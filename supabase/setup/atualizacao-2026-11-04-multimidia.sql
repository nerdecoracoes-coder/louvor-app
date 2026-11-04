-- Atualização de 04/11/2026 (Multimídia). Pode rodar mais de uma vez. Cole tudo no SQL Editor do Supabase e clique em Run.
-- =====================================================================
-- Ministério de Multimídia (04/11/2026): roteiro do culto, pedidos de mídia, checklist pré-culto
-- e funções padrão por tipo de time.
-- Recursos novos de time: roteiro, pedidos, checklist (o tipo Multimídia já vem com os três).
-- =====================================================================

-- ---------------------------------------------------------------- recursos do time
create or replace function public.team_feature_preset(p_type text) returns text[]
language sql immutable as $$
  select case p_type
    when 'louvor' then array['repertorio']::text[]
    when 'multimidia' then array['checklist','pedidos','roteiro']::text[]
    else '{}'::text[] end
$$;

create or replace function public.fill_team_features() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.features is null then new.features := team_feature_preset(new.team_type); end if;
  new.features := array(select distinct x from unnest(new.features) x where x in ('repertorio','roteiro','pedidos','checklist') order by 1);
  if tg_op = 'UPDATE' and new.features is distinct from old.features
     and auth.uid() is not null and not is_org_admin(new.org_id) then
    raise exception 'only_admin_sets_features';
  end if;
  return new;
end $$;

-- times de Multimídia que ainda não tinham recurso nenhum recebem os do tipo
update public.teams set features = public.team_feature_preset('multimidia') where team_type = 'multimidia' and coalesce(features, '{}') = '{}';

create or replace function public.team_has_feature(p_team uuid, p_feature text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams where id = p_team and p_feature = any(features))
$$;

-- ---------------------------------------------------------------- funções padrão por tipo
create or replace function public.ensure_type_roles(p_org uuid, p_type text) returns void
language plpgsql security definer set search_path = public as $$
declare names text[];
begin
  names := case p_type
    when 'multimidia' then array['Direção','Projeção','Transmissão/Corte','Câmera 2','Câmera 3','Iluminação']
    else null end;
  if names is null or exists (select 1 from music_roles where org_id = p_org and team_type = p_type) then return; end if;
  insert into music_roles (org_id, name, sort, team_type)
  select p_org, n, i, p_type from unnest(names) with ordinality as t(n, i)
  on conflict do nothing;
end $$;
revoke execute on function public.ensure_type_roles(uuid, text) from public, anon, authenticated;

create or replace function public.team_type_roles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform ensure_type_roles(new.org_id, new.team_type);
  return null;
end $$;
drop trigger if exists t_team_type_roles on public.teams;
create trigger t_team_type_roles after insert or update of team_type on public.teams
  for each row execute function public.team_type_roles();
do $$ begin perform public.ensure_type_roles(org_id, team_type) from (select distinct org_id, team_type from public.teams) t; end $$;

