-- Atualização de 04/11/2026: tipos e categorias de time, repertório do Louvor, liderança pelo administrador,
-- membros da igreja, convidados de outras igrejas e funções por tipo de time.
-- Pode ser executada mais de uma vez sem problema. Cole tudo no SQL Editor do Supabase e clique em Run.

-- >>> supabase/migrations/20261104000001_team_types.sql
-- =====================================================================
-- Tipos de time, repertório exclusivo do Louvor, funções por tipo,
-- liderança definida só pelo administrador e convite para a igreja
-- A igreja (organização) reúne os times; cada time tem um tipo.
-- O repertório, o player e os arquivos das músicas só ficam acessíveis para
-- administradores da igreja e integrantes de times cujo tipo usa repertório.
-- =====================================================================

alter table public.teams
  add column if not exists team_type text not null default 'louvor'
    check (team_type in ('louvor','multimidia','diaconal','recepcao','infantil','intercessao','outro')),
  add column if not exists team_type_label text;   -- nome digitado quando o tipo é "outro"

-- Tipos de time que usam o repertório (ajustar aqui para liberar a outros tipos no futuro)
create or replace function public.repertoire_types() returns text[]
language sql immutable as $$ select array['louvor']::text[] $$;

create or replace function public.team_has_repertoire(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams where id = p_team and team_type = any(repertoire_types()))
$$;

-- Quem pode ver o repertório da igreja
create or replace function public.has_repertoire(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_org_admin(p_org) or exists (
    select 1 from team_members tm join teams t on t.id = tm.team_id
    where tm.org_id = p_org and tm.user_id = auth.uid() and t.team_type = any(repertoire_types()))
$$;

-- Quem pode cadastrar e editar músicas: administrador ou líder de um time com repertório
create or replace function public.is_repertoire_staff(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_org_admin(p_org) or exists (
    select 1 from team_members tm join teams t on t.id = tm.team_id
    where tm.org_id = p_org and tm.user_id = auth.uid() and tm.is_leader and t.team_type = any(repertoire_types()))
$$;

-- Políticas do repertório -------------------------------------------------
drop policy if exists songs_select on public.songs;
drop policy if exists songs_insert on public.songs;
drop policy if exists songs_update on public.songs;
drop policy if exists songs_delete on public.songs;
create policy songs_select on public.songs for select to authenticated using (public.has_repertoire(org_id));
create policy songs_insert on public.songs for insert to authenticated
  with check (public.is_repertoire_staff(org_id) and source = 'manual' and drive_folder_id is null
              and status = 'ready' and current_project_id is null);
create policy songs_update on public.songs for update to authenticated
  using (public.is_repertoire_staff(org_id)) with check (public.is_repertoire_staff(org_id));
create policy songs_delete on public.songs for delete to authenticated
  using (public.is_repertoire_staff(org_id) and source = 'manual');

drop policy if exists sf_select on public.song_files;
drop policy if exists sf_insert on public.song_files;
drop policy if exists sf_delete on public.song_files;
create policy sf_select on public.song_files for select to authenticated using (public.has_repertoire(org_id));
create policy sf_insert on public.song_files for insert to authenticated
  with check (public.is_repertoire_staff(org_id) and exists (select 1 from public.songs s where s.id = song_id and s.org_id = song_files.org_id));
create policy sf_delete on public.song_files for delete to authenticated using (public.is_repertoire_staff(org_id));

drop policy if exists mp_select on public.multitrack_projects;
drop policy if exists pt_select on public.project_tracks;
drop policy if exists pm_select on public.project_markers;
drop policy if exists pme_select on public.project_media;
create policy mp_select on public.multitrack_projects for select to authenticated using (public.has_repertoire(org_id));
create policy pt_select on public.project_tracks for select to authenticated using (public.has_repertoire(org_id));
create policy pm_select on public.project_markers for select to authenticated using (public.has_repertoire(org_id));
create policy pme_select on public.project_media for select to authenticated using (public.has_repertoire(org_id));

drop policy if exists mix_all on public.mix_presets;
create policy mix_all on public.mix_presets for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.songs s where s.id = song_id and public.has_repertoire(s.org_id)));

