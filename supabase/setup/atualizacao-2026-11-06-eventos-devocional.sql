-- =====================================================================
-- Eventos do time (reuniões, fraternização...) e devocional semanal em vídeo (06/11/2026).
-- =====================================================================

create or replace function public.team_feature_preset(p_type text) returns text[]
language sql immutable as $$
  select case p_type
    when 'louvor' then array['devocional','eventos','letras','repertorio']::text[]
    when 'multimidia' then array['checklist','estudio','eventos','letras','pedidos','roteiro']::text[]
    when 'diaconal' then array['checklist','eventos','roteiro','visitantes']::text[]
    when 'infantil' then array['checklist','criancas','eventos']::text[]
    else array['eventos']::text[] end
$$;

create or replace function public.fill_team_features() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.features is null then new.features := team_feature_preset(new.team_type); end if;
  new.features := array(select distinct x from unnest(new.features) x where x in ('repertorio','roteiro','pedidos','checklist','criancas','visitantes','letras','estudio','eventos','devocional') order by 1);
  if tg_op = 'UPDATE' and new.features is distinct from old.features
     and auth.uid() is not null and not is_org_admin(new.org_id) then
    raise exception 'only_admin_sets_features';
  end if;
  return new;
end $$;

update public.teams set features = array(select distinct x from unnest(coalesce(features,'{}') || array['eventos']) x order by 1);
update public.teams set features = array(select distinct x from unnest(coalesce(features,'{}') || array['devocional']) x order by 1) where team_type = 'louvor';

-- vídeos do devocional: private/devotionals/<org_id>/<team_id>/...
create or replace function public.storage_can_write(p_bucket text, p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare f text[] := storage.foldername(p_name); v_org uuid; v_team uuid;
begin
  if auth.uid() is null or array_length(f, 1) is null then return false; end if;
  begin
    if f[1] = 'avatars' then return f[2] = auth.uid()::text; end if;
    v_org := f[2]::uuid;
    if f[1] in ('teams','chat','files','studio','devotionals') then v_team := f[3]::uuid; end if;
  exception when others then return false; end;
  if p_bucket = 'media' then
    if f[1] = 'orgs' then return is_org_admin(v_org); end if;
    if f[1] = 'teams' then return team_org(v_team) = v_org and can_manage_team(v_team); end if;
    if f[1] = 'songs' then return is_org_staff(v_org); end if;
    if f[1] = 'announcements' then return is_org_member(v_org); end if;
    if f[1] = 'studio' then return team_org(v_team) = v_org and (is_team_member(v_team) or can_manage_team(v_team)); end if;
  elsif p_bucket = 'private' then
    if f[1] = 'chat' then return team_org(v_team) = v_org and is_team_member(v_team); end if;
    if f[1] = 'files' then return team_org(v_team) = v_org and can_manage_team(v_team); end if;
    if f[1] = 'songs' then return is_org_staff(v_org); end if;
    if f[1] = 'devotionals' then return team_org(v_team) = v_org and (is_team_member(v_team) or can_manage_team(v_team)); end if;
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
    if f[1] in ('chat','files','devotionals') then v_team := f[3]::uuid; end if;
  exception when others then return false; end;
  if f[1] = 'chat' then return team_org(v_team) = v_org and is_team_member(v_team); end if;
  if f[1] = 'files' then return team_org(v_team) = v_org and (is_team_member(v_team) or is_org_admin(v_org)); end if;
  if f[1] = 'devotionals' then return team_org(v_team) = v_org and (is_team_member(v_team) or is_org_admin(v_org)); end if;
  if f[1] = 'songs' then return is_org_member(v_org); end if;
  return false;
end $$;

-- eventos do time
create table if not exists public.team_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  kind text not null default 'reuniao' check (kind in ('reuniao','fraternizacao','ensaio','estudo','outro')),
  description text check (char_length(description) <= 1000),
  location text check (char_length(location) <= 160),
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists team_events_team on public.team_events (team_id, starts_at);

create table if not exists public.team_event_rsvps (
  event_id uuid not null references public.team_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  answer text not null check (answer in ('vou','talvez','nao')),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- devocional semanal (vídeo enviado ou link)
create table if not exists public.team_devotionals (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 140),
  description text check (char_length(description) <= 1500),
  video_path text,
  video_url text check (video_url is null or char_length(video_url) <= 500),
  author_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (video_path is not null or video_url is not null)
);
create index if not exists team_devotionals_team on public.team_devotionals (team_id, created_at desc);

alter table public.team_events enable row level security;
alter table public.team_event_rsvps enable row level security;
alter table public.team_devotionals enable row level security;
revoke all on public.team_events, public.team_event_rsvps, public.team_devotionals from anon;

drop policy if exists te_select on public.team_events; drop policy if exists te_write on public.team_events;
create policy te_select on public.team_events for select to authenticated using (public.is_team_member(team_id) or public.can_manage_team(team_id) or public.is_org_admin(org_id));
create policy te_write on public.team_events for all to authenticated
  using (public.can_manage_team(team_id))
  with check (public.can_manage_team(team_id) and public.team_org(team_id) = org_id and public.team_has_feature(team_id, 'eventos'));

drop policy if exists rsvp_select on public.team_event_rsvps; drop policy if exists rsvp_write on public.team_event_rsvps;
create policy rsvp_select on public.team_event_rsvps for select to authenticated
  using (exists (select 1 from public.team_events e where e.id = event_id and (public.is_team_member(e.team_id) or public.can_manage_team(e.team_id) or public.is_org_admin(e.org_id))));
create policy rsvp_write on public.team_event_rsvps for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.team_events e where e.id = event_id and public.is_team_member(e.team_id)));

