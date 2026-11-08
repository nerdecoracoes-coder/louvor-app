-- Palco do time (posições das funções), presets de escala e versão da música em cada escala.

create table if not exists public.team_stage_slots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  role_id uuid not null references public.music_roles(id) on delete cascade,
  x numeric(5,2) not null default 50 check (x between 0 and 100),
  y numeric(5,2) not null default 50 check (y between 0 and 100),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists team_stage_slots_team_idx on public.team_stage_slots (team_id, sort);

create table if not exists public.team_presets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  slot_ids uuid[] not null default '{}',
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (team_id, name)
);
create index if not exists team_presets_team_idx on public.team_presets (team_id, sort);

alter table public.team_stage_slots enable row level security;
alter table public.team_presets enable row level security;
revoke all on public.team_stage_slots, public.team_presets from anon;

drop policy if exists tss_select on public.team_stage_slots;
drop policy if exists tss_write on public.team_stage_slots;
create policy tss_select on public.team_stage_slots for select to authenticated using (public.is_org_member(org_id) or public.is_team_member(team_id));
create policy tss_write on public.team_stage_slots for all to authenticated
  using (public.can_manage_team(team_id))
  with check (public.can_manage_team(team_id) and org_id = public.team_org(team_id)
              and exists (select 1 from public.music_roles r where r.id = role_id and r.org_id = team_stage_slots.org_id));

drop policy if exists tpr_select on public.team_presets;
drop policy if exists tpr_write on public.team_presets;
create policy tpr_select on public.team_presets for select to authenticated using (public.is_org_member(org_id) or public.is_team_member(team_id));
create policy tpr_write on public.team_presets for all to authenticated
  using (public.can_manage_team(team_id))
  with check (public.can_manage_team(team_id) and org_id = public.team_org(team_id));

-- versão escolhida de cada música na escala (o tom e o BPM da versão vêm junto)
alter table public.schedule_songs
  add column if not exists version_id uuid references public.song_versions(id) on delete set null,
  add column if not exists version_name text,
  add column if not exists bpm numeric(6,2);
