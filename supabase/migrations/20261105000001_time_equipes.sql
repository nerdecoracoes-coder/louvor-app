-- =====================================================================
-- Página "Time" (05/11/2026): equipes dentro do time e classificações das músicas
--  * team_groups / team_group_members: equipes (ex.: Banda A, Banda B) dentro de um time
--  * classifications: classificações do repertório (Louvor, Adoração, Ceia...), por igreja
--  * songs.classification: nome da classificação da música
-- =====================================================================
create table if not exists public.team_groups (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists team_groups_team on public.team_groups (team_id);
create table if not exists public.team_group_members (
  group_id uuid not null references public.team_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  primary key (group_id, user_id)
);
create table if not exists public.classifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);
alter table public.songs add column if not exists classification text;

do $$ declare t text; begin
  foreach t in array array['team_groups','team_group_members','classifications'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

drop policy if exists tg_select on public.team_groups;
create policy tg_select on public.team_groups for select to authenticated using (public.is_team_member(team_id) or public.is_org_admin(org_id));
drop policy if exists tg_write on public.team_groups;
create policy tg_write on public.team_groups for all to authenticated
  using (public.can_manage_team(team_id)) with check (public.can_manage_team(team_id) and org_id = public.team_org(team_id));
drop policy if exists tgm_select on public.team_group_members;
create policy tgm_select on public.team_group_members for select to authenticated using (public.is_team_member(team_id) or public.is_org_admin(org_id));
drop policy if exists tgm_write on public.team_group_members;
create policy tgm_write on public.team_group_members for all to authenticated
  using (public.can_manage_team(team_id)) with check (public.can_manage_team(team_id) and org_id = public.team_org(team_id));
drop policy if exists cl_select on public.classifications;
create policy cl_select on public.classifications for select to authenticated using (public.is_org_member(org_id));
drop policy if exists cl_write on public.classifications;
create policy cl_write on public.classifications for all to authenticated
  using (public.is_org_staff(org_id)) with check (public.is_org_staff(org_id));