drop policy if exists td_select on public.team_devotionals; drop policy if exists td_insert on public.team_devotionals; drop policy if exists td_modify on public.team_devotionals; drop policy if exists td_delete on public.team_devotionals;
create policy td_select on public.team_devotionals for select to authenticated using (public.is_team_member(team_id) or public.can_manage_team(team_id) or public.is_org_admin(org_id));
create policy td_insert on public.team_devotionals for insert to authenticated
  with check ((public.is_team_member(team_id) or public.can_manage_team(team_id)) and public.team_org(team_id) = org_id and author_id = auth.uid() and public.team_has_feature(team_id, 'devocional'));
create policy td_modify on public.team_devotionals for update to authenticated
  using (author_id = auth.uid() or public.can_manage_team(team_id)) with check (author_id = auth.uid() or public.can_manage_team(team_id));
create policy td_delete on public.team_devotionals for delete to authenticated
  using (author_id = auth.uid() or public.can_manage_team(team_id));

-- avisos para o time
create or replace function public.notify_team_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify_user(tm.user_id, new.org_id, 'evento', 'Novo evento: ' || new.title,
    to_char(new.starts_at at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI'), '#/times/' || new.team_id || '/eventos/' || new.id, jsonb_build_object('event_id', new.id))
  from team_members tm where tm.team_id = new.team_id and tm.user_id <> coalesce(new.created_by, '00000000-0000-0000-0000-000000000000'::uuid);
  return null;
end $$;
drop trigger if exists t_notify_team_event on public.team_events;
create trigger t_notify_team_event after insert on public.team_events for each row execute function public.notify_team_event();

create or replace function public.notify_devotional() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify_user(tm.user_id, new.org_id, 'devocional', 'Novo devocional: ' || new.title,
    (select name from teams where id = new.team_id), '#/times/' || new.team_id || '/devocional/' || new.id, jsonb_build_object('devotional_id', new.id))
  from team_members tm where tm.team_id = new.team_id and tm.user_id <> coalesce(new.author_id, '00000000-0000-0000-0000-000000000000'::uuid);
  return null;
end $$;
drop trigger if exists t_notify_devotional on public.team_devotionals;
create trigger t_notify_devotional after insert on public.team_devotionals for each row execute function public.notify_devotional();