-- Músicas na escala só em times com repertório
drop policy if exists ss_insert on public.schedule_songs;
create policy ss_insert on public.schedule_songs for insert to authenticated
  with check (public.can_manage_team(team_id) and public.team_has_repertoire(team_id)
              and exists (select 1 from public.schedules s where s.id = schedule_id and s.team_id = schedule_songs.team_id and s.org_id = schedule_songs.org_id)
              and (song_id is null or exists (select 1 from public.songs g where g.id = song_id and g.org_id = schedule_songs.org_id)));

-- Compartilhar música no chat só em times com repertório
drop policy if exists msg_insert on public.messages;
create policy msg_insert on public.messages for insert to authenticated
  with check (user_id = auth.uid() and public.is_team_member(team_id) and org_id = public.team_org(team_id)
              and (song_id is null or (public.team_has_repertoire(team_id) and exists (select 1 from public.songs s where s.id = song_id and s.org_id = messages.org_id)))
              and (poll_id is null or exists (select 1 from public.polls p where p.id = poll_id and p.team_id = messages.team_id)));

-- Áudio do Drive para o player
create or replace function public.can_read_drive_file(p_file_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from project_media pm where pm.drive_file_id = p_file_id and has_repertoire(pm.org_id))
$$;

-- Arquivos (Storage)
create or replace function public.storage_can_write(p_bucket text, p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare f text[] := storage.foldername(p_name); v_org uuid; v_team uuid;
begin
  if auth.uid() is null or array_length(f, 1) is null then return false; end if;
  begin
    if f[1] = 'avatars' then return f[2] = auth.uid()::text; end if;
    v_org := f[2]::uuid;
    if f[1] in ('teams','chat','files') then v_team := f[3]::uuid; end if;
  exception when others then return false; end;
  if p_bucket = 'media' then
    if f[1] = 'orgs' then return is_org_admin(v_org); end if;
    if f[1] = 'teams' then return team_org(v_team) = v_org and can_manage_team(v_team); end if;
    if f[1] = 'songs' then return is_repertoire_staff(v_org); end if;
    if f[1] = 'announcements' then return is_org_member(v_org); end if;
  elsif p_bucket = 'private' then
    if f[1] = 'chat' then return team_org(v_team) = v_org and is_team_member(v_team); end if;
    if f[1] = 'files' then return team_org(v_team) = v_org and can_manage_team(v_team); end if;
    if f[1] = 'songs' then return is_repertoire_staff(v_org); end if;
  end if;
  return false;
end $$;

create or replace function public.storage_can_read(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare f text[] := storage.foldername(p_name); v_org uuid; v_team uuid;
begin
  if auth.uid() is null or array_length(f, 1) is null then return false; end if;
  begin
    v_org := f[2]::uuid;
    if f[1] in ('chat','files') then v_team := f[3]::uuid; end if;
  exception when others then return false; end;
  if f[1] = 'chat' then return team_org(v_team) = v_org and is_team_member(v_team); end if;
  if f[1] = 'files' then return team_org(v_team) = v_org and (is_team_member(v_team) or is_org_admin(v_org)); end if;
  if f[1] = 'songs' then return has_repertoire(v_org); end if;
  return false;
end $$;

-- =====================================================================
-- Funções por tipo de time
-- team_type nulo = função disponível para qualquer tipo de time
-- =====================================================================
alter table public.music_roles
  add column if not exists team_type text
    check (team_type is null or team_type in ('louvor','multimidia','diaconal','recepcao','infantil','intercessao','outro'));
alter table public.music_roles drop constraint if exists music_roles_org_id_name_key;
create unique index if not exists music_roles_org_type_name on public.music_roles (org_id, coalesce(team_type, ''), lower(name));
update public.music_roles set team_type = 'louvor' where team_type is null;

-- função só pode ser dada a integrante de um time do mesmo tipo
drop policy if exists tmr_insert on public.team_member_roles;
create policy tmr_insert on public.team_member_roles for insert to authenticated
  with check (public.can_manage_team(team_id) and org_id = public.team_org(team_id)
              and exists (select 1 from public.music_roles r join public.teams t on t.id = team_member_roles.team_id
                          where r.id = role_id and r.org_id = team_member_roles.org_id
                            and (r.team_type is null or r.team_type = t.team_type)));

create or replace function public.set_member_roles(p_team uuid, p_user uuid, p_roles uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := team_org(p_team); v_type text := (select team_type from teams where id = p_team);
begin
  if not can_manage_team(p_team) then raise exception 'forbidden'; end if;
  delete from team_member_roles where team_id = p_team and user_id = p_user and not (role_id = any(p_roles));
  insert into team_member_roles (team_id, user_id, role_id, org_id)
  select p_team, p_user, r.id, v_org from music_roles r
  where r.id = any(p_roles) and r.org_id = v_org and (r.team_type is null or r.team_type = v_type)
  on conflict do nothing;
end $$;

-- ao copiar/mover integrante, só levam as funções compatíveis com o tipo do time de destino
create or replace function public.copy_team_member(p_from uuid, p_to uuid, p_user uuid, p_move boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := team_org(p_from); v_type text := (select team_type from teams where id = p_to);
begin
  if v_org is null or v_org <> team_org(p_to) then raise exception 'different_org'; end if;
  if not (can_manage_team(p_to) and (not p_move or can_manage_team(p_from))) then raise exception 'forbidden'; end if;
  if not exists (select 1 from team_members where team_id = p_from and user_id = p_user) then raise exception 'not_member'; end if;
  insert into team_members (team_id, user_id, org_id, monthly_limit, avoid_with)
  select p_to, user_id, org_id, monthly_limit, avoid_with from team_members where team_id = p_from and user_id = p_user
  on conflict do nothing;
  insert into team_member_roles (team_id, user_id, role_id, org_id)
  select p_to, m.user_id, m.role_id, m.org_id from team_member_roles m join music_roles r on r.id = m.role_id
  where m.team_id = p_from and m.user_id = p_user and (r.team_type is null or r.team_type = v_type)
  on conflict do nothing;
  if p_move then delete from team_members where team_id = p_from and user_id = p_user; end if;
end $$;

-- novas igrejas já recebem as funções do Louvor
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
  insert into music_roles (org_id, name, sort, team_type)
  select v_org, n, o, 'louvor' from unnest(array['Ministro','Vocal masculino','Vocal feminino','Soprano','Contralto','Tenor',
    'Violão','Guitarra','Baixo','Teclado','Bateria','Volante']) with ordinality as x(n, o);
  return v_org;
end $$;
revoke execute on function public.create_organization(text, text, text) from anon;

-- =====================================================================
-- Liderança: somente o administrador geral define os líderes dos times
-- =====================================================================
-- (sem security definer: current_user precisa ser o papel de quem está usando o app)
create or replace function public.guard_team_leader() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and not is_org_admin(new.org_id)
     and ((tg_op = 'INSERT' and new.is_leader) or (tg_op = 'UPDATE' and new.is_leader is distinct from old.is_leader)) then
    raise exception 'only_admin_sets_leader';
  end if;
  return new;
end $$;
drop trigger if exists t_guard_team_leader on public.team_members;
create trigger t_guard_team_leader before insert or update on public.team_members
  for each row execute function public.guard_team_leader();

-- =====================================================================
-- Membros da igreja: convite da igreja (sem time). A entrada em um time
-- continua sendo só por convite ou inclusão feita pelo líder/administrador.
-- =====================================================================
alter table public.invites alter column team_id drop not null;

drop policy if exists inv_select on public.invites;
drop policy if exists inv_update on public.invites;
create policy inv_select on public.invites for select to authenticated
  using (case when team_id is null then public.is_org_admin(org_id) else public.can_manage_team(team_id) end);
create policy inv_update on public.invites for update to authenticated
  using (case when team_id is null then public.is_org_admin(org_id) else public.can_manage_team(team_id) end)
  with check (case when team_id is null then public.is_org_admin(org_id) else public.can_manage_team(team_id) end);

create or replace function public.create_org_invite(p_org uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not is_org_admin(p_org) then raise exception 'forbidden'; end if;
  insert into invites (token, org_id, team_id, created_by) values (v_token, p_org, null, auth.uid());
  return v_token;
end $$;
revoke execute on function public.create_org_invite(uuid) from anon;

create or replace function public.get_invite(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'valid', i.revoked_at is null and i.expires_at > now(),
    'expired', i.expires_at <= now(), 'revoked', i.revoked_at is not null,
    'team', case when t.id is null then null else jsonb_build_object('id', t.id, 'name', t.name, 'logo_url', t.logo_url, 'accent_color', t.accent_color,
                               'members', (select count(*) from team_members where team_id = t.id)) end,
    'org', jsonb_build_object('id', o.id, 'name', o.name, 'logo_url', o.logo_url, 'accent_color', o.accent_color,
                              'members', (select count(*) from org_members where org_id = o.id)),
    'already_member', case when t.id is null then exists (select 1 from org_members where org_id = o.id and user_id = auth.uid())
                           else exists (select 1 from team_members where team_id = t.id and user_id = auth.uid()) end)
  from invites i left join teams t on t.id = i.team_id join organizations o on o.id = i.org_id
  where i.token = p_token
$$;
grant execute on function public.get_invite(text) to anon, authenticated;

create or replace function public.accept_invite(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_inv invites%rowtype; v_uid uuid := auth.uid(); v_name text; v_where text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_inv from invites where token = p_token for update;
  if not found then raise exception 'invite_not_found'; end if;
  if v_inv.revoked_at is not null or v_inv.expires_at <= now() then raise exception 'invite_expired'; end if;
  if v_inv.team_id is null then
    if exists (select 1 from org_members where org_id = v_inv.org_id and user_id = v_uid) then
      return jsonb_build_object('status', 'already_member', 'org_id', v_inv.org_id, 'team_id', null);
    end if;
    insert into org_members (org_id, user_id, role) values (v_inv.org_id, v_uid, 'member');
    select name into v_where from organizations where id = v_inv.org_id;
  else
    if exists (select 1 from team_members where team_id = v_inv.team_id and user_id = v_uid) then
      return jsonb_build_object('status', 'already_member', 'org_id', v_inv.org_id, 'team_id', v_inv.team_id);
    end if;
    -- entra como integrante comum: o convite nunca concede liderança nem administração
    insert into org_members (org_id, user_id, role) values (v_inv.org_id, v_uid, 'member') on conflict do nothing;
    insert into team_members (team_id, user_id, org_id) values (v_inv.team_id, v_uid, v_inv.org_id);
    select name into v_where from teams where id = v_inv.team_id;
  end if;
  update invites set uses = uses + 1 where id = v_inv.id;
  select full_name into v_name from profiles where id = v_uid;
  if v_inv.created_by is not null and v_inv.created_by <> v_uid then
    perform notify_user(v_inv.created_by, v_inv.org_id, 'invite_accepted', coalesce(v_name, 'Alguém') || ' aceitou seu convite',
      v_where, case when v_inv.team_id is null then '#/org' else '#/times/' || v_inv.team_id end);
  end if;
  return jsonb_build_object('status', 'joined', 'org_id', v_inv.org_id, 'team_id', v_inv.team_id);
end $$;
revoke execute on function public.accept_invite(text) from anon;

-- >>> supabase/migrations/20261104000002_guests.sql
-- =====================================================================
-- Categoria do time e convidados de outras igrejas
--   ministry = Ministério da igreja: só membros cadastrados da igreja
--   open     = Time aberto a convidados: aceita pessoas de outras igrejas
-- Convidado: tem vínculo "guest" com a igreja e participa SOMENTE dos times
-- para os quais foi convidado. Não é membro, não vê a igreja inteira.
-- =====================================================================

alter table public.teams
  add column if not exists category text not null default 'ministry' check (category in ('ministry','open'));

alter table public.org_members drop constraint if exists org_members_role_check;
alter table public.org_members add constraint org_members_role_check check (role in ('admin','member','guest'));

alter table public.team_members
  add column if not exists is_guest boolean not null default false,
  add column if not exists guest_church text,
  add column if not exists access_until date;      -- opcional: acesso termina nesta data

-- ---------------------------------------------------------------- funções de permissão
-- membro de verdade (admin ou membro), sem convidados
create or replace function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role <> 'guest')
$$;

-- qualquer vínculo com a igreja, inclusive convidado
create or replace function public.in_org(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid())
$$;

-- participação ativa no time (convidado com acesso vencido deixa de participar)
create or replace function public.is_team_member(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id = p_team and user_id = auth.uid()
                 and (access_until is null or access_until >= (now() at time zone 'America/Sao_Paulo')::date))
$$;

create or replace function public.shares_team(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members a join team_members b on a.team_id = b.team_id
    where a.user_id = auth.uid() and b.user_id = p_user
      and (a.access_until is null or a.access_until >= (now() at time zone 'America/Sao_Paulo')::date))
$$;

-- perfis visíveis: quem é da mesma igreja (sem contar convidados) ou divide um time
create or replace function public.shares_org(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user = auth.uid()
      or exists (select 1 from org_members a join org_members b on a.org_id = b.org_id
                 where a.user_id = auth.uid() and b.user_id = p_user and a.role <> 'guest' and b.role <> 'guest')
      or exists (select 1 from org_members a join org_members b on a.org_id = b.org_id
                 where a.user_id = auth.uid() and a.role <> 'guest' and b.user_id = p_user and b.role = 'guest')
      or shares_team(p_user)
$$;

create or replace function public.has_repertoire(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_org_admin(p_org) or exists (
    select 1 from team_members tm join teams t on t.id = tm.team_id
    where tm.org_id = p_org and tm.user_id = auth.uid() and t.team_type = any(repertoire_types())
      and (tm.access_until is null or tm.access_until >= (now() at time zone 'America/Sao_Paulo')::date))
$$;

-- ---------------------------------------------------------------- políticas
drop policy if exists org_select on public.organizations;
create policy org_select on public.organizations for select to authenticated using (public.in_org(id));

drop policy if exists om_select on public.org_members;
create policy om_select on public.org_members for select to authenticated
  using (public.is_org_member(org_id) or user_id = auth.uid() or (public.in_org(org_id) and public.shares_team(user_id)));

drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select to authenticated
  using (public.is_org_member(org_id) or public.is_team_member(id));

drop policy if exists tm_select on public.team_members;
create policy tm_select on public.team_members for select to authenticated
  using (public.is_org_member(org_id) or public.is_team_member(team_id));

drop policy if exists tm_insert on public.team_members;
create policy tm_insert on public.team_members for insert to authenticated
  with check (public.can_manage_team(team_id) and org_id = public.team_org(team_id)
              and exists (select 1 from public.org_members m where m.org_id = team_members.org_id and m.user_id = team_members.user_id and m.role <> 'guest'));

drop policy if exists mr_select on public.music_roles;
create policy mr_select on public.music_roles for select to authenticated using (public.in_org(org_id));

drop policy if exists tmr_select on public.team_member_roles;
create policy tmr_select on public.team_member_roles for select to authenticated
  using (public.is_org_member(org_id) or public.is_team_member(team_id));

drop policy if exists sch_select on public.schedules;
create policy sch_select on public.schedules for select to authenticated
  using ((status = 'published' and (public.is_org_member(org_id) or public.is_team_member(team_id))) or public.can_manage_team(team_id));

drop policy if exists sa_select on public.schedule_assignments;
create policy sa_select on public.schedule_assignments for select to authenticated
  using (exists (select 1 from public.schedules s where s.id = schedule_id
                 and ((s.status = 'published' and (public.is_org_member(s.org_id) or public.is_team_member(s.team_id))) or public.can_manage_team(s.team_id))));

drop policy if exists ss_select on public.schedule_songs;
create policy ss_select on public.schedule_songs for select to authenticated
  using (exists (select 1 from public.schedules s where s.id = schedule_id
                 and ((s.status = 'published' and (public.is_org_member(s.org_id) or public.is_team_member(s.team_id))) or public.can_manage_team(s.team_id))));

-- indisponibilidade: convidado registra a própria; membros veem as da igreja
drop policy if exists un_select on public.unavailability;
drop policy if exists un_insert on public.unavailability;
drop policy if exists un_update on public.unavailability;
create policy un_select on public.unavailability for select to authenticated
  using (public.is_org_member(org_id) or user_id = auth.uid());
create policy un_insert on public.unavailability for insert to authenticated
  with check (user_id = auth.uid() and public.in_org(org_id));
create policy un_update on public.unavailability for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.in_org(org_id));

-- ---------------------------------------------------------------- regras de entrada
create or replace function public.add_team_members(p_team uuid, p_users uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare v_org uuid := team_org(p_team); n int;
begin
  if not can_manage_team(p_team) then raise exception 'forbidden'; end if;
  insert into team_members (team_id, user_id, org_id)
  select p_team, u, v_org from unnest(p_users) u
  where exists (select 1 from org_members m where m.org_id = v_org and m.user_id = u and m.role <> 'guest')
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.copy_team_member(p_from uuid, p_to uuid, p_user uuid, p_move boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := team_org(p_from); v_type text := (select team_type from teams where id = p_to);
        v_open boolean := (select category = 'open' from teams where id = p_to);
        v_src team_members%rowtype;
begin
  if v_org is null or v_org <> team_org(p_to) then raise exception 'different_org'; end if;
  if not (can_manage_team(p_to) and (not p_move or can_manage_team(p_from))) then raise exception 'forbidden'; end if;
  select * into v_src from team_members where team_id = p_from and user_id = p_user;
  if not found then raise exception 'not_member'; end if;
  if v_src.is_guest and not v_open then raise exception 'not_church_member'; end if;
  insert into team_members (team_id, user_id, org_id, monthly_limit, avoid_with, is_guest, guest_church, access_until)
  values (p_to, v_src.user_id, v_src.org_id, v_src.monthly_limit, v_src.avoid_with, v_src.is_guest, v_src.guest_church, v_src.access_until)
  on conflict do nothing;
  insert into team_member_roles (team_id, user_id, role_id, org_id)
  select p_to, m.user_id, m.role_id, m.org_id from team_member_roles m join music_roles r on r.id = m.role_id
  where m.team_id = p_from and m.user_id = p_user and (r.team_type is null or r.team_type = v_type)
  on conflict do nothing;
  if p_move then delete from team_members where team_id = p_from and user_id = p_user; end if;
end $$;

create or replace function public.set_org_admin(p_org uuid, p_user uuid, p_admin boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_org_admin(p_org) then raise exception 'forbidden'; end if;
  if exists (select 1 from org_members where org_id = p_org and user_id = p_user and role = 'guest') then raise exception 'not_church_member'; end if;
  update org_members set role = case when p_admin then 'admin' else 'member' end
   where org_id = p_org and user_id = p_user;
  if not found then raise exception 'not_member'; end if;
  if p_admin then
    perform notify_user(p_user, p_org, 'admin', 'Você agora é administrador geral',
      (select name from organizations where id = p_org), '#/org');
  end if;
end $$;

-- convidado que vira membro (pelo convite da igreja) deixa de ser convidado
create or replace function public.get_invite(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'valid', i.revoked_at is null and i.expires_at > now(),
    'expired', i.expires_at <= now(), 'revoked', i.revoked_at is not null,
    'team', case when t.id is null then null else jsonb_build_object('id', t.id, 'name', t.name, 'logo_url', t.logo_url, 'accent_color', t.accent_color,
              'category', t.category, 'members', (select count(*) from team_members where team_id = t.id)) end,
    'org', jsonb_build_object('id', o.id, 'name', o.name, 'logo_url', o.logo_url, 'accent_color', o.accent_color,
              'members', (select count(*) from org_members where org_id = o.id and role <> 'guest')),
    'is_church_member', exists (select 1 from org_members where org_id = o.id and user_id = auth.uid() and role <> 'guest'),
    'already_member', case when t.id is null then exists (select 1 from org_members where org_id = o.id and user_id = auth.uid() and role <> 'guest')
                           else exists (select 1 from team_members where team_id = t.id and user_id = auth.uid()) end)
  from invites i left join teams t on t.id = i.team_id join organizations o on o.id = i.org_id
  where i.token = p_token
$$;
grant execute on function public.get_invite(text) to anon, authenticated;

drop function if exists public.accept_invite(text);
create or replace function public.accept_invite(p_token text, p_church text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_inv invites%rowtype; v_uid uuid := auth.uid(); v_name text; v_where text; v_role text; v_open boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_inv from invites where token = p_token for update;
  if not found then raise exception 'invite_not_found'; end if;
  if v_inv.revoked_at is not null or v_inv.expires_at <= now() then raise exception 'invite_expired'; end if;
  select role into v_role from org_members where org_id = v_inv.org_id and user_id = v_uid;

  if v_inv.team_id is null then
    -- convite da igreja: torna-se membro (se era convidado, passa a membro)
    if v_role in ('admin', 'member') then
      return jsonb_build_object('status', 'already_member', 'org_id', v_inv.org_id, 'team_id', null);
    end if;
    if v_role = 'guest' then
      update org_members set role = 'member' where org_id = v_inv.org_id and user_id = v_uid;
      update team_members set is_guest = false, guest_church = null where org_id = v_inv.org_id and user_id = v_uid;
    else
      insert into org_members (org_id, user_id, role) values (v_inv.org_id, v_uid, 'member');
    end if;
    select name into v_where from organizations where id = v_inv.org_id;
  else
    if exists (select 1 from team_members where team_id = v_inv.team_id and user_id = v_uid) then
      return jsonb_build_object('status', 'already_member', 'org_id', v_inv.org_id, 'team_id', v_inv.team_id);
    end if;
    select category = 'open', name into v_open, v_where from teams where id = v_inv.team_id;
    if v_role in ('admin', 'member') then
      insert into team_members (team_id, user_id, org_id) values (v_inv.team_id, v_uid, v_inv.org_id);
    elsif v_open then
      -- time aberto: quem não é membro entra como convidado, só neste time
      insert into org_members (org_id, user_id, role) values (v_inv.org_id, v_uid, 'guest') on conflict do nothing;
      insert into team_members (team_id, user_id, org_id, is_guest, guest_church)
      values (v_inv.team_id, v_uid, v_inv.org_id, true, nullif(trim(p_church), ''));
    else
      raise exception 'not_church_member';
    end if;
  end if;
  update invites set uses = uses + 1 where id = v_inv.id;
  select full_name into v_name from profiles where id = v_uid;
  if v_inv.created_by is not null and v_inv.created_by <> v_uid then
    perform notify_user(v_inv.created_by, v_inv.org_id, 'invite_accepted', coalesce(v_name, 'Alguém') || ' aceitou seu convite',
      v_where, case when v_inv.team_id is null then '#/org' else '#/times/' || v_inv.team_id end);
  end if;
  return jsonb_build_object('status', 'joined', 'org_id', v_inv.org_id, 'team_id', v_inv.team_id);
end $$;
revoke execute on function public.accept_invite(text, text) from anon;

-- time de ministério não pode receber convidado; time deixa de ser aberto só se não tiver convidados
create or replace function public.guard_team_category() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.category = 'ministry' and old.category = 'open'
     and exists (select 1 from team_members where team_id = new.id and is_guest) then
    raise exception 'team_has_guests';
  end if;
  return new;
end $$;
drop trigger if exists t_guard_team_category on public.teams;
create trigger t_guard_team_category before update of category on public.teams
  for each row execute function public.guard_team_category();

-- convidado que sai do último time deixa de ter vínculo com a igreja
create or replace function public.cleanup_guest() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return old; end if;  -- já está sendo removido junto com o vínculo da igreja
  if old.is_guest and not exists (select 1 from team_members where org_id = old.org_id and user_id = old.user_id) then
    delete from org_members where org_id = old.org_id and user_id = old.user_id and role = 'guest';
  end if;
  return old;
end $$;
drop trigger if exists t_cleanup_guest on public.team_members;
create trigger t_cleanup_guest after delete on public.team_members
  for each row execute function public.cleanup_guest();