-- ---------------------------------------------------------------- roteiro do culto
create table if not exists public.schedule_cues (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  position int not null default 0,
  at_time time,
  duration_min int check (duration_min is null or duration_min between 0 and 600),
  kind text not null default 'outro' check (kind in ('abertura','louvor','oracao','avisos','oferta','pregacao','video','ceia','encerramento','outro')),
  title text not null check (length(trim(title)) between 1 and 120),
  responsible text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists schedule_cues_sched on public.schedule_cues (schedule_id, position);
alter table public.schedule_cues enable row level security;
revoke all on public.schedule_cues from anon;
drop policy if exists sc_select on public.schedule_cues;
drop policy if exists sc_write on public.schedule_cues;
create policy sc_select on public.schedule_cues for select to authenticated using (public.is_team_member(team_id) or public.is_org_admin(org_id));
create policy sc_write on public.schedule_cues for all to authenticated
  using (public.can_manage_team(team_id))
  with check (public.can_manage_team(team_id) and public.team_has_feature(team_id, 'roteiro')
    and exists (select 1 from public.schedules s where s.id = schedule_id and s.team_id = schedule_cues.team_id and s.org_id = schedule_cues.org_id));

-- Músicas do louvor no mesmo culto (escalas publicadas de times com repertório, até 4 h antes ou depois),
-- com a letra, para o Multimídia preparar os slides. Quem é do time da escala pode consultar.
create or replace function public.service_songs(p_schedule uuid)
returns table (schedule_id uuid, schedule_title text, team_name text, starts_at timestamptz, pos int,
  song_id uuid, title text, artist text, song_key text, lyrics jsonb)
language sql stable security definer set search_path = public as $$
  select o.id, o.title, t.name, o.starts_at, ss.position, ss.song_id, ss.title_snapshot, ss.artist_snapshot,
         coalesce(ss.song_key, so.song_key), so.lyrics
  from schedules me
  join schedules o on o.org_id = me.org_id and o.id <> me.id and o.status = 'published'
                  and o.starts_at between me.starts_at - interval '4 hours' and me.starts_at + interval '4 hours'
  join teams t on t.id = o.team_id and 'repertorio' = any(t.features)
  join schedule_songs ss on ss.schedule_id = o.id
  left join songs so on so.id = ss.song_id
  where me.id = p_schedule and (is_team_member(me.team_id) or is_org_admin(me.org_id))
  order by o.starts_at, ss.position
$$;

-- ---------------------------------------------------------------- pedidos de mídia
create table if not exists public.media_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,      -- time que atende (Multimídia)
  requested_by uuid not null references auth.users(id) on delete cascade,
  from_team_id uuid references public.teams(id) on delete set null,          -- time de quem pediu (opcional)
  title text not null check (length(trim(title)) between 1 and 140),
  kind text not null default 'arte' check (kind in ('arte','video','slide','foto','outro')),
  description text,
  due_date date,
  status text not null default 'pendente' check (status in ('pendente','fazendo','pronto','cancelado')),
  assignee uuid references auth.users(id) on delete set null,
  delivery_url text,
  delivery_path text,
  delivery_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists media_requests_team on public.media_requests (team_id, status, due_date);
create index if not exists media_requests_by on public.media_requests (requested_by, created_at desc);
alter table public.media_requests enable row level security;
revoke all on public.media_requests from anon;
drop trigger if exists t_media_requests_touch on public.media_requests;
create trigger t_media_requests_touch before update on public.media_requests for each row execute function public.touch_updated_at();

drop policy if exists mr2_select on public.media_requests;
drop policy if exists mr2_insert on public.media_requests;
drop policy if exists mr2_update on public.media_requests;
drop policy if exists mr2_delete on public.media_requests;
create policy mr2_select on public.media_requests for select to authenticated
  using (requested_by = auth.uid() or public.is_team_member(team_id) or public.is_org_admin(org_id));
-- qualquer membro da igreja (ou integrante do próprio time) pede a um time que atende pedidos
create policy mr2_insert on public.media_requests for insert to authenticated
  with check (requested_by = auth.uid() and public.team_org(team_id) = org_id and public.team_has_feature(team_id, 'pedidos')
    and (public.is_org_member(org_id) or public.is_team_member(team_id)) and status = 'pendente');
create policy mr2_update on public.media_requests for update to authenticated
  using (requested_by = auth.uid() or public.is_team_member(team_id) or public.is_org_admin(org_id));
create policy mr2_delete on public.media_requests for delete to authenticated
  using ((requested_by = auth.uid() and status = 'pendente') or public.is_org_admin(org_id));

-- quem pediu só edita o próprio pedido enquanto pendente (ou cancela); quem atende muda situação, responsável e entrega
create or replace function public.guard_media_request() returns trigger
language plpgsql set search_path = public as $$
declare staff boolean := auth.uid() is null or is_team_member(old.team_id) or is_org_admin(old.org_id);
begin
  if new.org_id <> old.org_id or new.team_id <> old.team_id or new.requested_by <> old.requested_by then raise exception 'protected_fields'; end if;
  if staff then return new; end if;
  if new.status <> old.status and not (new.status = 'cancelado' and old.status = 'pendente') then raise exception 'forbidden'; end if;
  if old.status <> 'pendente' and (new.title, new.kind, new.description, new.due_date) is distinct from (old.title, old.kind, old.description, old.due_date) then raise exception 'forbidden'; end if;
  if (new.assignee, new.delivery_url, new.delivery_path, new.delivery_name) is distinct from (old.assignee, old.delivery_url, old.delivery_path, old.delivery_name) then raise exception 'forbidden'; end if;
  return new;
end $$;
drop trigger if exists t_guard_media_request on public.media_requests;
create trigger t_guard_media_request before update on public.media_requests for each row execute function public.guard_media_request();

create or replace function public.notify_media_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare tname text := (select name from teams where id = new.team_id);
begin
  if tg_op = 'INSERT' then
    perform notify_user(tm.user_id, new.org_id, 'media_request', 'Novo pedido: ' || new.title,
      coalesce(new.description, ''), '#/pedido/' || new.id, jsonb_build_object('request_id', new.id))
    from team_members tm where tm.team_id = new.team_id and tm.user_id <> new.requested_by;
  elsif new.status is distinct from old.status and new.status in ('fazendo','pronto') and new.requested_by <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) then
    perform notify_user(new.requested_by, new.org_id, 'media_request',
      case new.status when 'pronto' then 'Pedido pronto: ' else 'Pedido em andamento: ' end || new.title,
      tname, '#/pedido/' || new.id, jsonb_build_object('request_id', new.id));
  end if;
  return null;
