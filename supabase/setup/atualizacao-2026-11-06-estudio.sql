-- =====================================================================
-- Estúdio de mídia (06/11/2026): apresentações de slides (música, pregação, aviso, contagem),
-- biblioteca de fundos do time e ferramentas de mídia. Recurso do tipo Multimídia.
-- =====================================================================

create or replace function public.team_feature_preset(p_type text) returns text[]
language sql immutable as $$
  select case p_type
    when 'louvor' then array['repertorio','letras']::text[]
    when 'multimidia' then array['checklist','estudio','letras','pedidos','roteiro']::text[]
    when 'diaconal' then array['checklist','roteiro','visitantes']::text[]
    when 'infantil' then array['checklist','criancas']::text[]
    else '{}'::text[] end
$$;

create or replace function public.fill_team_features() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.features is null then new.features := team_feature_preset(new.team_type); end if;
  new.features := array(select distinct x from unnest(new.features) x where x in ('repertorio','roteiro','pedidos','checklist','criancas','visitantes','letras','estudio') order by 1);
  if tg_op = 'UPDATE' and new.features is distinct from old.features
     and auth.uid() is not null and not is_org_admin(new.org_id) then
    raise exception 'only_admin_sets_features';
  end if;
  return new;
end $$;

update public.teams set features = array(select distinct x from unnest(coalesce(features,'{}') || array['estudio']) x order by 1) where team_type = 'multimidia';

-- imagens do estúdio: media/studio/<org_id>/<team_id>/..., qualquer integrante do time envia
create or replace function public.storage_can_write(p_bucket text, p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare f text[] := storage.foldername(p_name); v_org uuid; v_team uuid;
begin
  if auth.uid() is null or array_length(f, 1) is null then return false; end if;
  begin
    if f[1] = 'avatars' then return f[2] = auth.uid()::text; end if;
    v_org := f[2]::uuid;
    if f[1] in ('teams','chat','files','studio') then v_team := f[3]::uuid; end if;
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
  end if;
  return false;
end $$;

create table if not exists public.studio_assets (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  kind text not null default 'imagem' check (kind in ('imagem','video')),
  path text not null,
  url text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists studio_assets_team on public.studio_assets (team_id, created_at desc);

create table if not exists public.studio_decks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  schedule_id uuid references public.schedules(id) on delete set null,
  slides jsonb not null default '[]'::jsonb,
  style jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists studio_decks_team on public.studio_decks (team_id, updated_at desc);

alter table public.studio_assets enable row level security;
alter table public.studio_decks enable row level security;
revoke all on public.studio_assets, public.studio_decks from anon;

drop policy if exists sa_select on public.studio_assets; drop policy if exists sa_write on public.studio_assets;
create policy sa_select on public.studio_assets for select to authenticated using (public.is_team_member(team_id) or public.can_manage_team(team_id) or public.is_org_admin(org_id));
create policy sa_write on public.studio_assets for all to authenticated
  using (public.is_team_member(team_id) or public.can_manage_team(team_id))
  with check ((public.is_team_member(team_id) or public.can_manage_team(team_id)) and public.team_org(team_id) = org_id and public.team_has_feature(team_id, 'estudio'));

drop policy if exists sd_select on public.studio_decks; drop policy if exists sd_write on public.studio_decks;
create policy sd_select on public.studio_decks for select to authenticated using (public.is_team_member(team_id) or public.can_manage_team(team_id) or public.is_org_admin(org_id));
create policy sd_write on public.studio_decks for all to authenticated
  using (public.is_team_member(team_id) or public.can_manage_team(team_id))
  with check ((public.is_team_member(team_id) or public.can_manage_team(team_id)) and public.team_org(team_id) = org_id and public.team_has_feature(team_id, 'estudio'));
