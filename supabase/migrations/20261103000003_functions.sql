-- =====================================================================
-- Funções de negócio (RPC), gatilhos de integridade e de notificações
-- =====================================================================

-- updated_at automático
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger t_profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger t_orgs_touch before update on public.organizations for each row execute function public.touch_updated_at();
create trigger t_teams_touch before update on public.teams for each row execute function public.touch_updated_at();
create trigger t_sched_touch before update on public.schedules for each row execute function public.touch_updated_at();
create trigger t_songs_touch before update on public.songs for each row execute function public.touch_updated_at();

-- Perfil criado junto com a conta
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id,
          coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
          nullif(trim(new.raw_user_meta_data->>'phone'), ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Envia notificação (uso interno)
create or replace function public.notify_user(p_user uuid, p_org uuid, p_kind text, p_title text,
  p_body text default null, p_link text default null, p_data jsonb default null) returns void
language sql security definer set search_path = public as $$
  insert into notifications (user_id, org_id, kind, title, body, link, data)
  values (p_user, p_org, p_kind, p_title, p_body, p_link, p_data)
$$;
revoke execute on function public.notify_user(uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Organização
-- ---------------------------------------------------------------------
create or replace function public.create_organization(p_name text, p_accent text default '#1EA7FF',
  p_subtitle text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required'; end if;
  insert into organizations (name, accent_color, subtitle, created_by)
  values (trim(p_name), coalesce(nullif(p_accent, ''), '#1EA7FF'), nullif(trim(p_subtitle), ''), v_uid)
  returning id into v_org;
  insert into org_members (org_id, user_id, role) values (v_org, v_uid, 'admin');
  insert into music_roles (org_id, name, sort)
  select v_org, n, o from unnest(array['Ministro','Vocal masculino','Vocal feminino','Soprano','Contralto','Tenor',
    'Violão','Guitarra','Baixo','Teclado','Bateria','Volante']) with ordinality as x(n, o);
  return v_org;
end $$;
revoke execute on function public.create_organization(text, text, text) from anon;

-- Impede organização sem administrador e troca de chaves do vínculo
create or replace function public.guard_org_members() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id or new.user_id <> old.user_id then raise exception 'immutable_keys'; end if;
    if old.role = 'admin' and new.role <> 'admin'
       and not exists (select 1 from org_members where org_id = old.org_id and role = 'admin' and user_id <> old.user_id) then
      raise exception 'last_admin';
    end if;
    return new;
  end if;
  -- DELETE
  if old.role = 'admin'
     and not exists (select 1 from org_members where org_id = old.org_id and role = 'admin' and user_id <> old.user_id)
     and exists (select 1 from organizations where id = old.org_id) then
    raise exception 'last_admin';
  end if;
  -- saiu da organização => sai dos times dela (a conta global continua existindo)
  delete from team_members where org_id = old.org_id and user_id = old.user_id;
  return old;
end $$;
create trigger t_guard_org_members before update or delete on public.org_members
  for each row execute function public.guard_org_members();

-- Concede/remove administrador geral (somente administradores)
create or replace function public.set_org_admin(p_org uuid, p_user uuid, p_admin boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_org_admin(p_org) then raise exception 'forbidden'; end if;
  update org_members set role = case when p_admin then 'admin' else 'member' end
   where org_id = p_org and user_id = p_user;
  if not found then raise exception 'not_member'; end if;
  if p_admin then
    perform notify_user(p_user, p_org, 'admin', 'Você agora é administrador geral',
      (select name from organizations where id = p_org), '#/org');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Times
-- ---------------------------------------------------------------------
create or replace function public.guard_team_members() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.team_id <> old.team_id or new.user_id <> old.user_id or new.org_id <> old.org_id) then
    raise exception 'immutable_keys';
  end if;
  -- "evitar escalar junto com" só aceita pessoas da mesma organização e nunca a própria pessoa
  new.avoid_with := coalesce((select array_agg(distinct a) from unnest(new.avoid_with) a
                              where a <> new.user_id and exists (select 1 from org_members m where m.org_id = new.org_id and m.user_id = a)), '{}');
  return new;
end $$;
create trigger t_guard_team_members before insert or update on public.team_members
  for each row execute function public.guard_team_members();

-- Adiciona vários usuários já cadastrados na organização a um time
create or replace function public.add_team_members(p_team uuid, p_users uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare v_org uuid := team_org(p_team); n int;
begin
  if not can_manage_team(p_team) then raise exception 'forbidden'; end if;
  insert into team_members (team_id, user_id, org_id)
  select p_team, u, v_org from unnest(p_users) u
  where exists (select 1 from org_members m where m.org_id = v_org and m.user_id = u)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Copia (ou move) um integrante para outro time da mesma organização, levando as funções
create or replace function public.copy_team_member(p_from uuid, p_to uuid, p_user uuid, p_move boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := team_org(p_from);
begin
  if v_org is null or v_org <> team_org(p_to) then raise exception 'different_org'; end if;
  if not (can_manage_team(p_to) and (not p_move or can_manage_team(p_from))) then raise exception 'forbidden'; end if;
  if not exists (select 1 from team_members where team_id = p_from and user_id = p_user) then raise exception 'not_member'; end if;
  insert into team_members (team_id, user_id, org_id, monthly_limit, avoid_with)
  select p_to, user_id, org_id, monthly_limit, avoid_with from team_members where team_id = p_from and user_id = p_user
  on conflict do nothing;
  insert into team_member_roles (team_id, user_id, role_id, org_id)
  select p_to, user_id, role_id, org_id from team_member_roles where team_id = p_from and user_id = p_user
  on conflict do nothing;
  if p_move then delete from team_members where team_id = p_from and user_id = p_user; end if;
end $$;

-- Define as funções musicais de um integrante no time (substitui a lista)
create or replace function public.set_member_roles(p_team uuid, p_user uuid, p_roles uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := team_org(p_team);
begin
  if not can_manage_team(p_team) then raise exception 'forbidden'; end if;
  delete from team_member_roles where team_id = p_team and user_id = p_user and not (role_id = any(p_roles));
  insert into team_member_roles (team_id, user_id, role_id, org_id)
  select p_team, p_user, r.id, v_org from music_roles r where r.id = any(p_roles) and r.org_id = v_org
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------
-- Convites
-- ---------------------------------------------------------------------
create or replace function public.create_team_invite(p_team uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not can_manage_team(p_team) then raise exception 'forbidden'; end if;
  insert into invites (token, org_id, team_id, created_by) values (v_token, team_org(p_team), p_team, auth.uid());
  return v_token;
end $$;

-- Prévia pública do convite (pode ser chamada antes do login)
create or replace function public.get_invite(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'valid', i.revoked_at is null and i.expires_at > now(),
    'expired', i.expires_at <= now(), 'revoked', i.revoked_at is not null,
    'team', jsonb_build_object('id', t.id, 'name', t.name, 'logo_url', t.logo_url, 'accent_color', t.accent_color,
                               'members', (select count(*) from team_members where team_id = t.id)),
    'org', jsonb_build_object('id', o.id, 'name', o.name, 'logo_url', o.logo_url, 'accent_color', o.accent_color),
    'already_member', exists (select 1 from team_members where team_id = t.id and user_id = auth.uid()))
  from invites i join teams t on t.id = i.team_id join organizations o on o.id = i.org_id
  where i.token = p_token
$$;
grant execute on function public.get_invite(text) to anon, authenticated;

create or replace function public.accept_invite(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_inv invites%rowtype; v_uid uuid := auth.uid(); v_name text; v_team text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_inv from invites where token = p_token for update;
  if not found then raise exception 'invite_not_found'; end if;
  if v_inv.revoked_at is not null or v_inv.expires_at <= now() then raise exception 'invite_expired'; end if;
  if exists (select 1 from team_members where team_id = v_inv.team_id and user_id = v_uid) then
    return jsonb_build_object('status', 'already_member', 'org_id', v_inv.org_id, 'team_id', v_inv.team_id);
  end if;
  -- entra como integrante comum: o convite nunca concede liderança nem administração
  insert into org_members (org_id, user_id, role) values (v_inv.org_id, v_uid, 'member') on conflict do nothing;
  insert into team_members (team_id, user_id, org_id) values (v_inv.team_id, v_uid, v_inv.org_id);
  update invites set uses = uses + 1 where id = v_inv.id;
  select full_name into v_name from profiles where id = v_uid;
  select name into v_team from teams where id = v_inv.team_id;
  if v_inv.created_by is not null and v_inv.created_by <> v_uid then
    perform notify_user(v_inv.created_by, v_inv.org_id, 'invite_accepted', coalesce(v_name, 'Alguém') || ' aceitou seu convite',
      v_team, '#/times/' || v_inv.team_id);
  end if;
  return jsonb_build_object('status', 'joined', 'org_id', v_inv.org_id, 'team_id', v_inv.team_id);
end $$;
revoke execute on function public.accept_invite(text) from anon;

-- ---------------------------------------------------------------------
-- Escalas
-- ---------------------------------------------------------------------
create or replace function public.guard_schedule() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and (new.org_id <> old.org_id or new.team_id <> old.team_id) then raise exception 'immutable_keys'; end if;
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') then new.published_at := now(); end if;
  return new;
end $$;
create trigger t_guard_schedule before insert or update on public.schedules
  for each row execute function public.guard_schedule();

-- Integrante marca que tomou conhecimento da escala
create or replace function public.mark_schedule_seen(p_schedule uuid) returns void
language sql security definer set search_path = public as $$
  update schedule_assignments set seen_at = coalesce(seen_at, now())
  where schedule_id = p_schedule and user_id = auth.uid()
    and exists (select 1 from schedules s where s.id = p_schedule and s.status = 'published')
$$;

-- Candidatos para cada função, com disponibilidade, limite mensal e preferências.
-- Usado pela "sugestão de escala": não grava nada, só informa.
create or replace function public.schedule_candidates(p_team uuid, p_starts timestamptz, p_ends timestamptz default null,
  p_exclude_schedule uuid default null)
returns table (user_id uuid, role_id uuid, display_name text, available boolean, unavailable_note text,
               month_count int, monthly_limit int, same_day_count int, avoid_with uuid[])
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := team_org(p_team); v_end timestamptz := coalesce(p_ends, p_starts + interval '2 hours');
        v_day date := (p_starts at time zone 'America/Sao_Paulo')::date;
begin
  if not can_manage_team(p_team) then raise exception 'forbidden'; end if;
  return query
  select tm.user_id, r.role_id,
         coalesce(om.display_name, p.full_name),
         not exists (select 1 from unavailability u where u.user_id = tm.user_id and u.org_id = v_org
                     and v_day between u.start_date and u.end_date
                     and (u.all_day or ((v_day + u.start_time) at time zone 'America/Sao_Paulo' < v_end
                                        and (v_day + u.end_time) at time zone 'America/Sao_Paulo' > p_starts))),
         (select string_agg(coalesce(u.note, 'Indisponível'), '; ') from unavailability u
           where u.user_id = tm.user_id and u.org_id = v_org and v_day between u.start_date and u.end_date),
         (select count(distinct a.schedule_id)::int from schedule_assignments a join schedules s on s.id = a.schedule_id
           where a.user_id = tm.user_id and s.org_id = v_org and s.id is distinct from p_exclude_schedule
             and date_trunc('month', s.starts_at at time zone 'America/Sao_Paulo') = date_trunc('month', p_starts at time zone 'America/Sao_Paulo')),
         tm.monthly_limit,
         (select count(distinct a.schedule_id)::int from schedule_assignments a join schedules s on s.id = a.schedule_id
           where a.user_id = tm.user_id and s.org_id = v_org and s.id is distinct from p_exclude_schedule
             and (s.starts_at at time zone 'America/Sao_Paulo')::date = v_day),
         tm.avoid_with
  from team_members tm
  join team_member_roles r on r.team_id = tm.team_id and r.user_id = tm.user_id
  join org_members om on om.org_id = v_org and om.user_id = tm.user_id
  join profiles p on p.id = tm.user_id
  where tm.team_id = p_team;
end $$;

-- ---------------------------------------------------------------------
-- Biblioteca: campos que só o servidor de sincronização pode mudar
-- ---------------------------------------------------------------------
create or replace function public.guard_songs() returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.org_id <> old.org_id or new.source <> old.source or new.status <> old.status
       or new.drive_folder_id is distinct from old.drive_folder_id or new.current_project_id is distinct from old.current_project_id
       or new.duplicate_of is distinct from old.duplicate_of or new.retry_count <> old.retry_count then
      raise exception 'protected_fields';
    end if;
    -- músicas do Drive: título, artista, tom e BPM vêm do nome do projeto
    if old.source = 'drive' and (new.title <> old.title or new.artist is distinct from old.artist
       or new.song_key is distinct from old.song_key or new.bpm is distinct from old.bpm) then
      raise exception 'drive_managed_fields';
    end if;
  end if;
  return new;
end $$;
create trigger t_guard_songs before update on public.songs for each row execute function public.guard_songs();

-- Ao montar escala, guarda título/artista para preservar o histórico
create or replace function public.fill_schedule_song() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.song_id is not null and (tg_op = 'INSERT' or new.song_id is distinct from old.song_id) then
    select title, artist, coalesce(new.song_key, song_key) into new.title_snapshot, new.artist_snapshot, new.song_key
    from songs where id = new.song_id;
  end if;
  return new;
end $$;
create trigger t_fill_schedule_song before insert or update on public.schedule_songs
  for each row execute function public.fill_schedule_song();

-- O servidor de mídia usa esta função (com o login do usuário) antes de transmitir um áudio do Drive
create or replace function public.can_read_drive_file(p_file_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from project_media pm where pm.drive_file_id = p_file_id and is_org_member(pm.org_id))
$$;

-- ---------------------------------------------------------------------
-- Notificações automáticas
-- ---------------------------------------------------------------------
create or replace function public.fmt_when(p timestamptz) returns text language sql immutable as $$
  select to_char(p at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI')
$$;

create or replace function public.on_schedule_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; v_team text;
begin
  select name into v_team from teams where id = new.team_id;
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') then
    for r in select distinct user_id from schedule_assignments where schedule_id = new.id loop
      perform notify_user(r.user_id, new.org_id, 'schedule_published', 'Você foi escalado(a): ' || new.title,
        v_team || ' · ' || fmt_when(new.starts_at), '#/escala/' || new.id, jsonb_build_object('schedule_id', new.id));
    end loop;
  elsif tg_op = 'UPDATE' and new.status = 'published' and old.status = 'published'
        and (new.starts_at <> old.starts_at or new.ends_at is distinct from old.ends_at or new.title <> old.title
             or new.location is distinct from old.location) then
    for r in select distinct user_id from schedule_assignments where schedule_id = new.id loop
      perform notify_user(r.user_id, new.org_id, 'schedule_changed', 'Escala alterada: ' || new.title,
        v_team || ' · ' || fmt_when(new.starts_at), '#/escala/' || new.id, jsonb_build_object('schedule_id', new.id));
    end loop;
  end if;
  return new;
end $$;
create trigger t_schedule_notify after insert or update on public.schedules
  for each row execute function public.on_schedule_change();

create or replace function public.on_assignment_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare s schedules%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into s from schedules where id = new.schedule_id;
    if s.status = 'published' and not exists (select 1 from schedule_assignments
        where schedule_id = new.schedule_id and user_id = new.user_id and id <> new.id) then
      perform notify_user(new.user_id, s.org_id, 'schedule_published', 'Você foi escalado(a): ' || s.title,
        (select name from teams where id = s.team_id) || ' · ' || fmt_when(s.starts_at), '#/escala/' || s.id,
        jsonb_build_object('schedule_id', s.id));
    end if;
    return new;
  end if;
  select * into s from schedules where id = old.schedule_id;
  if found and s.status = 'published' and not exists (select 1 from schedule_assignments
      where schedule_id = old.schedule_id and user_id = old.user_id and id <> old.id) then
    perform notify_user(old.user_id, s.org_id, 'schedule_changed', 'Você saiu da escala: ' || s.title,
      fmt_when(s.starts_at), '#/escala/' || s.id, jsonb_build_object('schedule_id', s.id));
  end if;
  return old;
end $$;
create trigger t_assignment_notify after insert or delete on public.schedule_assignments
  for each row execute function public.on_assignment_change();

create or replace function public.on_announcement() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, org_id, kind, title, body, link, data)
  select u, new.org_id, 'announcement', 'Novo aviso: ' || new.title, left(coalesce(new.body, ''), 140),
         case when new.team_id is null then '#/avisos' else '#/times/' || new.team_id || '/avisos' end,
         jsonb_build_object('announcement_id', new.id)
  from (select user_id u from org_members where new.team_id is null and org_id = new.org_id
        union select user_id from team_members where new.team_id is not null and team_id = new.team_id) x
  where u is distinct from new.created_by;
  return new;
end $$;
create trigger t_announcement_notify after insert on public.announcements
  for each row execute function public.on_announcement();

-- Uma notificação de chat por pessoa e por time (atualizada a cada mensagem nova)
create or replace function public.on_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_team text; v_author text; v_preview text;
begin
  select name into v_team from teams where id = new.team_id;
  select full_name into v_author from profiles where id = new.user_id;
  v_preview := case new.kind when 'text' then left(coalesce(new.body, ''), 120) when 'image' then '📷 Foto'
               when 'file' then '📎 Arquivo' when 'song' then '🎵 Música' when 'poll' then '📊 Enquete' else '' end;
  delete from notifications n using team_members tm
   where tm.team_id = new.team_id and n.user_id = tm.user_id and n.kind = 'message'
     and n.read_at is null and n.data->>'team_id' = new.team_id::text;
  insert into notifications (user_id, org_id, kind, title, body, link, data)
  select tm.user_id, new.org_id, 'message', v_team, coalesce(v_author, '') || ': ' || v_preview,
         '#/chat/' || new.team_id, jsonb_build_object('team_id', new.team_id)
  from team_members tm where tm.team_id = new.team_id and tm.user_id is distinct from new.user_id;
  return new;
end $$;
create trigger t_message_notify after insert on public.messages
  for each row execute function public.on_message();

create or replace function public.on_team_member() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_team text; v_name text;
begin
  select name into v_team from teams where id = new.team_id;
  select full_name into v_name from profiles where id = new.user_id;
  if new.user_id is distinct from auth.uid() then
    perform notify_user(new.user_id, new.org_id, 'team_joined', 'Você entrou no time ' || v_team, null, '#/times/' || new.team_id);
  end if;
  insert into notifications (user_id, org_id, kind, title, body, link)
  select tm.user_id, new.org_id, 'team_joined', coalesce(v_name, 'Novo integrante') || ' entrou no time', v_team, '#/times/' || new.team_id
  from team_members tm where tm.team_id = new.team_id and tm.is_leader and tm.user_id <> new.user_id
    and tm.user_id is distinct from auth.uid();
  return new;
end $$;
create trigger t_team_member_notify after insert on public.team_members
  for each row execute function public.on_team_member();

create or replace function public.on_leader_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_leader and not old.is_leader then
    perform notify_user(new.user_id, new.org_id, 'leader', 'Você agora é líder do time ' || (select name from teams where id = new.team_id),
      null, '#/times/' || new.team_id);
  end if;
  return new;
end $$;
create trigger t_leader_notify after update of is_leader on public.team_members
  for each row execute function public.on_leader_change();

-- Contagem de mensagens não lidas por time (para a lista de conversas)
create or replace function public.chat_overview(p_org uuid)
returns table (team_id uuid, last_message_at timestamptz, last_body text, last_kind text, last_author text, unread int)
language sql stable security definer set search_path = public as $$
  select t.id,
         lm.created_at, lm.body, lm.kind, lp.full_name,
         (select count(*)::int from messages m where m.team_id = t.id and m.deleted_at is null and m.user_id is distinct from auth.uid()
            and m.created_at > coalesce((select last_read_at from chat_reads cr where cr.team_id = t.id and cr.user_id = auth.uid()), '-infinity'))
  from teams t
  join team_members tm on tm.team_id = t.id and tm.user_id = auth.uid()
  left join lateral (select * from messages m where m.team_id = t.id and m.deleted_at is null order by created_at desc limit 1) lm on true
  left join profiles lp on lp.id = lm.user_id
  where t.org_id = p_org
$$;

-- Realtime (chat e notificações ao vivo)
alter publication supabase_realtime add table public.messages, public.poll_votes, public.notifications;