end $$;
drop trigger if exists t_notify_media_request on public.media_requests;
create trigger t_notify_media_request after insert or update of status on public.media_requests
  for each row execute function public.notify_media_request();

-- ---------------------------------------------------------------- checklist pré-culto
create table if not exists public.team_checklist_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  position int not null default 0,
  label text not null check (length(trim(label)) between 1 and 140),
  created_at timestamptz not null default now()
);
create index if not exists team_checklist_items_team on public.team_checklist_items (team_id, position);
create table if not exists public.schedule_checks (
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  item_id uuid not null references public.team_checklist_items(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  checked_by uuid references auth.users(id) on delete set null,
  checked_at timestamptz not null default now(),
  primary key (schedule_id, item_id)
);
alter table public.team_checklist_items enable row level security;
alter table public.schedule_checks enable row level security;
revoke all on public.team_checklist_items from anon;
revoke all on public.schedule_checks from anon;
drop policy if exists tci_select on public.team_checklist_items;
drop policy if exists tci_write on public.team_checklist_items;
create policy tci_select on public.team_checklist_items for select to authenticated using (public.is_team_member(team_id) or public.is_org_admin(org_id));
create policy tci_write on public.team_checklist_items for all to authenticated
  using (public.can_manage_team(team_id))
  with check (public.can_manage_team(team_id) and public.team_org(team_id) = org_id and public.team_has_feature(team_id, 'checklist'));
drop policy if exists sck_select on public.schedule_checks;
drop policy if exists sck_insert on public.schedule_checks;
drop policy if exists sck_delete on public.schedule_checks;
create policy sck_select on public.schedule_checks for select to authenticated using (public.is_team_member(team_id) or public.is_org_admin(org_id));
create policy sck_insert on public.schedule_checks for insert to authenticated
  with check (public.is_team_member(team_id) and checked_by = auth.uid()
    and exists (select 1 from public.schedules s where s.id = schedule_id and s.team_id = schedule_checks.team_id and s.org_id = schedule_checks.org_id)
    and exists (select 1 from public.team_checklist_items i where i.id = item_id and i.team_id = schedule_checks.team_id));
create policy sck_delete on public.schedule_checks for delete to authenticated using (public.is_team_member(team_id));

-- ---------------------------------------------------------------- arquivos de pedidos (bucket privado)
-- caminho: requests/<igreja>/<time que atende>/<pedido>/<arquivo>
create or replace function public.storage_can_write(p_bucket text, p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare f text[] := storage.foldername(p_name); v_org uuid; v_team uuid; v_req uuid;
begin
  if auth.uid() is null or array_length(f, 1) is null then return false; end if;
  begin
    if f[1] = 'avatars' then return f[2] = auth.uid()::text; end if;
    v_org := f[2]::uuid;
    if f[1] in ('teams','chat','files','requests') then v_team := f[3]::uuid; end if;
    if f[1] = 'requests' then v_req := f[4]::uuid; end if;
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
    if f[1] = 'requests' then return exists (select 1 from media_requests r where r.id = v_req and r.team_id = v_team and r.org_id = v_org
      and (is_team_member(v_team) or r.requested_by = auth.uid())); end if;
  end if;
  return false;
end $$;

create or replace function public.storage_can_read(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare f text[] := storage.foldername(p_name); v_org uuid; v_team uuid; v_req uuid;
begin
  if auth.uid() is null or array_length(f, 1) is null then return false; end if;
  begin
    v_org := f[2]::uuid;
    if f[1] in ('chat','files','requests') then v_team := f[3]::uuid; end if;
    if f[1] = 'requests' then v_req := f[4]::uuid; end if;
  exception when others then return false; end;
  if f[1] = 'chat' then return team_org(v_team) = v_org and is_team_member(v_team); end if;
  if f[1] = 'files' then return team_org(v_team) = v_org and (is_team_member(v_team) or is_org_admin(v_org)); end if;
  if f[1] = 'songs' then return has_repertoire(v_org); end if;
  if f[1] = 'requests' then return exists (select 1 from media_requests r where r.id = v_req and r.team_id = v_team and r.org_id = v_org
      and (is_team_member(v_team) or r.requested_by = auth.uid() or is_org_admin(v_org))); end if;
  return false;
end $$;

-- tempo real: pedidos e checklist atualizam na tela de quem está olhando
do $$ begin
  begin alter publication supabase_realtime add table public.media_requests; exception when others then null; end;
  begin alter publication supabase_realtime add table public.schedule_checks; exception when others then null; end;
end $$;
