-- Presets de letra (Simulador ProPresenter): ajustes de fonte, cor, fundo, caixa e transição guardados por time.
create table if not exists public.lyric_presets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  config jsonb not null default '{}'::jsonb,
  sort int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (team_id, name)
);
alter table public.lyric_presets enable row level security;
drop policy if exists lp_select on public.lyric_presets;
create policy lp_select on public.lyric_presets for select to authenticated
  using (public.is_team_member(team_id) or public.is_org_admin(org_id));
drop policy if exists lp_write on public.lyric_presets;
create policy lp_write on public.lyric_presets for all to authenticated
  using (public.can_manage_team(team_id) or public.is_team_member(team_id))
  with check ((public.can_manage_team(team_id) or public.is_team_member(team_id))
    and exists (select 1 from public.teams t where t.id = lyric_presets.team_id and t.org_id = lyric_presets.org_id));
