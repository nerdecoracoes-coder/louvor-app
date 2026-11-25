-- Arquivo gerado por dev/combine.sh a partir de supabase/migrations. Cole tudo no SQL Editor de um projeto NOVO e clique em Run.

-- >>> supabase/migrations/20261103000001_schema.sql
-- =====================================================================
-- Louvor App — esquema principal (Supabase / PostgreSQL)
-- Multi-organização com isolamento por Row Level Security.
-- Rode este arquivo inteiro no SQL Editor do Supabase (projeto NOVO, separado do Evolute).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Perfis (um por conta, global)
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  phone text,
  birth_date date,
  city text,
  about text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Organizações e vínculos
-- ---------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  subtitle text,
  logo_url text,
  accent_color text not null default '#1EA7FF' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.org_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','member')),
  display_name text,            -- "nome utilizado na organização"
  birth_date date,              -- quando o administrador informa/corrige
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index on public.org_members (user_id);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  description text,
  logo_url text,
  accent_color text check (accent_color is null or accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  apply_theme boolean not null default false,   -- aplicar a cor do time às telas internas
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.teams (org_id);

create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  is_leader boolean not null default false,
  monthly_limit int check (monthly_limit is null or monthly_limit between 0 and 62),
  avoid_with uuid[] not null default '{}',     -- preferência, não proibição
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index on public.team_members (user_id);
create index on public.team_members (org_id);

create table public.music_roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create table public.team_member_roles (
  team_id uuid not null,
  user_id uuid not null,
  role_id uuid not null references public.music_roles(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  primary key (team_id, user_id, role_id),
  foreign key (team_id, user_id) references public.team_members(team_id, user_id) on delete cascade
);
create index on public.team_member_roles (role_id);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  revoked_at timestamptz,
  uses int not null default 0
);

-- ---------------------------------------------------------------------
-- Funções auxiliares de permissão (security definer evita recursão de RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid())
$$;

create or replace function public.is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
$$;

create or replace function public.is_team_member(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id = p_team and user_id = auth.uid())
$$;

create or replace function public.is_team_leader(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id = p_team and user_id = auth.uid() and is_leader)
$$;

-- Administrador geral da organização do time OU líder do próprio time
create or replace function public.can_manage_team(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from teams t
    where t.id = p_team
      and (exists (select 1 from org_members m where m.org_id = t.org_id and m.user_id = auth.uid() and m.role = 'admin')
           or exists (select 1 from team_members tm where tm.team_id = t.id and tm.user_id = auth.uid() and tm.is_leader))
  )
$$;

-- Administrador ou líder de qualquer time da organização (ex.: cadastrar músicas, funções)
create or replace function public.is_org_staff(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_org_admin(p_org)
      or exists (select 1 from team_members where org_id = p_org and user_id = auth.uid() and is_leader)
$$;

create or replace function public.shares_org(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user = auth.uid() or exists (
    select 1 from org_members a join org_members b on a.org_id = b.org_id
    where a.user_id = auth.uid() and b.user_id = p_user)
$$;

create or replace function public.team_org(p_team uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from teams where id = p_team
$$;

-- ---------------------------------------------------------------------
-- Escalas
-- ---------------------------------------------------------------------
create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 140),
  event_type text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  notes text,
  status text not null default 'draft' check (status in ('draft','published')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  check (ends_at is null or ends_at >= starts_at)
);
create index on public.schedules (org_id, starts_at);
create index on public.schedules (team_id, starts_at);

create table public.schedule_assignments (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid references public.music_roles(id) on delete set null,
  role_name text,               -- preserva o nome da função no histórico
  seen_at timestamptz,          -- "tomei conhecimento"
  created_at timestamptz not null default now(),
  unique (schedule_id, user_id, role_id)
);
create index on public.schedule_assignments (user_id);

create table public.unavailability (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  all_day boolean not null default true,
  start_time time,
  end_time time,
  note text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (all_day or (start_time is not null and end_time is not null and end_time > start_time))
);
create index on public.unavailability (org_id, start_date);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,   -- null = aviso da organização
  title text not null check (length(trim(title)) between 1 and 140),
  body text,
  link_url text,
  tag text,
  image_url text,
  event_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.announcements (org_id, created_at desc);

-- ---------------------------------------------------------------------
-- Biblioteca (uma por organização, compartilhada por todos os times)
-- ---------------------------------------------------------------------
create table public.songs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  artist text,
  song_key text,
  bpm numeric(6,2),
  duration_sec int,
  youtube_url text,
  chords_url text,
  links jsonb not null default '[]',       -- [{label,url}]
  cover_url text,
  lyrics jsonb,                            -- {blocks:[{id,label,text,start,end}], source, synced}
  source text not null default 'manual' check (source in ('manual','drive')),
  status text not null default 'ready' check (status in ('ready','processing','waiting_files','error','removed')),
  status_message text,
  drive_folder_id text,
  drive_folder_name text,
  drive_signature text,          -- resumo do conteúdo da pasta (detecta alterações)
  drive_modified_at timestamptz,
  current_project_id uuid,
  duplicate_of uuid references public.songs(id) on delete set null,
  retry_count int not null default 0,
  next_retry_at timestamptz,
  last_synced_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, drive_folder_id),
  check (source = 'manual' or drive_folder_id is not null)
);
create index on public.songs (org_id, title);

create table public.song_files (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  kind text not null default 'other' check (kind in ('chords','lyrics','sheet','audio','other')),
  storage_path text,
  url text,
  size bigint,
  mime text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (storage_path is not null or url is not null)
);

create table public.schedule_songs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  song_id uuid references public.songs(id) on delete set null,
  position int not null default 0,
  title_snapshot text not null,           -- histórico preservado mesmo se a música sair do repertório
  artist_snapshot text,
  song_key text,
  notes text
);
create index on public.schedule_songs (schedule_id, position);

-- Projetos multitrack importados (versionados)
create table public.multitrack_projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  version int not null,
  is_current boolean not null default true,
  fingerprint text not null,
  rpp_file_id text not null,
  rpp_name text not null,
  rpp_modified_time timestamptz,
  tempo numeric(7,3),
  time_sig_num int,
  time_sig_den int,
  sample_rate int,
  length_sec numeric(10,3),
  master jsonb,                -- {volume, pan, muted}
  warnings jsonb not null default '[]',
  lyrics_raw jsonb,            -- dados brutos da track de letra, aguardando validação do formato
  raw jsonb,                   -- estrutura completa interpretada do .RPP (preservada)
  created_at timestamptz not null default now(),
  unique (song_id, version),
  unique (song_id, fingerprint)
);
alter table public.songs add constraint songs_current_project_fk
  foreign key (current_project_id) references public.multitrack_projects(id) on delete set null;

create table public.project_tracks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.multitrack_projects(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  idx int not null,
  guid text,
  name text not null,
  kind text not null check (kind in ('audio','folder','lyrics','midi','empty')),
  volume real not null default 1,
  pan real not null default 0,
  muted boolean not null default false,
  soloed boolean not null default false,
  phase_invert boolean not null default false,
  color int,
  folder_depth int not null default 0,
  parent_idx int,
  sends_to_parent boolean not null default true,
  items jsonb not null default '[]',
  warnings jsonb not null default '[]',
  unique (project_id, idx)
);

create table public.project_markers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.multitrack_projects(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  idx int not null,
  name text not null default '',
  position numeric(10,3) not null,
  end_position numeric(10,3),
  is_region boolean not null default false,
  color int
);
create index on public.project_markers (project_id, position);

-- Arquivos de mídia de cada projeto (permite checar o acesso antes de transmitir o áudio)
create table public.project_media (
  project_id uuid not null references public.multitrack_projects(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  drive_file_id text not null,
  name text not null,
  rel_path text,
  mime text,
  size bigint,
  md5 text,
  format jsonb,               -- cabeçalho WAV interpretado {codec,sampleRate,channels,bits,dataOffset,dataBytes,blockAlign}
  primary key (project_id, drive_file_id)
);
create index on public.project_media (drive_file_id);

-- Mixagem pessoal do usuário (não altera o projeto original)
create table public.mix_presets (
  user_id uuid not null references auth.users(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  project_id uuid references public.multitrack_projects(id) on delete set null,
  settings jsonb not null,     -- {master, tracks:{guid|idx:{volume,pan,muted,soloed}}}
  updated_at timestamptz not null default now(),
  primary key (user_id, song_id)
);

-- ---------------------------------------------------------------------
-- Google Drive
-- ---------------------------------------------------------------------
create table public.drive_integrations (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  folder_id text not null unique,     -- uma pasta só pode estar ligada a uma organização
  folder_name text,
  folder_owner text,
  status text not null default 'connected' check (status in ('connected','error','paused')),
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  page_token text,
  watch_channel_id text,
  watch_resource_id text,
  watch_token text,
  watch_expires_at timestamptz,
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz not null default now()
);

create table public.drive_items (
  org_id uuid not null references public.organizations(id) on delete cascade,
  file_id text not null,
  parent_id text,
  song_folder_id text,          -- pasta da música à qual o item pertence
  name text not null,
  rel_path text,
  mime_type text,
  md5 text,
  size bigint,
  modified_time timestamptz,
  seen_at timestamptz not null default now(),
  primary key (org_id, file_id)
);
create index on public.drive_items (org_id, song_folder_id);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  trigger text not null,       -- cron | webhook | manual | connect
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','ok','partial','error')),
  stats jsonb not null default '{}',
  error text
);
create index on public.sync_runs (org_id, started_at desc);

create table public.sync_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid references public.sync_runs(id) on delete cascade,
  song_id uuid references public.songs(id) on delete set null,
  folder_id text,
  level text not null check (level in ('info','warn','error')),
  message text not null,
  details jsonb,
  created_at timestamptz not null default now()
);
create index on public.sync_events (org_id, created_at desc);

-- ---------------------------------------------------------------------
-- Chat, enquetes, arquivos do time, notificações
-- ---------------------------------------------------------------------
create table public.polls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  question text not null check (length(trim(question)) between 1 and 300),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 12),
  multiple boolean not null default false,
  closed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.poll_votes (
  poll_id uuid not null references public.polls(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  option_index int not null check (option_index >= 0),
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id, option_index)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  kind text not null default 'text' check (kind in ('text','image','file','song','poll')),
  body text,
  attachment jsonb,          -- {path,name,size,mime}
  song_id uuid references public.songs(id) on delete set null,
  poll_id uuid references public.polls(id) on delete cascade,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on public.messages (team_id, created_at desc);

create table public.chat_reads (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table public.team_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  storage_path text,
  url text,
  size bigint,
  mime text,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (storage_path is not null or url is not null)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  data jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

-- >>> supabase/migrations/20261103000002_policies.sql
-- =====================================================================
-- Row Level Security: toda tabela tem RLS ligada e políticas explícitas.
-- Sem política = sem acesso. O papel "anon" (não logado) não lê nenhuma tabela.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['profiles','organizations','org_members','teams','team_members','music_roles',
    'team_member_roles','invites','schedules','schedule_assignments','unavailability','announcements',
    'songs','song_files','schedule_songs','multitrack_projects','project_tracks','project_markers',
    'project_media','mix_presets','drive_integrations','drive_items','sync_runs','sync_events',
    'polls','poll_votes','messages','chat_reads','team_files','notifications']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Perfis ------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (public.shares_org(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Organizações -------------------------------------------------------------
create policy org_select on public.organizations for select to authenticated
  using (public.is_org_member(id));
create policy org_update on public.organizations for update to authenticated
  using (public.is_org_admin(id)) with check (public.is_org_admin(id));
create policy org_delete on public.organizations for delete to authenticated
  using (public.is_org_admin(id));
-- criação somente pela função create_organization()

create policy om_select on public.org_members for select to authenticated
  using (public.is_org_member(org_id));
create policy om_update on public.org_members for update to authenticated
  using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy om_delete on public.org_members for delete to authenticated
  using (public.is_org_admin(org_id) or user_id = auth.uid());

-- Times --------------------------------------------------------------------
create policy teams_select on public.teams for select to authenticated
  using (public.is_org_member(org_id));
create policy teams_insert on public.teams for insert to authenticated
  with check (public.is_org_admin(org_id));
create policy teams_update on public.teams for update to authenticated
  using (public.can_manage_team(id)) with check (public.can_manage_team(id));
create policy teams_delete on public.teams for delete to authenticated
  using (public.is_org_admin(org_id));

create policy tm_select on public.team_members for select to authenticated
  using (public.is_org_member(org_id));
create policy tm_insert on public.team_members for insert to authenticated
  with check (public.can_manage_team(team_id) and org_id = public.team_org(team_id)
              and exists (select 1 from public.org_members m where m.org_id = team_members.org_id and m.user_id = team_members.user_id));
create policy tm_update on public.team_members for update to authenticated
  using (public.can_manage_team(team_id)) with check (public.can_manage_team(team_id) and org_id = public.team_org(team_id));
create policy tm_delete on public.team_members for delete to authenticated
  using (public.can_manage_team(team_id) or user_id = auth.uid());

create policy mr_select on public.music_roles for select to authenticated
  using (public.is_org_member(org_id));
create policy mr_insert on public.music_roles for insert to authenticated
  with check (public.is_org_staff(org_id));
create policy mr_update on public.music_roles for update to authenticated
  using (public.is_org_staff(org_id)) with check (public.is_org_staff(org_id));
create policy mr_delete on public.music_roles for delete to authenticated
  using (public.is_org_admin(org_id));

create policy tmr_select on public.team_member_roles for select to authenticated
  using (public.is_org_member(org_id));
create policy tmr_insert on public.team_member_roles for insert to authenticated
  with check (public.can_manage_team(team_id) and org_id = public.team_org(team_id)
              and exists (select 1 from public.music_roles r where r.id = role_id and r.org_id = team_member_roles.org_id));
create policy tmr_delete on public.team_member_roles for delete to authenticated
  using (public.can_manage_team(team_id));

create policy inv_select on public.invites for select to authenticated
  using (public.can_manage_team(team_id));
create policy inv_update on public.invites for update to authenticated
  using (public.can_manage_team(team_id)) with check (public.can_manage_team(team_id));
-- criação e aceite somente pelas funções create_team_invite() / accept_invite()

-- Escalas ------------------------------------------------------------------
create policy sch_select on public.schedules for select to authenticated
  using ((status = 'published' and public.is_org_member(org_id)) or public.can_manage_team(team_id));
create policy sch_insert on public.schedules for insert to authenticated
  with check (public.can_manage_team(team_id) and org_id = public.team_org(team_id));
create policy sch_update on public.schedules for update to authenticated
  using (public.can_manage_team(team_id)) with check (public.can_manage_team(team_id) and org_id = public.team_org(team_id));
create policy sch_delete on public.schedules for delete to authenticated
  using (public.can_manage_team(team_id));

create policy sa_select on public.schedule_assignments for select to authenticated
  using (exists (select 1 from public.schedules s where s.id = schedule_id
                 and ((s.status = 'published' and public.is_org_member(s.org_id)) or public.can_manage_team(s.team_id))));
create policy sa_insert on public.schedule_assignments for insert to authenticated
  with check (public.can_manage_team(team_id)
              and exists (select 1 from public.schedules s where s.id = schedule_id and s.team_id = schedule_assignments.team_id and s.org_id = schedule_assignments.org_id)
              and exists (select 1 from public.team_members tm where tm.team_id = schedule_assignments.team_id and tm.user_id = schedule_assignments.user_id));
create policy sa_update on public.schedule_assignments for update to authenticated
  using (public.can_manage_team(team_id)) with check (public.can_manage_team(team_id));
create policy sa_delete on public.schedule_assignments for delete to authenticated
  using (public.can_manage_team(team_id));

create policy ss_select on public.schedule_songs for select to authenticated
  using (exists (select 1 from public.schedules s where s.id = schedule_id
                 and ((s.status = 'published' and public.is_org_member(s.org_id)) or public.can_manage_team(s.team_id))));
create policy ss_insert on public.schedule_songs for insert to authenticated
  with check (public.can_manage_team(team_id)
              and exists (select 1 from public.schedules s where s.id = schedule_id and s.team_id = schedule_songs.team_id and s.org_id = schedule_songs.org_id)
              and (song_id is null or exists (select 1 from public.songs g where g.id = song_id and g.org_id = schedule_songs.org_id)));
create policy ss_update on public.schedule_songs for update to authenticated
  using (public.can_manage_team(team_id)) with check (public.can_manage_team(team_id));
create policy ss_delete on public.schedule_songs for delete to authenticated
  using (public.can_manage_team(team_id));

create policy un_select on public.unavailability for select to authenticated
  using (public.is_org_member(org_id));
create policy un_insert on public.unavailability for insert to authenticated
  with check (user_id = auth.uid() and public.is_org_member(org_id));
create policy un_update on public.unavailability for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_org_member(org_id));
create policy un_delete on public.unavailability for delete to authenticated
  using (user_id = auth.uid());

-- Avisos -------------------------------------------------------------------
create policy an_select on public.announcements for select to authenticated
  using (case when team_id is null then public.is_org_member(org_id)
              else public.is_team_member(team_id) or public.is_org_admin(org_id) end);
create policy an_insert on public.announcements for insert to authenticated
  with check (created_by = auth.uid() and
              case when team_id is null then public.is_org_staff(org_id)
                   else public.can_manage_team(team_id) and org_id = public.team_org(team_id) end);
create policy an_update on public.announcements for update to authenticated
  using (created_by = auth.uid() or public.is_org_admin(org_id))
  with check (created_by = auth.uid() or public.is_org_admin(org_id));
create policy an_delete on public.announcements for delete to authenticated
  using (created_by = auth.uid() or public.is_org_admin(org_id)
         or (team_id is not null and public.can_manage_team(team_id)));

-- Biblioteca ---------------------------------------------------------------
create policy songs_select on public.songs for select to authenticated
  using (public.is_org_member(org_id));
create policy songs_insert on public.songs for insert to authenticated
  with check (public.is_org_staff(org_id) and source = 'manual' and drive_folder_id is null
              and status = 'ready' and current_project_id is null);
create policy songs_update on public.songs for update to authenticated
  using (public.is_org_staff(org_id)) with check (public.is_org_staff(org_id));
create policy songs_delete on public.songs for delete to authenticated
  using (public.is_org_staff(org_id) and source = 'manual');

create policy sf_select on public.song_files for select to authenticated
  using (public.is_org_member(org_id));
create policy sf_insert on public.song_files for insert to authenticated
  with check (public.is_org_staff(org_id) and exists (select 1 from public.songs s where s.id = song_id and s.org_id = song_files.org_id));
create policy sf_delete on public.song_files for delete to authenticated
  using (public.is_org_staff(org_id));

-- Dados importados do Drive: leitura pelos membros; escrita só pelo servidor (service_role)
create policy mp_select on public.multitrack_projects for select to authenticated using (public.is_org_member(org_id));
create policy pt_select on public.project_tracks for select to authenticated using (public.is_org_member(org_id));
create policy pm_select on public.project_markers for select to authenticated using (public.is_org_member(org_id));
create policy pme_select on public.project_media for select to authenticated using (public.is_org_member(org_id));

create policy mix_all on public.mix_presets for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.songs s where s.id = song_id and public.is_org_member(s.org_id)));

create policy di_select on public.drive_integrations for select to authenticated using (public.is_org_admin(org_id));
create policy dit_select on public.drive_items for select to authenticated using (public.is_org_admin(org_id));
create policy sr_select on public.sync_runs for select to authenticated using (public.is_org_admin(org_id));
create policy se_select on public.sync_events for select to authenticated using (public.is_org_admin(org_id));

-- Chat (somente integrantes do time) ----------------------------------------
create policy msg_select on public.messages for select to authenticated
  using (public.is_team_member(team_id));
create policy msg_insert on public.messages for insert to authenticated
  with check (user_id = auth.uid() and public.is_team_member(team_id) and org_id = public.team_org(team_id)
              and (song_id is null or exists (select 1 from public.songs s where s.id = song_id and s.org_id = messages.org_id))
              and (poll_id is null or exists (select 1 from public.polls p where p.id = poll_id and p.team_id = messages.team_id)));
create policy msg_update on public.messages for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy poll_select on public.polls for select to authenticated using (public.is_team_member(team_id));
create policy poll_insert on public.polls for insert to authenticated
  with check (created_by = auth.uid() and public.is_team_member(team_id) and org_id = public.team_org(team_id));
create policy poll_update on public.polls for update to authenticated
  using (created_by = auth.uid() or public.can_manage_team(team_id))
  with check (created_by = auth.uid() or public.can_manage_team(team_id));

create policy pv_select on public.poll_votes for select to authenticated
  using (exists (select 1 from public.polls p where p.id = poll_id and public.is_team_member(p.team_id)));
create policy pv_insert on public.poll_votes for insert to authenticated
  with check (user_id = auth.uid() and exists (
    select 1 from public.polls p where p.id = poll_id and p.closed_at is null and public.is_team_member(p.team_id)
      and option_index < jsonb_array_length(p.options)));
create policy pv_delete on public.poll_votes for delete to authenticated using (user_id = auth.uid());

create policy cr_all on public.chat_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_team_member(team_id));

create policy tf_select on public.team_files for select to authenticated
  using (public.is_team_member(team_id) or public.is_org_admin(org_id));
create policy tf_insert on public.team_files for insert to authenticated
  with check (public.can_manage_team(team_id) and org_id = public.team_org(team_id) and uploaded_by = auth.uid());
create policy tf_delete on public.team_files for delete to authenticated
  using (public.can_manage_team(team_id) or uploaded_by = auth.uid());

create policy nt_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy nt_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy nt_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

-- >>> supabase/migrations/20261103000003_functions.sql
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

-- >>> supabase/migrations/20261103000004_storage.sql
-- =====================================================================
-- Supabase Storage: dois "baldes"
--   media   (público para leitura): fotos de perfil, logos, capas, imagens de avisos
--   private (só com login e permissão): anexos do chat, arquivos do time, anexos de músicas
-- Caminhos:
--   media/avatars/<user_id>/...            media/orgs/<org_id>/...
--   media/teams/<org_id>/<team_id>/...     media/songs/<org_id>/...
--   private/chat/<org_id>/<team_id>/...    private/files/<org_id>/<team_id>/...
--   private/songs/<org_id>/<song_id>/...
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 10485760), ('private', 'private', false, 52428800)
on conflict (id) do nothing;

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
    if f[1] = 'songs' then return is_org_staff(v_org); end if;
    if f[1] = 'announcements' then return is_org_member(v_org); end if;
  elsif p_bucket = 'private' then
    if f[1] = 'chat' then return team_org(v_team) = v_org and is_team_member(v_team); end if;
    if f[1] = 'files' then return team_org(v_team) = v_org and can_manage_team(v_team); end if;
    if f[1] = 'songs' then return is_org_staff(v_org); end if;
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
  if f[1] = 'songs' then return is_org_member(v_org); end if;
  return false;
end $$;

create policy "media read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'media');
create policy "media write" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.storage_can_write(bucket_id, name));
create policy "media update" on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.storage_can_write(bucket_id, name));
create policy "media delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.storage_can_write(bucket_id, name));

create policy "private read" on storage.objects for select to authenticated
  using (bucket_id = 'private' and public.storage_can_read(name));
create policy "private write" on storage.objects for insert to authenticated
  with check (bucket_id = 'private' and public.storage_can_write(bucket_id, name));
create policy "private delete" on storage.objects for delete to authenticated
  using (bucket_id = 'private' and public.storage_can_write(bucket_id, name));

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

-- >>> supabase/migrations/20261104000003_team_features.sql
-- =====================================================================
-- Recursos de cada time (04/11/2026)
-- O tipo do time sugere os recursos (Louvor já vem com o repertório), e o administrador pode ajustar.
-- Recursos disponíveis hoje:
--   repertorio  Músicas, player multitrack e integração com o Google Drive
-- O acesso ao repertório passa a depender do recurso do time (e não mais só do tipo).
-- A integração com o Drive pode ser gerenciada pelo administrador e pelos líderes de times com repertório.
-- =====================================================================

alter table public.teams add column if not exists features text[];

-- recursos sugeridos para cada tipo de time
create or replace function public.team_feature_preset(p_type text) returns text[]
language sql immutable as $$
  select case when p_type = 'louvor' then array['repertorio']::text[] else '{}'::text[] end
$$;

update public.teams set features = public.team_feature_preset(team_type) where features is null;

-- novo time sem recursos informados recebe os do tipo; só o administrador altera os recursos de um time
create or replace function public.fill_team_features() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.features is null then new.features := team_feature_preset(new.team_type); end if;
  new.features := array(select distinct x from unnest(new.features) x where x in ('repertorio') order by 1);
  if tg_op = 'UPDATE' and new.features is distinct from old.features
     and auth.uid() is not null and not is_org_admin(new.org_id) then
    raise exception 'only_admin_sets_features';
  end if;
  return new;
end $$;
drop trigger if exists t_fill_team_features on public.teams;
create trigger t_fill_team_features before insert or update on public.teams
  for each row execute function public.fill_team_features();

create or replace function public.team_has_repertoire(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams where id = p_team and 'repertorio' = any(features))
$$;

create or replace function public.has_repertoire(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_org_admin(p_org) or exists (
    select 1 from team_members tm join teams t on t.id = tm.team_id
    where tm.org_id = p_org and tm.user_id = auth.uid() and 'repertorio' = any(t.features)
      and (tm.access_until is null or tm.access_until >= (now() at time zone 'America/Sao_Paulo')::date))
$$;

create or replace function public.is_repertoire_staff(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_org_admin(p_org) or exists (
    select 1 from team_members tm join teams t on t.id = tm.team_id
    where tm.org_id = p_org and tm.user_id = auth.uid() and tm.is_leader and 'repertorio' = any(t.features))
$$;

-- Google Drive: administrador e líderes de times com repertório acompanham e gerenciam a integração
drop policy if exists di_select on public.drive_integrations;
create policy di_select on public.drive_integrations for select to authenticated using (public.is_repertoire_staff(org_id));
drop policy if exists sr_select on public.sync_runs;
create policy sr_select on public.sync_runs for select to authenticated using (public.is_repertoire_staff(org_id));
drop policy if exists se_select on public.sync_events;
create policy se_select on public.sync_events for select to authenticated using (public.is_repertoire_staff(org_id));

-- >>> supabase/migrations/20261104000005_light_audio.sql
-- =====================================================================
-- Versão leve das faixas (04/11/2026)
-- Cada áudio do Drive ganha uma cópia compactada (Opus) no Cloudflare R2, gerada pelo conversor no GitHub.
-- O player usa a versão leve quando ela existe; senão, continua lendo o WAV do Drive.
-- A cópia é identificada pelo arquivo do Drive + conteúdo (md5): a mesma faixa em versões diferentes do
-- projeto reaproveita a mesma cópia. O original no Drive nunca é alterado.
-- =====================================================================

create table if not exists public.light_audio (
  org_id uuid not null references public.organizations(id) on delete cascade,
  drive_file_id text not null,
  src text not null,                 -- md5 do arquivo (ou "s<tamanho>" quando o Drive não informa)
  key text,                          -- caminho no bucket
  info jsonb,                        -- canais, pre-skip, amostras, índice de páginas
  bytes bigint,
  error text,                        -- falha na conversão (nova tentativa depois de um tempo)
  attempts int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (drive_file_id, src)
);
create index if not exists light_audio_org on public.light_audio (org_id);
alter table public.light_audio enable row level security;
revoke all on public.light_audio from anon;
drop policy if exists la_select on public.light_audio;
create policy la_select on public.light_audio for select to authenticated using (public.has_repertoire(org_id));
-- escrita só pelo servidor (chave de serviço)

-- Fila do conversor: áudios das versões atuais dos projetos que ainda não têm versão leve.
-- Músicas mais recentes primeiro (um envio novo fica leve antes do acervo antigo).
create or replace function public.light_queue(p_limit int default 40)
returns table (org_id uuid, drive_file_id text, src text, name text, size bigint, format jsonb, song_title text)
language sql stable security definer set search_path = public as $$
  select q.org_id, q.drive_file_id, q.src, q.name, q.size, q.format, q.title from (
    select distinct on (pm.drive_file_id, coalesce(pm.md5, 's' || pm.size))
      pm.org_id, pm.drive_file_id, coalesce(pm.md5, 's' || pm.size) as src, pm.name, pm.size, pm.format, s.title, s.last_synced_at
    from project_media pm
    join multitrack_projects p on p.id = pm.project_id and p.is_current
    join songs s on s.id = p.song_id and s.status = 'ready'
    left join light_audio la on la.drive_file_id = pm.drive_file_id and la.src = coalesce(pm.md5, 's' || pm.size)
    where la.drive_file_id is null
       or (la.key is null and la.attempts < 5 and la.updated_at < now() - interval '1 hour' * power(2, la.attempts))
    order by pm.drive_file_id, coalesce(pm.md5, 's' || pm.size), s.last_synced_at desc nulls last
  ) q
  order by q.last_synced_at desc nulls last
  limit greatest(1, least(p_limit, 500))
$$;
revoke all on function public.light_queue(int) from public, anon, authenticated;
grant execute on function public.light_queue(int) to service_role;

-- >>> supabase/migrations/20261104000006_multimidia.sql
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

-- >>> supabase/migrations/20261104000007_demo_users.sql
-- =====================================================================
-- Integrantes de teste (04/11/2026)
-- O administrador cria contas fictícias num time para testar escalas, roteiro, checklist e pedidos.
-- Elas têm prazo: o servidor apaga as contas (e tudo o que fizeram) quando o prazo vence.
-- Criação e exclusão só pelo servidor (Edge Function drive-sync, ações demo-*); aqui fica o registro.
-- =====================================================================
create table if not exists public.demo_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  label text not null,
  email text not null,
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists demo_users_exp on public.demo_users (expires_at);
alter table public.demo_users enable row level security;
revoke all on public.demo_users from anon;
drop policy if exists du_select on public.demo_users;
create policy du_select on public.demo_users for select to authenticated using (public.is_org_admin(org_id));

-- >>> supabase/migrations/20261104000008_invite_joins_church.sql
-- =====================================================================
-- Convite do time cadastra também na igreja (04/11/2026)
-- Enquanto a membresia da igreja não estiver organizada no app, quem aceita o convite de um time de
-- ministério entra no time e passa a ser membro da igreja automaticamente (antes era exigido o convite de membro).
-- Times abertos a convidados continuam iguais: quem é de outra igreja entra como convidado, só naquele time.
-- =====================================================================
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
      -- ministério da igreja: o convite do time já cadastra a pessoa como membro da igreja
      if v_role = 'guest' then
        update org_members set role = 'member' where org_id = v_inv.org_id and user_id = v_uid;
        update team_members set is_guest = false, guest_church = null where org_id = v_inv.org_id and user_id = v_uid;
      else
        insert into org_members (org_id, user_id, role) values (v_inv.org_id, v_uid, 'member');
      end if;
      insert into team_members (team_id, user_id, org_id) values (v_inv.team_id, v_uid, v_inv.org_id);
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

-- >>> supabase/migrations/20261105000001_time_equipes.sql
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

-- >>> supabase/migrations/20261105000002_light_queue_prioridade.sql
-- A fila de conversão da versão leve passa a atender primeiro as músicas das próximas escalas
-- (a mais próxima primeiro); o restante segue pela sincronização mais recente.
create or replace function public.light_queue(p_limit int default 40)
returns table (org_id uuid, drive_file_id text, src text, name text, size bigint, format jsonb, song_title text)
language sql stable security definer set search_path = public as $$
  select q.org_id, q.drive_file_id, q.src, q.name, q.size, q.format, q.title from (
    select distinct on (pm.drive_file_id, coalesce(pm.md5, 's' || pm.size))
      pm.org_id, pm.drive_file_id, coalesce(pm.md5, 's' || pm.size) as src, pm.name, pm.size, pm.format, s.title, s.last_synced_at,
      (select min(sc.starts_at) from schedule_songs ss join schedules sc on sc.id = ss.schedule_id
        where ss.song_id = s.id and sc.starts_at >= now() - interval '1 day') as next_use
    from project_media pm
    join multitrack_projects p on p.id = pm.project_id and p.is_current
    join songs s on s.id = p.song_id and s.status = 'ready'
    left join light_audio la on la.drive_file_id = pm.drive_file_id and la.src = coalesce(pm.md5, 's' || pm.size)
    where la.drive_file_id is null
       or (la.key is null and la.attempts < 5 and la.updated_at < now() - interval '1 hour' * power(2, la.attempts))
    order by pm.drive_file_id, coalesce(pm.md5, 's' || pm.size), s.last_synced_at desc nulls last
  ) q
  order by q.next_use asc nulls last, q.last_synced_at desc nulls last
  limit greatest(1, least(p_limit, 500))
$$;
revoke all on function public.light_queue(int) from public, anon, authenticated;
grant execute on function public.light_queue(int) to service_role;

-- >>> supabase/migrations/20261105000003_peaks_queue.sql
-- Fila das faixas já convertidas que ainda não têm a forma de onda pronta (gerada pelo conversor no GitHub).
create or replace function public.peaks_queue(p_limit int default 30)
returns table (org_id uuid, drive_file_id text, src text, key text, bytes bigint, info jsonb)
language sql stable security definer set search_path = public as $$
  select la.org_id, la.drive_file_id, la.src, la.key, la.bytes, la.info
  from light_audio la
  where la.key is not null and la.info is not null and la.info->'peaks' is null
  order by la.updated_at desc
  limit greatest(1, least(p_limit, 200))
$$;
revoke all on function public.peaks_queue(int) from public, anon, authenticated;
grant execute on function public.peaks_queue(int) to service_role;

-- >>> supabase/migrations/20261105000004_escala_opcoes.sql
-- Opções da escala (05/11/2026): pedir confirmação dos participantes e paletas de cores das vestimentas.
alter table public.schedules add column if not exists ask_confirmation boolean not null default true;
alter table public.schedules add column if not exists palettes jsonb not null default '[]'::jsonb;

-- >>> supabase/migrations/20261105000005_ambientes_times.sql
-- =====================================================================
-- Ambientes dos times Diáconos e Ministério Infantil (05/11/2026):
-- recursos e funções padrão por tipo de time (como o Louvor e a Multimídia).
-- =====================================================================

create or replace function public.team_feature_preset(p_type text) returns text[]
language sql immutable as $$
  select case p_type
    when 'louvor' then array['repertorio']::text[]
    when 'multimidia' then array['checklist','pedidos','roteiro']::text[]
    when 'diaconal' then array['checklist','roteiro']::text[]
    when 'infantil' then array['checklist']::text[]
    else '{}'::text[] end
$$;

-- times desses tipos que ainda estavam sem recursos recebem os do tipo
update public.teams set features = public.team_feature_preset(team_type)
 where team_type in ('diaconal','infantil') and coalesce(features, '{}') = '{}';

create or replace function public.ensure_type_roles(p_org uuid, p_type text) returns void
language plpgsql security definer set search_path = public as $$
declare names text[];
begin
  names := case p_type
    when 'multimidia' then array['Direção','Projeção','Transmissão/Corte','Câmera 2','Câmera 3','Iluminação']
    when 'diaconal' then array['Coordenação','Porta / Recepção','Estacionamento','Segurança','Santa Ceia','Oferta','Apoio ao altar','Visitantes']
    when 'infantil' then array['Coordenação','Professor(a)','Auxiliar','Recepção / Check-in','Berçário','Louvor infantil']
    else null end;
  if names is null or exists (select 1 from music_roles where org_id = p_org and team_type = p_type) then return; end if;
  insert into music_roles (org_id, name, sort, team_type)
  select p_org, n, i, p_type from unnest(names) with ordinality as t(n, i)
  on conflict do nothing;
end $$;
revoke execute on function public.ensure_type_roles(uuid, text) from public, anon, authenticated;

do $$ begin perform public.ensure_type_roles(org_id, team_type) from (select distinct org_id, team_type from public.teams where team_type in ('diaconal','infantil')) t; end $$;

-- >>> supabase/migrations/20261105000006_criancas_visitantes.sql
-- =====================================================================
-- Ministério Infantil: crianças, check-in e saída. Diáconos: registro de visitantes (05/11/2026).
-- Recursos novos de time: criancas, visitantes. Funções extras dos Diáconos.
-- =====================================================================

create or replace function public.team_feature_preset(p_type text) returns text[]
language sql immutable as $$
  select case p_type
    when 'louvor' then array['repertorio']::text[]
    when 'multimidia' then array['checklist','pedidos','roteiro']::text[]
    when 'diaconal' then array['checklist','roteiro','visitantes']::text[]
    when 'infantil' then array['checklist','criancas']::text[]
    else '{}'::text[] end
$$;

create or replace function public.fill_team_features() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.features is null then new.features := team_feature_preset(new.team_type); end if;
  new.features := array(select distinct x from unnest(new.features) x where x in ('repertorio','roteiro','pedidos','checklist','criancas','visitantes') order by 1);
  if tg_op = 'UPDATE' and new.features is distinct from old.features
     and auth.uid() is not null and not is_org_admin(new.org_id) then
    raise exception 'only_admin_sets_features';
  end if;
  return new;
end $$;

-- times que já existem ganham os recursos novos do tipo
update public.teams set features = array(select distinct x from unnest(coalesce(features,'{}') || array['criancas']) x order by 1) where team_type = 'infantil';
update public.teams set features = array(select distinct x from unnest(coalesce(features,'{}') || array['visitantes']) x order by 1) where team_type = 'diaconal';

-- funções dos Diáconos: portaria, ofertório e introdução (além das que já existem)
create or replace function public.ensure_type_roles(p_org uuid, p_type text) returns void
language plpgsql security definer set search_path = public as $$
declare names text[];
begin
  names := case p_type
    when 'multimidia' then array['Direção','Projeção','Transmissão/Corte','Câmera 2','Câmera 3','Iluminação']
    when 'diaconal' then array['Coordenação','Portaria','Ofertório','Introdução','Santa Ceia','Estacionamento','Segurança','Apoio ao altar','Visitantes']
    when 'infantil' then array['Coordenação','Professor(a)','Auxiliar','Recepção / Check-in','Berçário','Louvor infantil']
    else null end;
  if names is null or exists (select 1 from music_roles where org_id = p_org and team_type = p_type) then return; end if;
  insert into music_roles (org_id, name, sort, team_type)
  select p_org, n, i, p_type from unnest(names) with ordinality as t(n, i)
  on conflict do nothing;
end $$;
revoke execute on function public.ensure_type_roles(uuid, text) from public, anon, authenticated;

insert into public.music_roles (org_id, name, sort, team_type)
select distinct t.org_id, n.name, n.sort, 'diaconal' from public.teams t,
  (values ('Portaria', 20), ('Ofertório', 21), ('Introdução', 22)) as n(name, sort)
 where t.team_type = 'diaconal'
on conflict do nothing;

-- ---------------------------------------------------------------- crianças
create table if not exists public.children (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  birth_date date,
  guardian_name text,
  guardian_phone text,
  allergies text,
  notes text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists children_team on public.children (team_id, name);

create table if not exists public.child_checkins (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  code text not null,
  checked_in_at timestamptz not null default now(),
  checked_in_by uuid references auth.users(id) on delete set null,
  checked_out_at timestamptz,
  checked_out_by uuid references auth.users(id) on delete set null,
  picked_by text,
  code_ok boolean
);
create index if not exists child_checkins_team on public.child_checkins (team_id, checked_in_at desc);
create unique index if not exists child_checkins_open on public.child_checkins (child_id) where checked_out_at is null;

-- ---------------------------------------------------------------- visitantes
create table if not exists public.visitors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  phone text,
  visited_on date not null default (now() at time zone 'America/Sao_Paulo')::date,
  first_time boolean not null default true,
  how_known text,
  notes text,
  status text not null default 'novo' check (status in ('novo','contatado','integrado')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists visitors_team on public.visitors (team_id, visited_on desc);

alter table public.children enable row level security;
alter table public.child_checkins enable row level security;
alter table public.visitors enable row level security;
revoke all on public.children, public.child_checkins, public.visitors from anon;

drop policy if exists ch_select on public.children; drop policy if exists ch_write on public.children; drop policy if exists ch_delete on public.children;
create policy ch_select on public.children for select to authenticated using (public.is_team_member(team_id) or public.is_org_admin(org_id));
create policy ch_write on public.children for all to authenticated
  using (public.is_team_member(team_id) or public.can_manage_team(team_id))
  with check ((public.is_team_member(team_id) or public.can_manage_team(team_id)) and public.team_org(team_id) = org_id and public.team_has_feature(team_id, 'criancas'));

drop policy if exists cc_select on public.child_checkins; drop policy if exists cc_write on public.child_checkins;
create policy cc_select on public.child_checkins for select to authenticated using (public.is_team_member(team_id) or public.is_org_admin(org_id));
create policy cc_write on public.child_checkins for all to authenticated
  using (public.is_team_member(team_id) or public.can_manage_team(team_id))
  with check ((public.is_team_member(team_id) or public.can_manage_team(team_id)) and public.team_org(team_id) = org_id and public.team_has_feature(team_id, 'criancas')
    and exists (select 1 from public.children c where c.id = child_id and c.team_id = child_checkins.team_id));

drop policy if exists vi_select on public.visitors; drop policy if exists vi_write on public.visitors;
create policy vi_select on public.visitors for select to authenticated using (public.is_team_member(team_id) or public.is_org_admin(org_id));
create policy vi_write on public.visitors for all to authenticated
  using (public.is_team_member(team_id) or public.can_manage_team(team_id))
  with check ((public.is_team_member(team_id) or public.can_manage_team(team_id)) and public.team_org(team_id) = org_id and public.team_has_feature(team_id, 'visitantes'));

-- >>> supabase/migrations/20261105000007_letras.sql
-- =====================================================================
-- Letras para a mídia (05/11/2026): recurso compartilhado entre Louvor e Multimídia.
-- A mídia vê as letras do repertório e guarda a sua própria versão (partes e estilo) sem mexer na original.
-- =====================================================================

create or replace function public.team_feature_preset(p_type text) returns text[]
language sql immutable as $$
  select case p_type
    when 'louvor' then array['repertorio','letras']::text[]
    when 'multimidia' then array['checklist','letras','pedidos','roteiro']::text[]
    when 'diaconal' then array['checklist','roteiro','visitantes']::text[]
    when 'infantil' then array['checklist','criancas']::text[]
    else '{}'::text[] end
$$;

create or replace function public.fill_team_features() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.features is null then new.features := team_feature_preset(new.team_type); end if;
  new.features := array(select distinct x from unnest(new.features) x where x in ('repertorio','roteiro','pedidos','checklist','criancas','visitantes','letras') order by 1);
  if tg_op = 'UPDATE' and new.features is distinct from old.features
     and auth.uid() is not null and not is_org_admin(new.org_id) then
    raise exception 'only_admin_sets_features';
  end if;
  return new;
end $$;

update public.teams set features = array(select distinct x from unnest(coalesce(features,'{}') || array['letras']) x order by 1) where team_type in ('louvor','multimidia');

create table if not exists public.lyric_slides (
  team_id uuid not null references public.teams(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  blocks jsonb,
  style jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (team_id, song_id)
);
alter table public.lyric_slides enable row level security;
revoke all on public.lyric_slides from anon;
drop policy if exists ls_select on public.lyric_slides; drop policy if exists ls_write on public.lyric_slides;
create policy ls_select on public.lyric_slides for select to authenticated using (public.is_team_member(team_id) or public.is_org_admin(org_id));
create policy ls_write on public.lyric_slides for all to authenticated
  using (public.is_team_member(team_id) or public.can_manage_team(team_id))
  with check ((public.is_team_member(team_id) or public.can_manage_team(team_id)) and public.team_org(team_id) = org_id and public.team_has_feature(team_id, 'letras')
    and exists (select 1 from public.songs s where s.id = song_id and s.org_id = lyric_slides.org_id));

-- biblioteca de letras para quem é do time (a mídia não vê o resto do repertório)
create or replace function public.lyrics_library(p_team uuid)
returns table (id uuid, title text, artist text, song_key text, lyrics jsonb)
language sql stable security definer set search_path = public as $$
  select s.id, s.title, s.artist, s.song_key, s.lyrics
    from songs s
   where s.org_id = team_org(p_team)
     and s.status <> 'removed'
     and s.lyrics is not null
     and (is_team_member(p_team) or can_manage_team(p_team))
     and team_has_feature(p_team, 'letras')
   order by s.title
$$;
revoke execute on function public.lyrics_library(uuid) from public, anon;
grant execute on function public.lyrics_library(uuid) to authenticated;

-- >>> supabase/migrations/20261105000008_igreja.sql
-- =====================================================================
-- Página da igreja (05/11/2026): agenda geral da igreja e cargo de liderança (pastor etc.).
-- =====================================================================

alter table public.org_members add column if not exists church_title text;

create table if not exists public.church_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text check (char_length(description) <= 1000),
  location text check (char_length(location) <= 160),
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists church_events_org_start on public.church_events (org_id, starts_at);
alter table public.church_events enable row level security;
revoke all on public.church_events from anon;
drop policy if exists ce_select on public.church_events; drop policy if exists ce_write on public.church_events;
create policy ce_select on public.church_events for select to authenticated using (public.is_org_member(org_id));
create policy ce_write on public.church_events for all to authenticated
  using (public.is_org_staff(org_id))
  with check (public.is_org_staff(org_id) and created_by = auth.uid());

-- >>> supabase/migrations/20261105000009_tela_projecao.sql
-- Tela da projeção (proporção dos slides) escolhida pela igreja, por time.
alter table public.teams add column if not exists slide_ratio text check (slide_ratio is null or char_length(slide_ratio) <= 16);

-- >>> supabase/migrations/20261106000010_estudio.sql
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

-- >>> supabase/migrations/20261106000011_letras_proprias.sql
-- Letras criadas pela própria Multimídia (sem depender do repertório do Louvor).
create table if not exists public.media_lyrics (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  artist text check (char_length(artist) <= 160),
  blocks jsonb,
  style jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists media_lyrics_team on public.media_lyrics (team_id, title);
alter table public.media_lyrics enable row level security;
revoke all on public.media_lyrics from anon;
drop policy if exists ml_select on public.media_lyrics; drop policy if exists ml_write on public.media_lyrics;
create policy ml_select on public.media_lyrics for select to authenticated
  using (public.is_team_member(team_id) or public.can_manage_team(team_id) or public.is_org_admin(org_id));
create policy ml_write on public.media_lyrics for all to authenticated
  using (public.is_team_member(team_id) or public.can_manage_team(team_id))
  with check ((public.is_team_member(team_id) or public.can_manage_team(team_id)) and public.team_org(team_id) = org_id and public.team_has_feature(team_id, 'letras'));

-- >>> supabase/migrations/20261106000012_padrao_letra.sql
-- Padrão da letra na tela (margens, alinhamento, posição do nome da parte e do rodapé), por time.
alter table public.teams add column if not exists slide_layout jsonb;

-- >>> supabase/migrations/20261106000013_eventos_devocional.sql
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

-- >>> supabase/migrations/20261106000014_devocional_leve.sql
-- Devocional: miniatura, tamanho e prazo da cópia guardada no app (a cópia permanente irá para o Drive).
alter table public.team_devotionals add column if not exists thumb text;
alter table public.team_devotionals add column if not exists video_bytes bigint;
alter table public.team_devotionals add column if not exists video_expires_at timestamptz;

-- >>> supabase/migrations/20261106000015_devocional_r2.sql
-- Devocional: o vídeo original fica no Cloudflare R2 (chave em r2_key), sem ocupar o Supabase.
alter table public.team_devotionals add column if not exists r2_key text;
alter table public.team_devotionals drop constraint if exists team_devotionals_check;
alter table public.team_devotionals add constraint team_devotionals_check check (video_path is not null or video_url is not null or r2_key is not null);

-- >>> supabase/migrations/20261106000016_coordenador_agenda.sql
-- Coordenador de agenda: quem monta a agenda da igreja e os avisos gerais (escolhido pelo administrador).
-- O evento da agenda indica quais ministérios ficam de serviço; cada líder recebe o aviso para criar a escala
-- e, a partir de 7 dias antes, é lembrado todo dia até a escala existir.

alter table public.org_members add column if not exists agenda_coordinator boolean not null default false;
alter table public.church_events add column if not exists kind text;
alter table public.schedules add column if not exists church_event_id uuid references public.church_events(id) on delete set null;
create index if not exists schedules_church_event_idx on public.schedules (church_event_id);

create table if not exists public.church_event_teams (
  event_id uuid not null references public.church_events(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, team_id)
);
alter table public.church_event_teams enable row level security;
revoke all on public.church_event_teams from anon;

create or replace function public.is_agenda_coordinator(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and agenda_coordinator)
$$;
create or replace function public.can_edit_agenda(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_org_admin(p_org) or public.is_agenda_coordinator(p_org)
$$;

-- agenda da igreja: todos leem; só administrador e coordenador(es) escrevem
drop policy if exists ce_select on public.church_events;
drop policy if exists ce_write on public.church_events;
drop policy if exists ce_insert on public.church_events;
drop policy if exists ce_update on public.church_events;
drop policy if exists ce_delete on public.church_events;
create policy ce_select on public.church_events for select to authenticated using (public.is_org_member(org_id));
create policy ce_insert on public.church_events for insert to authenticated with check (public.can_edit_agenda(org_id) and created_by = auth.uid());
create policy ce_update on public.church_events for update to authenticated using (public.can_edit_agenda(org_id)) with check (public.can_edit_agenda(org_id));
create policy ce_delete on public.church_events for delete to authenticated using (public.can_edit_agenda(org_id));

-- ministérios de serviço no evento
drop policy if exists cet_select on public.church_event_teams;
drop policy if exists cet_write on public.church_event_teams;
create policy cet_select on public.church_event_teams for select to authenticated using (public.is_org_member(org_id));
create policy cet_write on public.church_event_teams for all to authenticated
  using (public.can_edit_agenda(org_id))
  with check (public.can_edit_agenda(org_id) and public.team_org(team_id) = org_id);

-- avisos gerais (sem time): administrador e coordenador(es); avisos de time continuam com o líder do time
drop policy if exists an_insert on public.announcements;
drop policy if exists an_update on public.announcements;
drop policy if exists an_delete on public.announcements;
create policy an_insert on public.announcements for insert to authenticated
  with check (created_by = auth.uid() and
              case when team_id is null then public.can_edit_agenda(org_id)
                   else public.can_manage_team(team_id) and org_id = public.team_org(team_id) end);
create policy an_update on public.announcements for update to authenticated
  using (created_by = auth.uid() or public.is_org_admin(org_id) or (team_id is null and public.can_edit_agenda(org_id)))
  with check (created_by = auth.uid() or public.is_org_admin(org_id) or (team_id is null and public.can_edit_agenda(org_id)));
create policy an_delete on public.announcements for delete to authenticated
  using (created_by = auth.uid() or public.is_org_admin(org_id)
         or (team_id is null and public.can_edit_agenda(org_id))
         or (team_id is not null and public.can_manage_team(team_id)));

-- a escala do time já existe? (ligada ao evento, ou do mesmo time no mesmo dia)
create or replace function public.event_has_schedule(p_event uuid, p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from schedules s, church_events e
    where e.id = p_event and s.team_id = p_team
      and (s.church_event_id = e.id
           or (s.starts_at at time zone 'America/Sao_Paulo')::date = (e.starts_at at time zone 'America/Sao_Paulo')::date))
$$;
revoke execute on function public.event_has_schedule(uuid, uuid) from public, anon;

-- quem recebe o aviso do time: os líderes (se não houver, os administradores)
create or replace function public.team_alert_users(p_team uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select user_id from team_members where team_id = p_team and is_leader
  union
  select m.user_id from org_members m where m.role = 'admin' and m.org_id = public.team_org(p_team)
    and not exists (select 1 from team_members where team_id = p_team and is_leader)
$$;
revoke execute on function public.team_alert_users(uuid) from public, anon, authenticated;

-- aviso enfático assim que o ministério é marcado no evento
create or replace function public.notify_event_team() returns trigger
language plpgsql security definer set search_path = public as $$
declare e record; t record;
begin
  select * into e from church_events where id = new.event_id;
  select * into t from teams where id = new.team_id;
  if e.id is null or t.id is null then return null; end if;
  perform notify_user(u, new.org_id, 'escala_pendente', 'CRIE A ESCALA: ' || e.title,
    'O time ' || t.name || ' está de serviço em ' || to_char(e.starts_at at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI') || '. Crie a escala agora.',
    '#/escala/nova/' || new.team_id || '?evento=' || e.id, jsonb_build_object('event_id', e.id, 'team_id', new.team_id))
  from team_alert_users(new.team_id) u where u <> coalesce(e.created_by, '00000000-0000-0000-0000-000000000000'::uuid);
  return null;
end $$;
drop trigger if exists t_notify_event_team on public.church_event_teams;
create trigger t_notify_event_team after insert on public.church_event_teams for each row execute function public.notify_event_team();

-- lembrete diário: de 7 dias antes até o evento, quem ainda não criou a escala é avisado todo dia
create or replace function public.remind_pending_scales() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; r record; u uuid; dias integer; quando text;
begin
  for r in
    select e.id as event_id, e.title, e.starts_at, e.org_id, ct.team_id, t.name as team_name
    from church_event_teams ct
    join church_events e on e.id = ct.event_id
    join teams t on t.id = ct.team_id
    where e.starts_at > now() and e.starts_at <= now() + interval '7 days'
  loop
    if public.event_has_schedule(r.event_id, r.team_id) then continue; end if;
    dias := (r.starts_at at time zone 'America/Sao_Paulo')::date - (now() at time zone 'America/Sao_Paulo')::date;
    quando := case when dias <= 0 then 'é HOJE' when dias = 1 then 'é AMANHÃ' else 'é em ' || dias || ' dias' end;
    for u in select * from public.team_alert_users(r.team_id) loop
      if exists (select 1 from notifications x where x.user_id = u and x.kind = 'escala_lembrete' and x.data->>'event_id' = r.event_id::text
                 and x.data->>'team_id' = r.team_id::text and (x.created_at at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date) then continue; end if;
      perform notify_user(u, r.org_id, 'escala_lembrete', 'FALTA A ESCALA: ' || r.title || ' ' || quando,
        'O time ' || r.team_name || ' ainda não tem escala para este evento. Crie agora.',
        '#/escala/nova/' || r.team_id || '?evento=' || r.event_id, jsonb_build_object('event_id', r.event_id, 'team_id', r.team_id));
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public.remind_pending_scales() from public, anon, authenticated;

-- times que eu lidero (ou, sem líder, que eu administro)
create or replace function public.team_alert_users_for_me() returns setof uuid
language sql stable security definer set search_path = public as $$
  select t.id from teams t where
    exists (select 1 from team_members where team_id = t.id and user_id = auth.uid() and is_leader)
    or (not exists (select 1 from team_members where team_id = t.id and is_leader) and public.is_org_admin(t.org_id))
$$;
-- escalas pendentes de quem lidera (para o cartão fixo no início do time)
create or replace function public.my_pending_scales() returns table (event_id uuid, title text, kind text, starts_at timestamptz, team_id uuid, team_name text)
language sql stable security definer set search_path = public as $$
  select e.id, e.title, e.kind, e.starts_at, ct.team_id, t.name
  from church_event_teams ct
  join church_events e on e.id = ct.event_id
  join teams t on t.id = ct.team_id
  where e.starts_at > now() - interval '3 hours'
    and ct.team_id in (select x from public.team_alert_users_for_me() x)
    and not public.event_has_schedule(e.id, ct.team_id)
  order by e.starts_at
$$;
revoke execute on function public.my_pending_scales() from public, anon;
revoke execute on function public.team_alert_users_for_me() from public, anon;

-- agendamento diário às 09:00 (Brasília); se o pg_cron não estiver ativo, o app continua mostrando o cartão de pendência
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'somos-lembrar-escalas';
  perform cron.schedule('somos-lembrar-escalas', '0 12 * * *', 'select public.remind_pending_scales()');
exception when others then raise notice 'pg_cron indisponível: %', sqlerrm;
end $$;

-- >>> supabase/migrations/20261107000017_versoes_musica.sql
-- Versões da música por cantor (tom, BPM, duração e referências de cada um), álbum e observações gerais.
alter table public.songs add column if not exists album text;
alter table public.songs add column if not exists notes text;

create table if not exists public.song_versions (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  singer_id uuid references auth.users(id) on delete set null,
  song_key text check (song_key is null or length(song_key) <= 8),
  bpm numeric(6,2),
  duration_sec int,
  classification text,
  links jsonb not null default '[]',
  notes text,
  position int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (song_id, name)
);
create index if not exists song_versions_song_idx on public.song_versions (song_id, position);
alter table public.song_versions enable row level security;
revoke all on public.song_versions from anon;

drop policy if exists sv_select on public.song_versions;
drop policy if exists sv_insert on public.song_versions;
drop policy if exists sv_update on public.song_versions;
drop policy if exists sv_delete on public.song_versions;
create policy sv_select on public.song_versions for select to authenticated using (public.has_repertoire(org_id));
create policy sv_insert on public.song_versions for insert to authenticated
  with check (public.is_repertoire_staff(org_id) and exists (select 1 from public.songs g where g.id = song_id and g.org_id = song_versions.org_id));
create policy sv_update on public.song_versions for update to authenticated
  using (public.is_repertoire_staff(org_id)) with check (public.is_repertoire_staff(org_id));
create policy sv_delete on public.song_versions for delete to authenticated using (public.is_repertoire_staff(org_id));

-- >>> supabase/migrations/20261107000018_cadastro_louvor.sql
-- Cadastro de quem entra no Louvor por convite: o convite informa o tipo do time, lista as funções disponíveis
-- e, depois de aceitar, a pessoa grava as próprias funções (pelo menos uma no Louvor).
create or replace function public.get_invite(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'valid', i.revoked_at is null and i.expires_at > now(),
    'expired', i.expires_at <= now(), 'revoked', i.revoked_at is not null,
    'team', case when t.id is null then null else jsonb_build_object('id', t.id, 'name', t.name, 'logo_url', t.logo_url, 'accent_color', t.accent_color,
              'category', t.category, 'team_type', t.team_type, 'members', (select count(*) from team_members where team_id = t.id)) end,
    'org', jsonb_build_object('id', o.id, 'name', o.name, 'logo_url', o.logo_url, 'accent_color', o.accent_color,
              'members', (select count(*) from org_members where org_id = o.id and role <> 'guest')),
    'is_church_member', exists (select 1 from org_members where org_id = o.id and user_id = auth.uid() and role <> 'guest'),
    'already_member', case when t.id is null then exists (select 1 from org_members where org_id = o.id and user_id = auth.uid() and role <> 'guest')
                           else exists (select 1 from team_members where team_id = t.id and user_id = auth.uid()) end)
  from invites i left join teams t on t.id = i.team_id join organizations o on o.id = i.org_id
  where i.token = p_token
$$;
grant execute on function public.get_invite(text) to anon, authenticated;

-- funções que a pessoa pode escolher ao aceitar o convite (só com convite válido)
create or replace function public.invite_roles(p_token text) returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select r.id, r.name from invites i
  join teams t on t.id = i.team_id
  join music_roles r on r.org_id = i.org_id and (r.team_type is null or r.team_type = t.team_type)
  where i.token = p_token and i.revoked_at is null and i.expires_at > now()
  order by r.sort, r.name
$$;
revoke execute on function public.invite_roles(text) from public, anon;
grant execute on function public.invite_roles(text) to authenticated;

-- a própria pessoa grava as funções dela no time (e no Louvor precisa ter pelo menos uma)
create or replace function public.finish_registration(p_team uuid, p_roles uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := team_org(p_team); v_type text := (select team_type from teams where id = p_team); v_n int;
begin
  if auth.uid() is null or not exists (select 1 from team_members where team_id = p_team and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  select count(*) into v_n from music_roles r where r.id = any(p_roles) and r.org_id = v_org and (r.team_type is null or r.team_type = v_type);
  if v_type = 'louvor' and v_n = 0 then raise exception 'roles_required'; end if;
  delete from team_member_roles where team_id = p_team and user_id = auth.uid() and not (role_id = any(p_roles));
  insert into team_member_roles (team_id, user_id, role_id, org_id)
  select p_team, auth.uid(), r.id, v_org from music_roles r
  where r.id = any(p_roles) and r.org_id = v_org and (r.team_type is null or r.team_type = v_type)
  on conflict do nothing;
end $$;
revoke execute on function public.finish_registration(uuid, uuid[]) from public, anon;
grant execute on function public.finish_registration(uuid, uuid[]) to authenticated;

-- >>> supabase/migrations/20261107000019_escalado_em_outro_time.sql
-- Quem monta a escala vê se a pessoa já foi escalada em outro time no mesmo evento (mesmo evento da agenda ou mesmo horário).
create or replace function public.scheduled_elsewhere(p_team uuid, p_starts timestamptz, p_church_event uuid, p_exclude uuid, p_users uuid[])
returns table (user_id uuid, team_name text, role_name text, title text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage_team(p_team) then raise exception 'forbidden'; end if;
  return query
    select a.user_id, t.name, a.role_name, s.title
    from schedule_assignments a
    join schedules s on s.id = a.schedule_id
    join teams t on t.id = s.team_id
    where a.user_id = any(p_users) and s.team_id <> p_team and s.org_id = public.team_org(p_team)
      and (p_exclude is null or s.id <> p_exclude)
      and ((p_church_event is not null and s.church_event_id = p_church_event) or s.starts_at = p_starts);
end $$;
revoke execute on function public.scheduled_elsewhere(uuid, timestamptz, uuid, uuid, uuid[]) from public, anon;
grant execute on function public.scheduled_elsewhere(uuid, timestamptz, uuid, uuid, uuid[]) to authenticated;

-- >>> supabase/migrations/20261107000020_palco_presets.sql
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

-- >>> supabase/migrations/20261107000021_palco_giro.sql
-- Giro dos instrumentos no palco (em graus).
alter table public.team_stage_slots add column if not exists rot smallint not null default 0 check (rot between 0 and 359);

-- >>> supabase/migrations/20261108000022_escala_ensaio.sql
-- O roteiro também pode ser montado por times de louvor (a aba Roteiro aparece na edição da escala).
drop policy if exists sc_write on public.schedule_cues;
create policy sc_write on public.schedule_cues for all to authenticated
  using (public.can_manage_team(team_id))
  with check (public.can_manage_team(team_id)
    and exists (select 1 from public.teams t where t.id = schedule_cues.team_id and ('roteiro' = any(t.features) or t.team_type = 'louvor'))
    and exists (select 1 from public.schedules s where s.id = schedule_id and s.team_id = schedule_cues.team_id and s.org_id = schedule_cues.org_id));

-- >>> supabase/migrations/20261108000023_ensaios.sql
-- Ensaios da escala: uma escala pode ter vários ensaios (data, horário e observação).
create table if not exists public.schedule_rehearsals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  starts_at timestamptz not null,
  notes text check (notes is null or char_length(notes) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists schedule_rehearsals_sched_idx on public.schedule_rehearsals (schedule_id, starts_at);
alter table public.schedule_rehearsals enable row level security;
drop policy if exists sr_select on public.schedule_rehearsals;
create policy sr_select on public.schedule_rehearsals for select to authenticated
  using (public.is_team_member(team_id) or public.is_org_admin(org_id)
    or exists (select 1 from public.schedule_assignments a where a.schedule_id = schedule_rehearsals.schedule_id and a.user_id = auth.uid()));
drop policy if exists sr_write on public.schedule_rehearsals;
create policy sr_write on public.schedule_rehearsals for all to authenticated
  using (public.can_manage_team(team_id))
  with check (public.can_manage_team(team_id)
    and exists (select 1 from public.schedules s where s.id = schedule_id and s.team_id = schedule_rehearsals.team_id and s.org_id = schedule_rehearsals.org_id));

-- Avisos: ensaio marcado, alterado ou cancelado (só para escalas publicadas)
create or replace function public.on_rehearsal_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare s schedules%rowtype; r record; v_title text; v_body text; v_at timestamptz; v_notes text;
begin
  select * into s from schedules where id = coalesce(new.schedule_id, old.schedule_id);
  if not found or s.status <> 'published' then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then v_title := 'Ensaio marcado: ' || s.title; v_at := new.starts_at; v_notes := new.notes;
  elsif tg_op = 'UPDATE' then
    if new.starts_at = old.starts_at then return new; end if;
    v_title := 'Ensaio alterado: ' || s.title; v_at := new.starts_at; v_notes := new.notes;
  else v_title := 'Ensaio cancelado: ' || s.title; v_at := old.starts_at; v_notes := null; end if;
  v_body := fmt_when(v_at) || coalesce(' · ' || v_notes, '');
  for r in select distinct user_id from schedule_assignments where schedule_id = s.id loop
    perform notify_user(r.user_id, s.org_id, 'rehearsal', v_title, v_body, '#/escala/' || s.id, jsonb_build_object('schedule_id', s.id));
  end loop;
  return coalesce(new, old);
end $$;
drop trigger if exists t_rehearsal_notify on public.schedule_rehearsals;
create trigger t_rehearsal_notify after insert or update or delete on public.schedule_rehearsals
  for each row execute function public.on_rehearsal_change();

-- >>> supabase/migrations/20261108000024_role_icon.sql
-- Ícone escolhido para cada função (microfone, violão, bateria...). Vazio = ícone automático pelo nome.
alter table public.music_roles add column if not exists icon text check (icon is null or icon ~ '^[a-z]{2,20}$');

-- >>> supabase/migrations/20261108000025_lyric_presets.sql
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

-- >>> supabase/migrations/20261108000026_servico.sql
-- Ambiente de serviço: abre no dia da escala, com checklist da função.
-- service_lead_min: quantos minutos antes do início a página de serviço passa a abrir (0 = desligado).
alter table public.teams add column if not exists service_lead_min int not null default 60 check (service_lead_min between 0 and 720);

-- Itens do checklist por função (role_id nulo = vale para todos os escalados do time).
-- offset_min: horário-alvo relativo ao início do evento (ex.: -30 = 30 min antes; nulo = sem horário).
create table if not exists public.role_checklist_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  role_id uuid references public.music_roles(id) on delete cascade,
  position int not null default 0,
  label text not null check (length(trim(label)) between 1 and 140),
  offset_min int check (offset_min between -720 and 720),
  created_at timestamptz not null default now()
);
create index if not exists rci_team on public.role_checklist_items (team_id, role_id, position);

-- Quem marcou, em qual escala e a hora REAL do servidor (checked_at); target_at guarda o horário-alvo.
create table if not exists public.service_checks (
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  item_id uuid not null references public.role_checklist_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  checked_at timestamptz not null default now(),
  target_at timestamptz,
  primary key (schedule_id, item_id, user_id)
);

alter table public.role_checklist_items enable row level security;
alter table public.service_checks enable row level security;
revoke all on public.role_checklist_items from anon;
revoke all on public.service_checks from anon;

drop policy if exists rci_select on public.role_checklist_items;
drop policy if exists rci_write on public.role_checklist_items;
create policy rci_select on public.role_checklist_items for select to authenticated
  using (public.is_team_member(team_id) or public.is_org_admin(org_id));
create policy rci_write on public.role_checklist_items for all to authenticated
  using (public.can_manage_team(team_id))
  with check (public.can_manage_team(team_id) and public.team_org(team_id) = org_id);

drop policy if exists svc_select on public.service_checks;
drop policy if exists svc_insert on public.service_checks;
drop policy if exists svc_delete on public.service_checks;
create policy svc_select on public.service_checks for select to authenticated
  using (user_id = auth.uid() or public.can_manage_team(team_id));
create policy svc_insert on public.service_checks for insert to authenticated
  with check (user_id = auth.uid() and public.is_team_member(team_id)
    and exists (select 1 from public.schedule_assignments a where a.schedule_id = service_checks.schedule_id and a.user_id = auth.uid())
    and exists (select 1 from public.role_checklist_items i where i.id = item_id and i.team_id = service_checks.team_id));
create policy svc_delete on public.service_checks for delete to authenticated using (user_id = auth.uid());

-- verificação:
-- select to_regclass('public.role_checklist_items') is not null as itens, to_regclass('public.service_checks') is not null as checks,
--   exists (select 1 from information_schema.columns where table_name='teams' and column_name='service_lead_min') as antecedencia;

-- >>> supabase/migrations/20261109000001_servico_modelos.sql
-- Modelos de checklist por função: ponto de partida que cada time pode editar (acrescentar, trocar, remover).
alter table public.teams add column if not exists service_seeded boolean not null default false;

-- (padrão de nome da função, item, minutos antes do início [negativo = antes], posição)
-- padrão nulo = vale para todos os escalados
create or replace function public.service_template()
returns table (pattern text, label text, off int, pos int)
language sql immutable as $$
  values
  (null, 'Chegar ao local', -30, 10),
  (null, 'Conferir a escala e o que você vai fazer', -30, 11),
  (null, 'Participar da oração da equipe', -10, 12),
  (null, 'Tudo pronto para começar', -5, 13),

  ('bateri|percuss', 'Montar a bateria e conferir o banco', -45, 20),
  ('bateri|percuss', 'Limpar a bateria e arrumar os pratos', -40, 21),
  ('bateri|percuss', 'Afinar e conferir pele, pedal e ferragens', -35, 22),
  ('bateri|percuss', 'Preparar o metrônomo/click e o retorno', -30, 23),
  ('bateri|percuss', 'Passagem de som', -25, 24),
  ('bateri|percuss', 'Separar baquetas reserva', null, 25),

  ('viol(ã|a)o|cavaquinho|ukulele', 'Afinar o violão', -35, 20),
  ('viol(ã|a)o|cavaquinho|ukulele', 'Conferir cabo, bateria/pilha e capotraste', -30, 21),
  ('viol(ã|a)o|cavaquinho|ukulele', 'Passagem de som', -25, 22),

  ('guitarra', 'Afinar e conferir os timbres e pedais', -35, 20),
  ('guitarra', 'Conferir cabos, fonte e amplificador', -30, 21),
  ('guitarra', 'Passagem de som', -25, 22),

  ('baixo', 'Afinar e conferir cabo e amplificador', -35, 20),
  ('baixo', 'Ouvir o tom de cada música', -30, 21),
  ('baixo', 'Passagem de som', -25, 22),

  ('teclado|piano|keys|sintetizador', 'Ligar e conferir timbres e pads de cada música', -35, 20),
  ('teclado|piano|keys|sintetizador', 'Conferir cabos, pedal de sustain e fonte', -30, 21),
  ('teclado|piano|keys|sintetizador', 'Passagem de som', -25, 22),

  ('vocal|voz|cantor|backing|soprano|contralto|tenor', 'Aquecer a voz e beber água', -30, 20),
  ('vocal|voz|cantor|backing|soprano|contralto|tenor', 'Rever letras e tons das músicas', -30, 21),
  ('vocal|voz|cantor|backing|soprano|contralto|tenor', 'Testar microfone e retorno', -25, 22),

  ('dire(ç|c)(ã|a)o|coordena|ministro|dirigente|l(í|i)der', 'Confirmar o repertório e a ordem com a equipe', -45, 20),
  ('dire(ç|c)(ã|a)o|coordena|ministro|dirigente|l(í|i)der', 'Alinhar transições e avisos com quem conduz o culto', -25, 21),
  ('dire(ç|c)(ã|a)o|coordena|ministro|dirigente|l(í|i)der', 'Reunir a equipe para orar', -10, 22),

  ('^som$|(á|a)udio|mesa|sonoplast', 'Ligar os equipamentos na ordem certa', -60, 20),
  ('^som$|(á|a)udio|mesa|sonoplast', 'Conferir canais, microfones e cabos', -50, 21),
  ('^som$|(á|a)udio|mesa|sonoplast', 'Passagem de som com todos', -35, 22),
  ('^som$|(á|a)udio|mesa|sonoplast', 'Ajustar o volume ambiente e salvar a cena', -15, 23),

  ('proje(ç|c)|m(í|i)dia|slide|letra|propres|holyrics', 'Abrir o programa e carregar letras e slides', -45, 20),
  ('proje(ç|c)|m(í|i)dia|slide|letra|propres|holyrics', 'Testar projetor/TV e os fundos', -35, 21),
  ('proje(ç|c)|m(í|i)dia|slide|letra|propres|holyrics', 'Conferir a ordem das músicas e os avisos', -25, 22),
  ('proje(ç|c)|m(í|i)dia|slide|letra|propres|holyrics', 'Alinhar com o louvor', -15, 23),

  ('transmiss|corte|c(â|a)mera|v(í|i)deo|live|stream|foto', 'Carregar baterias e conferir cartão/armazenamento', -60, 20),
  ('transmiss|corte|c(â|a)mera|v(í|i)deo|live|stream|foto', 'Posicionar câmeras e conferir o enquadramento', -50, 21),
  ('transmiss|corte|c(â|a)mera|v(í|i)deo|live|stream|foto', 'Testar o áudio e a internet', -40, 22),
  ('transmiss|corte|c(â|a)mera|v(í|i)deo|live|stream|foto', 'Iniciar a transmissão/gravação', -5, 23),

  ('portaria|recep|acolh|diac|visitante|estacion|seguran', 'Abrir as portas e conferir o ambiente', -40, 20),
  ('portaria|recep|acolh|diac|visitante|estacion|seguran', 'Conferir materiais e informativos', -30, 21),
  ('portaria|recep|acolh|diac|visitante|estacion|seguran', 'Posicionar-se nos pontos combinados', -20, 22),
  ('portaria|recep|acolh|diac|visitante|estacion|seguran', 'Receber quem chega com um sorriso', -10, 23),

  ('ofert', 'Conferir cestas, envelopes e maquininha', -30, 20),
  ('ofert', 'Combinar o momento do ofertório com a equipe', -15, 21),

  ('auxiliar', 'Perguntar ao líder onde ajudar', -35, 20),
  ('auxiliar', 'Ajudar na montagem e na organização', -30, 21),

  ('ilumina', 'Ligar a iluminação e testar as cenas', -45, 20),
  ('ilumina', 'Conferir os focos no palco e no púlpito', -30, 21),
  ('ilumina', 'Alinhar as cenas com a ordem do culto', -15, 22),

  ('santa ceia', 'Preparar os elementos e os utensílios', -40, 20),
  ('santa ceia', 'Combinar o momento com quem conduz', -20, 21),

  ('altar', 'Conferir o altar e o púlpito (água, Bíblia, microfone)', -30, 20),
  ('altar', 'Ficar atento a quem precisa de apoio', -10, 21),

  ('ber(ç|c)(á|a)rio', 'Preparar o ambiente e conferir os itens de cuidado', -40, 20),
  ('ber(ç|c)(á|a)rio', 'Receber as famílias com atenção', -10, 21),

  ('introdu', 'Rever os pontos da introdução', -30, 20),

  ('introdu', 'Alinhar com a banda a entrada', -20, 21),

  ('professor|(á|a)rea kids|kids|crian', 'Rever a lição e o material', -45, 20),
  ('professor|(á|a)rea kids|kids|crian', 'Preparar a sala', -30, 21),
  ('professor|(á|a)rea kids|kids|crian', 'Receber as crianças e as famílias', -10, 22)
$$;

-- Cria o ponto de partida do time uma única vez (qualquer membro do time pode disparar).
create or replace function public.ensure_service_checklist(p_team uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; t record;
begin
  if not (public.is_team_member(p_team) or public.is_org_admin(public.team_org(p_team))) then
    raise exception 'sem permissão';
  end if;
  select * into t from public.teams where id = p_team for update;
  if t.service_seeded then return 0; end if;
  insert into public.role_checklist_items (org_id, team_id, role_id, position, label, offset_min)
  select t.org_id, p_team, null, s.pos, s.label, s.off from public.service_template() s where s.pattern is null;
  get diagnostics n = row_count;
  insert into public.role_checklist_items (org_id, team_id, role_id, position, label, offset_min)
  select t.org_id, p_team, r.id, s.pos, s.label, s.off
  from public.music_roles r
  join public.service_template() s on s.pattern is not null and r.name ~* s.pattern
  where r.org_id = t.org_id and (r.team_type is null or r.team_type = t.team_type);
  update public.teams set service_seeded = true where id = p_team;
  return n;
end $$;

-- Líder: devolve o modelo de uma função (ou de "todos", com p_role nulo), sem repetir itens que já existem.
create or replace function public.restore_service_template(p_team uuid, p_role uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; t record; r record;
begin
  if not public.can_manage_team(p_team) then raise exception 'sem permissão'; end if;
  select * into t from public.teams where id = p_team;
  if p_role is null then
    insert into public.role_checklist_items (org_id, team_id, role_id, position, label, offset_min)
    select t.org_id, p_team, null, s.pos, s.label, s.off from public.service_template() s
    where s.pattern is null and not exists (select 1 from public.role_checklist_items i where i.team_id = p_team and i.role_id is null and i.label = s.label);
  else
    select * into r from public.music_roles where id = p_role and org_id = t.org_id;
    if not found then raise exception 'função inválida'; end if;
    insert into public.role_checklist_items (org_id, team_id, role_id, position, label, offset_min)
    select t.org_id, p_team, r.id, s.pos, s.label, s.off from public.service_template() s
    where s.pattern is not null and r.name ~* s.pattern
      and not exists (select 1 from public.role_checklist_items i where i.team_id = p_team and i.role_id = r.id and i.label = s.label);
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.ensure_service_checklist(uuid), public.restore_service_template(uuid, uuid) from public, anon;
grant execute on function public.ensure_service_checklist(uuid), public.restore_service_template(uuid, uuid) to authenticated;

-- verificação:
-- select count(*) as itens_do_modelo from public.service_template();

-- >>> supabase/migrations/20261110000001_repertorio_multimidia.sql
-- Repertório da escala enviado ao Ministério de Multimídia.
-- mm_sent_at: quando o Louvor confirmou que o repertório está pronto; mm_sig: assinatura das músicas/versões/tons no envio;
-- mm_changed: o repertório foi alterado depois do envio (a Multimídia espera um novo envio).
alter table public.schedules
  add column if not exists mm_sent_at timestamptz,
  add column if not exists mm_sent_by uuid references auth.users(id) on delete set null,
  add column if not exists mm_sig text,
  add column if not exists mm_changed boolean not null default false;

-- envia (ou reenvia) o repertório da escala publicada; avisa todos os times de Multimídia da igreja
create or replace function public.send_repertoire(p_schedule uuid, p_sig text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s schedules%rowtype; resent boolean;
begin
  select * into s from schedules where id = p_schedule;
  if not found or not public.can_manage_team(s.team_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if s.status <> 'published' then raise exception 'publique a escala antes de enviar o repertório' using errcode = '22023'; end if;
  resent := s.mm_sent_at is not null;
  update schedules set mm_sent_at = now(), mm_sent_by = auth.uid(), mm_sig = p_sig, mm_changed = false where id = p_schedule;
  perform public.notify_user(u.user_id, s.org_id, 'repertoire',
    case when resent then 'Repertório atualizado: ' else 'Repertório recebido: ' end || s.title,
    to_char(s.starts_at at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI'), '#/repertorio-culto/' || s.id, jsonb_build_object('schedule_id', s.id))
  from (select distinct tm.user_id from team_members tm join teams t on t.id = tm.team_id
        where t.org_id = s.org_id and t.team_type = 'multimidia' and tm.user_id <> auth.uid()) u;
end $$;

-- o repertório já enviado foi alterado: a Multimídia é avisada e espera o novo envio
create or replace function public.mark_repertoire_changed(p_schedule uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s schedules%rowtype;
begin
  select * into s from schedules where id = p_schedule;
  if not found or not public.can_manage_team(s.team_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if s.mm_sent_at is null or s.mm_changed then return; end if;
  update schedules set mm_changed = true where id = p_schedule;
  perform public.notify_user(u.user_id, s.org_id, 'repertoire', 'Repertório alterado: ' || s.title,
    'O Louvor mudou o repertório. Aguarde o novo envio.', '#/repertorio-culto/' || s.id, jsonb_build_object('schedule_id', s.id))
  from (select distinct tm.user_id from team_members tm join teams t on t.id = tm.team_id
        where t.org_id = s.org_id and t.team_type = 'multimidia' and tm.user_id <> auth.uid()) u;
end $$;

-- repertórios recebidos (de hoje em diante) ou um específico; só para quem é de um time de Multimídia da igreja ou administra
create or replace function public.media_repertoires(p_schedule uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.starts_at), '[]'::jsonb) from (
    select s.id, s.title, s.starts_at, s.location, t.name as team_name, s.mm_sent_at, s.mm_changed,
      (select coalesce(jsonb_agg(jsonb_build_object('position', ss.position, 'title', ss.title_snapshot, 'artist', ss.artist_snapshot, 'key', ss.song_key,
          'version', ss.version_name, 'bpm', coalesce(ss.bpm, so.bpm), 'notes', ss.notes) order by ss.position), '[]'::jsonb)
         from schedule_songs ss left join songs so on so.id = ss.song_id where ss.schedule_id = s.id) as songs
    from schedules s join teams t on t.id = s.team_id
    where s.mm_sent_at is not null and s.status = 'published'
      and ((p_schedule is null and s.starts_at >= now() - interval '1 day') or s.id = p_schedule)
      and (public.is_org_admin(s.org_id) or exists (select 1 from team_members tm join teams mt on mt.id = tm.team_id
            where tm.user_id = auth.uid() and mt.org_id = s.org_id and mt.team_type = 'multimidia'))
  ) x
$$;
revoke execute on function public.send_repertoire(uuid, text), public.mark_repertoire_changed(uuid), public.media_repertoires(uuid) from public, anon;
grant execute on function public.send_repertoire(uuid, text), public.mark_repertoire_changed(uuid), public.media_repertoires(uuid) to authenticated;

-- verificação:
-- select exists (select 1 from information_schema.columns where table_name='schedules' and column_name='mm_sent_at') as colunas,
--   to_regprocedure('public.send_repertoire(uuid,text)') is not null as enviar, to_regprocedure('public.media_repertoires(uuid)') is not null as ler;

-- >>> supabase/migrations/20261111000001_conflito_por_horario.sql
-- 'Já escalado neste dia' passa a considerar só escalas que se sobrepõem ao horário do evento (manhã e noite não se misturam).
-- A coluna continua se chamando same_day_count para não mudar o app; agora conta conflitos no mesmo horário.
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
             and s.starts_at < v_end and coalesce(s.ends_at, s.starts_at + interval '2 hours') > p_starts),   -- mesmo culto/horário (sobrepõe), não o dia inteiro
         tm.avoid_with
  from team_members tm
  join team_member_roles r on r.team_id = tm.team_id and r.user_id = tm.user_id
  join org_members om on om.org_id = v_org and om.user_id = tm.user_id
  join profiles p on p.id = tm.user_id
  where tm.team_id = p_team;
end $$;

-- verificação:
-- select pg_get_functiondef('public.schedule_candidates(uuid,timestamptz,timestamptz,uuid)'::regprocedure) like '%sobrepõe%' as atualizada;

-- >>> supabase/migrations/20261115000001_equipe_louvor.sql
-- App de equipe de louvor: cada grupo que se cadastra tem o seu espaço próprio e isolado (sem ligação com outras igrejas).
-- team_only: a pessoa só enxerga a página da equipe, inclusive o administrador (as áreas de igreja e de outros ministérios ficam fechadas).
alter table public.organizations add column if not exists team_only boolean not null default false;

-- cadastro de uma nova equipe de louvor: cria o espaço, a equipe e deixa quem cadastrou como líder
create or replace function public.create_louvor_team(p_name text, p_church text default null, p_accent text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_org uuid; v_team uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required'; end if;
  v_org := public.create_organization(trim(p_name), p_accent, nullif(trim(coalesce(p_church, '')), ''));
  update organizations set team_only = true where id = v_org;
  insert into teams (org_id, name, category, team_type, created_by)
  values (v_org, trim(p_name), 'ministry', 'louvor', v_uid) returning id into v_team;
  insert into team_members (team_id, user_id, org_id, is_leader) values (v_team, v_uid, v_org, true);
  return jsonb_build_object('org_id', v_org, 'team_id', v_team);
end $$;
revoke execute on function public.create_louvor_team(text, text, text) from public, anon;
grant execute on function public.create_louvor_team(text, text, text) to authenticated;

-- verificação:
-- select exists (select 1 from information_schema.columns where table_name='organizations' and column_name='team_only') as coluna,
--   to_regprocedure('public.create_louvor_team(text,text,text)') is not null as funcao;

-- >>> supabase/migrations/20261115000002_desenvolvedor.sql
-- Modo desenvolvedor: a pessoa marcada enxerga o app completo (igreja, outros ministérios, telas em construção),
-- mesmo dentro de uma equipe "somente time". A marca só pode ser colocada pelo SQL Editor (nunca pelo próprio usuário).
alter table public.profiles add column if not exists is_developer boolean not null default false;

create or replace function public.profiles_guard_developer() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then new.is_developer := false;
    else new.is_developer := old.is_developer; end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_developer on public.profiles;
create trigger profiles_guard_developer before insert or update on public.profiles
  for each row execute function public.profiles_guard_developer();

-- para ligar no SEU login (troque o e-mail, se precisar):
-- update public.profiles set is_developer = true where id = (select id from auth.users where email = 'SEU_EMAIL');
-- verificação:
-- select p.full_name, u.email, p.is_developer from public.profiles p join auth.users u on u.id = p.id where p.is_developer;

-- >>> supabase/migrations/20261116000001_tempo_de_player.sql
-- Tempo de uso do player: cada pessoa registra o próprio tempo de escuta (por música e por dia);
-- só o líder da equipe (ou o administrador) consegue consultar o tempo dos integrantes.
create table if not exists public.player_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  org_id uuid not null,
  day date not null,
  schedule_id uuid not null default '00000000-0000-0000-0000-000000000000',
  seconds integer not null default 0,
  primary key (user_id, song_id, day, schedule_id)
);
create index if not exists player_usage_org_day on public.player_usage (org_id, day);
alter table public.player_usage enable row level security;
drop policy if exists pu_own_select on public.player_usage;
create policy pu_own_select on public.player_usage for select to authenticated using (user_id = auth.uid());

create or replace function public.log_listening(p_song uuid, p_seconds integer, p_schedule uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_org uuid; v_day date := (now() at time zone 'America/Sao_Paulo')::date; v_s integer := least(greatest(coalesce(p_seconds, 0), 0), 300);
begin
  if v_uid is null or v_s = 0 then return; end if;
  select org_id into v_org from songs where id = p_song;
  if v_org is null or not public.is_org_member(v_org) then return; end if;
  insert into player_usage (user_id, song_id, org_id, day, schedule_id, seconds)
  values (v_uid, p_song, v_org, v_day, coalesce(p_schedule, '00000000-0000-0000-0000-000000000000'), v_s)
  on conflict (user_id, song_id, day, schedule_id) do update set seconds = player_usage.seconds + excluded.seconds;
end $$;
revoke execute on function public.log_listening(uuid, integer, uuid) from public, anon;
grant execute on function public.log_listening(uuid, integer, uuid) to authenticated;

-- tempo de escuta dos integrantes do time: de uma escala (as músicas dela, desde que foi criada) ou de todas as músicas desde p_since
create or replace function public.team_listening(p_team uuid, p_schedule uuid default null, p_since date default null)
returns table (user_id uuid, song_id uuid, seconds bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_from date;
begin
  if not public.can_manage_team(p_team) then raise exception 'forbidden'; end if;
  select org_id into v_org from teams where id = p_team;
  if p_schedule is not null then
    select (s.created_at at time zone 'America/Sao_Paulo')::date into v_from from schedules s where s.id = p_schedule and s.team_id = p_team;
    if v_from is null then raise exception 'not_found'; end if;
    return query
      select u.user_id, u.song_id, sum(u.seconds)::bigint from player_usage u
      join team_members tm on tm.team_id = p_team and tm.user_id = u.user_id
      where u.org_id = v_org and u.day >= v_from
        and u.song_id in (select ss.song_id from schedule_songs ss where ss.schedule_id = p_schedule and ss.song_id is not null)
      group by u.user_id, u.song_id;
  else
    return query
      select u.user_id, u.song_id, sum(u.seconds)::bigint from player_usage u
      join team_members tm on tm.team_id = p_team and tm.user_id = u.user_id
      where u.org_id = v_org and u.day >= coalesce(p_since, current_date - 30)
      group by u.user_id, u.song_id;
  end if;
end $$;
revoke execute on function public.team_listening(uuid, uuid, date) from public, anon;
grant execute on function public.team_listening(uuid, uuid, date) to authenticated;

-- verificação:
-- select to_regclass('public.player_usage') is not null as tabela,
--   to_regprocedure('public.log_listening(uuid,integer,uuid)') is not null as registra,
--   to_regprocedure('public.team_listening(uuid,uuid,date)') is not null as consulta;

-- >>> supabase/migrations/20261123000001_ambientes_permissoes.sql
-- =====================================================================
-- Ambientes, redes de supervisão, funções e permissões (23/11/2026)
--  SOMOS Um (comunidade) · SOMOS Servos (times) · SOMOS Chamados (liderança)
--  * 100% aditivo: nada é apagado, renomeado ou recriado; o Louvor e os demais times seguem como estão.
--  * Vínculos de time continuam em team_members (is_leader = líder do ministério) e org_members (admin/member/guest).
--  * Novo: redes (grupos de times sob um pastor supervisor), concessões de função com ações permitidas
--    (supervisor de rede e liderança geral) e o perfil de desenvolvedor valendo no SERVIDOR.
--  * As funções de permissão já usadas pelas políticas de acesso (RLS) passam a reconhecer esses papéis.
-- =====================================================================

-- ---------------------------------------------------------------- desenvolvedor (servidor)
-- profiles.is_developer só pode ser ligado pelo SQL Editor (gatilho profiles_guard_developer).
create or replace function public.is_developer() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_developer from public.profiles where id = auth.uid()), false)
$$;
revoke execute on function public.is_developer() from public, anon;
grant execute on function public.is_developer() to authenticated;

-- ---------------------------------------------------------------- redes e concessões
create table if not exists public.church_networks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists church_networks_org_name on public.church_networks (org_id, lower(name));

create table if not exists public.network_teams (
  network_id uuid not null references public.church_networks(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  primary key (network_id, team_id)
);
create index if not exists network_teams_team on public.network_teams (team_id);

-- Quem exerce qual função, em qual área e com quais ações:
--   network_supervisor = pastor/supervisor de uma rede   (network_id obrigatório)
--   general_leader     = liderança geral da igreja       (sem rede; o título é livre: Pastor presidente, Bispo...)
create table if not exists public.access_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_key text not null check (role_key in ('network_supervisor','general_leader')),
  network_id uuid references public.church_networks(id) on delete cascade,
  title text check (title is null or length(trim(title)) between 1 and 60),
  actions text[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((role_key = 'network_supervisor' and network_id is not null) or (role_key = 'general_leader' and network_id is null)),
  check (actions <@ array['view','create','edit','delete','approve','manage','administer']::text[])
);
create unique index if not exists access_grants_supervisor on public.access_grants (org_id, user_id, network_id) where role_key = 'network_supervisor';
create unique index if not exists access_grants_general on public.access_grants (org_id, user_id) where role_key = 'general_leader';
create index if not exists access_grants_user on public.access_grants (user_id);

-- ---------------------------------------------------------------- matriz de ações por função
create or replace function public.all_actions() returns text[] language sql immutable as $$
  select array['view','create','edit','delete','approve','manage','administer']::text[]
$$;
create or replace function public.role_actions(p_role text) returns text[] language sql immutable as $$
  select case p_role
    when 'team_member'        then array['view']
    when 'team_leader'        then array['view','create','edit','delete','approve','manage']
    when 'network_supervisor' then array['view','approve','manage']
    when 'general_leader'     then array['view','create','edit','approve','manage','administer']
    else '{}' end::text[]
$$;

-- concessão cobre o time? (só por rede/liderança geral; não conta administrador, líder nem integrante)
create or replace function public.grant_covers_team(p_team uuid, p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from access_grants g join teams t on t.org_id = g.org_id and t.id = p_team
    where g.user_id = auth.uid() and p_action = any(g.actions)
      and (g.role_key = 'general_leader'
           or (g.role_key = 'network_supervisor' and exists (select 1 from network_teams nt where nt.network_id = g.network_id and nt.team_id = t.id))))
$$;

-- permissão de uma ação sobre um time: desenvolvedor, administrador, líder, integrante (só ver) ou concessão
create or replace function public.has_perm(p_team uuid, p_action text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from teams where id = p_team;
  if v_org is null then return false; end if;
  if public.is_developer() then return true; end if;
  if exists (select 1 from org_members where org_id = v_org and user_id = auth.uid() and role = 'admin') then return true; end if;
  if exists (select 1 from team_members where team_id = p_team and user_id = auth.uid() and is_leader)
     and p_action = any (public.role_actions('team_leader')) then return true; end if;
  if p_action = 'view' and exists (select 1 from team_members where team_id = p_team and user_id = auth.uid()
       and (access_until is null or access_until >= (now() at time zone 'America/Sao_Paulo')::date)) then return true; end if;
  return public.grant_covers_team(p_team, p_action);
end $$;

-- permissão no nível da igreja (rede, liderança, configurações)
create or replace function public.has_org_perm(p_org uuid, p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_developer()
      or exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
      or exists (select 1 from access_grants where org_id = p_org and user_id = auth.uid() and role_key = 'general_leader' and p_action = any(actions))
$$;
revoke execute on function public.grant_covers_team(uuid, text), public.has_perm(uuid, text), public.has_org_perm(uuid, text) from public, anon;
grant execute on function public.grant_covers_team(uuid, text), public.has_perm(uuid, text), public.has_org_perm(uuid, text) to authenticated;

-- ---------------------------------------------------------------- funções de permissão existentes (mesmo comportamento + novos papéis)
create or replace function public.is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
      or public.is_developer()
$$;

create or replace function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role <> 'guest')
      or public.is_developer()
      or exists (select 1 from access_grants where org_id = p_org and user_id = auth.uid())
$$;

create or replace function public.in_org(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid())
      or public.is_developer()
$$;

create or replace function public.is_team_member(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id = p_team and user_id = auth.uid()
                 and (access_until is null or access_until >= (now() at time zone 'America/Sao_Paulo')::date))
      or public.is_developer()
      or public.grant_covers_team(p_team, 'view')
$$;

create or replace function public.can_manage_team(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from teams t
    where t.id = p_team
      and (exists (select 1 from org_members m where m.org_id = t.org_id and m.user_id = auth.uid() and m.role = 'admin')
           or exists (select 1 from team_members tm where tm.team_id = t.id and tm.user_id = auth.uid() and tm.is_leader)))
   or public.is_developer() or public.grant_covers_team(p_team, 'manage')
$$;

create or replace function public.shares_team(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members a join team_members b on a.team_id = b.team_id
    where a.user_id = auth.uid() and b.user_id = p_user
      and (a.access_until is null or a.access_until >= (now() at time zone 'America/Sao_Paulo')::date))
  or public.is_developer()
  or exists (select 1 from team_members b where b.user_id = p_user and public.grant_covers_team(b.team_id, 'view'))
$$;

-- ---------------------------------------------------------------- políticas das tabelas novas
alter table public.church_networks enable row level security;
alter table public.network_teams  enable row level security;
alter table public.access_grants  enable row level security;
revoke all on public.church_networks, public.network_teams, public.access_grants from anon;
revoke insert, update, delete on public.church_networks, public.network_teams, public.access_grants from authenticated;   -- escrita só pelas funções abaixo

drop policy if exists networks_select on public.church_networks;
create policy networks_select on public.church_networks for select to authenticated using (public.is_org_member(org_id));
drop policy if exists network_teams_select on public.network_teams;
create policy network_teams_select on public.network_teams for select to authenticated using (public.is_org_member(org_id));
drop policy if exists grants_select on public.access_grants;
create policy grants_select on public.access_grants for select to authenticated
  using (user_id = auth.uid() or public.has_org_perm(org_id, 'administer'));

-- ---------------------------------------------------------------- gestão (somente servidor decide)
-- ações que o chamador pode repassar: administrador/desenvolvedor = todas; liderança geral = as suas
create or replace function public.caller_actions(p_org uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when public.is_developer() or exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin') then public.all_actions()
    else coalesce((select actions from access_grants where org_id = p_org and user_id = auth.uid() and role_key = 'general_leader'), '{}'::text[]) end
$$;

create or replace function public.network_save(p_org uuid, p_id uuid, p_name text, p_teams uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id;
begin
  if not public.has_org_perm(p_org, 'administer') then raise exception 'forbidden'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required'; end if;
  if exists (select 1 from unnest(coalesce(p_teams, '{}')) t where not exists (select 1 from teams where id = t and org_id = p_org)) then raise exception 'invalid_team'; end if;
  if v_id is null then
    insert into church_networks (org_id, name, sort) values (p_org, trim(p_name), coalesce((select max(sort) + 1 from church_networks where org_id = p_org), 0)) returning id into v_id;
  else
    update church_networks set name = trim(p_name) where id = v_id and org_id = p_org;
    if not found then raise exception 'not_found'; end if;
  end if;
  delete from network_teams where network_id = v_id and not (team_id = any (coalesce(p_teams, '{}')));
  insert into network_teams (network_id, team_id, org_id) select v_id, t, p_org from unnest(coalesce(p_teams, '{}')) t on conflict do nothing;
  return v_id;
end $$;

create or replace function public.network_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from church_networks where id = p_id;
  if v_org is null then return; end if;
  if not public.has_org_perm(v_org, 'administer') then raise exception 'forbidden'; end if;
  delete from church_networks where id = p_id;   -- vínculos e supervisões da rede saem junto; os times não são tocados
end $$;

create or replace function public.grant_set(p_org uuid, p_user uuid, p_role text, p_network uuid, p_title text, p_actions text[] default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_actions text[]; v_id uuid;
begin
  if not public.has_org_perm(p_org, 'administer') then raise exception 'forbidden'; end if;
  if p_role not in ('network_supervisor','general_leader') then raise exception 'invalid_role'; end if;
  -- só administrador/desenvolvedor nomeia liderança geral
  if p_role = 'general_leader' and not (public.is_developer() or public.is_org_admin(p_org)) then raise exception 'forbidden'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = p_user and role <> 'guest') then raise exception 'not_a_member'; end if;
  if p_role = 'network_supervisor' and not exists (select 1 from church_networks where id = p_network and org_id = p_org) then raise exception 'invalid_network'; end if;
  v_actions := coalesce(p_actions, public.role_actions(p_role));
  if not (v_actions <@ public.caller_actions(p_org)) then raise exception 'cannot_grant_more_than_you_have'; end if;
  if p_role = 'general_leader' then
    insert into access_grants (org_id, user_id, role_key, title, actions, created_by) values (p_org, p_user, p_role, nullif(trim(coalesce(p_title, '')), ''), v_actions, auth.uid())
    on conflict (org_id, user_id) where role_key = 'general_leader' do update set title = excluded.title, actions = excluded.actions returning id into v_id;
  else
    insert into access_grants (org_id, user_id, role_key, network_id, title, actions, created_by) values (p_org, p_user, p_role, p_network, nullif(trim(coalesce(p_title, '')), ''), v_actions, auth.uid())
    on conflict (org_id, user_id, network_id) where role_key = 'network_supervisor' do update set title = excluded.title, actions = excluded.actions returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.grant_remove(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g access_grants;
begin
  select * into g from access_grants where id = p_id;
  if g.id is null then return; end if;
  if not public.has_org_perm(g.org_id, 'administer') then raise exception 'forbidden'; end if;
  if g.role_key = 'general_leader' and not (public.is_developer() or public.is_org_admin(g.org_id)) then raise exception 'forbidden'; end if;
  delete from access_grants where id = p_id;
end $$;

-- o que a pessoa é, e onde, na igreja (base da navegação entre ambientes)
create or replace function public.my_access(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_dev boolean := public.is_developer(); v_admin boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_admin := exists (select 1 from org_members where org_id = p_org and user_id = v_uid and role = 'admin');
  return jsonb_build_object(
    'developer', v_dev,
    'admin', v_admin,
    'member', exists (select 1 from org_members where org_id = p_org and user_id = v_uid and role <> 'guest'),
    'general_leader', (select jsonb_build_object('title', g.title, 'actions', g.actions) from access_grants g where g.org_id = p_org and g.user_id = v_uid and g.role_key = 'general_leader'),
    'networks', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'title', g.title, 'actions', g.actions) order by n.sort, n.name)
                          from access_grants g join church_networks n on n.id = g.network_id where g.org_id = p_org and g.user_id = v_uid and g.role_key = 'network_supervisor'), '[]'::jsonb),
    'leader_of', coalesce((select jsonb_agg(tm.team_id) from team_members tm where tm.org_id = p_org and tm.user_id = v_uid and tm.is_leader), '[]'::jsonb),
    'member_of', coalesce((select jsonb_agg(tm.team_id) from team_members tm where tm.org_id = p_org and tm.user_id = v_uid
                           and (tm.access_until is null or tm.access_until >= (now() at time zone 'America/Sao_Paulo')::date)), '[]'::jsonb));
end $$;

-- todas as igrejas, só para o desenvolvedor (testar os diferentes ambientes)
create or replace function public.dev_orgs() returns setof public.organizations
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_developer() then raise exception 'forbidden'; end if;
  return query select * from organizations order by name;
end $$;

revoke execute on function public.caller_actions(uuid), public.network_save(uuid, uuid, text, uuid[]), public.network_delete(uuid),
  public.grant_set(uuid, uuid, text, uuid, text, text[]), public.grant_remove(uuid), public.my_access(uuid), public.dev_orgs() from public, anon;
grant execute on function public.caller_actions(uuid), public.network_save(uuid, uuid, text, uuid[]), public.network_delete(uuid),
  public.grant_set(uuid, uuid, text, uuid, text, text[]), public.grant_remove(uuid), public.my_access(uuid), public.dev_orgs() to authenticated;

-- verificação:
-- select to_regclass('public.church_networks') is not null as redes, to_regclass('public.access_grants') is not null as concessoes,
--   to_regprocedure('public.has_perm(uuid,text)') is not null as permissao, to_regprocedure('public.my_access(uuid)') is not null as acesso;
-- conferir o desenvolvedor:
-- select p.full_name, u.email, p.is_developer from public.profiles p join auth.users u on u.id = p.id where p.is_developer;

-- REVERSÃO (se um dia precisar): as funções de permissão voltam às versões de 20261103000001 e 20261104000002 (reexecute esses
-- trechos) e depois: drop table public.access_grants, public.network_teams, public.church_networks;
-- drop function public.is_developer(), public.has_perm(uuid,text), public.has_org_perm(uuid,text), public.grant_covers_team(uuid,text),
--   public.role_actions(text), public.all_actions(), public.caller_actions(uuid), public.network_save(uuid,uuid,text,uuid[]),
--   public.network_delete(uuid), public.grant_set(uuid,uuid,text,uuid,text,text[]), public.grant_remove(uuid), public.my_access(uuid), public.dev_orgs();

-- >>> supabase/migrations/20261123000002_auditoria_desenvolvedor.sql
-- =====================================================================
-- Modo auditoria do desenvolvedor (23/11/2026)
--  O desenvolvedor circula e edita TODAS as áreas (times, escalas, músicas, repertórios, redes, configurações),
--  mas NÃO lê dados pessoais de ninguém: perfis, telefone, nascimento, conversas, enquetes, crianças, visitantes,
--  indisponibilidades, arquivos privados e lista de integrantes de igrejas em que não é membro de verdade.
--  * Aditivo e reversível: só recria shares_team/schedule_candidates e acrescenta políticas RESTRITIVAS
--    (valem somente quando is_developer() é verdadeiro; para todas as outras pessoas nada muda).
--  * Vínculo "de verdade" (membro, líder ou administrador da própria igreja) continua valendo como sempre.
-- =====================================================================

-- vínculo real, sem o atalho de desenvolvedor nem concessões de rede
create or replace function public.real_org_access(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid())
$$;
create or replace function public.real_team_access(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id = p_team and user_id = auth.uid())
      or exists (select 1 from teams t join org_members m on m.org_id = t.org_id and m.user_id = auth.uid() and m.role = 'admin' where t.id = p_team)
$$;
revoke execute on function public.real_org_access(uuid), public.real_team_access(uuid) from public, anon;
grant execute on function public.real_org_access(uuid), public.real_team_access(uuid) to authenticated;

-- "divide time com": volta a não incluir o desenvolvedor (é isto que libera perfis de outras pessoas)
create or replace function public.shares_team(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members a join team_members b on a.team_id = b.team_id
    where a.user_id = auth.uid() and b.user_id = p_user
      and (a.access_until is null or a.access_until >= (now() at time zone 'America/Sao_Paulo')::date))
  or exists (select 1 from team_members b where b.user_id = p_user and public.grant_covers_team(b.team_id, 'view'))
$$;

-- políticas restritivas (só afetam o desenvolvedor)
drop policy if exists dev_audit_org_members on public.org_members;
create policy dev_audit_org_members on public.org_members as restrictive for all to authenticated
  using (not public.is_developer() or user_id = auth.uid() or public.real_org_access(org_id));
drop policy if exists dev_audit_unavailability on public.unavailability;
create policy dev_audit_unavailability on public.unavailability as restrictive for all to authenticated
  using (not public.is_developer() or user_id = auth.uid() or public.real_org_access(org_id));

do $$
declare t text;
begin
  foreach t in array array['messages','polls','children','child_checkins','visitors','team_files','service_checks'] loop
    execute format('drop policy if exists dev_audit_%1$s on public.%1$s', t);
    execute format('create policy dev_audit_%1$s on public.%1$s as restrictive for all to authenticated using (not public.is_developer() or public.real_team_access(team_id))', t);
  end loop;
end $$;
drop policy if exists dev_audit_poll_votes on public.poll_votes;
create policy dev_audit_poll_votes on public.poll_votes as restrictive for all to authenticated
  using (not public.is_developer() or user_id = auth.uid() or exists (select 1 from polls p where p.id = poll_votes.poll_id and public.real_team_access(p.team_id)));
drop policy if exists dev_audit_team_event_rsvps on public.team_event_rsvps;
create policy dev_audit_team_event_rsvps on public.team_event_rsvps as restrictive for all to authenticated
  using (not public.is_developer() or user_id = auth.uid() or exists (select 1 from team_events e where e.id = team_event_rsvps.event_id and public.real_team_access(e.team_id)));

-- sugestão de escala (nomes e indisponibilidades): idem
CREATE OR REPLACE FUNCTION public.schedule_candidates(p_team uuid, p_starts timestamp with time zone, p_ends timestamp with time zone DEFAULT NULL::timestamp with time zone, p_exclude_schedule uuid DEFAULT NULL::uuid)
 RETURNS TABLE(user_id uuid, role_id uuid, display_name text, available boolean, unavailable_note text, month_count integer, monthly_limit integer, same_day_count integer, avoid_with uuid[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid := team_org(p_team); v_end timestamptz := coalesce(p_ends, p_starts + interval '2 hours');
        v_day date := (p_starts at time zone 'America/Sao_Paulo')::date;
begin
  if not can_manage_team(p_team) then raise exception 'forbidden'; end if;
  -- modo auditoria: o desenvolvedor não lê nomes nem indisponibilidades de times em que não está de verdade
  if public.is_developer() and not public.real_team_access(p_team) then raise exception 'forbidden'; end if;
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
             and s.starts_at < v_end and coalesce(s.ends_at, s.starts_at + interval '2 hours') > p_starts),   -- mesmo culto/horário (sobrepõe), não o dia inteiro
         tm.avoid_with
  from team_members tm
  join team_member_roles r on r.team_id = tm.team_id and r.user_id = tm.user_id
  join org_members om on om.org_id = v_org and om.user_id = tm.user_id
  join profiles p on p.id = tm.user_id
  where tm.team_id = p_team;
end $function$;

-- verificação:
-- select count(*) filter (where policyname like 'dev_audit_%') as politicas from pg_policies where schemaname='public';   -- esperado: 11
-- REVERSÃO: drop policy dev_audit_<tabela> on public.<tabela>;  (todas as dev_audit_*) e recriar shares_team como em 20261123000001.

-- >>> supabase/migrations/20261124000001_pessoas.sql
-- =====================================================================
-- Cadastro de Pessoas e membresia (24/11/2026)
--  * Base de pessoas separada das contas: a pessoa pode existir sem conta e a conta sem pessoa.
--  * Classificação (membro / frequentador / visitante) independente de ministério, liderança e acesso; o histórico é preservado.
--  * Quatro modalidades: cadastro manual, formulário público (link/QR), vínculo de usuários existentes e importação de planilha.
--  * Permissões próprias (people_view / people_edit / people_approve / people_import) concedidas em "access_grants";
--    nova função "Secretaria". Líder de time NÃO recebe acesso à base por ser líder.
--  * Tudo é aditivo: nenhuma tabela existente perde dados. As escritas passam só por funções no servidor (sem política de escrita).
--  * O desenvolvedor NÃO recebe leitura automática dos dados (modo auditoria): só vale quem é de fato administrador/concedido.
-- =====================================================================

-- ---------------------------------------------------------------- novas funções e ações em access_grants
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.access_grants'::regclass and contype = 'c' loop
    execute format('alter table public.access_grants drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.access_grants add constraint access_grants_role_key_check check (role_key in ('network_supervisor','general_leader','secretary'));
alter table public.access_grants add constraint access_grants_scope_check check (
  (role_key = 'network_supervisor' and network_id is not null) or (role_key <> 'network_supervisor' and network_id is null));
alter table public.access_grants add constraint access_grants_actions_check check (
  actions <@ array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import']::text[]);
alter table public.access_grants add constraint access_grants_title_check check (title is null or length(trim(title)) between 1 and 60);
create unique index if not exists access_grants_secretary on public.access_grants (org_id, user_id) where role_key = 'secretary';

create or replace function public.all_actions() returns text[] language sql immutable as $$
  select array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import']::text[]
$$;
create or replace function public.role_actions(p_role text) returns text[] language sql immutable as $$
  select case p_role
    when 'team_member'        then array['view']
    when 'team_leader'        then array['view','create','edit','delete','approve','manage']
    when 'network_supervisor' then array['view','approve','manage']
    when 'general_leader'     then array['view','create','edit','approve','manage','administer']
    when 'secretary'          then array['people_view','people_edit','people_approve','people_import']
    else '{}' end::text[]
$$;

-- ---------------------------------------------------------------- permissões do módulo (sem atalho de desenvolvedor)
create or replace function public.people_actions(p_org uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
      then array['people_view','people_edit','people_approve','people_import']
    else coalesce((select array_agg(distinct a) from access_grants g, unnest(g.actions) a
                   where g.org_id = p_org and g.user_id = auth.uid() and a like 'people\_%'), '{}'::text[]) end
$$;
create or replace function public.has_people_perm(p_org uuid, p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_action = any (public.people_actions(p_org))
$$;
-- vê a base inteira (administrador, liderança geral ou secretaria com people_view)
create or replace function public.people_scope_all(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
      or exists (select 1 from access_grants g where g.org_id = p_org and g.user_id = auth.uid()
                 and g.role_key in ('general_leader','secretary') and 'people_view' = any (g.actions))
$$;
-- supervisor de rede com people_view: só as pessoas (com conta) que integram times da sua rede
create or replace function public.people_supervised(p_org uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user is not null and exists (
    select 1 from access_grants g
      join network_teams nt on nt.network_id = g.network_id
      join team_members tm on tm.team_id = nt.team_id and tm.user_id = p_user
    where g.org_id = p_org and g.user_id = auth.uid() and g.role_key = 'network_supervisor' and 'people_view' = any (g.actions))
$$;
revoke execute on function public.people_actions(uuid), public.has_people_perm(uuid, text), public.people_scope_all(uuid), public.people_supervised(uuid, uuid) from public, anon;
grant execute on function public.people_actions(uuid), public.has_people_perm(uuid, text), public.people_scope_all(uuid), public.people_supervised(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- validações
create or replace function public.digits(p text) returns text language sql immutable as $$
  select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '')
$$;
create or replace function public.cpf_valid(p text) returns boolean language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g'); s int; i int; r int;
begin
  if length(d) <> 11 or d ~ '^(\d)\1{10}$' then return false; end if;
  s := 0; for i in 1..9 loop s := s + substr(d, i, 1)::int * (11 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if; if r <> substr(d, 10, 1)::int then return false; end if;
  s := 0; for i in 1..10 loop s := s + substr(d, i, 1)::int * (12 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if; return r = substr(d, 11, 1)::int;
end $$;

-- ---------------------------------------------------------------- tabelas
create table if not exists public.people_forms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  title text not null default 'Cadastro de pessoas' check (length(trim(title)) between 1 and 120),
  fields text[] not null default array['phone','whatsapp','email','birth_date'],
  initial_classification text not null default 'visitor' check (initial_classification in ('member','attender','visitor')),
  requires_approval boolean not null default true,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (fields <@ array['social_name','birth_date','sex','cpf','marital_status','phone','whatsapp','email','address','city','state','zip']::text[])
);
create index if not exists people_forms_org on public.people_forms (org_id);

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null check (length(trim(full_name)) between 1 and 160),
  social_name text check (social_name is null or length(social_name) <= 160),
  birth_date date check (birth_date is null or (birth_date > date '1900-01-01' and birth_date <= current_date)),
  sex text check (sex is null or sex in ('M','F')),
  cpf text check (cpf is null or cpf ~ '^\d{11}$'),
  marital_status text check (marital_status is null or marital_status in ('solteiro','casado','divorciado','viuvo','uniao_estavel','outro')),
  phone text check (phone is null or length(phone) <= 30),
  whatsapp text check (whatsapp is null or length(whatsapp) <= 30),
  email text check (email is null or (length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  address text check (address is null or length(address) <= 240),
  city text check (city is null or length(city) <= 120),
  state text check (state is null or state ~ '^[A-Za-z]{2}$'),
  zip text check (zip is null or zip ~ '^\d{8}$'),
  photo_url text check (photo_url is null or length(photo_url) <= 600),
  classification text not null default 'visitor' check (classification in ('member','attender','visitor')),
  registered_at date not null default current_date,
  joined_at date,
  status text not null default 'active' check (status in ('active','inactive','pending','rejected')),
  admin_notes text check (admin_notes is null or length(admin_notes) <= 2000),
  source text not null default 'manual' check (source in ('manual','form','user','import','self')),
  form_id uuid references public.people_forms(id) on delete set null,
  import_batch uuid,
  flagged_duplicate boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists people_org_cpf on public.people (org_id, cpf) where cpf is not null;
create unique index if not exists people_org_user on public.people (org_id, user_id) where user_id is not null;
create index if not exists people_org_class on public.people (org_id, classification, status);
create index if not exists people_org_name on public.people (org_id, lower(full_name));
create index if not exists people_org_email on public.people (org_id, lower(email)) where email is not null;
create index if not exists people_batch on public.people (import_batch) where import_batch is not null;

create table if not exists public.person_history (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid,              -- sem FK de propósito: o registro de auditoria sobrevive à pessoa
  actor uuid references auth.users(id) on delete set null,
  kind text not null,
  field text,
  old_value text,
  new_value text,
  note text,
  at timestamptz not null default now()
);
create index if not exists person_history_person on public.person_history (person_id, at desc);
create index if not exists person_history_org on public.person_history (org_id, at desc);

-- ---------------------------------------------------------------- RLS (leitura por permissão; nenhuma escrita direta)
alter table public.people enable row level security;
alter table public.person_history enable row level security;
alter table public.people_forms enable row level security;
revoke all on public.people, public.person_history, public.people_forms from anon, authenticated;
grant select on public.people, public.person_history, public.people_forms to authenticated;

drop policy if exists people_select on public.people;
create policy people_select on public.people for select to authenticated using (
  user_id = auth.uid()
  or (public.people_scope_all(org_id) and public.has_people_perm(org_id, 'people_view'))
  or public.people_supervised(org_id, user_id));

drop policy if exists person_history_select on public.person_history;
create policy person_history_select on public.person_history for select to authenticated using (
  public.people_scope_all(org_id) and public.has_people_perm(org_id, 'people_view'));

drop policy if exists people_forms_select on public.people_forms;
create policy people_forms_select on public.people_forms for select to authenticated using (public.has_people_perm(org_id, 'people_edit'));

-- ---------------------------------------------------------------- utilitários internos
create or replace function public.person_log(p_org uuid, p_person uuid, p_kind text, p_field text, p_old text, p_new text, p_note text default null)
returns void language sql security definer set search_path = public as $$
  insert into person_history (org_id, person_id, actor, kind, field, old_value, new_value, note) values (p_org, p_person, auth.uid(), p_kind, p_field, p_old, p_new, p_note)
$$;
revoke execute on function public.person_log(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;

create or replace function public.person_clean(p jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare r jsonb := '{}'::jsonb; k text; v text;
begin
  foreach k in array array['full_name','social_name','sex','marital_status','phone','whatsapp','email','address','city','state','photo_url','admin_notes'] loop
    if p ? k then v := nullif(trim(coalesce(p->>k, '')), ''); r := r || jsonb_build_object(k, v); end if;
  end loop;
  if p ? 'email' and r->>'email' is not null then r := r || jsonb_build_object('email', lower(r->>'email')); end if;
  if p ? 'state' and r->>'state' is not null then r := r || jsonb_build_object('state', upper(r->>'state')); end if;
  if p ? 'cpf' then r := r || jsonb_build_object('cpf', public.digits(p->>'cpf')); end if;
  if p ? 'zip' then r := r || jsonb_build_object('zip', public.digits(p->>'zip')); end if;
  foreach k in array array['birth_date','joined_at','registered_at'] loop
    if p ? k then r := r || jsonb_build_object(k, nullif(trim(coalesce(p->>k, '')), '')); end if;
  end loop;
  return r;
end $$;

-- valida o conteúdo já limpo; devolve o código do erro ou null
create or replace function public.person_check(c jsonb, p_need_name boolean) returns text
language plpgsql immutable set search_path = public as $$
begin
  if p_need_name and (c->>'full_name') is null then return 'name_required'; end if;
  if (c->>'cpf') is not null and not public.cpf_valid(c->>'cpf') then return 'invalid_cpf'; end if;
  if (c->>'email') is not null and (c->>'email') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return 'invalid_email'; end if;
  if (c->>'zip') is not null and (c->>'zip') !~ '^\d{8}$' then return 'invalid_zip'; end if;
  if (c->>'state') is not null and (c->>'state') !~ '^[A-Z]{2}$' then return 'invalid_state'; end if;
  if (c->>'sex') is not null and (c->>'sex') not in ('M','F') then return 'invalid_sex'; end if;
  if (c->>'marital_status') is not null and (c->>'marital_status') not in ('solteiro','casado','divorciado','viuvo','uniao_estavel','outro') then return 'invalid_marital'; end if;
  begin
    if (c->>'birth_date') is not null and ((c->>'birth_date')::date > current_date or (c->>'birth_date')::date < date '1900-01-01') then return 'invalid_birth'; end if;
    if (c->>'joined_at') is not null then perform (c->>'joined_at')::date; end if;
  exception when others then return 'invalid_date'; end;
  return null;
end $$;

create or replace function public.people_find_dupes(p_org uuid, p_cpf text, p_email text, p_name text, p_birth date, p_exclude uuid default null)
returns table (id uuid, full_name text, classification text, reason text)
language sql stable security definer set search_path = public as $$
  select x.id, x.full_name, x.classification, x.reason from (
    select p.id, p.full_name, p.classification, 'cpf'::text as reason, 1 as o from people p
      where p.org_id = p_org and p_cpf is not null and p.cpf = p_cpf and p.id is distinct from p_exclude
    union all
    select p.id, p.full_name, p.classification, 'email', 2 from people p
      where p.org_id = p_org and p_email is not null and lower(p.email) = lower(p_email) and p.id is distinct from p_exclude
    union all
    select p.id, p.full_name, p.classification, 'nome e nascimento', 3 from people p
      where p.org_id = p_org and p_name is not null and p_birth is not null and lower(trim(p.full_name)) = lower(trim(p_name)) and p.birth_date = p_birth and p.id is distinct from p_exclude
  ) x order by x.o limit 5
$$;
revoke execute on function public.people_find_dupes(uuid, text, text, text, date, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- cadastro manual / edição
create or replace function public.person_save(p_org uuid, p_id uuid, p jsonb, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; err text; old people; v_id uuid; k text; ov text; nv text; dup jsonb; v_class text; v_status text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.has_people_perm(p_org, 'people_edit') then raise exception 'forbidden'; end if;
  c := public.person_clean(p);
  err := public.person_check(c, p_id is null);
  if err is not null then raise exception '%', err; end if;
  v_class := nullif(trim(coalesce(p->>'classification', '')), '');
  v_status := nullif(trim(coalesce(p->>'status', '')), '');
  if v_class is not null and v_class not in ('member','attender','visitor') then raise exception 'invalid_classification'; end if;
  if v_status is not null and v_status not in ('active','inactive') then raise exception 'invalid_status'; end if;

  if p_id is null then
    select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'full_name', d.full_name, 'classification', d.classification, 'reason', d.reason)), '[]'::jsonb) into dup
      from public.people_find_dupes(p_org, c->>'cpf', c->>'email', c->>'full_name', nullif(c->>'birth_date', '')::date, null) d;
    if jsonb_array_length(dup) > 0 and not p_force then return jsonb_build_object('saved', false, 'duplicates', dup); end if;
    if (c->>'cpf') is not null and exists (select 1 from people where org_id = p_org and cpf = c->>'cpf') then raise exception 'duplicate_cpf'; end if;
    insert into people (org_id, full_name, social_name, birth_date, sex, cpf, marital_status, phone, whatsapp, email, address, city, state, zip, photo_url,
                        classification, joined_at, status, admin_notes, source, flagged_duplicate, created_by)
    values (p_org, c->>'full_name', c->>'social_name', nullif(c->>'birth_date', '')::date, c->>'sex', c->>'cpf', c->>'marital_status', c->>'phone', c->>'whatsapp',
            c->>'email', c->>'address', c->>'city', c->>'state', c->>'zip', c->>'photo_url', coalesce(v_class, 'visitor'), nullif(c->>'joined_at', '')::date,
            coalesce(v_status, 'active'), c->>'admin_notes', 'manual', jsonb_array_length(dup) > 0, auth.uid())
    returning id into v_id;
    perform public.person_log(p_org, v_id, 'create', null, null, coalesce(v_class, 'visitor'), 'cadastro manual');
    return jsonb_build_object('saved', true, 'id', v_id);
  end if;

  select * into old from people where id = p_id and org_id = p_org for update;
  if old.id is null then raise exception 'not_found'; end if;
  if (c->>'cpf') is not null and exists (select 1 from people where org_id = p_org and cpf = c->>'cpf' and id <> p_id) then raise exception 'duplicate_cpf'; end if;
  -- registra cada campo que mudou
  foreach k in array array['full_name','social_name','birth_date','sex','cpf','marital_status','phone','whatsapp','email','address','city','state','zip','photo_url','joined_at','admin_notes'] loop
    if c ? k then
      ov := to_jsonb(old) ->> k; nv := c ->> k;
      if ov is distinct from nv then perform public.person_log(p_org, p_id, 'field', k, ov, nv); end if;
    end if;
  end loop;
  if v_class is not null and v_class <> old.classification then perform public.person_log(p_org, p_id, 'classification', 'classification', old.classification, v_class); end if;
  if v_status is not null and v_status <> old.status and old.status in ('active','inactive') then perform public.person_log(p_org, p_id, 'field', 'status', old.status, v_status); end if;
  update people set
    full_name = coalesce(c->>'full_name', full_name),
    social_name = case when c ? 'social_name' then c->>'social_name' else social_name end,
    birth_date = case when c ? 'birth_date' then nullif(c->>'birth_date', '')::date else birth_date end,
    sex = case when c ? 'sex' then c->>'sex' else sex end,
    cpf = case when c ? 'cpf' then c->>'cpf' else cpf end,
    marital_status = case when c ? 'marital_status' then c->>'marital_status' else marital_status end,
    phone = case when c ? 'phone' then c->>'phone' else phone end,
    whatsapp = case when c ? 'whatsapp' then c->>'whatsapp' else whatsapp end,
    email = case when c ? 'email' then c->>'email' else email end,
    address = case when c ? 'address' then c->>'address' else address end,
    city = case when c ? 'city' then c->>'city' else city end,
    state = case when c ? 'state' then c->>'state' else state end,
    zip = case when c ? 'zip' then c->>'zip' else zip end,
    photo_url = case when c ? 'photo_url' then c->>'photo_url' else photo_url end,
    joined_at = case when c ? 'joined_at' then nullif(c->>'joined_at', '')::date else joined_at end,
    admin_notes = case when c ? 'admin_notes' then c->>'admin_notes' else admin_notes end,
    classification = coalesce(v_class, classification),
    status = case when v_status is not null and status in ('active','inactive') then v_status else status end,
    updated_at = now()
  where id = p_id;
  return jsonb_build_object('saved', true, 'id', p_id);
end $$;

-- aprovar / corrigir / rejeitar cadastros pendentes
create or replace function public.person_review(p_id uuid, p_decision text, p jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare old people; c jsonb; err text;
begin
  select * into old from people where id = p_id;
  if old.id is null then raise exception 'not_found'; end if;
  if not public.has_people_perm(old.org_id, 'people_approve') then raise exception 'forbidden'; end if;
  if old.status <> 'pending' then raise exception 'not_pending'; end if;
  if p_decision not in ('approve','reject') then raise exception 'invalid_decision'; end if;
  if p_decision = 'approve' then
    c := public.person_clean(p);
    err := public.person_check(c, false);
    if err is not null then raise exception '%', err; end if;
    if (c->>'cpf') is not null and exists (select 1 from people where org_id = old.org_id and cpf = c->>'cpf' and id <> p_id) then raise exception 'duplicate_cpf'; end if;
    update people set
      full_name = coalesce(c->>'full_name', full_name),
      social_name = case when c ? 'social_name' then c->>'social_name' else social_name end,
      birth_date = case when c ? 'birth_date' then nullif(c->>'birth_date', '')::date else birth_date end,
      cpf = case when c ? 'cpf' then c->>'cpf' else cpf end,
      phone = case when c ? 'phone' then c->>'phone' else phone end,
      whatsapp = case when c ? 'whatsapp' then c->>'whatsapp' else whatsapp end,
      email = case when c ? 'email' then c->>'email' else email end,
      classification = coalesce(nullif(p->>'classification', ''), classification),
      status = 'active', flagged_duplicate = false, updated_at = now()
    where id = p_id;
    perform public.person_log(old.org_id, p_id, 'approve', null, 'pending', 'active', null);
  else
    update people set status = 'rejected', updated_at = now() where id = p_id;
    perform public.person_log(old.org_id, p_id, 'reject', null, 'pending', 'rejected', nullif(trim(coalesce(p->>'note', '')), ''));
  end if;
end $$;

-- ---------------------------------------------------------------- consulta (respeita a RLS de quem chama)
create or replace function public.people_list(p_org uuid, p_q text default null, p_class text default null, p_status text default null,
                                              p_order text default 'name', p_limit int default 25, p_offset int default 0) returns jsonb
language plpgsql stable set search_path = public as $$
declare v_q text := nullif(trim(coalesce(p_q, '')), ''); v_d text; v_rows jsonb; v_total int; v_counts jsonb; v_lim int := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  v_d := public.digits(v_q);
  select jsonb_build_object('all', count(*) filter (where status <> 'rejected'), 'member', count(*) filter (where classification = 'member' and status in ('active','inactive')),
                            'attender', count(*) filter (where classification = 'attender' and status in ('active','inactive')),
                            'visitor', count(*) filter (where classification = 'visitor' and status in ('active','inactive')),
                            'pending', count(*) filter (where status = 'pending'))
    into v_counts from people where org_id = p_org;
  with f as (
    select * from people p where p.org_id = p_org
      and (p_class is null or p.classification = p_class)
      and (case when p_status is null then p.status <> 'rejected' else p.status = p_status end)
      and (v_q is null or p.full_name ilike '%' || v_q || '%' or p.social_name ilike '%' || v_q || '%' or p.email ilike '%' || v_q || '%'
           or (v_d is not null and (p.cpf like '%' || v_d || '%' or regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') like '%' || v_d || '%' or regexp_replace(coalesce(p.whatsapp, ''), '\D', '', 'g') like '%' || v_d || '%')))
  ), t as (select count(*) as n from f),
  pg as (select * from f order by
      case when p_order = 'name' then lower(full_name) end asc,
      case when p_order = 'recent' then created_at end desc,
      case when p_order = 'class' then classification end asc, lower(full_name) asc
    limit v_lim offset greatest(coalesce(p_offset, 0), 0))
  select (select n from t), coalesce(jsonb_agg(jsonb_build_object('id', pg.id, 'full_name', pg.full_name, 'social_name', pg.social_name, 'classification', pg.classification,
      'phone', coalesce(pg.whatsapp, pg.phone), 'email', pg.email, 'status', pg.status, 'registered_at', pg.registered_at, 'photo_url', pg.photo_url,
      'flagged_duplicate', pg.flagged_duplicate, 'user_id', pg.user_id)), '[]'::jsonb)
    into v_total, v_rows from pg;
  return jsonb_build_object('total', v_total, 'counts', v_counts, 'rows', v_rows);
end $$;

-- ---------------------------------------------------------------- o próprio cadastro
create or replace function public.my_person(p_org uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select (to_jsonb(p) - 'admin_notes' - 'import_batch' - 'created_by' - 'form_id' - 'flagged_duplicate') from people p where p.org_id = p_org and p.user_id = auth.uid()
$$;
create or replace function public.my_person_update(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; err text; old people; k text; ov text; nv text; v_id uuid; v_name text; v_email text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  -- só campos pessoais: nunca classificação, situação, observações, data de ingresso ou funções
  c := public.person_clean(p - 'classification' - 'status' - 'admin_notes' - 'joined_at' - 'registered_at' - 'user_id');
  err := public.person_check(c, false);
  if err is not null then raise exception '%', err; end if;
  select * into old from people where org_id = p_org and user_id = auth.uid() for update;
  if old.id is null then
    v_name := coalesce(c->>'full_name', (select full_name from profiles where id = auth.uid()), 'Sem nome');
    select email into v_email from auth.users where id = auth.uid();
    if (c->>'cpf') is not null and exists (select 1 from people where org_id = p_org and cpf = c->>'cpf') then raise exception 'duplicate_cpf'; end if;
    insert into people (org_id, user_id, full_name, social_name, birth_date, sex, cpf, marital_status, phone, whatsapp, email, address, city, state, zip, photo_url, classification, source, created_by)
    values (p_org, auth.uid(), v_name, c->>'social_name', nullif(c->>'birth_date', '')::date, c->>'sex', c->>'cpf', c->>'marital_status', c->>'phone', c->>'whatsapp',
            coalesce(c->>'email', lower(v_email)), c->>'address', c->>'city', c->>'state', c->>'zip', c->>'photo_url', 'visitor', 'self', auth.uid())
    returning id into v_id;
    perform public.person_log(p_org, v_id, 'create', null, null, 'visitor', 'cadastro feito pela própria pessoa');
    return jsonb_build_object('id', v_id);
  end if;
  if (c->>'cpf') is not null and exists (select 1 from people where org_id = p_org and cpf = c->>'cpf' and id <> old.id) then raise exception 'duplicate_cpf'; end if;
  foreach k in array array['full_name','social_name','birth_date','sex','cpf','marital_status','phone','whatsapp','email','address','city','state','zip','photo_url'] loop
    if c ? k then
      ov := to_jsonb(old) ->> k; nv := c ->> k;
      if ov is distinct from nv then perform public.person_log(p_org, old.id, 'self_update', k, ov, nv); end if;
    end if;
  end loop;
  update people set
    full_name = coalesce(c->>'full_name', full_name),
    social_name = case when c ? 'social_name' then c->>'social_name' else social_name end,
    birth_date = case when c ? 'birth_date' then nullif(c->>'birth_date', '')::date else birth_date end,
    sex = case when c ? 'sex' then c->>'sex' else sex end,
    cpf = case when c ? 'cpf' then c->>'cpf' else cpf end,
    marital_status = case when c ? 'marital_status' then c->>'marital_status' else marital_status end,
    phone = case when c ? 'phone' then c->>'phone' else phone end,
    whatsapp = case when c ? 'whatsapp' then c->>'whatsapp' else whatsapp end,
    email = case when c ? 'email' then c->>'email' else email end,
    address = case when c ? 'address' then c->>'address' else address end,
    city = case when c ? 'city' then c->>'city' else city end,
    state = case when c ? 'state' then c->>'state' else state end,
    zip = case when c ? 'zip' then c->>'zip' else zip end,
    photo_url = case when c ? 'photo_url' then c->>'photo_url' else photo_url end,
    updated_at = now()
  where id = old.id;
  return jsonb_build_object('id', old.id);
end $$;

-- ---------------------------------------------------------------- vincular usuários que já têm conta
create or replace function public.people_linkable_users(p_org uuid, p_q text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  if not public.has_people_perm(p_org, 'people_import') then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(x order by lower(x->>'name')) from (
    select jsonb_build_object('user_id', m.user_id, 'name', coalesce(nullif(pr.full_name, ''), m.display_name, 'Sem nome'), 'email', lower(u.email), 'phone', pr.phone,
             'avatar_url', pr.avatar_url,
             'candidate', (select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'reason', 'e-mail')
                           from people p where p.org_id = p_org and p.user_id is null and p.email is not null and lower(p.email) = lower(u.email) limit 1)) as x
    from org_members m join auth.users u on u.id = m.user_id left join profiles pr on pr.id = m.user_id
    where m.org_id = p_org and m.role <> 'guest'
      and not exists (select 1 from people p where p.org_id = p_org and p.user_id = m.user_id)
      and (v_q is null or coalesce(pr.full_name, m.display_name, '') ilike '%' || v_q || '%' or u.email ilike '%' || v_q || '%')
    limit 200) s), '[]'::jsonb);
end $$;

-- p_resolve: {"<user_id>": "<person_id>" | "new"} para os casos em que já existe uma pessoa com o mesmo e-mail
create or replace function public.people_link_users(p_org uuid, p_user_ids uuid[], p_classification text, p_resolve jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid; v_email text; pr profiles; m org_members; cand people; res text; v_id uuid; linked int := 0; created int := 0; conflicts jsonb := '[]'::jsonb;
begin
  if not public.has_people_perm(p_org, 'people_import') then raise exception 'forbidden'; end if;
  if p_classification not in ('member','attender','visitor') then raise exception 'invalid_classification'; end if;
  foreach u in array coalesce(p_user_ids, '{}') loop
    select * into m from org_members where org_id = p_org and user_id = u and role <> 'guest';
    if m.user_id is null then continue; end if;
    if exists (select 1 from people where org_id = p_org and user_id = u) then continue; end if;
    select lower(email) into v_email from auth.users where id = u;
    select * into pr from profiles where id = u;
    select * into cand from people where org_id = p_org and user_id is null and v_email is not null and lower(email) = v_email limit 1;
    res := p_resolve ->> u::text;
    if cand.id is not null and res is null then
      conflicts := conflicts || jsonb_build_array(jsonb_build_object('user_id', u, 'name', coalesce(nullif(pr.full_name, ''), m.display_name), 'person_id', cand.id, 'person_name', cand.full_name, 'reason', 'e-mail'));
      continue;
    end if;
    if cand.id is not null and res <> 'new' then
      -- vincula à pessoa já existente; só preenche o que está vazio (nada é sobrescrito)
      if res <> cand.id::text then raise exception 'invalid_resolution'; end if;
      update people set user_id = u, phone = coalesce(phone, pr.phone), birth_date = coalesce(birth_date, pr.birth_date), city = coalesce(city, pr.city),
                        photo_url = coalesce(photo_url, pr.avatar_url), updated_at = now() where id = cand.id;
      perform public.person_log(p_org, cand.id, 'link', 'user_id', null, u::text, 'conta vinculada a cadastro existente');
      linked := linked + 1;
    else
      insert into people (org_id, user_id, full_name, phone, birth_date, city, photo_url, email, classification, source, created_by)
      values (p_org, u, coalesce(nullif(pr.full_name, ''), m.display_name, 'Sem nome'), pr.phone, pr.birth_date, pr.city, pr.avatar_url, v_email, p_classification, 'user', auth.uid())
      returning id into v_id;
      perform public.person_log(p_org, v_id, 'link', 'user_id', null, u::text, 'cadastro criado a partir da conta');
      created := created + 1;
    end if;
  end loop;
  return jsonb_build_object('linked', linked, 'created', created, 'conflicts', conflicts);
end $$;

-- ---------------------------------------------------------------- importação em massa (tudo ou nada)
create or replace function public.people_import(p_org uuid, p_rows jsonb, p_allow_dupes boolean default false, p_dry_run boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; c jsonb; err text; n int := 0; ins int := 0; skipped int := 0; errs jsonb := '[]'::jsonb; dups jsonb := '[]'::jsonb; v_batch uuid := gen_random_uuid();
        v_class text; v_dupes int; v_cpfs text[] := '{}';
begin
  if not public.has_people_perm(p_org, 'people_import') then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'invalid_rows'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'too_many_rows'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1;
    c := public.person_clean(r);
    err := public.person_check(c, true);
    v_class := coalesce(nullif(lower(trim(coalesce(r->>'classification', ''))), ''), 'visitor');
    if err is null and v_class not in ('member','attender','visitor') then err := 'invalid_classification'; end if;
    if err is null and (c->>'cpf') is not null then
      if (c->>'cpf') = any (v_cpfs) then err := 'duplicate_in_file'; else v_cpfs := v_cpfs || (c->>'cpf'); end if;
    end if;
    if err is not null then errs := errs || jsonb_build_array(jsonb_build_object('row', n, 'error', err)); continue; end if;
    select count(*) into v_dupes from public.people_find_dupes(p_org, c->>'cpf', c->>'email', c->>'full_name', nullif(c->>'birth_date', '')::date, null);
    if v_dupes > 0 and not p_allow_dupes then
      skipped := skipped + 1; dups := dups || jsonb_build_array(jsonb_build_object('row', n, 'name', c->>'full_name')); continue;
    end if;
    if (c->>'cpf') is not null and exists (select 1 from people where org_id = p_org and cpf = c->>'cpf') then
      skipped := skipped + 1; dups := dups || jsonb_build_array(jsonb_build_object('row', n, 'name', c->>'full_name')); continue;
    end if;
    if not p_dry_run then
      insert into people (org_id, full_name, birth_date, cpf, marital_status, phone, whatsapp, email, address, city, state, zip, classification, joined_at, source, import_batch, flagged_duplicate, created_by)
      values (p_org, c->>'full_name', nullif(c->>'birth_date', '')::date, c->>'cpf', c->>'marital_status', c->>'phone', c->>'whatsapp', c->>'email', c->>'address', c->>'city',
              c->>'state', c->>'zip', v_class, nullif(c->>'joined_at', '')::date, 'import', v_batch, v_dupes > 0, auth.uid());
    end if;
    ins := ins + 1;
  end loop;
  if not p_dry_run then
    perform public.person_log(p_org, null, 'import', 'batch', null, v_batch::text, format('%s importadas, %s ignoradas por duplicidade, %s com erro', ins, skipped, jsonb_array_length(errs)));
  end if;
  return jsonb_build_object('batch', case when p_dry_run then null else v_batch end, 'dry_run', p_dry_run, 'total', n, 'inserted', ins, 'skipped_duplicates', skipped, 'errors', errs, 'duplicates', dups);
end $$;

-- desfaz uma importação (só o que ninguém mexeu depois)
create or replace function public.people_import_undo(p_org uuid, p_batch uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.has_people_perm(p_org, 'people_import') then raise exception 'forbidden'; end if;
  with d as (delete from people where org_id = p_org and import_batch = p_batch and user_id is null and updated_at = created_at returning id)
  select count(*) into v_n from d;
  perform public.person_log(p_org, null, 'import_undo', 'batch', p_batch::text, null, format('%s cadastros removidos', v_n));
  return v_n;
end $$;

-- ---------------------------------------------------------------- formulário público (link / QR)
create or replace function public.people_form_save(p_org uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_fields text[]; v_class text := coalesce(nullif(p->>'initial_classification', ''), 'visitor');
begin
  if not public.has_people_perm(p_org, 'people_edit') then raise exception 'forbidden'; end if;
  if v_class not in ('member','attender','visitor') then raise exception 'invalid_classification'; end if;
  v_fields := coalesce((select array_agg(distinct x) from jsonb_array_elements_text(coalesce(p->'fields', '[]'::jsonb)) x
                        where x in ('social_name','birth_date','sex','cpf','marital_status','phone','whatsapp','email','address','city','state','zip')), '{}');
  if p_id is null then
    insert into people_forms (org_id, title, fields, initial_classification, requires_approval, active, created_by)
    values (p_org, coalesce(nullif(trim(p->>'title'), ''), 'Cadastro de pessoas'), v_fields, v_class, coalesce((p->>'requires_approval')::boolean, true), coalesce((p->>'active')::boolean, true), auth.uid())
    returning id into v_id;
    perform public.person_log(p_org, null, 'form_create', 'form', null, v_id::text, null);
  else
    update people_forms set title = coalesce(nullif(trim(p->>'title'), ''), title), fields = v_fields, initial_classification = v_class,
      requires_approval = coalesce((p->>'requires_approval')::boolean, requires_approval), active = coalesce((p->>'active')::boolean, active)
    where id = p_id and org_id = p_org returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
    perform public.person_log(p_org, null, 'form_update', 'form', null, v_id::text, null);
  end if;
  return v_id;
end $$;

create or replace function public.people_form_get(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('title', f.title, 'fields', f.fields, 'org_name', o.name, 'org_subtitle', o.subtitle, 'logo_url', o.logo_url)
  from people_forms f join organizations o on o.id = f.org_id where f.token = p_token and f.active
$$;

-- recebe um cadastro público: honeypot, limites de volume e nenhum dado devolvido (evita descobrir quem já está cadastrado)
create or replace function public.people_form_submit(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f people_forms; c jsonb; err text; v_dupes int; v_pending int; v_recent int;
begin
  select * into f from people_forms where token = p_token and active;
  if f.id is null then raise exception 'form_closed'; end if;
  if nullif(trim(coalesce(p->>'website', '')), '') is not null then return jsonb_build_object('ok', true); end if;   -- robô: finge que deu certo
  select count(*) into v_recent from people where form_id = f.id and created_at > now() - interval '10 minutes';
  if v_recent >= 40 then raise exception 'too_many_requests'; end if;
  select count(*) into v_pending from people where form_id = f.id and status = 'pending';
  if v_pending >= 2000 then raise exception 'too_many_requests'; end if;
  -- só entram os campos que o formulário pede
  c := public.person_clean((select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(p) e(k, v) where k = 'full_name' or k = any (f.fields)));
  err := public.person_check(c, true);
  if err is not null then raise exception '%', err; end if;
  select count(*) into v_dupes from public.people_find_dupes(f.org_id, c->>'cpf', c->>'email', c->>'full_name', nullif(c->>'birth_date', '')::date, null);
  if (c->>'cpf') is not null and exists (select 1 from people where org_id = f.org_id and cpf = c->>'cpf') then c := c - 'cpf'; v_dupes := greatest(v_dupes, 1); end if;
  insert into people (org_id, full_name, social_name, birth_date, sex, cpf, marital_status, phone, whatsapp, email, address, city, state, zip, classification, status, source, form_id, flagged_duplicate)
  values (f.org_id, c->>'full_name', c->>'social_name', nullif(c->>'birth_date', '')::date, c->>'sex', c->>'cpf', c->>'marital_status', c->>'phone', c->>'whatsapp', c->>'email',
          c->>'address', c->>'city', c->>'state', c->>'zip', f.initial_classification, case when f.requires_approval then 'pending' else 'active' end, 'form', f.id, v_dupes > 0);
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.people_form_get(text), public.people_form_submit(text, jsonb) from public;
grant execute on function public.people_form_get(text), public.people_form_submit(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- funções para o app (somente usuários autenticados)
revoke execute on function public.person_save(uuid, uuid, jsonb, boolean), public.person_review(uuid, text, jsonb),
  public.people_list(uuid, text, text, text, text, int, int), public.my_person(uuid), public.my_person_update(uuid, jsonb),
  public.people_linkable_users(uuid, text), public.people_link_users(uuid, uuid[], text, jsonb), public.people_import(uuid, jsonb, boolean, boolean),
  public.people_import_undo(uuid, uuid), public.people_form_save(uuid, uuid, jsonb) from public, anon;
grant execute on function public.person_save(uuid, uuid, jsonb, boolean), public.person_review(uuid, text, jsonb),
  public.people_list(uuid, text, text, text, text, int, int), public.my_person(uuid), public.my_person_update(uuid, jsonb),
  public.people_linkable_users(uuid, text), public.people_link_users(uuid, uuid[], text, jsonb), public.people_import(uuid, jsonb, boolean, boolean),
  public.people_import_undo(uuid, uuid), public.people_form_save(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- concessões (secretaria) e acesso
create or replace function public.grant_set(p_org uuid, p_user uuid, p_role text, p_network uuid, p_title text, p_actions text[] default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_actions text[]; v_id uuid;
begin
  if not public.has_org_perm(p_org, 'administer') then raise exception 'forbidden'; end if;
  if p_role not in ('network_supervisor','general_leader','secretary') then raise exception 'invalid_role'; end if;
  -- só administrador/desenvolvedor nomeia liderança geral
  if p_role = 'general_leader' and not (public.is_developer() or public.is_org_admin(p_org)) then raise exception 'forbidden'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = p_user and role <> 'guest') then raise exception 'not_a_member'; end if;
  if p_role = 'network_supervisor' and not exists (select 1 from church_networks where id = p_network and org_id = p_org) then raise exception 'invalid_network'; end if;
  v_actions := coalesce(p_actions, public.role_actions(p_role));
  if not (v_actions <@ public.caller_actions(p_org)) then raise exception 'cannot_grant_more_than_you_have'; end if;
  -- ações de Pessoas só entram para quem as tem de verdade (o atalho de desenvolvedor não vale aqui)
  if exists (select 1 from unnest(v_actions) a where a like 'people\_%' and not (a = any (public.people_actions(p_org)))) and not public.is_org_admin(p_org) then
    raise exception 'cannot_grant_more_than_you_have';
  end if;
  if p_role = 'general_leader' then
    insert into access_grants (org_id, user_id, role_key, title, actions, created_by) values (p_org, p_user, p_role, nullif(trim(coalesce(p_title, '')), ''), v_actions, auth.uid())
    on conflict (org_id, user_id) where role_key = 'general_leader' do update set title = excluded.title, actions = excluded.actions returning id into v_id;
  elsif p_role = 'secretary' then
    insert into access_grants (org_id, user_id, role_key, title, actions, created_by) values (p_org, p_user, p_role, nullif(trim(coalesce(p_title, '')), ''), v_actions, auth.uid())
    on conflict (org_id, user_id) where role_key = 'secretary' do update set title = excluded.title, actions = excluded.actions returning id into v_id;
  else
    insert into access_grants (org_id, user_id, role_key, network_id, title, actions, created_by) values (p_org, p_user, p_role, p_network, nullif(trim(coalesce(p_title, '')), ''), v_actions, auth.uid())
    on conflict (org_id, user_id, network_id) where role_key = 'network_supervisor' do update set title = excluded.title, actions = excluded.actions returning id into v_id;
  end if;
  perform public.person_log(p_org, null, 'grant', p_role, null, p_user::text, array_to_string(v_actions, ','));
  return v_id;
end $$;

create or replace function public.my_access(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_dev boolean := public.is_developer(); v_admin boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_admin := exists (select 1 from org_members where org_id = p_org and user_id = v_uid and role = 'admin');
  return jsonb_build_object(
    'developer', v_dev,
    'admin', v_admin,
    'member', exists (select 1 from org_members where org_id = p_org and user_id = v_uid and role <> 'guest'),
    'general_leader', (select jsonb_build_object('title', g.title, 'actions', g.actions) from access_grants g where g.org_id = p_org and g.user_id = v_uid and g.role_key = 'general_leader'),
    'secretary', (select jsonb_build_object('title', g.title, 'actions', g.actions) from access_grants g where g.org_id = p_org and g.user_id = v_uid and g.role_key = 'secretary'),
    'people', to_jsonb(public.people_actions(p_org)),
    'networks', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'title', g.title, 'actions', g.actions) order by n.sort, n.name)
                          from access_grants g join church_networks n on n.id = g.network_id where g.org_id = p_org and g.user_id = v_uid and g.role_key = 'network_supervisor'), '[]'::jsonb),
    'leader_of', coalesce((select jsonb_agg(tm.team_id) from team_members tm where tm.org_id = p_org and tm.user_id = v_uid and tm.is_leader), '[]'::jsonb),
    'member_of', coalesce((select jsonb_agg(tm.team_id) from team_members tm where tm.org_id = p_org and tm.user_id = v_uid
                           and (tm.access_until is null or tm.access_until >= (now() at time zone 'America/Sao_Paulo')::date)), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- verificação (rode depois de aplicar)
--   select to_regclass('public.people') is not null as pessoas, to_regclass('public.person_history') is not null as historico,
--          to_regclass('public.people_forms') is not null as formularios, to_regprocedure('public.people_import(uuid,jsonb,boolean,boolean)') is not null as importacao,
--          to_regprocedure('public.people_form_submit(text,jsonb)') is not null as formulario_publico;
-- REVERSÃO: drop table public.person_history, public.people, public.people_forms cascade; (as funções people_* e person_* podem ser removidas em seguida)

-- >>> supabase/migrations/20261124000002_pessoas_excluir.sql
-- =====================================================================
-- Pessoas: excluir um cadastro (24/11/2026)
--  * Só quem tem a permissão people_edit. A conta de acesso da pessoa (se tiver) NÃO é afetada: só sai da base de membresia.
--  * Por privacidade (LGPD), o histórico de alterações da pessoa também é apagado; fica apenas um registro de que a exclusão
--    aconteceu (quem, quando e a classificação), sem nome nem dados de contato.
--  * Para quem apenas deixou a igreja, prefira marcar como "Inativo": o cadastro e o histórico são mantidos.
-- =====================================================================
create or replace function public.person_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare old people;
begin
  select * into old from people where id = p_id;
  if old.id is null then raise exception 'not_found'; end if;
  if not public.has_people_perm(old.org_id, 'people_edit') then raise exception 'forbidden'; end if;
  delete from person_history where person_id = p_id;
  delete from people where id = p_id;
  perform public.person_log(old.org_id, null, 'delete', 'classification', old.classification, null,
    case when old.user_id is not null then 'tinha conta no app (conta mantida)' else null end);
end $$;
revoke execute on function public.person_delete(uuid) from public, anon;
grant execute on function public.person_delete(uuid) to authenticated;

-- verificação:  select to_regprocedure('public.person_delete(uuid)') is not null as excluir;

-- >>> supabase/migrations/20261125000001_acolhimento.sql
-- =====================================================================
-- Acolhimento e jornada de visitantes (25/11/2026)
--  * Reaproveita a base central "people" (o visitante é uma pessoa com classification = 'visitor'; ao virar frequentador ou membro
--    continua sendo o MESMO registro, com o mesmo histórico). Nada é duplicado e nenhum dado existente é alterado.
--  * Cadastro inicial mínimo: nome, data da primeira visita, responsável pelo acolhimento e, só se a pessoa quiser, telefone + autorização de contato.
--  * Visitas ficam em "person_visits" (a primeira visita nunca é sobrescrita); aproximação, integração, interesses e contatos em "person_journey".
--    Ambas só crescem: não há função para editar ou apagar um registro antigo.
--  * A etapa da jornada (primeira visita, retorno, aproximação, integração) é CALCULADA a partir dos registros reais. Não há alerta,
--    pendência, meta ou cobrança por ausência: quem não volta simplesmente continua na etapa em que está.
--  * Nova ação de permissão "people_welcome" (registrar acolhimento). Também vale para quem já tem "people_edit". Validada sempre no servidor.
--    O desenvolvedor não recebe acesso automático (modo auditoria).
-- =====================================================================

-- ---------------------------------------------------------------- nova ação de permissão
alter table public.access_grants drop constraint if exists access_grants_actions_check;
alter table public.access_grants add constraint access_grants_actions_check check (
  actions <@ array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome']::text[]);

create or replace function public.all_actions() returns text[] language sql immutable as $$
  select array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome']::text[]
$$;
create or replace function public.role_actions(p_role text) returns text[] language sql immutable as $$
  select case p_role
    when 'team_member'        then array['view']
    when 'team_leader'        then array['view','create','edit','delete','approve','manage']
    when 'network_supervisor' then array['view','approve','manage']
    when 'general_leader'     then array['view','create','edit','approve','manage','administer']
    when 'secretary'          then array['people_view','people_edit','people_approve','people_import','people_welcome']
    else '{}' end::text[]
$$;
create or replace function public.people_actions(p_org uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
      then array['people_view','people_edit','people_approve','people_import','people_welcome']
    else coalesce((select array_agg(distinct a) from access_grants g, unnest(g.actions) a
                   where g.org_id = p_org and g.user_id = auth.uid() and a like 'people\_%'), '{}'::text[]) end
$$;
create or replace function public.can_welcome(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_people_perm(p_org, 'people_welcome') or public.has_people_perm(p_org, 'people_edit')
$$;
revoke execute on function public.can_welcome(uuid) from public, anon;
grant execute on function public.can_welcome(uuid) to authenticated;

-- ---------------------------------------------------------------- consentimento de contato (na própria pessoa)
alter table public.people add column if not exists contact_consent boolean not null default false;
alter table public.people add column if not exists contact_consent_at timestamptz;

-- ---------------------------------------------------------------- visitas e jornada
create table if not exists public.person_visits (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  visited_on date not null,
  kind text not null check (kind in ('first','return')),
  welcomed_by uuid references auth.users(id) on delete set null,
  welcomed_by_name text check (welcomed_by_name is null or length(welcomed_by_name) <= 160),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (person_id, visited_on)
);
create index if not exists person_visits_org on public.person_visits (org_id, visited_on desc);

create table if not exists public.person_journey (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  kind text not null check (kind in ('contact','interest','request','family','approach','integration')),
  note text not null check (length(trim(note)) between 1 and 1000),
  happened_on date not null default current_date,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text check (created_by_name is null or length(created_by_name) <= 160),
  created_at timestamptz not null default now()
);
create index if not exists person_journey_person on public.person_journey (person_id, happened_on desc);

alter table public.person_visits enable row level security;
alter table public.person_journey enable row level security;
revoke all on public.person_visits, public.person_journey from anon, authenticated;
grant select on public.person_visits, public.person_journey to authenticated;
drop policy if exists person_visits_select on public.person_visits;
create policy person_visits_select on public.person_visits for select to authenticated using (
  public.people_scope_all(org_id) and public.has_people_perm(org_id, 'people_view'));
drop policy if exists person_journey_select on public.person_journey;
create policy person_journey_select on public.person_journey for select to authenticated using (
  public.people_scope_all(org_id) and public.has_people_perm(org_id, 'people_view'));

-- ---------------------------------------------------------------- utilitários internos
create or replace function public.welcome_name(p_org uuid, p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(om.display_name, ''), nullif(p.full_name, ''), 'Sem nome') from org_members om left join profiles p on p.id = om.user_id
   where om.org_id = p_org and om.user_id = p_user
$$;
create or replace function public.welcome_today() returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
-- etapa calculada: só muda por fatos registrados (nunca pelo passar do tempo)
create or replace function public.welcome_stage(p_person uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from person_journey where person_id = p_person and kind = 'integration') then 'integration'
    when exists (select 1 from person_journey where person_id = p_person and kind in ('interest','request','family','approach')) then 'approach'
    when (select count(*) from person_visits where person_id = p_person) > 1 then 'returning'
    else 'first_visit' end
$$;
create or replace function public.welcome_norm(p text) returns text language sql immutable as $$
  select lower(regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g'))
$$;
revoke execute on function public.welcome_name(uuid, uuid), public.welcome_stage(uuid), public.welcome_norm(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- cadastro simples depois da conversa
create or replace function public.welcome_register(p_org uuid, p_name text, p_phone text default null, p_consent boolean default false,
  p_visited_on date default null, p_welcomer uuid default null, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_name text := trim(coalesce(p_name, '')); v_phone text := nullif(trim(coalesce(p_phone, '')), ''); v_d text; v_day date := coalesce(p_visited_on, public.welcome_today());
        v_w uuid := coalesce(p_welcomer, auth.uid()); dup jsonb; v_id uuid; v_consent boolean := coalesce(p_consent, false);
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.can_welcome(p_org) then raise exception 'forbidden'; end if;
  if length(v_name) < 1 then raise exception 'name_required'; end if;
  if length(v_name) > 160 then raise exception 'name_too_long'; end if;
  if v_day > public.welcome_today() or v_day < date '2000-01-01' then raise exception 'invalid_date'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = v_w and role <> 'guest') then raise exception 'invalid_welcomer'; end if;
  if v_phone is not null then
    v_d := public.digits(v_phone);
    if v_d is null or length(v_d) < 8 or length(v_d) > 15 or length(v_phone) > 30 then raise exception 'invalid_phone'; end if;
    if not v_consent then raise exception 'phone_needs_consent'; end if;
  elsif v_consent then raise exception 'consent_needs_phone';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'full_name', x.full_name, 'classification', x.classification, 'reason', x.reason)), '[]'::jsonb) into dup from (
    select p.id, p.full_name, p.classification, 'nome'::text as reason from people p
      where p.org_id = p_org and p.status in ('active','inactive','pending') and public.welcome_norm(p.full_name) = public.welcome_norm(v_name)
    union
    select p.id, p.full_name, p.classification, 'telefone' from people p
      where p.org_id = p_org and v_d is not null and p.status in ('active','inactive','pending')
        and (public.digits(p.phone) = v_d or public.digits(p.whatsapp) = v_d)
    limit 5) x;
  if jsonb_array_length(dup) > 0 and not coalesce(p_force, false) then return jsonb_build_object('saved', false, 'duplicates', dup); end if;

  insert into people (org_id, full_name, phone, classification, status, source, registered_at, contact_consent, contact_consent_at, flagged_duplicate, created_by)
  values (p_org, v_name, v_phone, 'visitor', 'active', 'manual', v_day, v_consent, case when v_consent then now() end, jsonb_array_length(dup) > 0, auth.uid())
  returning id into v_id;
  insert into person_visits (org_id, person_id, visited_on, kind, welcomed_by, welcomed_by_name, created_by)
  values (p_org, v_id, v_day, 'first', v_w, public.welcome_name(p_org, v_w), auth.uid());
  perform public.person_log(p_org, v_id, 'create', null, null, 'visitor', 'acolhimento: primeira visita');
  if v_consent then perform public.person_log(p_org, v_id, 'consent', 'contact_consent', 'false', 'true', 'autorizou contato'); end if;
  return jsonb_build_object('saved', true, 'id', v_id);
end $$;

-- ---------------------------------------------------------------- retorno (nova visita no mesmo cadastro)
create or replace function public.welcome_visit(p_person uuid, p_visited_on date default null, p_welcomer uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people; v_day date := coalesce(p_visited_on, public.welcome_today()); v_w uuid := coalesce(p_welcomer, auth.uid()); v_first date; v_kind text;
begin
  select * into pe from people where id = p_person;
  if pe.id is null or pe.status not in ('active','inactive') then raise exception 'not_found'; end if;
  if not public.can_welcome(pe.org_id) then raise exception 'forbidden'; end if;
  if v_day > public.welcome_today() then raise exception 'invalid_date'; end if;
  if not exists (select 1 from org_members where org_id = pe.org_id and user_id = v_w and role <> 'guest') then raise exception 'invalid_welcomer'; end if;
  select min(visited_on) into v_first from person_visits where person_id = p_person;
  if v_first is not null and v_day < v_first then raise exception 'before_first_visit'; end if;
  if exists (select 1 from person_visits where person_id = p_person and visited_on = v_day) then raise exception 'already_registered'; end if;
  v_kind := case when v_first is null then 'first' else 'return' end;
  insert into person_visits (org_id, person_id, visited_on, kind, welcomed_by, welcomed_by_name, created_by)
  values (pe.org_id, p_person, v_day, v_kind, v_w, public.welcome_name(pe.org_id, v_w), auth.uid());
  perform public.person_log(pe.org_id, p_person, 'visit', null, null, v_day::text, case when v_kind = 'first' then 'primeira visita registrada' else 'retorno' end);
  return jsonb_build_object('ok', true, 'kind', v_kind, 'stage', public.welcome_stage(p_person));
end $$;

-- ---------------------------------------------------------------- aproximação, integração, interesses e contatos (só acrescenta)
create or replace function public.welcome_note(p_person uuid, p_kind text, p_note text, p_on date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people; v_day date := coalesce(p_on, public.welcome_today()); v_note text := trim(coalesce(p_note, ''));
begin
  select * into pe from people where id = p_person;
  if pe.id is null or pe.status not in ('active','inactive') then raise exception 'not_found'; end if;
  if not public.can_welcome(pe.org_id) then raise exception 'forbidden'; end if;
  if p_kind not in ('contact','interest','request','family','approach','integration') then raise exception 'invalid_kind'; end if;
  if length(v_note) < 1 then raise exception 'note_required'; end if;
  if length(v_note) > 1000 then raise exception 'note_too_long'; end if;
  if v_day > public.welcome_today() or v_day < date '2000-01-01' then raise exception 'invalid_date'; end if;
  if p_kind = 'contact' and not pe.contact_consent then raise exception 'no_contact_consent'; end if;
  insert into person_journey (org_id, person_id, kind, note, happened_on, created_by, created_by_name)
  values (pe.org_id, p_person, p_kind, v_note, v_day, auth.uid(), public.welcome_name(pe.org_id, auth.uid()));
  perform public.person_log(pe.org_id, p_person, 'journey', p_kind, null, null, null);
  return jsonb_build_object('ok', true, 'stage', public.welcome_stage(p_person));
end $$;

-- ---------------------------------------------------------------- corrigir nome, telefone e autorização (o que mudou fica registrado)
create or replace function public.welcome_update(p_person uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people; v_name text; v_phone text; v_d text; v_consent boolean;
begin
  select * into pe from people where id = p_person;
  if pe.id is null or pe.status not in ('active','inactive') then raise exception 'not_found'; end if;
  if not public.can_welcome(pe.org_id) then raise exception 'forbidden'; end if;
  v_name := case when p ? 'full_name' then trim(coalesce(p->>'full_name', '')) else pe.full_name end;
  if length(v_name) < 1 then raise exception 'name_required'; end if;
  if length(v_name) > 160 then raise exception 'name_too_long'; end if;
  v_consent := case when p ? 'consent' then coalesce((p->>'consent')::boolean, false) else pe.contact_consent end;
  v_phone := case when p ? 'phone' then nullif(trim(coalesce(p->>'phone', '')), '') else pe.phone end;
  -- tirar a autorização de contato remove também o telefone
  if pe.contact_consent and not v_consent then v_phone := null; end if;
  if v_phone is not null and (v_phone is distinct from pe.phone) then
    v_d := public.digits(v_phone);
    if v_d is null or length(v_d) < 8 or length(v_d) > 15 or length(v_phone) > 30 then raise exception 'invalid_phone'; end if;
    if not v_consent then raise exception 'phone_needs_consent'; end if;
  end if;
  if v_consent and v_phone is null then raise exception 'consent_needs_phone'; end if;
  if v_name is distinct from pe.full_name then perform public.person_log(pe.org_id, p_person, 'field', 'full_name', pe.full_name, v_name); end if;
  if v_phone is distinct from pe.phone then perform public.person_log(pe.org_id, p_person, 'field', 'phone', pe.phone, v_phone); end if;
  if v_consent is distinct from pe.contact_consent then
    perform public.person_log(pe.org_id, p_person, 'consent', 'contact_consent', pe.contact_consent::text, v_consent::text, case when v_consent then 'autorizou contato' else 'retirou a autorização de contato' end);
  end if;
  update people set full_name = v_name, phone = v_phone, contact_consent = v_consent,
    contact_consent_at = case when v_consent and not pe.contact_consent then now() when not v_consent then null else contact_consent_at end,
    updated_at = now() where id = p_person;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- lista de acolhimento (sem dados sensíveis; telefone só com autorização)
create or replace function public.welcome_list(p_org uuid, p_q text default null, p_limit int default 30, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_q text := nullif(trim(coalesce(p_q, '')), ''); v_rows jsonb; v_total int; v_lim int := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.can_welcome(p_org) then raise exception 'forbidden'; end if;
  with f as (
    select p.*, (select min(visited_on) from person_visits v where v.person_id = p.id) as first_on,
                (select max(visited_on) from person_visits v where v.person_id = p.id) as last_on,
                (select count(*) from person_visits v where v.person_id = p.id) as n
      from people p
     where p.org_id = p_org and p.status in ('active','inactive')
       and (p.classification = 'visitor' or exists (select 1 from person_visits v where v.person_id = p.id))
       and (v_q is null or p.full_name ilike '%' || v_q || '%')
  ), t as (select count(*) as n from f),
  pg as (select * from f order by coalesce(last_on, registered_at) desc, lower(full_name) limit v_lim offset greatest(coalesce(p_offset, 0), 0))
  select (select n from t), coalesce(jsonb_agg(jsonb_build_object('id', pg.id, 'full_name', pg.full_name, 'classification', pg.classification,
      'first_visit_on', pg.first_on, 'last_visit_on', pg.last_on, 'visits', pg.n, 'stage', public.welcome_stage(pg.id),
      'consent', pg.contact_consent, 'phone', case when pg.contact_consent then pg.phone end,
      'welcomed_by_name', (select welcomed_by_name from person_visits v where v.person_id = pg.id order by visited_on, id limit 1)
    ) order by coalesce(pg.last_on, pg.registered_at) desc, lower(pg.full_name)), '[]'::jsonb)
    into v_total, v_rows from pg;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

-- ---------------------------------------------------------------- ficha de acolhimento (visitas, jornada, autorizações)
create or replace function public.welcome_get(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from people where id = p_person;
  if pe.id is null or pe.status not in ('active','inactive') then raise exception 'not_found'; end if;
  if not public.can_welcome(pe.org_id) then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'person', jsonb_build_object('id', pe.id, 'full_name', pe.full_name, 'classification', pe.classification, 'status', pe.status,
      'consent', pe.contact_consent, 'consent_at', pe.contact_consent_at, 'phone', case when pe.contact_consent then pe.phone end, 'registered_at', pe.registered_at),
    'stage', public.welcome_stage(pe.id),
    'visits', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'visited_on', v.visited_on, 'kind', v.kind, 'welcomed_by_name', v.welcomed_by_name) order by v.visited_on desc, v.id desc)
                        from person_visits v where v.person_id = pe.id), '[]'::jsonb),
    'journey', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'kind', j.kind, 'note', j.note, 'happened_on', j.happened_on, 'by', j.created_by_name) order by j.happened_on desc, j.id desc)
                         from person_journey j where j.person_id = pe.id), '[]'::jsonb),
    'consents', coalesce((select jsonb_agg(jsonb_build_object('at', h.at, 'value', h.new_value = 'true', 'by', public.welcome_name(pe.org_id, h.actor)) order by h.at desc)
                          from person_history h where h.person_id = pe.id and h.kind = 'consent'), '[]'::jsonb));
end $$;

revoke execute on function public.welcome_register(uuid, text, text, boolean, date, uuid, boolean), public.welcome_visit(uuid, date, uuid), public.welcome_note(uuid, text, text, date),
  public.welcome_update(uuid, jsonb), public.welcome_list(uuid, text, int, int), public.welcome_get(uuid) from public, anon;
grant execute on function public.welcome_register(uuid, text, text, boolean, date, uuid, boolean), public.welcome_visit(uuid, date, uuid), public.welcome_note(uuid, text, text, date),
  public.welcome_update(uuid, jsonb), public.welcome_list(uuid, text, int, int), public.welcome_get(uuid) to authenticated;

-- verificação:
--   select to_regclass('public.person_visits') is not null as visitas, to_regclass('public.person_journey') is not null as jornada,
--          to_regprocedure('public.welcome_register(uuid,text,text,boolean,date,uuid,boolean)') is not null as cadastro,
--          'people_welcome' = any (public.all_actions()) as permissao;
-- REVERSÃO: drop table public.person_journey, public.person_visits; alter table public.people drop column contact_consent, drop column contact_consent_at;
--           (e as funções welcome_*, se quiser)

-- >>> supabase/migrations/20261126000001_ficha_pessoa.sql
-- =====================================================================
-- Ficha individual de pessoas (26/11/2026)
-- Reaproveita people / person_history / person_visits / person_journey. Nada existente é alterado ou apagado.
--  * Família: relações entre pessoas JÁ cadastradas (sem criar pessoa nova), vistas dos dois lados.
--  * Vida na igreja: batismo (campos novos), visitas e jornada (já existentes) lidos numa só chamada.
--  * Times: vínculos reais lidos de team_members; entradas, saídas e mudança de função passam a entrar no histórico da pessoa (gatilho que
--    NUNCA bloqueia a operação original: qualquer falha ali é ignorada).
--  * Acompanhamento pastoral: ação própria "people_care", sem leitura direta nas tabelas, e cada leitura/registro fica numa trilha de acesso.
--    Não aparece no histórico geral que os líderes enxergam.
--  * Cartão do integrante para o líder do time: só nome, foto, classificação, contatos e aniversário (nada de CPF, endereço, notas ou pastoral).
--  * O desenvolvedor segue sem acesso aos dados pessoais (modo auditoria).
-- =====================================================================

-- ---------------------------------------------------------------- nova ação "people_care"
alter table public.access_grants drop constraint if exists access_grants_actions_check;
alter table public.access_grants add constraint access_grants_actions_check check (
  actions <@ array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care']::text[]);
create or replace function public.all_actions() returns text[] language sql immutable as $$
  select array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care']::text[]
$$;
create or replace function public.people_actions(p_org uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
      then array['people_view','people_edit','people_approve','people_import','people_welcome','people_care']
    else coalesce((select array_agg(distinct a) from access_grants g, unnest(g.actions) a
                   where g.org_id = p_org and g.user_id = auth.uid() and a like 'people\_%'), '{}'::text[]) end
$$;

-- ---------------------------------------------------------------- batismo (colunas novas, opcionais)
alter table public.people add column if not exists baptized boolean not null default false;
alter table public.people add column if not exists baptism_date date check (baptism_date is null or (baptism_date > date '1900-01-01' and baptism_date <= current_date));

-- ---------------------------------------------------------------- família
create table if not exists public.person_relations (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  relative_id uuid not null references public.people(id) on delete cascade,
  relation text not null check (relation in ('spouse','child','parent','sibling','other')),  -- "relative é <relation> de person"
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (person_id <> relative_id)
);
create unique index if not exists person_relations_pair on public.person_relations (least(person_id, relative_id), greatest(person_id, relative_id));
create index if not exists person_relations_a on public.person_relations (person_id);
create index if not exists person_relations_b on public.person_relations (relative_id);

-- ---------------------------------------------------------------- acompanhamento pastoral (restrito) e trilha de acesso
create table if not exists public.person_care (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  kind text not null check (kind in ('visit','prayer','counsel','other')),
  note text not null check (length(trim(note)) between 1 and 4000),
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text check (created_by_name is null or length(created_by_name) <= 160),
  created_at timestamptz not null default now()
);
create index if not exists person_care_person on public.person_care (person_id, created_at desc);
create table if not exists public.person_care_access (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid,                -- sem FK: a trilha sobrevive à pessoa
  actor uuid references auth.users(id) on delete set null,
  action text not null check (action in ('read','add')),
  at timestamptz not null default now()
);
create index if not exists person_care_access_person on public.person_care_access (person_id, at desc);

alter table public.person_relations enable row level security;
alter table public.person_care enable row level security;
alter table public.person_care_access enable row level security;
revoke all on public.person_relations, public.person_care, public.person_care_access from anon, authenticated;   -- tudo só por função

-- ---------------------------------------------------------------- leitura permitida da ficha (mesmo alcance da tabela people)
create or replace function public.can_read_person(p_person uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from people p where p.id = p_person and (
    (public.people_scope_all(p.org_id) and public.has_people_perm(p.org_id, 'people_view')) or public.people_supervised(p.org_id, p.user_id)))
$$;
revoke execute on function public.can_read_person(uuid) from public, anon;
grant execute on function public.can_read_person(uuid) to authenticated;

-- ---------------------------------------------------------------- família: listar, relacionar e desfazer
create or replace function public.person_family(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_read_person(p_person) then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'relative_id', x.rid, 'name', pe.full_name, 'photo_url', pe.photo_url, 'classification', pe.classification, 'relation', x.rel) order by pe.full_name)
    from (
      select r.id, r.relative_id as rid, r.relation as rel from person_relations r where r.person_id = p_person
      union all
      select r.id, r.person_id, case r.relation when 'child' then 'parent' when 'parent' then 'child' else r.relation end from person_relations r where r.relative_id = p_person
    ) x join people pe on pe.id = x.rid), '[]'::jsonb);
end $$;

create or replace function public.person_relation_add(p_person uuid, p_relative uuid, p_relation text) returns void
language plpgsql security definer set search_path = public as $$
declare a people; b people; lbl text;
begin
  select * into a from people where id = p_person; select * into b from people where id = p_relative;
  if a.id is null or b.id is null or a.org_id <> b.org_id then raise exception 'not_found'; end if;
  if not public.has_people_perm(a.org_id, 'people_edit') then raise exception 'forbidden'; end if;
  if a.id = b.id then raise exception 'same_person'; end if;
  if p_relation not in ('spouse','child','parent','sibling','other') then raise exception 'invalid_relation'; end if;
  if exists (select 1 from person_relations where (person_id = a.id and relative_id = b.id) or (person_id = b.id and relative_id = a.id)) then raise exception 'already_related'; end if;
  insert into person_relations (org_id, person_id, relative_id, relation, created_by) values (a.org_id, a.id, b.id, p_relation, auth.uid());
  lbl := case p_relation when 'spouse' then 'cônjuge' when 'child' then 'filho(a)' when 'parent' then 'pai/mãe' when 'sibling' then 'irmão(ã)' else 'outro vínculo' end;
  perform public.person_log(a.org_id, a.id, 'family', 'relation', null, lbl, b.full_name);
  perform public.person_log(a.org_id, b.id, 'family', 'relation', null, case p_relation when 'child' then 'pai/mãe' when 'parent' then 'filho(a)' else lbl end, a.full_name);
end $$;

create or replace function public.person_relation_remove(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r person_relations; a people; b people;
begin
  select * into r from person_relations where id = p_id;
  if r.id is null then raise exception 'not_found'; end if;
  if not public.has_people_perm(r.org_id, 'people_edit') then raise exception 'forbidden'; end if;
  select * into a from people where id = r.person_id; select * into b from people where id = r.relative_id;
  delete from person_relations where id = p_id;
  perform public.person_log(r.org_id, a.id, 'family', 'relation', 'vínculo', null, b.full_name);
  perform public.person_log(r.org_id, b.id, 'family', 'relation', 'vínculo', null, a.full_name);
end $$;

-- ---------------------------------------------------------------- vida na igreja
create or replace function public.person_church_life_save(p_person uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare pe people; v_b boolean; v_d date;
begin
  select * into pe from people where id = p_person;
  if pe.id is null then raise exception 'not_found'; end if;
  if not public.has_people_perm(pe.org_id, 'people_edit') then raise exception 'forbidden'; end if;
  v_b := case when p ? 'baptized' then coalesce((p->>'baptized')::boolean, false) else pe.baptized end;
  v_d := case when p ? 'baptism_date' then nullif(p->>'baptism_date', '')::date else pe.baptism_date end;
  if p ? 'baptized' and not v_b and not (p ? 'baptism_date') then v_d := null; end if;
  if v_d is not null and (v_d > current_date or v_d < date '1900-01-02') then raise exception 'invalid_date'; end if;
  if v_d is not null then v_b := true; end if;
  if not v_b then v_d := null; end if;
  if v_b is distinct from pe.baptized then perform public.person_log(pe.org_id, p_person, 'field', 'baptized', pe.baptized::text, v_b::text); end if;
  if v_d is distinct from pe.baptism_date then perform public.person_log(pe.org_id, p_person, 'field', 'baptism_date', pe.baptism_date::text, v_d::text); end if;
  update people set baptized = v_b, baptism_date = v_d, updated_at = now() where id = p_person;
end $$;

create or replace function public.person_church_life(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from people where id = p_person;
  if pe.id is null or not public.can_read_person(p_person) then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'baptized', pe.baptized, 'baptism_date', pe.baptism_date,
    'first_visit_on', (select min(visited_on) from person_visits where person_id = p_person),
    'visits', coalesce((select jsonb_agg(jsonb_build_object('visited_on', v.visited_on, 'kind', v.kind, 'welcomed_by_name', v.welcomed_by_name) order by v.visited_on desc) from person_visits v where v.person_id = p_person), '[]'::jsonb),
    'stage', public.welcome_stage(p_person),
    'classification_changes', coalesce((select jsonb_agg(jsonb_build_object('at', h.at, 'from', h.old_value, 'to', h.new_value) order by h.at desc) from person_history h where h.person_id = p_person and h.kind = 'classification'), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- vínculos com times (leitura dos vínculos reais)
create or replace function public.person_teams(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from people where id = p_person;
  if pe.id is null or not public.can_read_person(p_person) then raise exception 'forbidden'; end if;
  if pe.user_id is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('team_id', t.id, 'name', t.name, 'role', case when tm.is_leader then 'leader' else 'member' end, 'joined_at', tm.joined_at, 'status', 'active') order by t.name)
    from team_members tm join teams t on t.id = tm.team_id where tm.user_id = pe.user_id and tm.org_id = pe.org_id), '[]'::jsonb);
end $$;

-- entrada, saída e mudança de função em times entram no histórico da pessoa (nunca bloqueia a operação original)
create or replace function public.team_member_history() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_tid uuid; v_org uuid; v_k text; v_note text; v_name text; r record;
begin
  begin
    if tg_op = 'DELETE' then v_uid := old.user_id; v_tid := old.team_id; v_org := old.org_id; v_k := 'team_leave';
    elsif tg_op = 'INSERT' then v_uid := new.user_id; v_tid := new.team_id; v_org := new.org_id; v_k := 'team_join';
    else
      if new.is_leader is not distinct from old.is_leader then return new; end if;
      v_uid := new.user_id; v_tid := new.team_id; v_org := new.org_id; v_k := 'team_role';
    end if;
    select name into v_name from teams where id = v_tid;
    v_note := coalesce(v_name, 'time') || case when v_k = 'team_role' then case when new.is_leader then ' · passou a líder' else ' · deixou de ser líder' end else '' end;
    for r in select id from people where org_id = v_org and user_id = v_uid loop
      insert into person_history (org_id, person_id, actor, kind, field, note) values (v_org, r.id, auth.uid(), v_k, 'team', v_note);
    end loop;
  exception when others then null;
  end;
  return coalesce(new, old);
end $$;
drop trigger if exists team_member_history on public.team_members;
create trigger team_member_history after insert or update or delete on public.team_members for each row execute function public.team_member_history();

-- ---------------------------------------------------------------- cartão do integrante para o líder do próprio time
create or replace function public.team_member_card(p_team uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t teams; pe people; v_name text;
begin
  select * into t from teams where id = p_team;
  if t.id is null then raise exception 'not_found'; end if;
  if not (exists (select 1 from team_members where team_id = p_team and user_id = auth.uid() and is_leader)
       or exists (select 1 from org_members where org_id = t.org_id and user_id = auth.uid() and role = 'admin')) then raise exception 'forbidden'; end if;
  if not exists (select 1 from team_members where team_id = p_team and user_id = p_user) then raise exception 'not_found'; end if;
  select * into pe from people where org_id = t.org_id and user_id = p_user limit 1;
  select coalesce(nullif(om.display_name, ''), p.full_name) into v_name from org_members om left join profiles p on p.id = om.user_id where om.org_id = t.org_id and om.user_id = p_user;
  return jsonb_build_object('name', coalesce(pe.full_name, v_name), 'social_name', pe.social_name, 'photo_url', pe.photo_url, 'has_person', pe.id is not null,
    'classification', pe.classification, 'phone', pe.phone, 'whatsapp', pe.whatsapp, 'email', pe.email,
    'birth_day', case when pe.birth_date is not null then to_char(pe.birth_date, 'DD/MM') end,
    'joined_at', (select joined_at from team_members where team_id = p_team and user_id = p_user),
    'is_leader', (select is_leader from team_members where team_id = p_team and user_id = p_user));
end $$;

-- ---------------------------------------------------------------- acompanhamento pastoral
create or replace function public.care_list(p_person uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from people where id = p_person;
  if pe.id is null then raise exception 'not_found'; end if;
  if not public.has_people_perm(pe.org_id, 'people_care') then raise exception 'forbidden'; end if;
  insert into person_care_access (org_id, person_id, actor, action) values (pe.org_id, p_person, auth.uid(), 'read');
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'note', c.note, 'by', c.created_by_name, 'at', c.created_at) order by c.created_at desc, c.id desc) from person_care c where c.person_id = p_person), '[]'::jsonb);
end $$;

create or replace function public.care_add(p_person uuid, p_kind text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare pe people; v_note text := trim(coalesce(p_note, ''));
begin
  select * into pe from people where id = p_person;
  if pe.id is null then raise exception 'not_found'; end if;
  if not public.has_people_perm(pe.org_id, 'people_care') then raise exception 'forbidden'; end if;
  if p_kind not in ('visit','prayer','counsel','other') then raise exception 'invalid_kind'; end if;
  if length(v_note) < 1 then raise exception 'note_required'; end if;
  if length(v_note) > 4000 then raise exception 'note_too_long'; end if;
  insert into person_care (org_id, person_id, kind, note, created_by, created_by_name) values (pe.org_id, p_person, p_kind, v_note, auth.uid(), public.welcome_name(pe.org_id, auth.uid()));
  insert into person_care_access (org_id, person_id, actor, action) values (pe.org_id, p_person, auth.uid(), 'add');
end $$;

-- quem acessou os registros pastorais: só o administrador da igreja
create or replace function public.care_access_log(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from people where id = p_person;
  if pe.id is null then raise exception 'not_found'; end if;
  if not exists (select 1 from org_members where org_id = pe.org_id and user_id = auth.uid() and role = 'admin') then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'action', a.action, 'by', public.welcome_name(pe.org_id, a.actor)) order by a.at desc)
    from (select * from person_care_access where person_id = p_person order by at desc limit 50) a), '[]'::jsonb);
end $$;

revoke execute on function public.person_family(uuid), public.person_relation_add(uuid, uuid, text), public.person_relation_remove(bigint), public.person_church_life_save(uuid, jsonb),
  public.person_church_life(uuid), public.person_teams(uuid), public.team_member_card(uuid, uuid), public.care_list(uuid), public.care_add(uuid, text, text), public.care_access_log(uuid) from public, anon;
grant execute on function public.person_family(uuid), public.person_relation_add(uuid, uuid, text), public.person_relation_remove(bigint), public.person_church_life_save(uuid, jsonb),
  public.person_church_life(uuid), public.person_teams(uuid), public.team_member_card(uuid, uuid), public.care_list(uuid), public.care_add(uuid, text, text), public.care_access_log(uuid) to authenticated;
revoke execute on function public.team_member_history() from public, anon, authenticated;

-- verificação:
--   select to_regclass('public.person_relations') is not null as familia, to_regclass('public.person_care') is not null as pastoral,
--          to_regprocedure('public.person_teams(uuid)') is not null as times, 'people_care' = any (public.all_actions()) as permissao,
--          exists (select 1 from pg_trigger where tgname = 'team_member_history') as gatilho;
-- REVERSÃO: drop trigger team_member_history on public.team_members; drop table public.person_care_access, public.person_care, public.person_relations;
--           alter table public.people drop column baptized, drop column baptism_date;

-- >>> supabase/migrations/20261127000001_dados_familia.sql
-- =====================================================================
-- Dados pessoais e familiares (27/11/2026) — complementa a Ficha Individual
--  * Endereço completo (logradouro já existia em "address"; novos: número, complemento, bairro, país) e telefone secundário.
--  * Tipos de parentesco numa tabela (relation_types): para ampliar no futuro basta inserir uma linha, sem mexer na estrutura.
--  * Vínculos validados: sem si mesmo, sem duplicar, sem ciclo de ascendência, idade coerente, um cônjuge por vez.
--  * Cadastrar familiar que ainda não existe (sem conta, e sem classificação eclesiástica: novo valor 'none').
--  * Alterar o grau de parentesco; encerrar vínculo (as fichas ficam, e o histórico guarda).
--  * Responsáveis legais em estrutura própria (parentesco não é responsabilidade), com tipo e observação.
--  * Proteção reforçada de menores de 18: o supervisor de rede deixa de enxergá-los; consultas à família de menores e aos responsáveis ficam
--    numa trilha de acesso que só o administrador lê.
--  * Nada existente é apagado; as pessoas e vínculos atuais continuam como estão.
-- =====================================================================

-- ---------------------------------------------------------------- campos novos de pessoa
alter table public.people add column if not exists phone2 text check (phone2 is null or length(phone2) <= 30);
alter table public.people add column if not exists address_number text check (address_number is null or length(address_number) <= 20);
alter table public.people add column if not exists address_complement text check (address_complement is null or length(address_complement) <= 120);
alter table public.people add column if not exists neighborhood text check (neighborhood is null or length(neighborhood) <= 120);
alter table public.people add column if not exists country text check (country is null or length(country) <= 80);
alter table public.people drop constraint if exists people_classification_check;
alter table public.people add constraint people_classification_check check (classification in ('member','attender','visitor','none'));

create or replace function public.person_is_minor(p_birth date) returns boolean language sql stable as $$
  select p_birth is not null and p_birth > (current_date - interval '18 years')::date
$$;

-- supervisor de rede não enxerga menores de 18 (proteção reforçada)
drop policy if exists people_select on public.people;
create policy people_select on public.people for select to authenticated using (
  user_id = auth.uid()
  or (public.people_scope_all(org_id) and public.has_people_perm(org_id, 'people_view'))
  or (public.people_supervised(org_id, user_id) and not public.person_is_minor(birth_date)));
create or replace function public.can_read_person(p_person uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from people p where p.id = p_person and (
    (public.people_scope_all(p.org_id) and public.has_people_perm(p.org_id, 'people_view'))
    or (public.people_supervised(p.org_id, p.user_id) and not public.person_is_minor(p.birth_date))))
$$;

-- ---------------------------------------------------------------- limpeza/validação/gravação com os campos novos
create or replace function public.person_clean(p jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare r jsonb := '{}'::jsonb; k text; v text;
begin
  foreach k in array array['full_name','social_name','sex','marital_status','phone','whatsapp','email','address','address_number','address_complement','neighborhood','country','phone2','city','state','photo_url','admin_notes'] loop
    if p ? k then v := nullif(trim(coalesce(p->>k, '')), ''); r := r || jsonb_build_object(k, v); end if;
  end loop;
  if p ? 'email' and r->>'email' is not null then r := r || jsonb_build_object('email', lower(r->>'email')); end if;
  if p ? 'state' and r->>'state' is not null then r := r || jsonb_build_object('state', upper(r->>'state')); end if;
  if p ? 'cpf' then r := r || jsonb_build_object('cpf', public.digits(p->>'cpf')); end if;
  if p ? 'zip' then r := r || jsonb_build_object('zip', public.digits(p->>'zip')); end if;
  foreach k in array array['birth_date','joined_at','registered_at'] loop
    if p ? k then r := r || jsonb_build_object(k, nullif(trim(coalesce(p->>k, '')), '')); end if;
  end loop;
  return r;
end $$;

create or replace function public.person_check(c jsonb, p_need_name boolean) returns text
language plpgsql immutable set search_path = public as $$
begin
  if length(coalesce(c->>'address_number','')) > 20 or length(coalesce(c->>'address_complement','')) > 120 or length(coalesce(c->>'neighborhood','')) > 120
     or length(coalesce(c->>'country','')) > 80 or length(coalesce(c->>'phone2','')) > 30
     or length(coalesce(c->>'full_name','')) > 160 or length(coalesce(c->>'social_name','')) > 160 then return 'field_too_long'; end if;
  if p_need_name and (c->>'full_name') is null then return 'name_required'; end if;
  if (c->>'cpf') is not null and not public.cpf_valid(c->>'cpf') then return 'invalid_cpf'; end if;
  if (c->>'email') is not null and (c->>'email') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return 'invalid_email'; end if;
  if (c->>'zip') is not null and (c->>'zip') !~ '^\d{8}$' then return 'invalid_zip'; end if;
  if (c->>'state') is not null and (c->>'state') !~ '^[A-Z]{2}$' then return 'invalid_state'; end if;
  if (c->>'sex') is not null and (c->>'sex') not in ('M','F') then return 'invalid_sex'; end if;
  if (c->>'marital_status') is not null and (c->>'marital_status') not in ('solteiro','casado','divorciado','viuvo','uniao_estavel','outro') then return 'invalid_marital'; end if;
  begin
    if (c->>'birth_date') is not null and ((c->>'birth_date')::date > current_date or (c->>'birth_date')::date < date '1900-01-01') then return 'invalid_birth'; end if;
    if (c->>'joined_at') is not null then perform (c->>'joined_at')::date; end if;
  exception when others then return 'invalid_date'; end;
  return null;
end $$;

create or replace function public.person_save(p_org uuid, p_id uuid, p jsonb, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; err text; old people; v_id uuid; k text; ov text; nv text; dup jsonb; v_class text; v_status text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.has_people_perm(p_org, 'people_edit') then raise exception 'forbidden'; end if;
  c := public.person_clean(p);
  err := public.person_check(c, p_id is null);
  if err is not null then raise exception '%', err; end if;
  v_class := nullif(trim(coalesce(p->>'classification', '')), '');
  v_status := nullif(trim(coalesce(p->>'status', '')), '');
  if v_class is not null and v_class not in ('member','attender','visitor','none') then raise exception 'invalid_classification'; end if;
  if v_status is not null and v_status not in ('active','inactive') then raise exception 'invalid_status'; end if;

  if p_id is null then
    select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'full_name', d.full_name, 'classification', d.classification, 'reason', d.reason)), '[]'::jsonb) into dup
      from public.people_find_dupes(p_org, c->>'cpf', c->>'email', c->>'full_name', nullif(c->>'birth_date', '')::date, null) d;
    if jsonb_array_length(dup) > 0 and not p_force then return jsonb_build_object('saved', false, 'duplicates', dup); end if;
    if (c->>'cpf') is not null and exists (select 1 from people where org_id = p_org and cpf = c->>'cpf') then raise exception 'duplicate_cpf'; end if;
    insert into people (org_id, full_name, social_name, birth_date, sex, cpf, marital_status, phone, whatsapp, email, address, address_number, address_complement, neighborhood, country, phone2, city, state, zip, photo_url,
                        classification, joined_at, status, admin_notes, source, flagged_duplicate, created_by)
    values (p_org, c->>'full_name', c->>'social_name', nullif(c->>'birth_date', '')::date, c->>'sex', c->>'cpf', c->>'marital_status', c->>'phone', c->>'whatsapp',
            c->>'email', c->>'address', c->>'address_number', c->>'address_complement', c->>'neighborhood', c->>'country', c->>'phone2', c->>'city', c->>'state', c->>'zip', c->>'photo_url', coalesce(v_class, 'visitor'), nullif(c->>'joined_at', '')::date,
            coalesce(v_status, 'active'), c->>'admin_notes', 'manual', jsonb_array_length(dup) > 0, auth.uid())
    returning id into v_id;
    perform public.person_log(p_org, v_id, 'create', null, null, coalesce(v_class, 'visitor'), 'cadastro manual');
    return jsonb_build_object('saved', true, 'id', v_id);
  end if;

  select * into old from people where id = p_id and org_id = p_org for update;
  if old.id is null then raise exception 'not_found'; end if;
  if (c->>'cpf') is not null and exists (select 1 from people where org_id = p_org and cpf = c->>'cpf' and id <> p_id) then raise exception 'duplicate_cpf'; end if;
  -- registra cada campo que mudou
  foreach k in array array['full_name','social_name','birth_date','sex','cpf','marital_status','phone','whatsapp','email','address','address_number','address_complement','neighborhood','country','phone2','city','state','zip','photo_url','joined_at','admin_notes'] loop
    if c ? k then
      ov := to_jsonb(old) ->> k; nv := c ->> k;
      if ov is distinct from nv then perform public.person_log(p_org, p_id, 'field', k, ov, nv); end if;
    end if;
  end loop;
  if v_class is not null and v_class <> old.classification then perform public.person_log(p_org, p_id, 'classification', 'classification', old.classification, v_class); end if;
  if v_status is not null and v_status <> old.status and old.status in ('active','inactive') then perform public.person_log(p_org, p_id, 'field', 'status', old.status, v_status); end if;
  update people set
    full_name = coalesce(c->>'full_name', full_name),
    social_name = case when c ? 'social_name' then c->>'social_name' else social_name end,
    birth_date = case when c ? 'birth_date' then nullif(c->>'birth_date', '')::date else birth_date end,
    sex = case when c ? 'sex' then c->>'sex' else sex end,
    cpf = case when c ? 'cpf' then c->>'cpf' else cpf end,
    marital_status = case when c ? 'marital_status' then c->>'marital_status' else marital_status end,
    phone = case when c ? 'phone' then c->>'phone' else phone end,
    whatsapp = case when c ? 'whatsapp' then c->>'whatsapp' else whatsapp end,
    email = case when c ? 'email' then c->>'email' else email end,
    address = case when c ? 'address' then c->>'address' else address end,
    address_number = case when c ? 'address_number' then c->>'address_number' else address_number end,
    address_complement = case when c ? 'address_complement' then c->>'address_complement' else address_complement end,
    neighborhood = case when c ? 'neighborhood' then c->>'neighborhood' else neighborhood end,
    country = case when c ? 'country' then c->>'country' else country end,
    phone2 = case when c ? 'phone2' then c->>'phone2' else phone2 end,
    city = case when c ? 'city' then c->>'city' else city end,
    state = case when c ? 'state' then c->>'state' else state end,
    zip = case when c ? 'zip' then c->>'zip' else zip end,
    photo_url = case when c ? 'photo_url' then c->>'photo_url' else photo_url end,
    joined_at = case when c ? 'joined_at' then nullif(c->>'joined_at', '')::date else joined_at end,
    admin_notes = case when c ? 'admin_notes' then c->>'admin_notes' else admin_notes end,
    classification = coalesce(v_class, classification),
    status = case when v_status is not null and status in ('active','inactive') then v_status else status end,
    updated_at = now()
  where id = p_id;
  return jsonb_build_object('saved', true, 'id', p_id);
end $$;

-- ---------------------------------------------------------------- tipos de parentesco (ampliáveis)
create table if not exists public.relation_types (
  key text primary key check (key ~ '^[a-z_]{2,30}$'),
  label text not null check (length(label) between 1 and 60),
  inverse text not null,                       -- como o outro lado enxerga ("child" ↔ "parent")
  kind text not null check (kind in ('spouse','up','down','side','other')),  -- up: o familiar é ascendente; down: descendente
  gens int not null default 0,
  sort int not null default 100,
  active boolean not null default true
);
insert into public.relation_types (key, label, inverse, kind, gens, sort) values
  ('spouse','Cônjuge','spouse','spouse',0,10), ('child','Filho(a)','parent','down',1,20), ('father','Pai','child','up',1,30),
  ('mother','Mãe','child','up',1,31), ('parent','Pai/Mãe','child','up',1,32), ('sibling','Irmão(ã)','sibling','side',0,40),
  ('grandparent','Avô/Avó','grandchild','up',2,50), ('grandchild','Neto(a)','grandparent','down',2,60), ('other','Outro vínculo familiar','other','other',0,90)
on conflict (key) do nothing;
alter table public.relation_types enable row level security;
revoke all on public.relation_types from anon, authenticated;
grant select on public.relation_types to authenticated;
drop policy if exists relation_types_select on public.relation_types;
create policy relation_types_select on public.relation_types for select to authenticated using (true);

alter table public.person_relations drop constraint if exists person_relations_relation_check;
alter table public.person_relations drop constraint if exists person_relations_relation_fkey;
alter table public.person_relations add constraint person_relations_relation_fkey foreign key (relation) references public.relation_types(key);

-- ---------------------------------------------------------------- responsáveis legais (estrutura própria)
create table if not exists public.person_guardians (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  ward_id uuid not null references public.people(id) on delete cascade,        -- quem está sob responsabilidade
  guardian_id uuid not null references public.people(id) on delete cascade,    -- o responsável
  kind text not null check (kind in ('parental','guardian','curator','other')),
  note text check (note is null or length(note) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (ward_id, guardian_id),
  check (ward_id <> guardian_id)
);
create index if not exists person_guardians_guardian on public.person_guardians (guardian_id);
create table if not exists public.person_sensitive_access (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid,
  actor uuid references auth.users(id) on delete set null,
  area text not null check (area in ('family_minor','guardians')),
  at timestamptz not null default now()
);
create index if not exists person_sensitive_access_person on public.person_sensitive_access (person_id, at desc);
alter table public.person_guardians enable row level security;
alter table public.person_sensitive_access enable row level security;
revoke all on public.person_guardians, public.person_sensitive_access from anon, authenticated;

-- ---------------------------------------------------------------- validação central de um vínculo
create or replace function public.relation_edges(p_org uuid, p_exclude bigint default null) returns table (src uuid, dst uuid)
language sql stable security definer set search_path = public as $$
  select case t.kind when 'down' then r.person_id else r.relative_id end, case t.kind when 'down' then r.relative_id else r.person_id end
    from person_relations r join relation_types t on t.key = r.relation where r.org_id = p_org and r.id is distinct from p_exclude and t.kind in ('up','down')
$$;
create or replace function public.relation_validate(a uuid, b uuid, p_rel text, p_exclude bigint default null) returns void
language plpgsql stable security definer set search_path = public as $$
declare pa people; pb people; t relation_types; anc uuid; des uuid; anc_b date; des_b date; cyc boolean;
begin
  select * into pa from people where id = a; select * into pb from people where id = b;
  if pa.id is null or pb.id is null or pa.org_id <> pb.org_id then raise exception 'not_found'; end if;
  if a = b then raise exception 'same_person'; end if;
  select * into t from relation_types where key = p_rel and active;
  if t.key is null then raise exception 'invalid_relation'; end if;
  if exists (select 1 from person_relations where id is distinct from p_exclude and ((person_id = a and relative_id = b) or (person_id = b and relative_id = a))) then raise exception 'already_related'; end if;
  if t.kind = 'spouse' and exists (select 1 from person_relations r join relation_types x on x.key = r.relation
       where r.id is distinct from p_exclude and x.kind = 'spouse' and (r.person_id in (a, b) or r.relative_id in (a, b))) then raise exception 'already_has_spouse'; end if;
  if t.kind in ('up','down') then
    if t.kind = 'down' then anc := a; des := b; anc_b := pa.birth_date; des_b := pb.birth_date; else anc := b; des := a; anc_b := pb.birth_date; des_b := pa.birth_date; end if;
    if anc_b is not null and des_b is not null and anc_b >= des_b then raise exception 'invalid_age'; end if;
    with recursive d(id) as (select des union select e.dst from relation_edges(pa.org_id, p_exclude) e join d on e.src = d.id)
      select exists (select 1 from d where id = anc) into cyc;
    if cyc then raise exception 'invalid_cycle'; end if;
  end if;
end $$;

create or replace function public.relation_label(p_key text) returns text language sql stable as $$ select label from relation_types where key = p_key $$;

-- edição dos próprios dados (inclui os novos campos)
create or replace function public.my_person_update(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; err text; old people; k text; ov text; nv text; v_id uuid; v_name text; v_email text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  -- só campos pessoais: nunca classificação, situação, observações, data de ingresso ou funções
  c := public.person_clean(p - 'classification' - 'status' - 'admin_notes' - 'joined_at' - 'registered_at' - 'user_id');
  err := public.person_check(c, false);
  if err is not null then raise exception '%', err; end if;
  select * into old from people where org_id = p_org and user_id = auth.uid() for update;
  if old.id is null then
    v_name := coalesce(c->>'full_name', (select full_name from profiles where id = auth.uid()), 'Sem nome');
    select email into v_email from auth.users where id = auth.uid();
    if (c->>'cpf') is not null and exists (select 1 from people where org_id = p_org and cpf = c->>'cpf') then raise exception 'duplicate_cpf'; end if;
    insert into people (org_id, user_id, full_name, social_name, birth_date, sex, cpf, marital_status, phone, whatsapp, email, address, address_number, address_complement, neighborhood, country, phone2, city, state, zip, photo_url, classification, source, created_by)
    values (p_org, auth.uid(), v_name, c->>'social_name', nullif(c->>'birth_date', '')::date, c->>'sex', c->>'cpf', c->>'marital_status', c->>'phone', c->>'whatsapp',
            coalesce(c->>'email', lower(v_email)), c->>'address', c->>'address_number', c->>'address_complement', c->>'neighborhood', c->>'country', c->>'phone2', c->>'city', c->>'state', c->>'zip', c->>'photo_url', 'visitor', 'self', auth.uid())
    returning id into v_id;
    perform public.person_log(p_org, v_id, 'create', null, null, 'visitor', 'cadastro feito pela própria pessoa');
    return jsonb_build_object('id', v_id);
  end if;
  if (c->>'cpf') is not null and exists (select 1 from people where org_id = p_org and cpf = c->>'cpf' and id <> old.id) then raise exception 'duplicate_cpf'; end if;
  foreach k in array array['full_name','social_name','birth_date','sex','cpf','marital_status','phone','whatsapp','email','address','address_number','address_complement','neighborhood','country','phone2','city','state','zip','photo_url'] loop
    if c ? k then
      ov := to_jsonb(old) ->> k; nv := c ->> k;
      if ov is distinct from nv then perform public.person_log(p_org, old.id, 'self_update', k, ov, nv); end if;
    end if;
  end loop;
  update people set
    full_name = coalesce(c->>'full_name', full_name),
    social_name = case when c ? 'social_name' then c->>'social_name' else social_name end,
    birth_date = case when c ? 'birth_date' then nullif(c->>'birth_date', '')::date else birth_date end,
    sex = case when c ? 'sex' then c->>'sex' else sex end,
    cpf = case when c ? 'cpf' then c->>'cpf' else cpf end,
    marital_status = case when c ? 'marital_status' then c->>'marital_status' else marital_status end,
    phone = case when c ? 'phone' then c->>'phone' else phone end,
    whatsapp = case when c ? 'whatsapp' then c->>'whatsapp' else whatsapp end,
    email = case when c ? 'email' then c->>'email' else email end,
    address = case when c ? 'address' then c->>'address' else address end,
    address_number = case when c ? 'address_number' then c->>'address_number' else address_number end,
    address_complement = case when c ? 'address_complement' then c->>'address_complement' else address_complement end,
    neighborhood = case when c ? 'neighborhood' then c->>'neighborhood' else neighborhood end,
    country = case when c ? 'country' then c->>'country' else country end,
    phone2 = case when c ? 'phone2' then c->>'phone2' else phone2 end,
    city = case when c ? 'city' then c->>'city' else city end,
    state = case when c ? 'state' then c->>'state' else state end,
    zip = case when c ? 'zip' then c->>'zip' else zip end,
    photo_url = case when c ? 'photo_url' then c->>'photo_url' else photo_url end,
    updated_at = now()
  where id = old.id;
  return jsonb_build_object('id', old.id);
end $$;

-- ---------------------------------------------------------------- vínculos: relacionar, cadastrar familiar novo, alterar, encerrar
create or replace function public.person_relation_add(p_person uuid, p_relative uuid, p_relation text) returns void
language plpgsql security definer set search_path = public as $$
declare a people; b people; inv text;
begin
  select * into a from people where id = p_person; select * into b from people where id = p_relative;
  if a.id is null or b.id is null or a.org_id <> b.org_id then raise exception 'not_found'; end if;
  if not public.has_people_perm(a.org_id, 'people_edit') then raise exception 'forbidden'; end if;
  perform public.relation_validate(a.id, b.id, p_relation);
  insert into person_relations (org_id, person_id, relative_id, relation, created_by) values (a.org_id, a.id, b.id, p_relation, auth.uid());
  select inverse into inv from relation_types where key = p_relation;
  if inv = 'parent' then inv := case a.sex when 'M' then 'father' when 'F' then 'mother' else 'parent' end; end if;
  perform public.person_log(a.org_id, a.id, 'family', 'relation', null, public.relation_label(p_relation), b.full_name);
  perform public.person_log(a.org_id, b.id, 'family', 'relation', null, public.relation_label(inv), a.full_name);
end $$;

create or replace function public.person_relation_create(p_person uuid, p_relation text, p jsonb, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a people; r jsonb; v_id uuid; v_p jsonb := coalesce(p, '{}'::jsonb);
begin
  select * into a from people where id = p_person;
  if a.id is null then raise exception 'not_found'; end if;
  if not public.has_people_perm(a.org_id, 'people_edit') then raise exception 'forbidden'; end if;
  if not exists (select 1 from relation_types where key = p_relation and active) then raise exception 'invalid_relation'; end if;
  -- o familiar não vira membro automaticamente: sem classificação informada, fica "sem classificação"
  if coalesce(nullif(trim(v_p->>'classification'), ''), '') = '' then v_p := v_p || jsonb_build_object('classification', 'none'); end if;
  r := public.person_save(a.org_id, null, v_p, p_force);
  if not coalesce((r->>'saved')::boolean, false) then return r; end if;
  v_id := (r->>'id')::uuid;
  perform public.person_relation_add(p_person, v_id, p_relation);   -- se o vínculo for inválido, tudo é desfeito (inclusive o cadastro)
  return jsonb_build_object('saved', true, 'id', v_id);
end $$;

create or replace function public.person_relation_update(p_id bigint, p_relation text, p_from uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare r person_relations; a people; b people; old_l text; v_new text := p_relation; inv text;
begin
  select * into r from person_relations where id = p_id;
  if r.id is null then raise exception 'not_found'; end if;
  if not public.has_people_perm(r.org_id, 'people_edit') then raise exception 'forbidden'; end if;
  if not exists (select 1 from relation_types where key = p_relation and active) then raise exception 'invalid_relation'; end if;
  -- visto de quem é o "relative" do vínculo guardado, o tipo escolhido vale ao contrário
  if p_from is not null and p_from = r.relative_id then select inverse into v_new from relation_types where key = p_relation; end if;
  if r.relation = v_new then return; end if;
  perform public.relation_validate(r.person_id, r.relative_id, v_new, p_id);
  select * into a from people where id = r.person_id; select * into b from people where id = r.relative_id;
  old_l := public.relation_label(r.relation);
  update person_relations set relation = v_new where id = p_id;
  perform public.person_log(r.org_id, a.id, 'family', 'relation', old_l, public.relation_label(v_new), b.full_name);
  perform public.person_log(r.org_id, b.id, 'family', 'relation', old_l, public.relation_label(v_new), a.full_name);
end $$;

create or replace function public.person_family(p_person uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people; v_full boolean;
begin
  select * into pe from people where id = p_person;
  if pe.id is null or not public.can_read_person(p_person) then raise exception 'forbidden'; end if;
  v_full := public.people_scope_all(pe.org_id) and public.has_people_perm(pe.org_id, 'people_view');
  if public.person_is_minor(pe.birth_date) then insert into person_sensitive_access (org_id, person_id, actor, area) values (pe.org_id, p_person, auth.uid(), 'family_minor'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'relative_id', x.rid, 'name', o.full_name, 'photo_url', o.photo_url, 'classification', o.classification, 'status', o.status,
                                        'relation', x.rel, 'label', public.relation_label(x.rel), 'minor', public.person_is_minor(o.birth_date)) order by o.full_name)
    from (
      select r.id, r.relative_id as rid, r.relation as rel from person_relations r where r.person_id = p_person
      union all
      select r.id, r.person_id, case t.inverse when 'parent' then case q.sex when 'M' then 'father' when 'F' then 'mother' else 'parent' end else t.inverse end
        from person_relations r join relation_types t on t.key = r.relation join people q on q.id = r.person_id where r.relative_id = p_person
    ) x join people o on o.id = x.rid
    where v_full or not public.person_is_minor(o.birth_date)), '[]'::jsonb);
end $$;

create or replace function public.relation_types_list() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label) order by sort), '[]'::jsonb) from relation_types where active and key <> 'parent'
$$;

-- ---------------------------------------------------------------- responsáveis legais
create or replace function public.person_guardians(p_person uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from people where id = p_person;
  if pe.id is null or not (public.people_scope_all(pe.org_id) and public.has_people_perm(pe.org_id, 'people_view')) then raise exception 'forbidden'; end if;
  insert into person_sensitive_access (org_id, person_id, actor, area) values (pe.org_id, p_person, auth.uid(), 'guardians');
  return jsonb_build_object(
    'guardians', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'person_id', o.id, 'name', o.full_name, 'photo_url', o.photo_url, 'classification', o.classification, 'kind', g.kind, 'note', g.note) order by o.full_name)
                           from person_guardians g join people o on o.id = g.guardian_id where g.ward_id = p_person), '[]'::jsonb),
    'wards', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'person_id', o.id, 'name', o.full_name, 'photo_url', o.photo_url, 'classification', o.classification, 'kind', g.kind, 'note', g.note) order by o.full_name)
                       from person_guardians g join people o on o.id = g.ward_id where g.guardian_id = p_person), '[]'::jsonb));
end $$;

create or replace function public.guardian_add(p_ward uuid, p_guardian uuid, p_kind text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare w people; g people; v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into w from people where id = p_ward; select * into g from people where id = p_guardian;
  if w.id is null or g.id is null or w.org_id <> g.org_id then raise exception 'not_found'; end if;
  if not public.has_people_perm(w.org_id, 'people_edit') then raise exception 'forbidden'; end if;
  if w.id = g.id then raise exception 'same_person'; end if;
  if p_kind not in ('parental','guardian','curator','other') then raise exception 'invalid_kind'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'note_too_long'; end if;
  if g.birth_date is not null and public.person_is_minor(g.birth_date) then raise exception 'guardian_minor'; end if;
  if w.birth_date is not null and not public.person_is_minor(w.birth_date) and p_kind <> 'curator' then raise exception 'ward_not_minor'; end if;
  if exists (select 1 from person_guardians where ward_id = w.id and guardian_id = g.id) then raise exception 'already_guardian'; end if;
  insert into person_guardians (org_id, ward_id, guardian_id, kind, note, created_by) values (w.org_id, w.id, g.id, p_kind, v_note, auth.uid());
  perform public.person_log(w.org_id, w.id, 'guardian', 'guardian', null, 'responsável legal', g.full_name);
  perform public.person_log(w.org_id, g.id, 'guardian', 'guardian', null, 'responsável por', w.full_name);
end $$;

create or replace function public.guardian_update(p_id bigint, p_kind text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r person_guardians; v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into r from person_guardians where id = p_id;
  if r.id is null then raise exception 'not_found'; end if;
  if not public.has_people_perm(r.org_id, 'people_edit') then raise exception 'forbidden'; end if;
  if p_kind not in ('parental','guardian','curator','other') then raise exception 'invalid_kind'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'note_too_long'; end if;
  update person_guardians set kind = p_kind, note = v_note where id = p_id;
  perform public.person_log(r.org_id, r.ward_id, 'guardian', 'guardian', r.kind, p_kind, 'tipo de responsabilidade alterado');
end $$;

create or replace function public.guardian_remove(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r person_guardians; w people; g people;
begin
  select * into r from person_guardians where id = p_id;
  if r.id is null then raise exception 'not_found'; end if;
  if not public.has_people_perm(r.org_id, 'people_edit') then raise exception 'forbidden'; end if;
  select * into w from people where id = r.ward_id; select * into g from people where id = r.guardian_id;
  delete from person_guardians where id = p_id;
  perform public.person_log(r.org_id, w.id, 'guardian', 'guardian', 'responsável legal', null, g.full_name);
  perform public.person_log(r.org_id, g.id, 'guardian', 'guardian', 'responsável por', null, w.full_name);
end $$;

-- quem consultou dados protegidos (família de menores e responsáveis): só o administrador
create or replace function public.person_access_history(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from people where id = p_person;
  if pe.id is null then raise exception 'not_found'; end if;
  if not exists (select 1 from org_members where org_id = pe.org_id and user_id = auth.uid() and role = 'admin') then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'area', a.area, 'by', public.welcome_name(pe.org_id, a.actor)) order by a.at desc)
    from (select * from person_sensitive_access where person_id = p_person order by at desc limit 50) a), '[]'::jsonb);
end $$;

revoke execute on function public.person_relation_add(uuid, uuid, text), public.person_relation_create(uuid, text, jsonb, boolean), public.person_relation_update(bigint, text, uuid),
  public.person_family(uuid), public.relation_types_list(), public.person_guardians(uuid), public.guardian_add(uuid, uuid, text, text), public.guardian_update(bigint, text, text),
  public.guardian_remove(bigint), public.person_access_history(uuid) from public, anon;
grant execute on function public.person_relation_add(uuid, uuid, text), public.person_relation_create(uuid, text, jsonb, boolean), public.person_relation_update(bigint, text, uuid),
  public.person_family(uuid), public.relation_types_list(), public.person_guardians(uuid), public.guardian_add(uuid, uuid, text, text), public.guardian_update(bigint, text, text),
  public.guardian_remove(bigint), public.person_access_history(uuid) to authenticated;
revoke execute on function public.relation_edges(uuid, bigint), public.relation_validate(uuid, uuid, text, bigint), public.relation_label(text), public.person_is_minor(date) from public, anon, authenticated;
grant execute on function public.person_is_minor(date), public.relation_label(text) to authenticated;   -- usados dentro da política de leitura

-- verificação:
--   select to_regclass('public.relation_types') is not null as tipos, to_regclass('public.person_guardians') is not null as responsaveis,
--          to_regprocedure('public.person_relation_create(uuid,text,jsonb,boolean)') is not null as familiar_novo,
--          exists (select 1 from information_schema.columns where table_name = 'people' and column_name = 'neighborhood') as endereco;
-- REVERSÃO: drop table public.person_sensitive_access, public.person_guardians; alter table public.person_relations drop constraint person_relations_relation_fkey;
--           drop table public.relation_types; alter table public.people drop column phone2, drop column address_number, drop column address_complement, drop column neighborhood, drop column country;

-- >>> supabase/migrations/20261128000001_linha_do_tempo.sql
-- =====================================================================
-- SOMOS Recurso 05: Histórico do membro — Linha do Tempo individual
-- Estende person_history (a mesma trilha que já registra cadastro, classificação, família e times). Nada é recriado nem apagado.
--  * person_history ganha categoria, título, descrição, data do fato, origem (auto/manual), operação, chave anti-duplicidade e metadados.
--  * Categorias em tabela (ampliáveis pelo administrador). Registro manual com data retroativa e responsável sempre o usuário logado.
--  * Registros automáticos são imutáveis. Manuais só são corrigidos por quem tem permissão e cada correção guarda o valor anterior.
--  * Família e responsáveis legais ficam marcados como restritos: aparecem sem detalhes para quem não edita pessoas.
--  * Acompanhamento pastoral (person_care) continua separado: nada dele entra na linha do tempo.
--  * Todas as leituras passam por funções que conferem permissão (nenhuma escrita direta, nenhum acesso do desenvolvedor aos dados).
-- =====================================================================

-- ---------------------------------------------------------------- permissões novas
alter table public.access_grants drop constraint if exists access_grants_actions_check;
alter table public.access_grants add constraint access_grants_actions_check check (
  actions <@ array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit']::text[]);
create or replace function public.all_actions() returns text[] language sql immutable as $$
  select array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit']::text[]
$$;
create or replace function public.role_actions(p_role text) returns text[] language sql immutable as $$
  select case p_role
    when 'team_member'        then array['view']
    when 'team_leader'        then array['view','create','edit','delete','approve','manage']
    when 'network_supervisor' then array['view','approve','manage']
    when 'general_leader'     then array['view','create','edit','approve','manage','administer']
    when 'secretary'          then array['people_view','people_edit','people_approve','people_import','people_welcome','people_timeline_add','people_timeline_edit']
    else '{}' end::text[]
$$;
create or replace function public.people_actions(p_org uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
      then array['people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit']
    else coalesce((select array_agg(distinct a) from access_grants g, unnest(g.actions) a
                   where g.org_id = p_org and g.user_id = auth.uid() and a like 'people\_%'), '{}'::text[]) end
$$;
-- adicionar acontecimento: ação própria ou quem já edita pessoas; corrigir: idem
create or replace function public.can_timeline(p_org uuid, p_mode text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_people_perm(p_org, 'people_edit')
      or public.has_people_perm(p_org, case p_mode when 'add' then 'people_timeline_add' else 'people_timeline_edit' end)
$$;
revoke execute on function public.can_timeline(uuid, text) from public, anon;
grant execute on function public.can_timeline(uuid, text) to authenticated;

-- ---------------------------------------------------------------- colunas novas na trilha existente
alter table public.person_history
  add column if not exists category text,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists occurred_on date,
  add column if not exists origin text not null default 'auto' check (origin in ('auto','manual')),
  add column if not exists op_id text,
  add column if not exists op_key text,
  add column if not exists meta jsonb not null default '{}'::jsonb,
  add column if not exists restricted boolean not null default false,
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid references auth.users(id) on delete set null,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id) on delete set null,
  add column if not exists void_reason text;
create unique index if not exists person_history_opkey on public.person_history (person_id, op_key) where op_key is not null;
create index if not exists person_history_timeline on public.person_history (person_id, occurred_on desc, at desc, id desc);

-- cada correção ou anulação de registro manual guarda o estado anterior
create table if not exists public.person_history_edits (
  id bigint generated always as identity primary key,
  history_id bigint not null references public.person_history(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor uuid references auth.users(id) on delete set null,
  action text not null check (action in ('edit','void')),
  before jsonb not null,
  reason text,
  at timestamptz not null default now()
);
create index if not exists person_history_edits_h on public.person_history_edits (history_id, at desc);
alter table public.person_history_edits enable row level security;
revoke all on public.person_history_edits from anon, authenticated;

-- categorias (do sistema ou criadas pela igreja)
create table if not exists public.history_categories (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations(id) on delete cascade,   -- nulo = categoria do sistema
  key text not null,
  label text not null check (char_length(label) between 2 and 40),
  manual boolean not null default true,        -- pode ser escolhida em registro manual
  active boolean not null default true,
  sort int not null default 100,
  created_by uuid references auth.users(id) on delete set null
);
create unique index if not exists history_categories_key on public.history_categories (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
alter table public.history_categories enable row level security;
revoke all on public.history_categories from anon, authenticated;
insert into public.history_categories (org_id, key, label, manual, sort) values
  (null, 'cadastro',     'Cadastro e situação',      false, 10),
  (null, 'pessoais',     'Dados pessoais',           false, 20),
  (null, 'familia',      'Vida familiar',            false, 30),
  (null, 'acolhimento',  'Acolhimento',              true,  40),
  (null, 'participacao', 'Participação na igreja',   true,  50),
  (null, 'batismo',      'Batismo',                  true,  60),
  (null, 'membresia',    'Membresia',                true,  70),
  (null, 'integracao',   'Integração',               true,  80),
  (null, 'ministerio',   'Ministério',               true,  90),
  (null, 'formacao',     'Formação e capacitação',   true,  100),
  (null, 'outros',       'Outros acontecimentos',    true,  900)
on conflict do nothing;

-- ---------------------------------------------------------------- descrição automática (um só lugar para todos os eventos)
create or replace function public.history_class_label(p text) returns text language sql immutable as $$
  select case p when 'member' then 'Membro' when 'attender' then 'Frequentador' when 'visitor' then 'Visitante' when 'none' then 'Sem classificação' else coalesce(p, '') end
$$;
create or replace function public.history_field_label(p text) returns text language sql immutable as $$
  select case p when 'full_name' then 'Nome' when 'social_name' then 'Nome de preferência' when 'birth_date' then 'Nascimento' when 'sex' then 'Sexo' when 'marital_status' then 'Estado civil'
    when 'cpf' then 'CPF' when 'phone' then 'Telefone' when 'phone2' then 'Telefone secundário' when 'whatsapp' then 'WhatsApp' when 'email' then 'E-mail' when 'zip' then 'CEP'
    when 'address' then 'Logradouro' when 'address_number' then 'Número' when 'address_complement' then 'Complemento' when 'neighborhood' then 'Bairro' when 'city' then 'Cidade'
    when 'state' then 'UF' when 'country' then 'País' when 'photo_url' then 'Foto' when 'status' then 'Situação' when 'classification' then 'Classificação' when 'notes' then 'Observações'
    else coalesce(p, 'Campo') end
$$;
create or replace function public.history_describe(p_kind text, p_field text, p_old text, p_new text, p_note text,
                                                   out category text, out title text, out description text, out restricted boolean)
language plpgsql immutable as $$
declare v_name text := split_part(coalesce(p_note, ''), ' · ', 1);
begin
  restricted := false; category := 'outros'; title := initcap(replace(coalesce(p_kind, 'evento'), '_', ' ')); description := nullif(p_note, '');
  if p_kind = 'create' then
    category := 'cadastro'; title := case p_new when 'visitor' then 'Cadastro inicial como visitante' else 'Ficha individual criada' end;
    description := trim(both ' ' from coalesce('Classificação: ' || public.history_class_label(p_new), '') || case when p_note is not null then ' · ' || p_note else '' end);
  elsif p_kind = 'classification' then
    category := 'cadastro';
    title := case when p_old is null or p_old = 'none' then 'Classificada como ' || public.history_class_label(p_new) else 'Passou de ' || public.history_class_label(p_old) || ' a ' || public.history_class_label(p_new) end;
    description := public.history_class_label(p_old) || ' → ' || public.history_class_label(p_new);
  elsif p_kind = 'field' and p_field = 'status' then
    category := 'cadastro';
    title := case when p_new = 'inactive' then 'Cadastro inativado' when p_old = 'inactive' and p_new = 'active' then 'Cadastro reativado' else 'Situação do cadastro alterada' end;
    description := null;
  elsif p_kind = 'field' and p_field = 'baptized' then
    category := 'batismo'; title := case when p_new = 'true' then 'Batismo registrado' else 'Batismo desmarcado' end; description := null;
  elsif p_kind = 'field' and p_field = 'baptism_date' then
    category := 'batismo'; title := 'Data do batismo registrada'; description := p_new;
  elsif p_kind in ('field', 'self_update') then
    category := 'pessoais'; title := case when p_kind = 'self_update' then 'Dado atualizado pela própria pessoa' else 'Dado pessoal atualizado' end; description := public.history_field_label(p_field);
  elsif p_kind = 'team_join' then
    category := 'ministerio'; title := 'Entrou em ' || coalesce(nullif(v_name, ''), 'um time'); description := case when p_note like '%entrou como líder%' then 'Entrou já como líder' end;
  elsif p_kind = 'team_leave' then
    category := 'ministerio'; title := 'Saiu de ' || coalesce(nullif(v_name, ''), 'um time'); description := null;
  elsif p_kind = 'team_role' then
    category := 'ministerio'; title := case when p_note like '%passou a líder%' then 'Nomeado(a) líder de ' else 'Deixou a liderança de ' end || coalesce(nullif(v_name, ''), 'um time'); description := null;
  elsif p_kind = 'visit' then category := 'acolhimento'; title := 'Visita registrada'; description := nullif(p_note, '');
  elsif p_kind = 'consent' then category := 'acolhimento'; title := case when p_new = 'true' then 'Contato autorizado' else 'Autorização de contato retirada' end; description := null;
  elsif p_kind = 'journey' then
    category := 'acolhimento'; title := 'Acolhimento: ' || case p_field when 'interest' then 'interesse em continuar' when 'request' then 'pedido registrado' when 'family' then 'conversa sobre família' when 'approach' then 'abordagem' when 'integration' then 'integração' when 'contact' then 'contato' else 'registro' end; description := null;
  elsif p_kind = 'family' then
    category := 'familia'; restricted := true;
    title := case when p_old is null then 'Vínculo familiar incluído' when p_new is null then 'Vínculo familiar encerrado' else 'Parentesco alterado' end;
    description := trim(both ' ' from coalesce(coalesce(p_new, p_old), '') || case when p_note is not null then ' · ' || p_note else '' end);
  elsif p_kind = 'guardian' then
    category := 'familia'; restricted := true;
    title := case when p_old is null then 'Responsável legal incluído' when p_new is null then 'Responsável legal removido' else 'Responsável legal alterado' end;
    description := trim(both ' ' from coalesce(coalesce(p_new, p_old), '') || case when p_note is not null then ' · ' || p_note else '' end);
  elsif p_kind = 'approve' then category := 'cadastro'; title := 'Cadastro aprovado'; description := null;
  elsif p_kind = 'reject' then category := 'cadastro'; title := 'Cadastro rejeitado'; description := nullif(p_note, '');
  elsif p_kind = 'link' then category := 'cadastro'; title := 'Conta do aplicativo vinculada ao cadastro'; description := null;
  end if;
end $$;

-- registros que já existiam ganham categoria, título e data do fato (nada é apagado nem reescrito além disso)
update public.person_history h set category = d.category, title = d.title, description = d.description, restricted = d.restricted,
       occurred_on = (h.at at time zone 'America/Sao_Paulo')::date
  from (select x.id, (public.history_describe(x.kind, x.field, x.old_value, x.new_value, x.note)).* from public.person_history x where x.category is null) d
 where h.id = d.id;

-- ---------------------------------------------------------------- ponto único de registro de eventos (substitui person_log mantendo as mesmas chamadas)
drop function if exists public.person_log(uuid, uuid, text, text, text, text, text);
create or replace function public.person_log(p_org uuid, p_person uuid, p_kind text, p_field text, p_old text, p_new text, p_note text default null,
                                             p_occurred date default null, p_key text default null, p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare d record;
begin
  select * into d from public.history_describe(p_kind, p_field, p_old, p_new, p_note);
  insert into person_history (org_id, person_id, actor, kind, field, old_value, new_value, note, category, title, description, restricted, occurred_on, origin, op_id, op_key, meta)
  values (p_org, p_person, auth.uid(), p_kind, p_field, p_old, p_new, p_note, d.category, d.title, d.description, d.restricted,
          coalesce(p_occurred, (now() at time zone 'America/Sao_Paulo')::date), 'auto', txid_current()::text, p_key, coalesce(p_meta, '{}'::jsonb))
  on conflict (person_id, op_key) where op_key is not null do nothing;
end $$;
revoke execute on function public.person_log(uuid, uuid, text, text, text, text, text, date, text, jsonb) from public, anon, authenticated;
revoke execute on function public.history_describe(text, text, text, text, text), public.history_class_label(text), public.history_field_label(text) from public, anon, authenticated;

-- entrada/saída/liderança em times (mesmo gatilho de antes, agora com chave anti-duplicidade e "entrou como líder")
create or replace function public.team_member_history() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_tid uuid; v_org uuid; v_k text; v_note text; v_name text; r record;
begin
  begin
    if tg_op = 'DELETE' then v_uid := old.user_id; v_tid := old.team_id; v_org := old.org_id; v_k := 'team_leave';
    elsif tg_op = 'INSERT' then v_uid := new.user_id; v_tid := new.team_id; v_org := new.org_id; v_k := 'team_join';
    else
      if new.is_leader is not distinct from old.is_leader then return new; end if;
      v_uid := new.user_id; v_tid := new.team_id; v_org := new.org_id; v_k := 'team_role';
    end if;
    select name into v_name from teams where id = v_tid;
    v_note := coalesce(v_name, 'time') || case when v_k = 'team_role' then case when new.is_leader then ' · passou a líder' else ' · deixou de ser líder' end
                                               when v_k = 'team_join' and new.is_leader then ' · entrou como líder' else '' end;
    for r in select id from people where org_id = v_org and user_id = v_uid loop
      perform public.person_log(v_org, r.id, v_k, 'team', null, null, v_note, null, 'tm:' || txid_current() || ':' || v_tid || ':' || v_k || ':' || (case when tg_op = 'DELETE' then 'x' else new.is_leader::text end),
                                jsonb_build_object('team_id', v_tid));
    end loop;
  exception when others then null;
  end;
  return coalesce(new, old);
end $$;

-- a política de leitura direta: registros restritos (família e responsáveis) só para o administrador da igreja
drop policy if exists person_history_select on public.person_history;
create policy person_history_select on public.person_history for select to authenticated using (
  public.people_scope_all(org_id) and public.has_people_perm(org_id, 'people_view')
  and (not restricted or exists (select 1 from org_members om where om.org_id = person_history.org_id and om.user_id = auth.uid() and om.role = 'admin')));

-- ---------------------------------------------------------------- leitura da linha do tempo
create or replace function public.person_timeline(p_person uuid, p_categories text[] default null, p_origin text default null,
                                                  p_from date default null, p_to date default null, p_by uuid default null,
                                                  p_limit int default 30, p_offset int default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people; v_full boolean; v_sup boolean; v_detail boolean; v_lim int := least(greatest(coalesce(p_limit, 30), 1), 100); v_res jsonb; v_more boolean;
begin
  select * into pe from people where id = p_person;
  if pe.id is null then raise exception 'not_found'; end if;
  v_full := public.people_scope_all(pe.org_id) and public.has_people_perm(pe.org_id, 'people_view');
  v_sup  := not v_full and public.people_supervised(pe.org_id, pe.user_id) and not public.person_is_minor(pe.birth_date);
  if not (v_full or v_sup) then raise exception 'forbidden'; end if;
  v_detail := v_full and public.has_people_perm(pe.org_id, 'people_edit');
  if p_origin is not null and p_origin not in ('auto', 'manual') then raise exception 'invalid_filter'; end if;

  with base as (
    select h.*, case when h.kind in ('field', 'self_update') and h.category = 'pessoais' and h.op_id is not null then 'g:' || h.op_id || ':' || h.kind || ':' || coalesce(h.actor::text, '') else 'r:' || h.id end as gk
      from person_history h
     where h.person_id = p_person and h.voided_at is null
       and (v_full or not h.restricted)
       and (p_categories is null or h.category = any (p_categories))
       and (p_origin is null or h.origin = p_origin)
       and (p_from is null or h.occurred_on >= p_from) and (p_to is null or h.occurred_on <= p_to)
       and (p_by is null or h.actor = p_by)
  ), grp as (
    select gk, max(id) as id, max(occurred_on) as occurred_on, max(at) as at, count(*) as n,
           (array_agg(id order by id))[1] as first_id
      from base group by gk
  ), page as (
    select q.*, row_number() over (order by q.occurred_on desc, q.at desc, q.id desc) as rn
      from (select g.* from grp g order by g.occurred_on desc, g.at desc, g.id desc offset greatest(coalesce(p_offset, 0), 0) limit v_lim + 1) q
  )
  select coalesce(jsonb_agg(x.j order by x.rn) filter (where x.rn <= v_lim), '[]'::jsonb), bool_or(x.rn > v_lim) into v_res, v_more
  from (
    select pg.rn, jsonb_build_object(
      'id', b.id, 'category', b.category, 'category_label', coalesce(c.label, 'Outros acontecimentos'),
      'title', case when pg.n > 1 then 'Dados pessoais atualizados' else case when b.restricted and not v_detail then case b.kind when 'guardian' then 'Responsável legal atualizado' else 'Vida familiar atualizada' end else b.title end end,
      'description', case when pg.n > 1 then (select string_agg(distinct public.history_field_label(g2.field), ', ') from base g2 where g2.gk = pg.gk)
                          when b.restricted and not v_detail then null else b.description end,
      'occurred_on', b.occurred_on, 'at', b.at, 'origin', b.origin, 'kind', b.kind,
      'by', case when b.actor is null then 'Sistema' else coalesce(public.welcome_name(b.org_id, b.actor), 'Usuário removido') end, 'by_id', b.actor,
      'edited', b.edited_at is not null, 'edited_at', b.edited_at,
      'notes', case when b.origin = 'manual' then b.meta->>'notes' end,
      'restricted', b.restricted and not v_detail, 'op_id', b.op_id,
      'changes', case when b.kind in ('field', 'self_update') and b.category = 'pessoais' then
                  (select jsonb_agg(jsonb_build_object('field', public.history_field_label(g2.field), 'old', case when g2.field = 'cpf' then null else g2.old_value end, 'new', case when g2.field = 'cpf' then null else g2.new_value end) order by g2.id)
                     from base g2 where g2.gk = pg.gk) end,
      'can_edit', b.origin = 'manual' and public.can_timeline(b.org_id, 'edit')
    ) as j
    from page pg join person_history b on b.id = pg.id left join history_categories c on c.key = b.category and (c.org_id is null or c.org_id = b.org_id)
  ) x;
  return jsonb_build_object('items', v_res, 'has_more', coalesce(v_more, false), 'can_add', public.can_timeline(pe.org_id, 'add'));
end $$;

-- ---------------------------------------------------------------- categorias
create or replace function public.history_categories_list(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_people_perm(p_org, 'people_view') or public.people_scope_all(p_org) or public.can_timeline(p_org, 'add') or public.people_supervised_any(p_org)) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('key', key, 'label', label, 'manual', manual, 'active', active, 'system', org_id is null) order by sort, label)
                   from history_categories where org_id is null or org_id = p_org), '[]'::jsonb);
end $$;
create or replace function public.people_supervised_any(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from access_grants g where g.org_id = p_org and g.user_id = auth.uid() and g.role_key = 'network_supervisor' and 'people_view' = any (g.actions))
$$;
create or replace function public.history_category_save(p_org uuid, p_key text, p_label text, p_active boolean default true) returns text
language plpgsql security definer set search_path = public as $$
declare v_label text := trim(coalesce(p_label, '')); v_key text := p_key; c history_categories;
begin
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin') then raise exception 'forbidden'; end if;
  if char_length(v_label) < 2 or char_length(v_label) > 40 then raise exception 'invalid_label'; end if;
  if exists (select 1 from history_categories where (org_id is null or org_id = p_org) and lower(label) = lower(v_label) and key is distinct from p_key) then raise exception 'already_exists'; end if;
  if v_key is null then
    v_key := 'c_' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
    insert into history_categories (org_id, key, label, manual, active, sort, created_by) values (p_org, v_key, v_label, true, coalesce(p_active, true), 500, auth.uid());
  else
    select * into c from history_categories where key = v_key and org_id = p_org;
    if c.id is null then raise exception 'not_found'; end if;
    update history_categories set label = v_label, active = coalesce(p_active, true) where id = c.id;
  end if;
  return v_key;
end $$;

-- ---------------------------------------------------------------- registro manual
create or replace function public.timeline_add(p_person uuid, p_category text, p_title text, p_description text default null,
                                               p_occurred_on date default null, p_notes text default null, p_key text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare pe people; v_t text := trim(coalesce(p_title, '')); v_d text := nullif(trim(coalesce(p_description, '')), ''); v_n text := nullif(trim(coalesce(p_notes, '')), '');
        v_on date := coalesce(p_occurred_on, (now() at time zone 'America/Sao_Paulo')::date); v_id bigint;
begin
  select * into pe from people where id = p_person;
  if pe.id is null then raise exception 'not_found'; end if;
  if not public.can_timeline(pe.org_id, 'add') then raise exception 'forbidden'; end if;
  if not exists (select 1 from history_categories where key = p_category and manual and active and (org_id is null or org_id = pe.org_id)) then raise exception 'invalid_category'; end if;
  if char_length(v_t) < 2 or char_length(v_t) > 120 then raise exception 'invalid_title'; end if;
  if char_length(coalesce(v_d, '')) > 1000 or char_length(coalesce(v_n, '')) > 1000 then raise exception 'text_too_long'; end if;
  if v_on < date '1900-01-01' or v_on > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'invalid_date'; end if;
  insert into person_history (org_id, person_id, actor, kind, category, title, description, occurred_on, origin, op_id, op_key, meta)
  values (pe.org_id, pe.id, auth.uid(), 'manual', p_category, v_t, v_d, v_on, 'manual', txid_current()::text,
          case when p_key is null then null else 'manual:' || left(p_key, 80) end, case when v_n is null then '{}'::jsonb else jsonb_build_object('notes', v_n) end)
  on conflict (person_id, op_key) where op_key is not null do nothing returning id into v_id;
  if v_id is null then select id into v_id from person_history where person_id = pe.id and op_key = 'manual:' || left(p_key, 80); end if;
  return v_id;
end $$;

create or replace function public.timeline_correct(p_id bigint, p_title text, p_description text default null, p_occurred_on date default null,
                                                   p_notes text default null, p_category text default null, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare h person_history; v_t text := trim(coalesce(p_title, '')); v_d text := nullif(trim(coalesce(p_description, '')), ''); v_n text := nullif(trim(coalesce(p_notes, '')), '');
        v_on date := coalesce(p_occurred_on, null); v_cat text; v_r text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into h from person_history where id = p_id;
  if h.id is null then raise exception 'not_found'; end if;
  if not public.can_timeline(h.org_id, 'edit') then raise exception 'forbidden'; end if;
  if h.origin <> 'manual' then raise exception 'auto_protected'; end if;
  if h.voided_at is not null then raise exception 'voided'; end if;
  v_cat := coalesce(p_category, h.category);
  if not exists (select 1 from history_categories where key = v_cat and (org_id is null or org_id = h.org_id) and (key = h.category or (manual and active))) then raise exception 'invalid_category'; end if;
  if char_length(v_t) < 2 or char_length(v_t) > 120 then raise exception 'invalid_title'; end if;
  if char_length(coalesce(v_d, '')) > 1000 or char_length(coalesce(v_n, '')) > 1000 or char_length(coalesce(v_r, '')) > 500 then raise exception 'text_too_long'; end if;
  v_on := coalesce(p_occurred_on, h.occurred_on);
  if v_on < date '1900-01-01' or v_on > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'invalid_date'; end if;
  insert into person_history_edits (history_id, org_id, actor, action, before, reason)
  values (h.id, h.org_id, auth.uid(), 'edit', jsonb_build_object('title', h.title, 'description', h.description, 'occurred_on', h.occurred_on, 'category', h.category, 'notes', h.meta->>'notes'), v_r);
  update person_history set title = v_t, description = v_d, occurred_on = v_on, category = v_cat,
         meta = case when v_n is null then meta - 'notes' else meta || jsonb_build_object('notes', v_n) end, edited_at = now(), edited_by = auth.uid() where id = h.id;
end $$;

create or replace function public.timeline_void(p_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare h person_history; v_r text := trim(coalesce(p_reason, ''));
begin
  select * into h from person_history where id = p_id;
  if h.id is null then raise exception 'not_found'; end if;
  if not public.can_timeline(h.org_id, 'edit') then raise exception 'forbidden'; end if;
  if h.origin <> 'manual' then raise exception 'auto_protected'; end if;
  if h.voided_at is not null then raise exception 'voided'; end if;
  if char_length(v_r) < 3 or char_length(v_r) > 500 then raise exception 'reason_required'; end if;
  insert into person_history_edits (history_id, org_id, actor, action, before, reason)
  values (h.id, h.org_id, auth.uid(), 'void', jsonb_build_object('title', h.title, 'description', h.description, 'occurred_on', h.occurred_on, 'category', h.category, 'notes', h.meta->>'notes'), v_r);
  update person_history set voided_at = now(), voided_by = auth.uid(), void_reason = v_r where id = h.id;
end $$;

-- auditoria da linha do tempo (correções e anulações): só o administrador da igreja
create or replace function public.timeline_audit(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from people where id = p_person;
  if pe.id is null then raise exception 'not_found'; end if;
  if not exists (select 1 from org_members where org_id = pe.org_id and user_id = auth.uid() and role = 'admin') then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'action', e.action, 'by', coalesce(public.welcome_name(e.org_id, e.actor), 'Usuário removido'), 'reason', e.reason, 'before', e.before,
                                                        'now_title', h.title, 'entry_by', coalesce(public.welcome_name(h.org_id, h.actor), '—')) order by e.at desc)
                   from person_history_edits e join person_history h on h.id = e.history_id where h.person_id = p_person), '[]'::jsonb);
end $$;

revoke execute on function public.person_timeline(uuid, text[], text, date, date, uuid, int, int), public.history_categories_list(uuid), public.people_supervised_any(uuid),
  public.history_category_save(uuid, text, text, boolean), public.timeline_add(uuid, text, text, text, date, text, text),
  public.timeline_correct(bigint, text, text, date, text, text, text), public.timeline_void(bigint, text), public.timeline_audit(uuid) from public, anon;
grant execute on function public.person_timeline(uuid, text[], text, date, date, uuid, int, int), public.history_categories_list(uuid), public.people_supervised_any(uuid),
  public.history_category_save(uuid, text, text, boolean), public.timeline_add(uuid, text, text, text, date, text, text),
  public.timeline_correct(bigint, text, text, date, text, text, text), public.timeline_void(bigint, text), public.timeline_audit(uuid) to authenticated;

-- verificação:
--   select to_regclass('public.history_categories') is not null as categorias, to_regprocedure('public.person_timeline(uuid,text[],text,date,date,uuid,integer,integer)') is not null as linha_do_tempo,
--          exists (select 1 from information_schema.columns where table_name = 'person_history' and column_name = 'origin') as colunas, 'people_timeline_add' = any (public.all_actions()) as permissao;
-- REVERSÃO: drop table public.person_history_edits, public.history_categories; alter table public.person_history drop column category, drop column title, drop column description, drop column occurred_on,
--           drop column origin, drop column op_id, drop column op_key, drop column meta, drop column restricted, drop column edited_at, drop column edited_by, drop column voided_at, drop column voided_by, drop column void_reason;
--           (e recriar person_log com 7 parâmetros a partir de 20261124000001_pessoas.sql)

-- >>> supabase/migrations/20261129000001_atualizacao_cadastral.sql
-- =====================================================================
-- SOMOS Recurso 06: Atualização cadastral pelo aplicativo (Meu Cadastro)
-- Reaproveita a ficha (`people`), o histórico (`person_log`/linha do tempo), as notificações (`notify_user`), as permissões (`people_approve`)
-- e os responsáveis legais (`person_guardians`). Nada é recriado.
--  * Política por campo (direto / precisa de aprovação / bloqueado), configurável pelo administrador.
--  * Campo direto: grava na hora e registra no histórico. Campo com aprovação: vira solicitação; a ficha só muda quando aprovada, campo a campo.
--  * Conflito: se o dado oficial mudou enquanto a solicitação esperava, a aprovação exige decisão explícita.
--  * Solicitações analisadas nunca são apagadas (só somem junto com a pessoa, por LGPD).
-- =====================================================================

create table if not exists public.person_field_policy (
  org_id uuid not null references public.organizations(id) on delete cascade,
  field text not null,
  mode text not null check (mode in ('direct','approval','locked')),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (org_id, field)
);
create table if not exists public.person_field_policy_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  field text not null, old_mode text, new_mode text not null,
  actor uuid references auth.users(id) on delete set null,
  at timestamptz not null default now()
);
alter table public.person_field_policy_log enable row level security;
revoke all on public.person_field_policy_log from anon, authenticated;
create table if not exists public.person_update_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  on_behalf boolean not null default false,
  status text not null check (status in ('draft','pending','in_review','approved','partial','refused','cancelled')),
  draft jsonb,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  started_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz
);
create unique index if not exists person_update_draft on public.person_update_requests (person_id) where status = 'draft';
create index if not exists person_update_status on public.person_update_requests (org_id, status, submitted_at desc);
create table if not exists public.person_update_items (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.person_update_requests(id) on delete cascade,
  field text not null,
  old_value text,
  new_value text,
  decision text not null default 'pending' check (decision in ('pending','approved','refused')),
  reason text,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  conflict_overridden boolean not null default false
);
create index if not exists person_update_items_req on public.person_update_items (request_id);
alter table public.person_field_policy enable row level security;
alter table public.person_update_requests enable row level security;
alter table public.person_update_items enable row level security;
revoke all on public.person_field_policy, public.person_update_requests, public.person_update_items from anon, authenticated;

-- histórico: aprovação e recusa de alterações cadastrais
create or replace function public.history_describe(p_kind text, p_field text, p_old text, p_new text, p_note text,
                                                   out category text, out title text, out description text, out restricted boolean)
language plpgsql immutable as $$
declare v_name text := split_part(coalesce(p_note, ''), ' · ', 1);
begin
  restricted := false; category := 'outros'; title := initcap(replace(coalesce(p_kind, 'evento'), '_', ' ')); description := nullif(p_note, '');
  if p_kind = 'create' then
    category := 'cadastro'; title := case p_new when 'visitor' then 'Cadastro inicial como visitante' else 'Ficha individual criada' end;
    description := trim(both ' ' from coalesce('Classificação: ' || public.history_class_label(p_new), '') || case when p_note is not null then ' · ' || p_note else '' end);
  elsif p_kind = 'classification' then
    category := 'cadastro';
    title := case when p_old is null or p_old = 'none' then 'Classificada como ' || public.history_class_label(p_new) else 'Passou de ' || public.history_class_label(p_old) || ' a ' || public.history_class_label(p_new) end;
    description := public.history_class_label(p_old) || ' → ' || public.history_class_label(p_new);
  elsif p_kind = 'field' and p_field = 'status' then
    category := 'cadastro';
    title := case when p_new = 'inactive' then 'Cadastro inativado' when p_old = 'inactive' and p_new = 'active' then 'Cadastro reativado' else 'Situação do cadastro alterada' end;
    description := null;
  elsif p_kind = 'field' and p_field = 'baptized' then
    category := 'batismo'; title := case when p_new = 'true' then 'Batismo registrado' else 'Batismo desmarcado' end; description := null;
  elsif p_kind = 'field' and p_field = 'baptism_date' then
    category := 'batismo'; title := 'Data do batismo registrada'; description := p_new;
  elsif p_kind in ('field', 'self_update') then
    category := 'pessoais'; title := case when p_kind = 'self_update' then 'Dado atualizado pela própria pessoa' else 'Dado pessoal atualizado' end; description := public.history_field_label(p_field);
  elsif p_kind = 'team_join' then
    category := 'ministerio'; title := 'Entrou em ' || coalesce(nullif(v_name, ''), 'um time'); description := case when p_note like '%entrou como líder%' then 'Entrou já como líder' end;
  elsif p_kind = 'team_leave' then
    category := 'ministerio'; title := 'Saiu de ' || coalesce(nullif(v_name, ''), 'um time'); description := null;
  elsif p_kind = 'team_role' then
    category := 'ministerio'; title := case when p_note like '%passou a líder%' then 'Nomeado(a) líder de ' else 'Deixou a liderança de ' end || coalesce(nullif(v_name, ''), 'um time'); description := null;
  elsif p_kind = 'visit' then category := 'acolhimento'; title := 'Visita registrada'; description := nullif(p_note, '');
  elsif p_kind = 'consent' then category := 'acolhimento'; title := case when p_new = 'true' then 'Contato autorizado' else 'Autorização de contato retirada' end; description := null;
  elsif p_kind = 'journey' then
    category := 'acolhimento'; title := 'Acolhimento: ' || case p_field when 'interest' then 'interesse em continuar' when 'request' then 'pedido registrado' when 'family' then 'conversa sobre família' when 'approach' then 'abordagem' when 'integration' then 'integração' when 'contact' then 'contato' else 'registro' end; description := null;
  elsif p_kind = 'family' then
    category := 'familia'; restricted := true;
    title := case when p_old is null then 'Vínculo familiar incluído' when p_new is null then 'Vínculo familiar encerrado' else 'Parentesco alterado' end;
    description := trim(both ' ' from coalesce(coalesce(p_new, p_old), '') || case when p_note is not null then ' · ' || p_note else '' end);
  elsif p_kind = 'guardian' then
    category := 'familia'; restricted := true;
    title := case when p_old is null then 'Responsável legal incluído' when p_new is null then 'Responsável legal removido' else 'Responsável legal alterado' end;
    description := trim(both ' ' from coalesce(coalesce(p_new, p_old), '') || case when p_note is not null then ' · ' || p_note else '' end);
  elsif p_kind = 'update_approved' then
    category := 'pessoais'; title := 'Alteração cadastral aprovada: ' || public.history_field_label(p_field);
    description := case when p_field = 'cpf' then nullif(p_note, '') else trim(both ' ' from coalesce(coalesce(p_old, '—') || ' → ' || coalesce(p_new, '—'), '') || case when p_note is not null then ' · ' || p_note else '' end) end;
  elsif p_kind = 'update_refused' then
    category := 'pessoais'; title := 'Alteração cadastral recusada: ' || public.history_field_label(p_field); description := nullif(p_note, '');
  elsif p_kind = 'approve' then category := 'cadastro'; title := 'Cadastro aprovado'; description := null;
  elsif p_kind = 'reject' then category := 'cadastro'; title := 'Cadastro rejeitado'; description := nullif(p_note, '');
  elsif p_kind = 'link' then category := 'cadastro'; title := 'Conta do aplicativo vinculada ao cadastro'; description := null;
  end if;
end $$;

create or replace function public.self_fields() returns text[] language sql immutable as $$
  select array['full_name','social_name','birth_date','sex','marital_status','cpf','phone','phone2','whatsapp','email','zip','address','address_number','address_complement','neighborhood','city','state','country','photo_url']
$$;
-- política por campo: o que a igreja configurou; sem configuração, contatos e nome social são diretos e o restante precisa de aprovação
create or replace function public.field_mode(p_org uuid, p_field text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select mode from person_field_policy where org_id = p_org and field = p_field),
    case when p_field = any (array['social_name','phone','phone2','whatsapp','email','photo_url']) then 'direct'
         when p_field = any (public.self_fields()) then 'approval' else 'locked' end)
$$;
-- quem pode mexer no cadastro: a própria pessoa, ou o responsável legal registrado
create or replace function public.self_role(p_person uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from people where id = p_person and user_id = auth.uid()) then 'self'
    when exists (select 1 from person_guardians g join people gp on gp.id = g.guardian_id where g.ward_id = p_person and gp.user_id = auth.uid()) then 'guardian' end
$$;
create or replace function public.person_apply_fields(p_person uuid, c jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  update people set
    full_name = coalesce(c->>'full_name', full_name),
    social_name = case when c ? 'social_name' then c->>'social_name' else social_name end,
    birth_date = case when c ? 'birth_date' then nullif(c->>'birth_date', '')::date else birth_date end,
    sex = case when c ? 'sex' then c->>'sex' else sex end,
    cpf = case when c ? 'cpf' then c->>'cpf' else cpf end,
    marital_status = case when c ? 'marital_status' then c->>'marital_status' else marital_status end,
    phone = case when c ? 'phone' then c->>'phone' else phone end,
    phone2 = case when c ? 'phone2' then c->>'phone2' else phone2 end,
    whatsapp = case when c ? 'whatsapp' then c->>'whatsapp' else whatsapp end,
    email = case when c ? 'email' then c->>'email' else email end,
    zip = case when c ? 'zip' then c->>'zip' else zip end,
    address = case when c ? 'address' then c->>'address' else address end,
    address_number = case when c ? 'address_number' then c->>'address_number' else address_number end,
    address_complement = case when c ? 'address_complement' then c->>'address_complement' else address_complement end,
    neighborhood = case when c ? 'neighborhood' then c->>'neighborhood' else neighborhood end,
    city = case when c ? 'city' then c->>'city' else city end,
    state = case when c ? 'state' then c->>'state' else state end,
    country = case when c ? 'country' then c->>'country' else country end,
    photo_url = case when c ? 'photo_url' then c->>'photo_url' else photo_url end,
    updated_at = now()
  where id = p_person;
end $$;
create or replace function public.registration_notify_reviewers(p_org uuid, p_title text, p_body text, p_except uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select user_id from org_members where org_id = p_org and role = 'admin'
           union select user_id from access_grants where org_id = p_org and 'people_approve' = any (actions) loop
    if u is distinct from p_except then perform public.notify_user(u, p_org, 'registration', p_title, p_body, '#/atualizacoes-cadastrais', null); end if;
  end loop;
end $$;
revoke execute on function public.self_fields(), public.field_mode(uuid, text), public.self_role(uuid), public.person_apply_fields(uuid, jsonb), public.registration_notify_reviewers(uuid, text, text, uuid) from public, anon, authenticated;

-- envio: campos diretos gravam; campos com aprovação viram solicitação; p_send=false guarda rascunho
create or replace function public.registration_submit(p_person uuid, p jsonb, p_send boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people; v_role text; c jsonb; err text; k text; ov text; nv text; v_mode text; v_direct jsonb := '{}'::jsonb; v_appr jsonb := '{}'::jsonb;
        v_req uuid; v_applied text[] := '{}'; v_pending text[] := '{}'; v_who text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into pe from people where id = p_person for update;
  if pe.id is null then raise exception 'not_found'; end if;
  v_role := public.self_role(p_person);
  if v_role is null then raise exception 'forbidden'; end if;
  if exists (select 1 from jsonb_object_keys(coalesce(p, '{}'::jsonb)) x where x <> all (public.self_fields())) then raise exception 'field_locked'; end if;
  c := public.person_clean(coalesce(p, '{}'::jsonb));
  err := public.person_check(c, false);
  if err is not null then raise exception '%', err; end if;
  if (c->>'cpf') is not null and exists (select 1 from people where org_id = pe.org_id and cpf = c->>'cpf' and id <> pe.id) then raise exception 'duplicate_cpf'; end if;
  for k in select jsonb_object_keys(c) loop
    ov := to_jsonb(pe) ->> k; nv := c ->> k;
    if ov is not distinct from nv then continue; end if;
    v_mode := public.field_mode(pe.org_id, k);
    if v_mode = 'locked' then raise exception 'field_locked'; end if;
    if v_mode = 'direct' then v_direct := v_direct || jsonb_build_object(k, nv); else v_appr := v_appr || jsonb_build_object(k, nv); end if;
  end loop;
  if not p_send then
    delete from person_update_requests where person_id = pe.id and status = 'draft';
    insert into person_update_requests (org_id, person_id, requested_by, on_behalf, status, draft) values (pe.org_id, pe.id, auth.uid(), v_role = 'guardian', 'draft', v_direct || v_appr) returning id into v_req;
    return jsonb_build_object('draft', v_req);
  end if;
  delete from person_update_requests where person_id = pe.id and status = 'draft';
  if v_appr <> '{}'::jsonb and exists (select 1 from person_update_items i join person_update_requests r on r.id = i.request_id
        where r.person_id = pe.id and r.status in ('pending','in_review') and i.decision = 'pending' and i.field in (select jsonb_object_keys(v_appr))) then raise exception 'already_pending'; end if;
  if v_direct <> '{}'::jsonb then
    perform public.person_apply_fields(pe.id, v_direct);
    for k in select jsonb_object_keys(v_direct) loop
      perform public.person_log(pe.org_id, pe.id, 'self_update', k, to_jsonb(pe) ->> k, v_direct ->> k, case when v_role = 'guardian' then 'feito pelo responsável legal' end);
      v_applied := v_applied || k;
    end loop;
  end if;
  if v_appr <> '{}'::jsonb then
    insert into person_update_requests (org_id, person_id, requested_by, on_behalf, status, submitted_at) values (pe.org_id, pe.id, auth.uid(), v_role = 'guardian', 'pending', now()) returning id into v_req;
    for k in select jsonb_object_keys(v_appr) loop
      insert into person_update_items (request_id, field, old_value, new_value) values (v_req, k, to_jsonb(pe) ->> k, v_appr ->> k);
      v_pending := v_pending || k;
    end loop;
    perform public.notify_user(auth.uid(), pe.org_id, 'registration', 'Solicitação recebida', 'Sua alteração de cadastro foi enviada para análise. Acompanhe em Meu Cadastro.', '#/meu-cadastro', jsonb_build_object('request_id', v_req));
    v_who := coalesce(pe.social_name, pe.full_name);
    perform public.registration_notify_reviewers(pe.org_id, 'Atualização cadastral para analisar', v_who || ' enviou uma solicitação de atualização de dados.', auth.uid());
  end if;
  return jsonb_build_object('applied', to_jsonb(v_applied), 'pending', to_jsonb(v_pending), 'request_id', v_req);
end $$;

-- "meus dados" antigo: se a pessoa ainda não tem ficha, cria; se já tem, segue a política por campo
create or replace function public.my_person_update(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; err text; old people; k text; ov text; nv text; v_id uuid; v_name text; v_email text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  -- só campos pessoais: nunca classificação, situação, observações, data de ingresso ou funções
  c := public.person_clean(p - 'classification' - 'status' - 'admin_notes' - 'joined_at' - 'registered_at' - 'user_id');
  err := public.person_check(c, false);
  if err is not null then raise exception '%', err; end if;
  select * into old from people where org_id = p_org and user_id = auth.uid() for update;
  if old.id is null then
    v_name := coalesce(c->>'full_name', (select full_name from profiles where id = auth.uid()), 'Sem nome');
    select email into v_email from auth.users where id = auth.uid();
    if (c->>'cpf') is not null and exists (select 1 from people where org_id = p_org and cpf = c->>'cpf') then raise exception 'duplicate_cpf'; end if;
    insert into people (org_id, user_id, full_name, social_name, birth_date, sex, cpf, marital_status, phone, whatsapp, email, address, address_number, address_complement, neighborhood, country, phone2, city, state, zip, photo_url, classification, source, created_by)
    values (p_org, auth.uid(), v_name, c->>'social_name', nullif(c->>'birth_date', '')::date, c->>'sex', c->>'cpf', c->>'marital_status', c->>'phone', c->>'whatsapp',
            coalesce(c->>'email', lower(v_email)), c->>'address', c->>'address_number', c->>'address_complement', c->>'neighborhood', c->>'country', c->>'phone2', c->>'city', c->>'state', c->>'zip', c->>'photo_url', 'visitor', 'self', auth.uid())
    returning id into v_id;
    perform public.person_log(p_org, v_id, 'create', null, null, 'visitor', 'cadastro feito pela própria pessoa');
    return jsonb_build_object('id', v_id);
  end if;
  return public.registration_submit(old.id, c, true);
end $$;

-- leitura do autoatendimento: só campos permitidos (nada de notas internas, pastoral ou histórico restrito)
create or replace function public.my_registration(p_org uuid, p_person uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people; v_id uuid := p_person; v_role text;
begin
  if auth.uid() is null or not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  if v_id is null then select id into v_id from people where org_id = p_org and user_id = auth.uid(); end if;
  if v_id is null then
    return jsonb_build_object('person', null, 'dependents', public.my_dependents(p_org));
  end if;
  select * into pe from people where id = v_id and org_id = p_org;
  v_role := public.self_role(v_id);
  if pe.id is null or v_role is null then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'role', v_role,
    'person', (select jsonb_object_agg(k, to_jsonb(pe) -> k) from unnest(public.self_fields()) k) || jsonb_build_object('id', pe.id),
    'policy', (select jsonb_object_agg(k, public.field_mode(p_org, k)) from unnest(public.self_fields()) k),
    'draft', (select draft from person_update_requests where person_id = pe.id and status = 'draft'),
    'pending_fields', coalesce((select jsonb_agg(distinct i.field) from person_update_items i join person_update_requests r on r.id = i.request_id where r.person_id = pe.id and r.status in ('pending','in_review') and i.decision = 'pending'), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'submitted_at', r.submitted_at, 'reviewed_at', r.reviewed_at, 'on_behalf', r.on_behalf,
        'by', coalesce(public.welcome_name(r.org_id, r.requested_by), '—'),
        'items', (select jsonb_agg(jsonb_build_object('field', i.field, 'label', public.history_field_label(i.field), 'old', case when i.field = 'cpf' then null else i.old_value end, 'new', case when i.field = 'cpf' then null else i.new_value end, 'decision', i.decision, 'reason', i.reason) order by i.id) from person_update_items i where i.request_id = r.id))
        order by r.submitted_at desc) from (select * from person_update_requests where person_id = pe.id and status <> 'draft' order by submitted_at desc limit 20) r), '[]'::jsonb),
    'family', coalesce((select jsonb_agg(jsonb_build_object('name', o.full_name, 'photo_url', o.photo_url, 'label', public.relation_label(x.rel)) order by o.full_name)
      from (select r.relative_id as rid, r.relation as rel from person_relations r where r.person_id = pe.id
            union all select r.person_id, case t.inverse when 'parent' then case q.sex when 'M' then 'father' when 'F' then 'mother' else 'parent' end else t.inverse end
              from person_relations r join relation_types t on t.key = r.relation join people q on q.id = r.person_id where r.relative_id = pe.id) x
      join people o on o.id = x.rid where not public.person_is_minor(o.birth_date) or v_role = 'self'), '[]'::jsonb),
    'dependents', public.my_dependents(p_org));
end $$;
create or replace function public.my_dependents(p_org uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.full_name, 'photo_url', w.photo_url) order by w.full_name), '[]'::jsonb)
  from person_guardians g join people gp on gp.id = g.guardian_id and gp.user_id = auth.uid() join people w on w.id = g.ward_id where g.org_id = p_org
$$;

create or replace function public.registration_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r person_update_requests;
begin
  select * into r from person_update_requests where id = p_id for update;
  if r.id is null or public.self_role(r.person_id) is null then raise exception 'not_found'; end if;
  if r.status not in ('draft','pending') or exists (select 1 from person_update_items where request_id = r.id and decision <> 'pending') then raise exception 'cannot_cancel'; end if;
  if r.status = 'draft' then delete from person_update_requests where id = r.id; return; end if;   -- rascunho nunca foi enviado: não há o que auditar
  update person_update_requests set status = 'cancelled', reviewed_at = now(), reviewed_by = auth.uid() where id = r.id;
end $$;

-- ---------------------------------------------------------------- painel dos responsáveis
create or replace function public.registration_requests(p_org uuid, p_status text default null, p_person uuid default null, p_from date default null, p_to date default null,
                                                        p_reviewer uuid default null, p_limit int default 20, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_lim int := least(greatest(coalesce(p_limit, 20), 1), 50); v_res jsonb; v_more boolean;
begin
  if not public.has_people_perm(p_org, 'people_approve') then raise exception 'forbidden'; end if;
  if p_status is not null and p_status not in ('pending','in_review','approved','partial','refused','cancelled') then raise exception 'invalid_filter'; end if;
  select coalesce(jsonb_agg(x.j order by x.rn) filter (where x.rn <= v_lim), '[]'::jsonb), coalesce(bool_or(x.rn > v_lim), false) into v_res, v_more
  from (
    select q.rn, jsonb_build_object('id', r.id, 'status', r.status, 'submitted_at', r.submitted_at, 'started_at', r.started_at, 'reviewed_at', r.reviewed_at, 'on_behalf', r.on_behalf,
      'person', jsonb_build_object('id', pe.id, 'name', pe.full_name, 'photo_url', pe.photo_url), 'requested_by', coalesce(public.welcome_name(r.org_id, r.requested_by), '—'),
      'reviewer', case when r.reviewed_by is null then null else coalesce(public.welcome_name(r.org_id, r.reviewed_by), '—') end,
      'items', (select jsonb_agg(jsonb_build_object('id', i.id, 'field', i.field, 'label', public.history_field_label(i.field), 'old', i.old_value, 'new', i.new_value, 'decision', i.decision, 'reason', i.reason,
                   'decided_by', case when i.decided_by is null then null else coalesce(public.welcome_name(r.org_id, i.decided_by), '—') end, 'decided_at', i.decided_at, 'overridden', i.conflict_overridden,
                   'current', to_jsonb(pe) ->> i.field, 'conflict', i.decision = 'pending' and (to_jsonb(pe) ->> i.field) is distinct from i.old_value) order by i.id) from person_update_items i where i.request_id = r.id)) as j
    from (select r2.*, row_number() over (order by r2.submitted_at desc, r2.id) as rn
            from (select * from person_update_requests where org_id = p_org and status <> 'draft'
                    and (p_status is null or status = p_status) and (p_person is null or person_id = p_person)
                    and (p_from is null or submitted_at >= p_from::timestamptz) and (p_to is null or submitted_at < (p_to + 1)::timestamptz)
                    and (p_reviewer is null or reviewed_by = p_reviewer)
                    order by submitted_at desc, id offset greatest(coalesce(p_offset, 0), 0) limit v_lim + 1) r2) q
         join person_update_requests r on r.id = q.id join people pe on pe.id = r.person_id
  ) x;
  return jsonb_build_object('items', v_res, 'has_more', v_more,
    'counts', (select jsonb_object_agg(status, n) from (select status, count(*) n from person_update_requests where org_id = p_org and status <> 'draft' group by status) s));
end $$;
create or replace function public.registration_pending_count(p_org uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when public.has_people_perm(p_org, 'people_approve') then (select count(*)::int from person_update_requests where org_id = p_org and status in ('pending','in_review')) else 0 end
$$;
create or replace function public.registration_start(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r person_update_requests;
begin
  select * into r from person_update_requests where id = p_id for update;
  if r.id is null then raise exception 'not_found'; end if;
  if not public.has_people_perm(r.org_id, 'people_approve') then raise exception 'forbidden'; end if;
  if r.status <> 'pending' then return; end if;
  update person_update_requests set status = 'in_review', started_by = auth.uid(), started_at = now() where id = r.id;
  if r.requested_by is not null then perform public.notify_user(r.requested_by, r.org_id, 'registration', 'Solicitação em análise', 'Sua solicitação de atualização cadastral começou a ser analisada.', '#/meu-cadastro', jsonb_build_object('request_id', r.id)); end if;
end $$;

create or replace function public.registration_decide(p_id uuid, p_decisions jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r person_update_requests; pe people; d jsonb; it person_update_items; v_conf bigint[] := '{}'; v_apply jsonb := '{}'::jsonb; v_reason text; v_force boolean;
        n_pend int; n_app int; n_ref int; v_status text; v_req_name text; v_me text; v_title text; v_body text; v_cur text;
begin
  select * into r from person_update_requests where id = p_id for update;
  if r.id is null then raise exception 'not_found'; end if;
  if not public.has_people_perm(r.org_id, 'people_approve') then raise exception 'forbidden'; end if;
  if r.status not in ('pending','in_review') then raise exception 'already_decided'; end if;
  if r.requested_by = auth.uid() and not exists (select 1 from org_members where org_id = r.org_id and user_id = auth.uid() and role = 'admin') then raise exception 'self_approval'; end if;
  select * into pe from people where id = r.person_id for update;
  if jsonb_typeof(p_decisions) <> 'array' or jsonb_array_length(p_decisions) = 0 then raise exception 'invalid_decision'; end if;
  -- 1ª passada: valida tudo e procura conflitos, sem gravar nada
  for d in select * from jsonb_array_elements(p_decisions) loop
    select * into it from person_update_items where id = (d->>'item_id')::bigint and request_id = r.id and decision = 'pending';
    if it.id is null then raise exception 'not_found'; end if;
    if d->>'decision' = 'refuse' then
      if char_length(trim(coalesce(d->>'reason', ''))) < 3 or char_length(trim(d->>'reason')) > 500 then raise exception 'reason_required'; end if;
    elsif d->>'decision' = 'approve' then
      v_cur := to_jsonb(pe) ->> it.field;
      if v_cur is distinct from it.old_value and not coalesce((d->>'force')::boolean, false) then v_conf := v_conf || it.id; end if;
      if it.field = 'cpf' and it.new_value is not null and exists (select 1 from people where org_id = r.org_id and cpf = it.new_value and id <> pe.id) then raise exception 'duplicate_cpf'; end if;
    else raise exception 'invalid_decision'; end if;
  end loop;
  if array_length(v_conf, 1) > 0 then return jsonb_build_object('ok', false, 'conflicts', to_jsonb(v_conf)); end if;
  v_req_name := coalesce(public.welcome_name(r.org_id, r.requested_by), 'a própria pessoa');
  v_me := coalesce(public.welcome_name(r.org_id, auth.uid()), 'responsável');
  -- 2ª passada: aplica
  for d in select * from jsonb_array_elements(p_decisions) loop
    select * into it from person_update_items where id = (d->>'item_id')::bigint;
    v_force := coalesce((d->>'force')::boolean, false);
    if d->>'decision' = 'approve' then
      v_cur := to_jsonb(pe) ->> it.field;
      v_apply := v_apply || jsonb_build_object(it.field, it.new_value);
      update person_update_items set decision = 'approved', decided_by = auth.uid(), decided_at = now(), conflict_overridden = (v_cur is distinct from it.old_value and v_force) where id = it.id;
      perform public.person_log(r.org_id, pe.id, 'update_approved', it.field, v_cur, it.new_value, 'Solicitado por ' || v_req_name || ' · aprovado por ' || v_me, null, null,
                                jsonb_build_object('request_id', r.id, 'requested_by', r.requested_by, 'approved_by', auth.uid()));
    else
      v_reason := trim(d->>'reason');
      update person_update_items set decision = 'refused', reason = v_reason, decided_by = auth.uid(), decided_at = now() where id = it.id;
      perform public.person_log(r.org_id, pe.id, 'update_refused', it.field, null, null, 'Recusado por ' || v_me || ': ' || v_reason, null, null,
                                jsonb_build_object('request_id', r.id, 'requested_by', r.requested_by, 'refused_by', auth.uid()));
    end if;
  end loop;
  if v_apply <> '{}'::jsonb then perform public.person_apply_fields(pe.id, v_apply); end if;
  select count(*) filter (where decision = 'pending'), count(*) filter (where decision = 'approved'), count(*) filter (where decision = 'refused') into n_pend, n_app, n_ref from person_update_items where request_id = r.id;
  if n_pend > 0 then
    update person_update_requests set status = 'in_review', started_by = coalesce(started_by, auth.uid()), started_at = coalesce(started_at, now()) where id = r.id;
    return jsonb_build_object('ok', true, 'status', 'in_review');
  end if;
  v_status := case when n_ref = 0 then 'approved' when n_app = 0 then 'refused' else 'partial' end;
  update person_update_requests set status = v_status, reviewed_by = auth.uid(), reviewed_at = now(), started_by = coalesce(started_by, auth.uid()), started_at = coalesce(started_at, now()) where id = r.id;
  v_title := case v_status when 'approved' then 'Alteração aprovada' when 'refused' then 'Alteração recusada' else 'Alteração parcialmente aprovada' end;
  v_body := case v_status when 'approved' then 'Os dados que você pediu para atualizar foram aprovados.' when 'refused' then 'Sua solicitação foi recusada. Veja o motivo em Meu Cadastro.' else 'Parte da sua solicitação foi aprovada e parte recusada. Veja os detalhes em Meu Cadastro.' end;
  if r.requested_by is not null then perform public.notify_user(r.requested_by, r.org_id, 'registration', v_title, v_body, '#/meu-cadastro', jsonb_build_object('request_id', r.id, 'status', v_status)); end if;
  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

-- regras por campo (administrador da igreja)
create or replace function public.registration_policy_list(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin') then raise exception 'forbidden'; end if;
  return (select jsonb_agg(jsonb_build_object('field', k, 'label', public.history_field_label(k), 'mode', public.field_mode(p_org, k)) order by ord) from unnest(public.self_fields()) with ordinality t(k, ord));
end $$;
create or replace function public.registration_policy_save(p_org uuid, p_field text, p_mode text) returns void
language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin') then raise exception 'forbidden'; end if;
  if not (p_field = any (public.self_fields())) then raise exception 'invalid_field'; end if;
  if p_mode not in ('direct','approval','locked') then raise exception 'invalid_mode'; end if;
  v_old := public.field_mode(p_org, p_field);
  insert into person_field_policy (org_id, field, mode, updated_by) values (p_org, p_field, p_mode, auth.uid())
  on conflict (org_id, field) do update set mode = excluded.mode, updated_by = auth.uid(), updated_at = now();
  insert into person_field_policy_log (org_id, field, old_mode, new_mode, actor) values (p_org, p_field, v_old, p_mode, auth.uid());
end $$;

revoke execute on function public.registration_submit(uuid, jsonb, boolean), public.my_registration(uuid, uuid), public.my_dependents(uuid), public.registration_cancel(uuid),
  public.registration_requests(uuid, text, uuid, date, date, uuid, int, int), public.registration_pending_count(uuid), public.registration_start(uuid), public.registration_decide(uuid, jsonb),
  public.registration_policy_list(uuid), public.registration_policy_save(uuid, text, text) from public, anon;
grant execute on function public.registration_submit(uuid, jsonb, boolean), public.my_registration(uuid, uuid), public.my_dependents(uuid), public.registration_cancel(uuid),
  public.registration_requests(uuid, text, uuid, date, date, uuid, int, int), public.registration_pending_count(uuid), public.registration_start(uuid), public.registration_decide(uuid, jsonb),
  public.registration_policy_list(uuid), public.registration_policy_save(uuid, text, text) to authenticated;

-- verificação:
--   select to_regclass('public.person_update_requests') is not null as solicitacoes, to_regclass('public.person_field_policy') is not null as regras,
--          to_regprocedure('public.registration_decide(uuid,jsonb)') is not null as aprovacao, to_regprocedure('public.my_registration(uuid,uuid)') is not null as meu_cadastro;
-- REVERSÃO: drop table public.person_update_items, public.person_update_requests, public.person_field_policy;
--           (my_person_update e history_describe voltam às versões de 20261127000001 e 20261128000001)

-- >>> supabase/migrations/20261130000001_novos_convertidos.sql
-- =====================================================================
-- SOMOS Recurso 07: Gestão de Novos Convertidos
-- A decisão de fé é um ACONTECIMENTO na trajetória da pessoa, não uma classificação:
--  * nunca altera a classificação (visitante/frequentador/membro), nunca cria vínculo com time/célula/ministério e nunca cria conta de acesso;
--  * a decisão pode existir antes de a pessoa ter ficha ("aguardando associação"); a associação é sempre uma escolha explícita (nunca automática por nome parecido);
--  * o acontecimento entra no histórico da pessoa como registro RESTRITO (crença religiosa é dado sensível): só quem tem permissão de ver convertidos o enxerga;
--  * telefone/e-mail são opcionais e só podem ser usados com autorização explícita ("não informado" nunca é consentimento);
--  * acompanhamento é flexível (sem etapas, prazos, metas ou alertas de ausência), pode ser encerrado/suspenso e a decisão permanece;
--  * exclusão só com permissão administrativa e justificativa; tudo fica no registro de auditoria. Permissões conferidas no banco.
-- =====================================================================

-- ---------------------------------------------------------------- permissões novas
alter table public.access_grants drop constraint if exists access_grants_actions_check;
alter table public.access_grants add constraint access_grants_actions_check check (
  actions <@ array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
                   'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin']::text[]);
create or replace function public.all_actions() returns text[] language sql immutable as $$
  select array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
               'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin']::text[]
$$;
create or replace function public.people_actions(p_org uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
      then array['people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
                 'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin']
    else coalesce((select array_agg(distinct a) from access_grants g, unnest(g.actions) a
                   where g.org_id = p_org and g.user_id = auth.uid() and a like 'people\_%'), '{}'::text[]) end
$$;
create or replace function public.conv_can(p_org uuid, p_mode text) returns boolean
language sql stable security definer set search_path = public as $$
  select ('people_converts_' || p_mode) = any (public.people_actions(p_org))
$$;
-- quem tem determinada permissão de convertidos (administradores + concedidas); usado para avisos e para escolher responsável
create or replace function public.conv_users(p_org uuid, p_mode text) returns setof uuid
language sql stable security definer set search_path = public as $$
  select om.user_id from org_members om where om.org_id = p_org and om.role = 'admin'
  union
  select g.user_id from access_grants g where g.org_id = p_org and ('people_converts_' || p_mode) = any (g.actions)
$$;
create or replace function public.conv_origin_label(p text) returns text language sql immutable as $$
  select case p when 'culto' then 'Culto' when 'celula' then 'Célula' when 'evento' then 'Evento' when 'transmissao' then 'Transmissão ao vivo'
                when 'evangelismo' then 'Evangelismo' when 'acao_externa' then 'Ação externa' when 'atendimento' then 'Atendimento pessoal' else 'Outro' end
$$;
revoke execute on function public.conv_can(uuid, text), public.conv_users(uuid, text), public.conv_origin_label(text) from public, anon;
grant execute on function public.conv_can(uuid, text) to authenticated;

-- ---------------------------------------------------------------- tabelas
create table if not exists public.faith_decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid references public.people(id) on delete set null,       -- nulo = aguardando associação
  display_name text not null check (length(trim(display_name)) between 1 and 160),
  decided_on date not null check (decided_on >= date '2000-01-01'),
  decided_time time,
  place text check (place is null or length(place) <= 120),
  origin text not null check (origin in ('culto','celula','evento','transmissao','evangelismo','acao_externa','atendimento','outro')),
  source text not null default 'admin' check (source in ('admin','app','public_form')),
  phone text check (phone is null or length(phone) <= 30),
  email text check (email is null or (length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  contact_consent text not null default 'unknown' check (contact_consent in ('authorized','declined','unknown')),
  consent_at timestamptz,
  admin_note text check (admin_note is null or length(admin_note) <= 500),
  wants_followup boolean,
  fu_status text not null default 'registered' check (fu_status in ('registered','offered','in_progress','suspended','ended','declined')),
  responsible_id uuid references auth.users(id) on delete set null,
  assigned_at timestamptz,
  assigned_by uuid references auth.users(id) on delete set null,
  registered_by uuid references auth.users(id) on delete set null,
  self_user uuid references auth.users(id) on delete set null,
  op_key text,
  linked_at timestamptz,
  linked_by uuid references auth.users(id) on delete set null,
  edited_at timestamptz,
  edited_by uuid references auth.users(id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  void_reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists faith_decisions_opkey on public.faith_decisions (org_id, op_key) where op_key is not null;
create index if not exists faith_decisions_org on public.faith_decisions (org_id, decided_on desc) where voided_at is null;
create index if not exists faith_decisions_person on public.faith_decisions (person_id) where person_id is not null;

create table if not exists public.faith_followup_entries (
  id bigint generated always as identity primary key,
  decision_id uuid not null references public.faith_decisions(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('contact','note','interest','referral')),
  occurred_on date not null,
  channel text check (channel is null or channel in ('whatsapp','phone','email','presencial','outro')),
  body text not null check (length(trim(body)) between 1 and 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists faith_entries_decision on public.faith_followup_entries (decision_id, occurred_on desc);

create table if not exists public.faith_decision_log (
  id bigint generated always as identity primary key,
  decision_id uuid not null,                       -- sem FK: a auditoria sobrevive
  org_id uuid not null,
  actor uuid references auth.users(id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists faith_log_decision on public.faith_decision_log (decision_id, at desc);

create table if not exists public.convert_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  form_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  form_active boolean not null default false,
  form_title text not null default 'Decidi seguir a Jesus' check (length(trim(form_title)) between 1 and 120),
  highlight_days int check (highlight_days is null or highlight_days between 1 and 365),
  updated_at timestamptz not null default now()
);

alter table public.faith_decisions enable row level security;
alter table public.faith_followup_entries enable row level security;
alter table public.faith_decision_log enable row level security;
alter table public.convert_settings enable row level security;
revoke all on public.faith_decisions, public.faith_followup_entries, public.faith_decision_log, public.convert_settings from anon, authenticated;

insert into public.history_categories (org_id, key, label, manual, sort) values (null, 'decisao', 'Decisão de fé', false, 45)
  on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), key) do nothing;

-- ---------------------------------------------------------------- linha do tempo: decisão de fé só para quem vê convertidos
create or replace function public.person_timeline(p_person uuid, p_categories text[] default null, p_origin text default null,
                                                  p_from date default null, p_to date default null, p_by uuid default null,
                                                  p_limit int default 30, p_offset int default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people; v_full boolean; v_sup boolean; v_detail boolean; v_lim int := least(greatest(coalesce(p_limit, 30), 1), 100); v_res jsonb; v_more boolean;
begin
  select * into pe from people where id = p_person;
  if pe.id is null then raise exception 'not_found'; end if;
  v_full := public.people_scope_all(pe.org_id) and public.has_people_perm(pe.org_id, 'people_view');
  v_sup  := not v_full and public.people_supervised(pe.org_id, pe.user_id) and not public.person_is_minor(pe.birth_date);
  if not (v_full or v_sup) then raise exception 'forbidden'; end if;
  v_detail := v_full and public.has_people_perm(pe.org_id, 'people_edit');
  if p_origin is not null and p_origin not in ('auto', 'manual') then raise exception 'invalid_filter'; end if;

  with base as (
    select h.*, case when h.kind in ('field', 'self_update') and h.category = 'pessoais' and h.op_id is not null then 'g:' || h.op_id || ':' || h.kind || ':' || coalesce(h.actor::text, '') else 'r:' || h.id end as gk
      from person_history h
     where h.person_id = p_person and h.voided_at is null
       and (v_full or not h.restricted)
       and (h.kind <> 'decision' or public.conv_can(pe.org_id, 'view'))
       and (p_categories is null or h.category = any (p_categories))
       and (p_origin is null or h.origin = p_origin)
       and (p_from is null or h.occurred_on >= p_from) and (p_to is null or h.occurred_on <= p_to)
       and (p_by is null or h.actor = p_by)
  ), grp as (
    select gk, max(id) as id, max(occurred_on) as occurred_on, max(at) as at, count(*) as n,
           (array_agg(id order by id))[1] as first_id
      from base group by gk
  ), page as (
    select q.*, row_number() over (order by q.occurred_on desc, q.at desc, q.id desc) as rn
      from (select g.* from grp g order by g.occurred_on desc, g.at desc, g.id desc offset greatest(coalesce(p_offset, 0), 0) limit v_lim + 1) q
  )
  select coalesce(jsonb_agg(x.j order by x.rn) filter (where x.rn <= v_lim), '[]'::jsonb), bool_or(x.rn > v_lim) into v_res, v_more
  from (
    select pg.rn, jsonb_build_object(
      'id', b.id, 'category', b.category, 'category_label', coalesce(c.label, 'Outros acontecimentos'),
      'title', case when pg.n > 1 then 'Dados pessoais atualizados' else case when b.restricted and not v_detail and b.kind <> 'decision' then case b.kind when 'guardian' then 'Responsável legal atualizado' else 'Vida familiar atualizada' end else b.title end end,
      'description', case when pg.n > 1 then (select string_agg(distinct public.history_field_label(g2.field), ', ') from base g2 where g2.gk = pg.gk)
                          when b.restricted and not v_detail and b.kind <> 'decision' then null else b.description end,
      'occurred_on', b.occurred_on, 'at', b.at, 'origin', b.origin, 'kind', b.kind,
      'by', case when b.actor is null then 'Sistema' else coalesce(public.welcome_name(b.org_id, b.actor), 'Usuário removido') end, 'by_id', b.actor,
      'edited', b.edited_at is not null, 'edited_at', b.edited_at,
      'notes', case when b.origin = 'manual' then b.meta->>'notes' end,
      'restricted', b.restricted and not v_detail and b.kind <> 'decision', 'op_id', b.op_id,
      'changes', case when b.kind in ('field', 'self_update') and b.category = 'pessoais' then
                  (select jsonb_agg(jsonb_build_object('field', public.history_field_label(g2.field), 'old', case when g2.field = 'cpf' then null else g2.old_value end, 'new', case when g2.field = 'cpf' then null else g2.new_value end) order by g2.id)
                     from base g2 where g2.gk = pg.gk) end,
      'can_edit', b.origin = 'manual' and public.can_timeline(b.org_id, 'edit')
    ) as j
    from page pg join person_history b on b.id = pg.id left join history_categories c on c.key = b.category and (c.org_id is null or c.org_id = b.org_id)
  ) x;
  return jsonb_build_object('items', v_res, 'has_more', coalesce(v_more, false), 'can_add', public.can_timeline(pe.org_id, 'add'));
end $$;

-- ---------------------------------------------------------------- utilitários internos
create or replace function public.conv_log(p_dec uuid, p_org uuid, p_action text, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public as $$
  insert into faith_decision_log (decision_id, org_id, actor, action, detail) values (p_dec, p_org, auth.uid(), p_action, coalesce(p_detail, '{}'::jsonb))
$$;
create or replace function public.conv_notify(p_org uuid, p_mode text, p_title text, p_body text, p_link text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select distinct x from public.conv_users(p_org, p_mode) x where x is distinct from auth.uid() loop
    perform public.notify_user(u, p_org, 'convert', p_title, p_body, p_link, null);
  end loop;
end $$;
-- registra o acontecimento na trajetória da pessoa (restrito; uma vez por decisão)
create or replace function public.conv_history(p_dec uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d faith_decisions;
begin
  select * into d from faith_decisions where id = p_dec;
  if d.id is null or d.person_id is null or d.voided_at is not null then return; end if;
  insert into person_history (org_id, person_id, actor, kind, field, old_value, new_value, note, category, title, description, restricted, occurred_on, origin, op_id, op_key, meta)
  values (d.org_id, d.person_id, auth.uid(), 'decision', null, null, null, null, 'decisao', 'Decisão de fé registrada',
          trim(both ' ' from public.conv_origin_label(d.origin) || coalesce(' · ' || d.place, '')),
          true, d.decided_on, 'auto', txid_current()::text, 'dec:' || d.id, jsonb_build_object('decision_id', d.id))
  on conflict (person_id, op_key) where op_key is not null do nothing;
end $$;
create or replace function public.conv_norm(p text) returns text language sql immutable as $$
  select lower(regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g'))
$$;
revoke execute on function public.conv_log(uuid, uuid, text, jsonb), public.conv_notify(uuid, text, text, text, text), public.conv_history(uuid), public.conv_norm(text) from public, anon, authenticated;

-- valida e normaliza os campos comuns
create or replace function public.conv_clean(p jsonb) returns jsonb
language plpgsql immutable as $$
declare v_name text := trim(coalesce(p->>'name', '')); v_phone text := nullif(trim(coalesce(p->>'phone', '')), ''); v_email text := nullif(lower(trim(coalesce(p->>'email', ''))), '');
        v_place text := nullif(trim(coalesce(p->>'place', '')), ''); v_note text := nullif(trim(coalesce(p->>'note', '')), ''); v_origin text := coalesce(nullif(trim(p->>'origin'), ''), 'culto');
        v_consent text := coalesce(nullif(trim(p->>'consent'), ''), 'unknown'); v_time text := nullif(trim(coalesce(p->>'time', '')), ''); v_d text;
begin
  if length(v_name) < 1 then raise exception 'name_required'; end if;
  if length(v_name) > 160 then raise exception 'name_too_long'; end if;
  if v_origin not in ('culto','celula','evento','transmissao','evangelismo','acao_externa','atendimento','outro') then raise exception 'invalid_origin'; end if;
  if v_consent not in ('authorized','declined','unknown') then raise exception 'invalid_consent'; end if;
  if v_phone is not null then
    v_d := public.digits(v_phone);
    if v_d is null or length(v_d) < 8 or length(v_d) > 15 or length(v_phone) > 30 then raise exception 'invalid_phone'; end if;
  end if;
  if v_email is not null and (length(v_email) > 200 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'invalid_email'; end if;
  if v_place is not null and length(v_place) > 120 then raise exception 'place_too_long'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'note_too_long'; end if;
  if v_time is not null and v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'invalid_time'; end if;
  return jsonb_build_object('name', v_name, 'phone', v_phone, 'email', v_email, 'place', v_place, 'note', v_note, 'origin', v_origin, 'consent', v_consent, 'time', v_time);
end $$;
revoke execute on function public.conv_clean(jsonb) from public, anon, authenticated;

create or replace function public.conv_today() returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
revoke execute on function public.conv_today() from public, anon, authenticated;

-- ---------------------------------------------------------------- candidatos (para escolher a ficha certa; nunca associa sozinho)
create or replace function public.convert_candidates(p_org uuid, p_name text, p_phone text default null, p_email text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_name text := public.conv_norm(p_name); v_d text := public.digits(p_phone); v_toks text[]; v_res jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not (public.conv_can(p_org, 'register') or public.conv_can(p_org, 'link')) then raise exception 'forbidden'; end if;
  v_toks := array(select t from unnest(string_to_array(v_name, ' ')) t where length(t) >= 2);
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'full_name', x.full_name, 'classification', x.classification, 'photo_url', x.photo_url, 'has_account', x.user_id is not null, 'reason', x.reason) order by x.o, x.full_name), '[]'::jsonb) into v_res from (
    select * from (
      select p.id, p.full_name, p.classification, p.photo_url, p.user_id,
             case when public.conv_norm(p.full_name) = v_name then 'nome igual'
                  when v_d is not null and length(v_d) >= 8 and (public.digits(p.phone) = v_d or public.digits(p.whatsapp) = v_d) then 'telefone igual'
                  when nullif(trim(coalesce(p_email, '')), '') is not null and lower(p.email) = lower(trim(p_email)) then 'e-mail igual'
                  else 'nome parecido' end as reason,
             case when public.conv_norm(p.full_name) = v_name then 1 when v_d is not null and length(v_d) >= 8 and (public.digits(p.phone) = v_d or public.digits(p.whatsapp) = v_d) then 2
                  when nullif(trim(coalesce(p_email, '')), '') is not null and lower(p.email) = lower(trim(p_email)) then 3 else 4 end as o
        from people p
       where p.org_id = p_org and p.status in ('active','inactive','pending')
         and (public.conv_norm(p.full_name) = v_name
              or (v_d is not null and length(v_d) >= 8 and (public.digits(p.phone) = v_d or public.digits(p.whatsapp) = v_d))
              or (nullif(trim(coalesce(p_email, '')), '') is not null and lower(p.email) = lower(trim(p_email)))
              or (cardinality(v_toks) >= 1 and not exists (select 1 from unnest(v_toks) t where lower(p.full_name) not like '%' || t || '%')))
    ) q order by q.o, q.full_name limit 8) x;
  return v_res;
end $$;

-- ---------------------------------------------------------------- registro da decisão
create or replace function public.convert_register(p_org uuid, p jsonb, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; v_mode text := coalesce(nullif(trim(p->>'mode'), ''), 'await'); v_day date; v_person uuid := nullif(p->>'person_id', '')::uuid; v_key text := nullif(trim(coalesce(p->>'key', '')), '');
        v_id uuid; v_pid uuid; v_dupes jsonb; v_wants boolean := case lower(coalesce(p->>'wants_followup', '')) when 'true' then true when 'false' then false else null end;
        v_existing uuid; v_resp uuid := nullif(p->>'responsible_id', '')::uuid; v_ph text; v_em text; v_dc jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.conv_can(p_org, 'register') then raise exception 'forbidden'; end if;
  if v_mode not in ('link','create','await') then raise exception 'invalid_mode'; end if;
  if v_key is not null then
    select id into v_existing from faith_decisions where org_id = p_org and op_key = v_key;
    if v_existing is not null then return jsonb_build_object('saved', true, 'id', v_existing, 'repeated', true); end if;
  end if;
  c := public.conv_clean(p);
  begin v_day := coalesce(nullif(p->>'decided_on', '')::date, public.conv_today()); exception when others then raise exception 'invalid_date'; end;
  if v_day > public.conv_today() or v_day < date '2000-01-01' then raise exception 'invalid_date'; end if;
  if v_mode in ('link','create') and not public.conv_can(p_org, 'link') then raise exception 'forbidden'; end if;
  if v_resp is not null and not (v_resp in (select public.conv_users(p_org, 'followup'))) then raise exception 'invalid_responsible'; end if;
  if v_resp is not null and not public.conv_can(p_org, 'assign') then raise exception 'forbidden'; end if;
  v_ph := c->>'phone'; v_em := c->>'email';

  if v_mode = 'link' then
    if v_person is null or not exists (select 1 from people where id = v_person and org_id = p_org and status in ('active','inactive','pending')) then raise exception 'person_not_found'; end if;
    v_pid := v_person;
    if exists (select 1 from faith_decisions where person_id = v_pid and decided_on = v_day and voided_at is null) and not p_force then raise exception 'duplicate_decision'; end if;
  elsif v_mode = 'create' then
    select public.convert_candidates(p_org, c->>'name', v_ph, v_em) into v_dupes;
    if jsonb_array_length(v_dupes) > 0 and not p_force then return jsonb_build_object('saved', false, 'candidates', v_dupes); end if;
    insert into people (org_id, full_name, phone, email, classification, status, source, registered_at, created_by, contact_consent, contact_consent_at, flagged_duplicate)
    values (p_org, c->>'name', case when c->>'consent' = 'authorized' then v_ph end, case when c->>'consent' = 'authorized' then v_em end, 'none', 'active', 'manual', v_day, auth.uid(),
            false, null, jsonb_array_length(v_dupes) > 0)
    returning id into v_pid;
    perform public.person_log(p_org, v_pid, 'create', null, null, 'none', 'cadastro criado a partir de uma decisão de fé');
  else
    if exists (select 1 from faith_decisions where org_id = p_org and person_id is null and voided_at is null and decided_on = v_day and public.conv_norm(display_name) = public.conv_norm(c->>'name')) and not p_force then
      raise exception 'duplicate_decision';
    end if;
  end if;

  insert into faith_decisions (org_id, person_id, display_name, decided_on, decided_time, place, origin, source, phone, email, contact_consent, consent_at, admin_note, wants_followup,
                               fu_status, responsible_id, assigned_at, assigned_by, registered_by, op_key, linked_at, linked_by)
  values (p_org, v_pid, c->>'name', v_day, nullif(c->>'time', '')::time, c->>'place', c->>'origin', 'admin', v_ph, v_em, c->>'consent', case when c->>'consent' <> 'unknown' then now() end, c->>'note', v_wants,
          case when v_wants is true then 'offered' when v_wants is false then 'declined' else 'registered' end,
          v_resp, case when v_resp is not null then now() end, case when v_resp is not null then auth.uid() end, auth.uid(), v_key,
          case when v_pid is not null then now() end, case when v_pid is not null then auth.uid() end)
  returning id into v_id;
  perform public.conv_log(v_id, p_org, 'register', jsonb_build_object('mode', v_mode, 'person_id', v_pid, 'decided_on', v_day));
  perform public.conv_history(v_id);
  if v_resp is not null and v_resp <> auth.uid() then
    perform public.notify_user(v_resp, p_org, 'convert', 'Você foi designado(a) para acompanhar uma nova decisão', null, '#/novos-convertidos/' || v_id, null);
  end if;
  if v_pid is null then perform public.conv_notify(p_org, 'link', 'Decisão de fé aguardando associação', 'Escolha a ficha da pessoa para concluir o registro.', '#/novos-convertidos');
  else perform public.conv_notify(p_org, 'view', 'Nova decisão de fé registrada', null, '#/novos-convertidos/' || v_id); end if;
  return jsonb_build_object('saved', true, 'id', v_id, 'person_id', v_pid);
end $$;

-- ---------------------------------------------------------------- associar uma decisão "aguardando" à ficha
create or replace function public.convert_link(p_id uuid, p_person uuid, p_create boolean default false, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d faith_decisions; v_pid uuid; v_dupes jsonb;
begin
  select * into d from faith_decisions where id = p_id and voided_at is null;
  if d.id is null then raise exception 'not_found'; end if;
  if not public.conv_can(d.org_id, 'link') then raise exception 'forbidden'; end if;
  if d.person_id is not null then raise exception 'already_linked'; end if;
  if coalesce(p_create, false) then
    select public.convert_candidates(d.org_id, d.display_name, d.phone, d.email) into v_dupes;
    if jsonb_array_length(v_dupes) > 0 and not coalesce(p_force, false) then return jsonb_build_object('saved', false, 'candidates', v_dupes); end if;
    insert into people (org_id, full_name, phone, email, classification, status, source, registered_at, created_by, flagged_duplicate)
    values (d.org_id, d.display_name, case when d.contact_consent = 'authorized' then d.phone end, case when d.contact_consent = 'authorized' then d.email end, 'none', 'active', 'manual', d.decided_on, auth.uid(), jsonb_array_length(v_dupes) > 0)
    returning id into v_pid;
    perform public.person_log(d.org_id, v_pid, 'create', null, null, 'none', 'cadastro criado a partir de uma decisão de fé');
  else
    if p_person is null or not exists (select 1 from people where id = p_person and org_id = d.org_id and status in ('active','inactive','pending')) then raise exception 'person_not_found'; end if;
    v_pid := p_person;
    if exists (select 1 from faith_decisions where person_id = v_pid and decided_on = d.decided_on and voided_at is null and id <> d.id) and not coalesce(p_force, false) then raise exception 'duplicate_decision'; end if;
  end if;
  update faith_decisions set person_id = v_pid, linked_at = now(), linked_by = auth.uid() where id = p_id;
  perform public.conv_log(p_id, d.org_id, 'link', jsonb_build_object('person_id', v_pid, 'created', coalesce(p_create, false)));
  perform public.conv_history(p_id);
  return jsonb_build_object('saved', true, 'person_id', v_pid);
end $$;

-- ---------------------------------------------------------------- correção das informações administrativas (guarda o valor anterior)
create or replace function public.convert_update(p_id uuid, p jsonb, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d faith_decisions; c jsonb; v_day date; v_ch jsonb := '{}'::jsonb; v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into d from faith_decisions where id = p_id and voided_at is null;
  if d.id is null then raise exception 'not_found'; end if;
  if not public.conv_can(d.org_id, 'edit') then raise exception 'forbidden'; end if;
  c := public.conv_clean(jsonb_build_object('name', coalesce(p->>'name', d.display_name), 'phone', case when p ? 'phone' then p->>'phone' else d.phone end,
        'email', case when p ? 'email' then p->>'email' else d.email end, 'place', case when p ? 'place' then p->>'place' else d.place end,
        'note', case when p ? 'note' then p->>'note' else d.admin_note end, 'origin', coalesce(p->>'origin', d.origin),
        'consent', coalesce(p->>'consent', d.contact_consent), 'time', case when p ? 'time' then p->>'time' else to_char(d.decided_time, 'HH24:MI') end));
  begin v_day := coalesce(nullif(p->>'decided_on', '')::date, d.decided_on); exception when others then raise exception 'invalid_date'; end;
  if v_day > public.conv_today() or v_day < date '2000-01-01' then raise exception 'invalid_date'; end if;
  if (v_day <> d.decided_on or (c->>'name') <> d.display_name) and v_reason is null then raise exception 'reason_required'; end if;
  if d.person_id is not null and v_day <> d.decided_on and exists (select 1 from faith_decisions where person_id = d.person_id and decided_on = v_day and voided_at is null and id <> d.id) then raise exception 'duplicate_decision'; end if;
  if (c->>'name') is distinct from d.display_name then v_ch := v_ch || jsonb_build_object('name', jsonb_build_array(d.display_name, c->>'name')); end if;
  if v_day <> d.decided_on then v_ch := v_ch || jsonb_build_object('decided_on', jsonb_build_array(d.decided_on, v_day)); end if;
  if (c->>'place') is distinct from d.place then v_ch := v_ch || jsonb_build_object('place', jsonb_build_array(d.place, c->>'place')); end if;
  if (c->>'origin') is distinct from d.origin then v_ch := v_ch || jsonb_build_object('origin', jsonb_build_array(d.origin, c->>'origin')); end if;
  if (c->>'consent') is distinct from d.contact_consent then v_ch := v_ch || jsonb_build_object('consent', jsonb_build_array(d.contact_consent, c->>'consent')); end if;
  if (c->>'note') is distinct from d.admin_note then v_ch := v_ch || jsonb_build_object('note', true); end if;
  if (c->>'phone') is distinct from d.phone or (c->>'email') is distinct from d.email then v_ch := v_ch || jsonb_build_object('contact', true); end if;
  if (c->>'time') is distinct from to_char(d.decided_time, 'HH24:MI') then v_ch := v_ch || jsonb_build_object('time', true); end if;
  if v_ch = '{}'::jsonb then return jsonb_build_object('saved', true, 'changed', false); end if;
  update faith_decisions set display_name = c->>'name', decided_on = v_day, decided_time = nullif(c->>'time', '')::time, place = c->>'place', origin = c->>'origin', phone = c->>'phone', email = c->>'email',
         contact_consent = c->>'consent', consent_at = case when (c->>'consent') is distinct from d.contact_consent then (case when c->>'consent' = 'unknown' then null else now() end) else d.consent_at end,
         admin_note = c->>'note', edited_at = now(), edited_by = auth.uid() where id = p_id;
  if d.person_id is not null then
    update person_history set occurred_on = v_day, description = trim(both ' ' from public.conv_origin_label(c->>'origin') || coalesce(' · ' || (c->>'place'), '')), edited_at = now(), edited_by = auth.uid()
     where person_id = d.person_id and op_key = 'dec:' || p_id;
  end if;
  perform public.conv_log(p_id, d.org_id, 'update', jsonb_build_object('changes', v_ch, 'reason', v_reason));
  return jsonb_build_object('saved', true, 'changed', true);
end $$;

-- ---------------------------------------------------------------- exclusão (restrita, justificada, auditada). Retifique preferencialmente.
create or replace function public.convert_void(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d faith_decisions; v_reason text := trim(coalesce(p_reason, ''));
begin
  select * into d from faith_decisions where id = p_id and voided_at is null;
  if d.id is null then raise exception 'not_found'; end if;
  if not public.conv_can(d.org_id, 'admin') then raise exception 'forbidden'; end if;
  if length(v_reason) < 5 then raise exception 'reason_required'; end if;
  if length(v_reason) > 500 then raise exception 'reason_too_long'; end if;
  update faith_decisions set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = p_id;
  if d.person_id is not null then
    update person_history set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where person_id = d.person_id and op_key = 'dec:' || p_id and voided_at is null;
  end if;
  perform public.conv_log(p_id, d.org_id, 'void', jsonb_build_object('reason', v_reason));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- lista com filtros e busca
create or replace function public.convert_list(p_org uuid, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_all boolean; v_q text := nullif(trim(coalesce(p->>'q', '')), ''); v_from date; v_to date; v_lim int := least(greatest(coalesce(nullif(p->>'limit', '')::int, 30), 1), 100); v_off int := greatest(coalesce(nullif(p->>'offset', '')::int, 0), 0);
        v_status text := nullif(p->>'status', ''); v_consent text := nullif(p->>'consent', ''); v_origin text := nullif(p->>'origin', ''); v_place text := nullif(trim(coalesce(p->>'place', '')), '');
        v_resp uuid := nullif(p->>'responsible', '')::uuid; v_nocontact boolean := coalesce((p->>'no_contact')::boolean, false); v_hl int; v_res jsonb; v_total int;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_all := public.conv_can(p_org, 'view');
  if not (v_all or public.conv_can(p_org, 'followup')) then raise exception 'forbidden'; end if;
  begin v_from := nullif(p->>'from', '')::date; v_to := nullif(p->>'to', '')::date; exception when others then raise exception 'invalid_date'; end;
  if v_status is not null and v_status not in ('awaiting','registered','offered','in_progress','suspended','ended','declined') then raise exception 'invalid_filter'; end if;
  if v_consent is not null and v_consent not in ('authorized','declined','unknown') then raise exception 'invalid_filter'; end if;
  select highlight_days into v_hl from convert_settings where org_id = p_org;

  with f as (
    select d.* from faith_decisions d left join people pe on pe.id = d.person_id
     where d.org_id = p_org and d.voided_at is null
       and (v_all or d.responsible_id = auth.uid())
       and (v_q is null or d.display_name ilike '%' || v_q || '%' or pe.full_name ilike '%' || v_q || '%')
       and (v_from is null or d.decided_on >= v_from) and (v_to is null or d.decided_on <= v_to)
       and (v_origin is null or d.origin = v_origin)
       and (v_place is null or d.place ilike '%' || v_place || '%')
       and (v_resp is null or d.responsible_id = v_resp)
       and (v_status is null or (v_status = 'awaiting' and d.person_id is null) or (v_status <> 'awaiting' and d.fu_status = v_status))
       and (v_consent is null or d.contact_consent = v_consent)
       and (not v_nocontact or (d.phone is null and d.email is null))
  ), pg as (select * from f order by decided_on desc, created_at desc offset v_off limit v_lim)
  select (select count(*) from f), coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id, 'name', g.display_name, 'person_id', g.person_id, 'photo_url', pe.photo_url, 'decided_on', g.decided_on, 'place', g.place, 'origin', g.origin, 'origin_label', public.conv_origin_label(g.origin),
      'source', g.source, 'responsible_id', g.responsible_id, 'responsible_name', case when g.responsible_id is null then null else coalesce(public.welcome_name(g.org_id, g.responsible_id), 'Usuário removido') end,
      'fu_status', g.fu_status, 'awaiting_link', g.person_id is null, 'consent', g.contact_consent, 'has_contact', (g.phone is not null or g.email is not null),
      'wants_followup', g.wants_followup, 'highlight', v_hl is not null and g.decided_on >= public.conv_today() - v_hl) order by g.decided_on desc, g.created_at desc), '[]'::jsonb)
    into v_total, v_res
    from pg g left join people pe on pe.id = g.person_id;
  return jsonb_build_object('items', v_res, 'total', v_total, 'scope', case when v_all then 'all' else 'mine' end,
                            'can_register', public.conv_can(p_org, 'register'), 'can_indicators', public.conv_can(p_org, 'indicators'), 'can_admin', public.conv_can(p_org, 'admin'));
end $$;

-- ---------------------------------------------------------------- indicadores (registros reais; cada decisão conta uma vez, pessoas distintas à parte)
create or replace function public.convert_indicators(p_org uuid, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_res jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.conv_can(p_org, 'indicators') then raise exception 'forbidden'; end if;
  with f as (select * from faith_decisions where org_id = p_org and voided_at is null and (p_from is null or decided_on >= p_from) and (p_to is null or decided_on <= p_to))
  select jsonb_build_object(
    'total', (select count(*) from f),
    'people', (select count(distinct person_id) from f where person_id is not null),
    'awaiting_link', (select count(*) from faith_decisions where org_id = p_org and voided_at is null and person_id is null),
    'followup_accepted', (select count(*) from f where wants_followup is true or fu_status in ('in_progress','suspended','ended')),
    'no_contact', (select count(*) from f where phone is null and email is null),
    'by_month', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'n', n) order by m) from (select to_char(decided_on, 'YYYY-MM') m, count(*) n from f group by 1) x), '[]'::jsonb),
    'by_origin', coalesce((select jsonb_agg(jsonb_build_object('origin', origin, 'label', public.conv_origin_label(origin), 'n', n) order by n desc) from (select origin, count(*) n from f group by 1) x), '[]'::jsonb),
    'by_status', coalesce((select jsonb_agg(jsonb_build_object('status', s, 'n', n) order by n desc) from (select fu_status s, count(*) n from f group by 1) x), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;

-- ---------------------------------------------------------------- detalhe
create or replace function public.convert_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d faith_decisions; v_all boolean; v_mine boolean; v_pe people; v_entries jsonb; v_log jsonb; v_auth boolean; v_fu boolean;
begin
  select * into d from faith_decisions where id = p_id and voided_at is null;
  if d.id is null then raise exception 'not_found'; end if;
  v_all := public.conv_can(d.org_id, 'view'); v_mine := coalesce(d.responsible_id = auth.uid(), false) and public.conv_can(d.org_id, 'followup');
  if not (v_all or v_mine) then raise exception 'forbidden'; end if;
  v_auth := d.contact_consent = 'authorized';
  v_fu := public.conv_can(d.org_id, 'followup') and (coalesce(d.responsible_id = auth.uid(), false) or public.conv_can(d.org_id, 'assign') or public.conv_can(d.org_id, 'admin'));
  select * into v_pe from people where id = d.person_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'occurred_on', e.occurred_on, 'channel', e.channel, 'body', e.body,
           'by', coalesce(public.welcome_name(e.org_id, e.created_by), 'Usuário removido'), 'at', e.created_at) order by e.occurred_on desc, e.id desc), '[]'::jsonb) into v_entries
    from (select * from faith_followup_entries where decision_id = p_id order by occurred_on desc, id desc limit 100) e;
  if public.conv_can(d.org_id, 'admin') or public.conv_can(d.org_id, 'view') then
    select coalesce(jsonb_agg(jsonb_build_object('action', l.action, 'detail', l.detail, 'at', l.at, 'by', case when l.actor is null then 'Sistema' else coalesce(public.welcome_name(l.org_id, l.actor), 'Usuário removido') end) order by l.at desc, l.id desc), '[]'::jsonb) into v_log
      from (select * from faith_decision_log where decision_id = p_id order by at desc, id desc limit 60) l;
  else v_log := '[]'::jsonb; end if;
  return jsonb_build_object(
    'id', d.id, 'org_id', d.org_id, 'name', d.display_name, 'decided_on', d.decided_on, 'time', to_char(d.decided_time, 'HH24:MI'), 'place', d.place, 'origin', d.origin, 'origin_label', public.conv_origin_label(d.origin),
    'source', d.source, 'consent', d.contact_consent, 'consent_at', d.consent_at, 'has_contact', (d.phone is not null or d.email is not null),
    'phone', case when v_auth then d.phone end, 'email', case when v_auth then d.email end,
    'admin_note', d.admin_note, 'wants_followup', d.wants_followup, 'fu_status', d.fu_status, 'awaiting_link', d.person_id is null,
    'responsible_id', d.responsible_id, 'responsible_name', case when d.responsible_id is null then null else coalesce(public.welcome_name(d.org_id, d.responsible_id), 'Usuário removido') end, 'assigned_at', d.assigned_at,
    'registered_by', case when d.registered_by is null then null else coalesce(public.welcome_name(d.org_id, d.registered_by), 'Usuário removido') end, 'created_at', d.created_at, 'edited_at', d.edited_at,
    'person', case when v_pe.id is null then null else jsonb_build_object('id', v_pe.id, 'full_name', v_pe.full_name, 'classification', v_pe.classification, 'photo_url', v_pe.photo_url, 'has_account', v_pe.user_id is not null,
                 'can_open', public.people_scope_all(d.org_id) and public.has_people_perm(d.org_id, 'people_view')) end,
    'others', (select count(*) from faith_decisions o where o.person_id = d.person_id and o.id <> d.id and o.voided_at is null and d.person_id is not null),
    'entries', v_entries, 'log', v_log,
    'can_edit', public.conv_can(d.org_id, 'edit'), 'can_link', public.conv_can(d.org_id, 'link'), 'can_assign', public.conv_can(d.org_id, 'assign'),
    'can_followup', v_fu, 'can_void', public.conv_can(d.org_id, 'admin'));
end $$;

-- decisões de uma ficha (seção "Decisão de fé" na ficha; só quem vê convertidos)
create or replace function public.convert_for_person(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from people where id = p_person;
  if pe.id is null then raise exception 'not_found'; end if;
  if not public.conv_can(pe.org_id, 'view') then return jsonb_build_object('allowed', false, 'items', '[]'::jsonb); end if;
  return jsonb_build_object('allowed', true, 'can_register', public.conv_can(pe.org_id, 'register') and public.conv_can(pe.org_id, 'link'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'decided_on', d.decided_on, 'place', d.place, 'origin_label', public.conv_origin_label(d.origin), 'fu_status', d.fu_status,
                  'consent', d.contact_consent, 'responsible_name', case when d.responsible_id is null then null else coalesce(public.welcome_name(d.org_id, d.responsible_id), 'Usuário removido') end) order by d.decided_on desc)
                  from faith_decisions d where d.person_id = p_person and d.voided_at is null), '[]'::jsonb));
end $$;

create or replace function public.convert_responsibles(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.conv_can(p_org, 'assign') or public.conv_can(p_org, 'register')) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', u, 'name', coalesce(public.welcome_name(p_org, u), 'Sem nome')) order by coalesce(public.welcome_name(p_org, u), '')) from (select distinct public.conv_users(p_org, 'followup') u) x
                   where exists (select 1 from org_members where org_id = p_org and user_id = x.u)), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- responsável e acompanhamento
create or replace function public.convert_assign(p_id uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d faith_decisions;
begin
  select * into d from faith_decisions where id = p_id and voided_at is null;
  if d.id is null then raise exception 'not_found'; end if;
  if not public.conv_can(d.org_id, 'assign') then raise exception 'forbidden'; end if;
  if p_user is not null and not (p_user in (select public.conv_users(d.org_id, 'followup'))) then raise exception 'invalid_responsible'; end if;
  if p_user is not distinct from d.responsible_id then return jsonb_build_object('ok', true, 'changed', false); end if;
  update faith_decisions set responsible_id = p_user, assigned_at = case when p_user is null then null else now() end, assigned_by = case when p_user is null then null else auth.uid() end where id = p_id;
  perform public.conv_log(p_id, d.org_id, case when p_user is null then 'unassign' else 'assign' end, jsonb_build_object('from', d.responsible_id, 'to', p_user));
  if p_user is not null and p_user <> auth.uid() then
    perform public.notify_user(p_user, d.org_id, 'convert', 'Você foi designado(a) para acompanhar uma nova decisão', null, '#/novos-convertidos/' || p_id, null);
  end if;
  return jsonb_build_object('ok', true, 'changed', true);
end $$;

create or replace function public.convert_followup_status(p_id uuid, p_action text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d faith_decisions; v_new text; v_wants boolean;
begin
  select * into d from faith_decisions where id = p_id and voided_at is null;
  if d.id is null then raise exception 'not_found'; end if;
  if not (public.conv_can(d.org_id, 'followup') and (coalesce(d.responsible_id = auth.uid(), false) or public.conv_can(d.org_id, 'assign') or public.conv_can(d.org_id, 'admin'))) then raise exception 'forbidden'; end if;
  if length(coalesce(p_note, '')) > 300 then raise exception 'note_too_long'; end if;
  v_new := case p_action when 'offer' then 'offered' when 'start' then 'in_progress' when 'resume' then 'in_progress' when 'suspend' then 'suspended' when 'end' then 'ended' when 'decline' then 'declined' else null end;
  if v_new is null then raise exception 'invalid_action'; end if;
  if v_new = d.fu_status then return jsonb_build_object('ok', true, 'changed', false); end if;
  v_wants := case when v_new = 'declined' then false when v_new in ('in_progress') then true else d.wants_followup end;
  update faith_decisions set fu_status = v_new, wants_followup = v_wants where id = p_id;
  perform public.conv_log(p_id, d.org_id, 'status', jsonb_build_object('from', d.fu_status, 'to', v_new, 'note', nullif(trim(coalesce(p_note, '')), '')));
  return jsonb_build_object('ok', true, 'changed', true, 'fu_status', v_new);
end $$;

create or replace function public.convert_entry_add(p_id uuid, p_kind text, p_body text, p_on date default null, p_channel text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d faith_decisions; v_body text := trim(coalesce(p_body, '')); v_day date := coalesce(p_on, public.conv_today()); v_ch text := nullif(trim(coalesce(p_channel, '')), '');
begin
  select * into d from faith_decisions where id = p_id and voided_at is null;
  if d.id is null then raise exception 'not_found'; end if;
  if not (public.conv_can(d.org_id, 'followup') and (coalesce(d.responsible_id = auth.uid(), false) or public.conv_can(d.org_id, 'assign') or public.conv_can(d.org_id, 'admin'))) then raise exception 'forbidden'; end if;
  if p_kind not in ('contact','note','interest','referral') then raise exception 'invalid_kind'; end if;
  if length(v_body) < 1 then raise exception 'body_required'; end if;
  if length(v_body) > 1000 then raise exception 'body_too_long'; end if;
  if v_day > public.conv_today() or v_day < d.decided_on then raise exception 'invalid_date'; end if;
  if v_ch is not null and v_ch not in ('whatsapp','phone','email','presencial','outro') then raise exception 'invalid_channel'; end if;
  if p_kind = 'contact' then
    if d.contact_consent <> 'authorized' then raise exception 'contact_not_authorized'; end if;
    if d.fu_status = 'declined' then raise exception 'followup_declined'; end if;
  else v_ch := null; end if;
  insert into faith_followup_entries (decision_id, org_id, kind, occurred_on, channel, body, created_by) values (p_id, d.org_id, p_kind, v_day, v_ch, v_body, auth.uid());
  perform public.conv_log(p_id, d.org_id, 'entry', jsonb_build_object('kind', p_kind));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- configurações (formulário por link e destaque opcional)
create or replace function public.convert_settings_get(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s convert_settings;
begin
  if not public.conv_can(p_org, 'admin') then raise exception 'forbidden'; end if;
  insert into convert_settings (org_id) values (p_org) on conflict do nothing;
  select * into s from convert_settings where org_id = p_org;
  return jsonb_build_object('form_token', s.form_token, 'form_active', s.form_active, 'form_title', s.form_title, 'highlight_days', s.highlight_days);
end $$;
create or replace function public.convert_settings_save(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s convert_settings; v_title text; v_hl int;
begin
  if not public.conv_can(p_org, 'admin') then raise exception 'forbidden'; end if;
  insert into convert_settings (org_id) values (p_org) on conflict do nothing;
  select * into s from convert_settings where org_id = p_org;
  v_title := coalesce(nullif(trim(p->>'form_title'), ''), s.form_title);
  if length(v_title) > 120 then raise exception 'title_too_long'; end if;
  if p ? 'highlight_days' then
    v_hl := nullif(p->>'highlight_days', '')::int;
    if v_hl is not null and (v_hl < 1 or v_hl > 365) then raise exception 'invalid_highlight'; end if;
  else v_hl := s.highlight_days; end if;
  update convert_settings set form_title = v_title, highlight_days = v_hl,
         form_active = coalesce((p->>'form_active')::boolean, form_active),
         form_token = case when coalesce((p->>'rotate')::boolean, false) then replace(gen_random_uuid()::text, '-', '') else form_token end, updated_at = now() where org_id = p_org;
  perform public.conv_log(p_org, p_org, 'settings', jsonb_build_object('form_active', p->>'form_active', 'rotate', p->>'rotate', 'highlight_days', v_hl));
  return public.convert_settings_get(p_org);
end $$;

-- ---------------------------------------------------------------- formulário público (sem login; não devolve nada sobre quem já existe)
create or replace function public.convert_public_get(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('title', s.form_title, 'org_name', o.name, 'org_subtitle', o.subtitle, 'logo_url', o.logo_url)
    from convert_settings s join organizations o on o.id = s.org_id where s.form_token = p_token and s.form_active
$$;
create or replace function public.convert_public_submit(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s convert_settings; c jsonb; v_day date; v_recent int; v_wants boolean := case lower(coalesce(p->>'wants_followup', '')) when 'true' then true else null end; v_origin text; v_id uuid;
begin
  select * into s from convert_settings where form_token = p_token and form_active;
  if s.org_id is null then raise exception 'form_closed'; end if;
  if nullif(trim(coalesce(p->>'website', '')), '') is not null then return jsonb_build_object('ok', true); end if;   -- robô: finge sucesso
  select count(*) into v_recent from faith_decisions where org_id = s.org_id and source = 'public_form' and created_at > now() - interval '10 minutes';
  if v_recent >= 40 then raise exception 'too_many_requests'; end if;
  v_origin := case when p->>'origin' in ('culto','celula','evento','transmissao','outro') then p->>'origin' else 'outro' end;
  c := public.conv_clean(jsonb_build_object('name', p->>'name', 'phone', p->>'phone', 'email', p->>'email', 'place', p->>'place', 'origin', v_origin, 'consent', coalesce(p->>'consent', 'unknown')));
  begin v_day := coalesce(nullif(p->>'decided_on', '')::date, public.conv_today()); exception when others then raise exception 'invalid_date'; end;
  if v_day > public.conv_today() or v_day < public.conv_today() - 60 then raise exception 'invalid_date'; end if;
  if exists (select 1 from faith_decisions where org_id = s.org_id and source = 'public_form' and decided_on = v_day and public.conv_norm(display_name) = public.conv_norm(c->>'name') and voided_at is null) then
    return jsonb_build_object('ok', true);      -- repetição do mesmo envio: não duplica e não revela nada
  end if;
  insert into faith_decisions (org_id, display_name, decided_on, place, origin, source, phone, email, contact_consent, consent_at, wants_followup, fu_status)
  values (s.org_id, c->>'name', v_day, c->>'place', c->>'origin', 'public_form', c->>'phone', c->>'email', c->>'consent', case when c->>'consent' <> 'unknown' then now() end, v_wants,
          case when v_wants is true then 'offered' else 'registered' end)
  returning id into v_id;
  perform public.conv_log(v_id, s.org_id, 'register', jsonb_build_object('mode', 'public_form'));
  perform public.conv_notify(s.org_id, 'link', 'Decisão de fé aguardando associação', 'Recebida pelo formulário. Escolha a ficha da pessoa para concluir o registro.', '#/novos-convertidos');
  if v_wants is true then perform public.conv_notify(s.org_id, 'assign', 'Uma pessoa pediu acompanhamento', null, '#/novos-convertidos/' || v_id); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- formulário dentro do app (usuário logado)
create or replace function public.convert_self_get(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  select * into pe from people where org_id = p_org and user_id = auth.uid() and status in ('active','inactive','pending') order by created_at limit 1;
  return jsonb_build_object('person', case when pe.id is null then null else jsonb_build_object('id', pe.id, 'full_name', pe.full_name) end,
                            'name', coalesce(pe.full_name, public.welcome_name(p_org, auth.uid())));
end $$;
create or replace function public.convert_self_submit(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people; c jsonb; v_day date; v_origin text; v_wants boolean := case lower(coalesce(p->>'wants_followup', '')) when 'true' then true else null end; v_id uuid; v_ex uuid; v_name text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  select * into pe from people where org_id = p_org and user_id = auth.uid() and status in ('active','inactive','pending') order by created_at limit 1;
  if pe.id is not null and not coalesce((p->>'confirm_identity')::boolean, false) then raise exception 'confirm_identity'; end if;
  v_name := coalesce(pe.full_name, nullif(trim(coalesce(p->>'name', '')), ''), public.welcome_name(p_org, auth.uid()));
  v_origin := case when p->>'origin' in ('culto','celula','evento','transmissao','outro') then p->>'origin' else 'outro' end;
  c := public.conv_clean(jsonb_build_object('name', v_name, 'phone', p->>'phone', 'email', p->>'email', 'place', p->>'place', 'origin', v_origin, 'consent', coalesce(p->>'consent', 'unknown')));
  begin v_day := coalesce(nullif(p->>'decided_on', '')::date, public.conv_today()); exception when others then raise exception 'invalid_date'; end;
  if v_day > public.conv_today() or v_day < public.conv_today() - 365 then raise exception 'invalid_date'; end if;
  select id into v_ex from faith_decisions where org_id = p_org and voided_at is null and decided_on = v_day and ((pe.id is not null and person_id = pe.id) or self_user = auth.uid()) limit 1;
  if v_ex is not null then return jsonb_build_object('ok', true, 'repeated', true); end if;
  insert into faith_decisions (org_id, person_id, display_name, decided_on, place, origin, source, phone, email, contact_consent, consent_at, wants_followup, fu_status, self_user, registered_by, linked_at, linked_by)
  values (p_org, pe.id, c->>'name', v_day, c->>'place', c->>'origin', 'app', c->>'phone', c->>'email', c->>'consent', case when c->>'consent' <> 'unknown' then now() end, v_wants,
          case when v_wants is true then 'offered' else 'registered' end, auth.uid(), auth.uid(), case when pe.id is not null then now() end, case when pe.id is not null then auth.uid() end)
  returning id into v_id;
  perform public.conv_log(v_id, p_org, 'register', jsonb_build_object('mode', 'app', 'person_id', pe.id));
  perform public.conv_history(v_id);
  if pe.id is null then perform public.conv_notify(p_org, 'link', 'Decisão de fé aguardando associação', 'Registrada pela própria pessoa no app. Escolha a ficha para concluir.', '#/novos-convertidos');
  else perform public.conv_notify(p_org, 'view', 'Nova decisão de fé registrada', null, '#/novos-convertidos/' || v_id); end if;
  if v_wants is true then perform public.conv_notify(p_org, 'assign', 'Uma pessoa pediu acompanhamento', null, '#/novos-convertidos/' || v_id); end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ---------------------------------------------------------------- permissões de execução
revoke execute on function
  public.convert_candidates(uuid, text, text, text), public.convert_register(uuid, jsonb, boolean), public.convert_link(uuid, uuid, boolean, boolean), public.convert_update(uuid, jsonb, text),
  public.convert_void(uuid, text), public.convert_list(uuid, jsonb), public.convert_indicators(uuid, date, date), public.convert_get(uuid), public.convert_for_person(uuid),
  public.convert_responsibles(uuid), public.convert_assign(uuid, uuid), public.convert_followup_status(uuid, text, text), public.convert_entry_add(uuid, text, text, date, text),
  public.convert_settings_get(uuid), public.convert_settings_save(uuid, jsonb), public.convert_public_get(text), public.convert_public_submit(text, jsonb),
  public.convert_self_get(uuid), public.convert_self_submit(uuid, jsonb) from public, anon;
grant execute on function
  public.convert_candidates(uuid, text, text, text), public.convert_register(uuid, jsonb, boolean), public.convert_link(uuid, uuid, boolean, boolean), public.convert_update(uuid, jsonb, text),
  public.convert_void(uuid, text), public.convert_list(uuid, jsonb), public.convert_indicators(uuid, date, date), public.convert_get(uuid), public.convert_for_person(uuid),
  public.convert_responsibles(uuid), public.convert_assign(uuid, uuid), public.convert_followup_status(uuid, text, text), public.convert_entry_add(uuid, text, text, date, text),
  public.convert_settings_get(uuid), public.convert_settings_save(uuid, jsonb), public.convert_self_get(uuid), public.convert_self_submit(uuid, jsonb) to authenticated;
grant execute on function public.convert_public_get(text), public.convert_public_submit(text, jsonb) to anon, authenticated;

-- Conferência (retorna true):
--   select to_regclass('public.faith_decisions') is not null
--      and to_regprocedure('public.convert_register(uuid,jsonb,boolean)') is not null
--      and to_regprocedure('public.convert_public_submit(text,jsonb)') is not null
--      and 'people_converts_view' = any (public.all_actions()) as ok;

-- >>> supabase/migrations/20261201000001_jornadas.sql
-- =====================================================================
-- SOMOS Recurso 08: Jornadas (acompanhamento da caminhada)
-- Jornada > Etapas > Atividades, montadas pela própria igreja (nada fixo). Participação é um registro à parte da ficha:
--  * não altera classificação, não cria conta, não cria vínculo com time/ministério e não é "avaliação espiritual" (o percentual só conta atividades obrigatórias);
--  * a estrutura pode mudar sem apagar progresso: atividades usadas são "removidas" (ocultas), nunca apagadas; jornada arquivada preserva participantes e histórico;
--  * responsáveis (geral, por etapa, por atividade, por participante) precisam da permissão de acompanhar e só enxergam o que lhes cabe;
--  * eventos reaproveitam church_events; conteúdo usa link/arquivo/texto (sem biblioteca paralela); nada entra em jornada sozinho por aceitar Jesus ou virar membro;
--  * notificações configuráveis por jornada, sem lembretes automáticos; a pessoa pode silenciar a própria jornada;
--  * tudo validado no banco; histórico administrativo em journey_log e eventos na linha do tempo da pessoa (sem nada pastoral).
-- =====================================================================

-- ---------------------------------------------------------------- permissões novas
alter table public.access_grants drop constraint if exists access_grants_actions_check;
alter table public.access_grants add constraint access_grants_actions_check check (
  actions <@ array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
                   'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin',
                   'people_journeys_admin','people_journeys_participants','people_journeys_follow','people_journeys_approve','people_journeys_indicators']::text[]);
create or replace function public.all_actions() returns text[] language sql immutable as $$
  select array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
               'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin',
               'people_journeys_admin','people_journeys_participants','people_journeys_follow','people_journeys_approve','people_journeys_indicators']::text[]
$$;
create or replace function public.people_actions(p_org uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
      then array['people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
                 'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin',
                 'people_journeys_admin','people_journeys_participants','people_journeys_follow','people_journeys_approve','people_journeys_indicators']
    else coalesce((select array_agg(distinct a) from access_grants g, unnest(g.actions) a
                   where g.org_id = p_org and g.user_id = auth.uid() and a like 'people\_%'), '{}'::text[]) end
$$;
create or replace function public.jr_can(p_org uuid, p_mode text) returns boolean
language sql stable security definer set search_path = public as $$
  select ('people_journeys_' || p_mode) = any (public.people_actions(p_org))
$$;
create or replace function public.jr_users(p_org uuid, p_mode text) returns setof uuid
language sql stable security definer set search_path = public as $$
  select om.user_id from org_members om where om.org_id = p_org and om.role = 'admin'
  union
  select g.user_id from access_grants g where g.org_id = p_org and ('people_journeys_' || p_mode) = any (g.actions)
$$;
revoke execute on function public.jr_can(uuid, text), public.jr_users(uuid, text) from public, anon;
grant execute on function public.jr_can(uuid, text) to authenticated;

-- ---------------------------------------------------------------- tabelas
create table if not exists public.journeys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  description text check (description is null or length(description) <= 1000),
  image_url text check (image_url is null or length(image_url) <= 600),
  objective text check (objective is null or length(objective) <= 500),
  audience text check (audience is null or length(audience) <= 300),
  owner_id uuid references auth.users(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  visibility text not null default 'private' check (visibility in ('public','private')),
  status text not null default 'draft' check (status in ('draft','active','paused','archived')),
  step_mode text not null default 'sequential' check (step_mode in ('sequential','free','conditional')),
  enroll_voluntary boolean not null default false,
  eligible_classes text[] check (eligible_classes is null or eligible_classes <@ array['member','attender','visitor','none']::text[]),
  auto_finish boolean not null default true,
  for_converts boolean not null default false,
  auto_rule jsonb,
  notify jsonb not null default '{"invite":true,"enroll":true,"step_open":true,"assign":true,"approve":true,"step_done":true,"done":true,"responsible":true}'::jsonb,
  version int not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists journeys_org on public.journeys (org_id, status);

create table if not exists public.journey_steps (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.journeys(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  description text check (description is null or length(description) <= 500),
  position int not null default 0,
  responsible_id uuid references auth.users(id) on delete set null,
  completion_rule text not null default 'all_required' check (completion_rule in ('all_required','manual')),
  requires uuid[] not null default '{}',
  removed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists journey_steps_j on public.journey_steps (journey_id, position);

create table if not exists public.journey_activities (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references public.journey_steps(id) on delete cascade,
  journey_id uuid not null references public.journeys(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 160),
  description text check (description is null or length(description) <= 1000),
  kind text not null default 'text' check (kind in ('text','video','file','link','reading','quiz','task','meeting','event','accompanied')),
  instructions text check (instructions is null or length(instructions) <= 1000),
  content_url text check (content_url is null or (length(content_url) <= 600 and content_url ~* '^https?://')),
  content_text text check (content_text is null or length(content_text) <= 4000),
  event_id uuid references public.church_events(id) on delete set null,
  responsible_id uuid references auth.users(id) on delete set null,
  completion_mode text not null default 'self' check (completion_mode in ('self','responsible','auto','approval')),
  required boolean not null default true,
  position int not null default 0,
  removed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists journey_acts_step on public.journey_activities (step_id, position);

create table if not exists public.journey_participants (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.journeys(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting','active','paused','completed','cancelled')),
  responsible_id uuid references auth.users(id) on delete set null,
  source text not null default 'admin' check (source in ('admin','self','rule','convert')),
  decision_id uuid references public.faith_decisions(id) on delete set null,
  notify boolean not null default true,
  started_on date,
  completed_at timestamptz,
  cancel_reason text check (cancel_reason is null or cancel_reason in ('declined','left','staff')),
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists journey_participants_unique on public.journey_participants (journey_id, person_id) where status <> 'cancelled';
create index if not exists journey_participants_person on public.journey_participants (person_id);

create table if not exists public.journey_completions (
  id bigint generated always as identity primary key,
  participant_id uuid not null references public.journey_participants(id) on delete cascade,
  activity_id uuid not null references public.journey_activities(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  status text not null check (status in ('done','pending_approval')),
  source text not null check (source in ('self','responsible','auto','approval')),
  answer text check (answer is null or length(answer) <= 2000),
  done_by uuid references auth.users(id) on delete set null,
  done_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  unique (participant_id, activity_id)
);
create table if not exists public.journey_step_progress (
  participant_id uuid not null references public.journey_participants(id) on delete cascade,
  step_id uuid not null references public.journey_steps(id) on delete cascade,
  completed_at timestamptz not null default now(),
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  primary key (participant_id, step_id)
);
create table if not exists public.journey_log (
  id bigint generated always as identity primary key,
  journey_id uuid not null,
  participant_id uuid,
  org_id uuid not null,
  actor uuid references auth.users(id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists journey_log_j on public.journey_log (journey_id, at desc);
create index if not exists journey_log_p on public.journey_log (participant_id, at desc);

alter table public.journeys enable row level security;
alter table public.journey_steps enable row level security;
alter table public.journey_activities enable row level security;
alter table public.journey_participants enable row level security;
alter table public.journey_completions enable row level security;
alter table public.journey_step_progress enable row level security;
alter table public.journey_log enable row level security;
revoke all on public.journeys, public.journey_steps, public.journey_activities, public.journey_participants, public.journey_completions, public.journey_step_progress, public.journey_log from anon, authenticated;

insert into public.history_categories (org_id, key, label, manual, sort) values (null, 'jornada', 'Jornadas', false, 47)
  on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), key) do nothing;

-- ---------------------------------------------------------------- utilitários internos
create or replace function public.jr_today() returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
create or replace function public.jr_log(p_journey uuid, p_pid uuid, p_org uuid, p_action text, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public as $$
  insert into journey_log (journey_id, participant_id, org_id, actor, action, detail) values (p_journey, p_pid, p_org, auth.uid(), p_action, coalesce(p_detail, '{}'::jsonb))
$$;
-- notificação configurável por jornada; nunca para quem agiu; a pessoa pode silenciar a própria jornada. Sem lembretes automáticos.
create or replace function public.jr_notify(p_journey uuid, p_key text, p_user uuid, p_title text, p_link text, p_muted boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare j journeys;
begin
  if p_user is null or p_user is not distinct from auth.uid() or coalesce(p_muted, false) then return; end if;
  select * into j from journeys where id = p_journey;
  if j.id is null or coalesce((j.notify->>p_key)::boolean, false) is not true then return; end if;
  perform public.notify_user(p_user, j.org_id, 'journey', p_title, null, p_link, null);
end $$;
-- evento na linha do tempo da pessoa (nome da jornada só quando é pública e não é de convertidos)
create or replace function public.jr_history(p_pid uuid, p_title text, p_desc text, p_key text) returns void
language plpgsql security definer set search_path = public as $$
declare pt journey_participants; j journeys; v_name text;
begin
  select * into pt from journey_participants where id = p_pid; select * into j from journeys where id = pt.journey_id;
  if pt.id is null or j.id is null then return; end if;
  v_name := case when j.visibility = 'public' and not j.for_converts then j.name end;
  insert into person_history (org_id, person_id, actor, kind, field, old_value, new_value, note, category, title, description, restricted, occurred_on, origin, op_id, op_key, meta)
  values (pt.org_id, pt.person_id, auth.uid(), 'journey', null, null, null, null, 'jornada', p_title, case when v_name is not null then v_name || coalesce(' · ' || p_desc, '') else p_desc end, false,
          public.jr_today(), 'auto', txid_current()::text, 'jr:' || p_key, jsonb_build_object('journey_id', j.id, 'participant_id', p_pid))
  on conflict (person_id, op_key) where op_key is not null do nothing;
end $$;
create or replace function public.jr_person_user(p_person uuid) returns uuid language sql stable security definer set search_path = public as $$ select user_id from people where id = p_person $$;

-- estado das etapas de uma participação (a regra única que o servidor usa para tudo)
create or replace function public.jr_steps(p_pid uuid)
returns table (step_id uuid, pos int, name text, req_total int, req_done int, total int, done int, complete boolean, unlocked boolean, confirmed boolean)
language sql stable security definer set search_path = public as $$
  with pt as (select * from journey_participants where id = p_pid),
  j as (select jj.* from journeys jj join pt on pt.journey_id = jj.id),
  s as (
    select st.*,
      (select count(*) from journey_activities a where a.step_id = st.id and a.removed_at is null and a.required)::int as rt,
      (select count(*) from journey_activities a join journey_completions c on c.activity_id = a.id and c.participant_id = p_pid and c.status = 'done' where a.step_id = st.id and a.removed_at is null and a.required)::int as rd,
      (select count(*) from journey_activities a where a.step_id = st.id and a.removed_at is null)::int as t,
      (select count(*) from journey_activities a join journey_completions c on c.activity_id = a.id and c.participant_id = p_pid and c.status = 'done' where a.step_id = st.id and a.removed_at is null)::int as d,
      exists (select 1 from journey_step_progress sp where sp.participant_id = p_pid and sp.step_id = st.id and sp.confirmed_at is not null) as conf
    from journey_steps st where st.journey_id = (select journey_id from pt) and st.removed_at is null),
  c as (select s.*, (s.rd = s.rt and (s.completion_rule = 'all_required' or s.conf)) as comp from s)
  select c.id, c.position, c.name, c.rt, c.rd, c.t, c.d, c.comp,
    case (select step_mode from j)
      when 'free' then true
      when 'sequential' then not exists (select 1 from c p where p.position < c.position and not p.comp)
      else not exists (select 1 from c p where p.id = any (c.requires) and not p.comp) end,
    c.conf
  from c order by c.position, c.created_at
$$;
create or replace function public.jr_pct(p_pid uuid) returns int language sql stable security definer set search_path = public as $$
  select case when coalesce(sum(req_total), 0) = 0 then 0 else round(100.0 * sum(req_done) / sum(req_total))::int end from public.jr_steps(p_pid)
$$;
-- nível de quem acompanha: staff (administra/gerencia participantes), manager (responsável geral ou da pessoa), step (responsável de etapa/atividade) ou nulo
create or replace function public.jr_level(p_pid uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare pt journey_participants; j journeys;
begin
  select * into pt from journey_participants where id = p_pid; if pt.id is null then return null; end if;
  select * into j from journeys where id = pt.journey_id;
  if public.jr_can(pt.org_id, 'admin') or public.jr_can(pt.org_id, 'participants') then return 'staff'; end if;
  if not public.jr_can(pt.org_id, 'follow') then return null; end if;
  if j.owner_id = auth.uid() or pt.responsible_id = auth.uid() then return 'manager'; end if;
  if exists (select 1 from journey_steps where journey_id = j.id and removed_at is null and responsible_id = auth.uid())
     or exists (select 1 from journey_activities where journey_id = j.id and removed_at is null and responsible_id = auth.uid()) then return 'step'; end if;
  return null;
end $$;
create or replace function public.jr_is_self(p_pid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from journey_participants pt join people p on p.id = pt.person_id where pt.id = p_pid and p.user_id = auth.uid())
$$;

-- fecha etapas, abre as seguintes e conclui a jornada quando tudo o que é obrigatório foi feito
create or replace function public.jr_recalc(p_pid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pt journey_participants; j journeys; r record; v_before uuid[]; v_req int; v_all boolean; v_link text; v_pu uuid; v_resp uuid; v_opened boolean := false;
begin
  select * into pt from journey_participants where id = p_pid; if pt.id is null or pt.status <> 'active' then return; end if;
  select * into j from journeys where id = pt.journey_id;
  v_pu := public.jr_person_user(pt.person_id); v_resp := coalesce(pt.responsible_id, j.owner_id); v_link := '#/jornadas/' || p_pid;
  select coalesce(array_agg(step_id) filter (where unlocked), '{}') into v_before from public.jr_steps(p_pid);
  for r in select * from public.jr_steps(p_pid) loop
    if r.complete and r.total > 0 and not exists (select 1 from journey_step_progress where participant_id = p_pid and step_id = r.step_id) then
      insert into journey_step_progress (participant_id, step_id) values (p_pid, r.step_id) on conflict do nothing;
      perform public.jr_log(j.id, p_pid, pt.org_id, 'step_done', jsonb_build_object('step_id', r.step_id, 'name', r.name));
      perform public.jr_history(p_pid, 'Etapa concluída', r.name, 'step:' || p_pid || ':' || r.step_id);
      perform public.jr_notify(j.id, 'step_done', v_resp, 'Uma etapa da jornada foi concluída', '#/gestao-jornadas/' || j.id);
    elsif not r.complete and exists (select 1 from journey_step_progress where participant_id = p_pid and step_id = r.step_id) then
      delete from journey_step_progress where participant_id = p_pid and step_id = r.step_id;
      perform public.jr_log(j.id, p_pid, pt.org_id, 'step_reopen', jsonb_build_object('step_id', r.step_id, 'name', r.name));
    end if;
  end loop;
  for r in select * from public.jr_steps(p_pid) where unlocked and not (step_id = any (v_before)) loop
    v_opened := true;
    perform public.jr_log(j.id, p_pid, pt.org_id, 'step_open', jsonb_build_object('step_id', r.step_id, 'name', r.name));
    perform public.jr_notify(j.id, 'step_open', v_pu, 'Uma nova etapa da sua jornada está disponível', v_link, not pt.notify);
  end loop;
  if j.auto_finish then
    select coalesce(sum(req_total), 0), coalesce(bool_and(complete), false) into v_req, v_all from public.jr_steps(p_pid);
    if v_req > 0 and v_all then
      update journey_participants set status = 'completed', completed_at = now(), updated_at = now() where id = p_pid;
      perform public.jr_log(j.id, p_pid, pt.org_id, 'complete', jsonb_build_object('auto', true));
      perform public.jr_history(p_pid, 'Jornada concluída', null, 'done:' || p_pid);
      perform public.jr_notify(j.id, 'done', v_pu, 'Você concluiu uma jornada. Parabéns!', v_link, not pt.notify);
      perform public.jr_notify(j.id, 'done', v_resp, 'Uma pessoa concluiu a jornada', '#/gestao-jornadas/' || j.id);
    end if;
  end if;
  if v_opened then perform public.jr_auto_sync(p_pid); end if;
end $$;
create or replace function public.jr_recalc_all(p_journey uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from journey_participants where journey_id = p_journey and status = 'active' loop perform public.jr_recalc(r.id); end loop;
end $$;
-- atividades "automáticas" (evento já realizado) são concluídas pelo servidor, sem ninguém marcar
create or replace function public.jr_auto_sync(p_pid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pt journey_participants; n int;
begin
  select * into pt from journey_participants where id = p_pid; if pt.id is null or pt.status <> 'active' then return; end if;
  insert into journey_completions (participant_id, activity_id, org_id, status, source, done_at)
  select p_pid, a.id, pt.org_id, 'done', 'auto', now() from journey_activities a join journey_steps s on s.id = a.step_id join church_events e on e.id = a.event_id
   where a.journey_id = pt.journey_id and a.removed_at is null and s.removed_at is null and a.completion_mode = 'auto' and e.starts_at <= now()
     and e.starts_at >= coalesce(pt.started_on, pt.created_at::date)::timestamptz
     and exists (select 1 from public.jr_steps(p_pid) x where x.step_id = a.step_id and x.unlocked)
     and not exists (select 1 from journey_completions c where c.participant_id = p_pid and c.activity_id = a.id)
  on conflict do nothing;
  get diagnostics n = row_count;
  if n > 0 then perform public.jr_recalc(p_pid); end if;
end $$;
create or replace function public.jr_current(p_pid uuid) returns table (step_id uuid, name text) language sql stable security definer set search_path = public as $$
  select step_id, name from public.jr_steps(p_pid) where unlocked and not complete order by pos limit 1
$$;
revoke execute on function public.jr_today(), public.jr_log(uuid, uuid, uuid, text, jsonb), public.jr_notify(uuid, text, uuid, text, text, boolean), public.jr_history(uuid, text, text, text),
  public.jr_person_user(uuid), public.jr_steps(uuid), public.jr_pct(uuid), public.jr_level(uuid), public.jr_is_self(uuid), public.jr_recalc(uuid), public.jr_recalc_all(uuid), public.jr_auto_sync(uuid), public.jr_current(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- construtor: jornada
create or replace function public.jr_check_follower(p_org uuid, p_user uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_user is not null and not (p_user in (select public.jr_users(p_org, 'follow'))) then raise exception 'invalid_responsible'; end if;
end $$;
create or replace function public.jr_bump(p_journey uuid, p_version int) returns void
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  select version into v from journeys where id = p_journey for update;
  if p_version is not null and p_version <> v then raise exception 'version_conflict'; end if;
  update journeys set version = version + 1, updated_at = now() where id = p_journey;
end $$;
revoke execute on function public.jr_check_follower(uuid, uuid), public.jr_bump(uuid, int) from public, anon, authenticated;

create or replace function public.journey_save(p_org uuid, p_id uuid, p jsonb, p_version int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j journeys; v_id uuid; v_name text; v_vis text; v_mode text; v_owner uuid; v_team uuid; v_cls text[]; v_notify jsonb; v_img text; k text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.jr_can(p_org, 'admin') then raise exception 'forbidden'; end if;
  if p_id is not null then
    select * into j from journeys where id = p_id and org_id = p_org; if j.id is null then raise exception 'not_found'; end if;
    if j.status = 'archived' then raise exception 'journey_archived'; end if;
    if p_version is not null and p_version <> j.version then raise exception 'version_conflict'; end if;
  end if;
  v_name := trim(coalesce(p->>'name', j.name, ''));
  if length(v_name) < 1 then raise exception 'name_required'; end if;
  if length(v_name) > 120 then raise exception 'name_too_long'; end if;
  v_vis := coalesce(nullif(p->>'visibility', ''), j.visibility, 'private'); if v_vis not in ('public','private') then raise exception 'invalid_visibility'; end if;
  v_mode := coalesce(nullif(p->>'step_mode', ''), j.step_mode, 'sequential'); if v_mode not in ('sequential','free','conditional') then raise exception 'invalid_step_mode'; end if;
  v_owner := case when p ? 'owner_id' then nullif(p->>'owner_id', '')::uuid else j.owner_id end; perform public.jr_check_follower(p_org, v_owner);
  v_team := case when p ? 'team_id' then nullif(p->>'team_id', '')::uuid else j.team_id end;
  if v_team is not null and not exists (select 1 from teams where id = v_team and org_id = p_org) then raise exception 'invalid_team'; end if;
  v_cls := case when p ? 'eligible_classes' then (select array_agg(x) from jsonb_array_elements_text(coalesce(p->'eligible_classes', '[]'::jsonb)) x) else j.eligible_classes end;
  if v_cls is not null and (cardinality(v_cls) = 0) then v_cls := null; end if;
  if v_cls is not null and not (v_cls <@ array['member','attender','visitor','none']::text[]) then raise exception 'invalid_classification'; end if;
  v_img := case when p ? 'image_url' then nullif(trim(coalesce(p->>'image_url', '')), '') else j.image_url end;
  if v_img is not null and v_img !~* '^https?://' then raise exception 'invalid_url'; end if;
  v_notify := coalesce(j.notify, '{"invite":true,"enroll":true,"step_open":true,"assign":true,"approve":true,"step_done":true,"done":true,"responsible":true}'::jsonb);
  if p ? 'notify' then
    for k in select jsonb_object_keys(p->'notify') loop
      if k not in ('invite','enroll','step_open','assign','approve','step_done','done','responsible') then raise exception 'invalid_notify'; end if;
      v_notify := v_notify || jsonb_build_object(k, coalesce((p->'notify'->>k)::boolean, false));
    end loop;
  end if;
  if p_id is null then
    insert into journeys (org_id, name, description, image_url, objective, audience, owner_id, team_id, visibility, step_mode, enroll_voluntary, eligible_classes, auto_finish, for_converts, auto_rule, notify, created_by)
    values (p_org, v_name, nullif(trim(coalesce(p->>'description', '')), ''), v_img, nullif(trim(coalesce(p->>'objective', '')), ''), nullif(trim(coalesce(p->>'audience', '')), ''), v_owner, v_team, v_vis, v_mode,
            coalesce((p->>'enroll_voluntary')::boolean, false), v_cls, coalesce((p->>'auto_finish')::boolean, true), coalesce((p->>'for_converts')::boolean, false),
            case when p ? 'auto_rule' then p->'auto_rule' end, v_notify, auth.uid())
    returning id into v_id;
    perform public.jr_log(v_id, null, p_org, 'create', jsonb_build_object('name', v_name));
    return jsonb_build_object('saved', true, 'id', v_id, 'version', 1);
  end if;
  update journeys set name = v_name, description = case when p ? 'description' then nullif(trim(coalesce(p->>'description', '')), '') else description end, image_url = v_img,
         objective = case when p ? 'objective' then nullif(trim(coalesce(p->>'objective', '')), '') else objective end, audience = case when p ? 'audience' then nullif(trim(coalesce(p->>'audience', '')), '') else audience end,
         owner_id = v_owner, team_id = v_team, visibility = v_vis, step_mode = v_mode, enroll_voluntary = coalesce((p->>'enroll_voluntary')::boolean, enroll_voluntary), eligible_classes = v_cls,
         auto_finish = coalesce((p->>'auto_finish')::boolean, auto_finish), for_converts = coalesce((p->>'for_converts')::boolean, for_converts),
         auto_rule = case when p ? 'auto_rule' then p->'auto_rule' else auto_rule end, notify = v_notify, version = version + 1, updated_at = now()
   where id = p_id;
  if v_owner is distinct from j.owner_id then
    perform public.jr_log(p_id, null, p_org, 'owner', jsonb_build_object('from', j.owner_id, 'to', v_owner));
    perform public.jr_notify(p_id, 'responsible', v_owner, 'Você foi designado(a) responsável por uma jornada', '#/gestao-jornadas/' || p_id);
  end if;
  perform public.jr_log(p_id, null, p_org, 'update', jsonb_build_object('name', v_name));
  if v_mode is distinct from j.step_mode then perform public.jr_recalc_all(p_id); end if;
  return jsonb_build_object('saved', true, 'id', p_id, 'version', j.version + 1);
end $$;

create or replace function public.journey_set_status(p_id uuid, p_status text, p_version int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j journeys;
begin
  select * into j from journeys where id = p_id; if j.id is null then raise exception 'not_found'; end if;
  if not public.jr_can(j.org_id, 'admin') then raise exception 'forbidden'; end if;
  if p_status not in ('draft','active','paused','archived') then raise exception 'invalid_status'; end if;
  if p_version is not null and p_version <> j.version then raise exception 'version_conflict'; end if;
  if p_status = j.status then return jsonb_build_object('ok', true, 'changed', false); end if;
  if p_status = 'active' and not exists (select 1 from journey_activities a join journey_steps s on s.id = a.step_id where a.journey_id = p_id and a.removed_at is null and s.removed_at is null) then raise exception 'journey_empty'; end if;
  if p_status = 'draft' and exists (select 1 from journey_participants where journey_id = p_id and status in ('active','paused','completed')) then raise exception 'has_participants'; end if;
  update journeys set status = p_status, archived_at = case when p_status = 'archived' then now() else null end, version = version + 1, updated_at = now() where id = p_id;
  perform public.jr_log(p_id, null, j.org_id, 'status', jsonb_build_object('from', j.status, 'to', p_status));
  return jsonb_build_object('ok', true, 'changed', true);
end $$;

create or replace function public.journey_duplicate(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j journeys; v_new uuid; s record; v_sid uuid; v_map jsonb := '{}'::jsonb; r record;
begin
  select * into j from journeys where id = p_id; if j.id is null then raise exception 'not_found'; end if;
  if not public.jr_can(j.org_id, 'admin') then raise exception 'forbidden'; end if;
  insert into journeys (org_id, name, description, image_url, objective, audience, owner_id, team_id, visibility, status, step_mode, enroll_voluntary, eligible_classes, auto_finish, for_converts, auto_rule, notify, created_by)
  values (j.org_id, left('Cópia de ' || j.name, 120), j.description, j.image_url, j.objective, j.audience, j.owner_id, j.team_id, j.visibility, 'draft', j.step_mode, j.enroll_voluntary, j.eligible_classes, j.auto_finish, j.for_converts, j.auto_rule, j.notify, auth.uid())
  returning id into v_new;
  for s in select * from journey_steps where journey_id = p_id and removed_at is null order by position loop
    insert into journey_steps (journey_id, org_id, name, description, position, responsible_id, completion_rule, requires) values (v_new, s.org_id, s.name, s.description, s.position, s.responsible_id, s.completion_rule, '{}') returning id into v_sid;
    v_map := v_map || jsonb_build_object(s.id::text, v_sid);
    insert into journey_activities (step_id, journey_id, org_id, title, description, kind, instructions, content_url, content_text, event_id, responsible_id, completion_mode, required, position)
    select v_sid, v_new, a.org_id, a.title, a.description, a.kind, a.instructions, a.content_url, a.content_text, a.event_id, a.responsible_id, a.completion_mode, a.required, a.position
      from journey_activities a where a.step_id = s.id and a.removed_at is null order by a.position;
  end loop;
  for r in select id, requires from journey_steps where journey_id = p_id and removed_at is null and cardinality(requires) > 0 loop
    update journey_steps set requires = coalesce((select array_agg((v_map->>x::text)::uuid) from unnest(r.requires) x where v_map ? x::text), '{}')
     where id = (v_map->>r.id::text)::uuid;
  end loop;
  perform public.jr_log(v_new, null, j.org_id, 'duplicate', jsonb_build_object('from', p_id));
  return jsonb_build_object('saved', true, 'id', v_new);
end $$;

-- ---------------------------------------------------------------- construtor: etapas e atividades
create or replace function public.journey_step_save(p_journey uuid, p_id uuid, p jsonb, p_version int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j journeys; st journey_steps; v_name text; v_rule text; v_resp uuid; v_req uuid[]; v_pos int; v_new uuid;
begin
  select * into j from journeys where id = p_journey; if j.id is null then raise exception 'not_found'; end if;
  if not public.jr_can(j.org_id, 'admin') then raise exception 'forbidden'; end if;
  if j.status = 'archived' then raise exception 'journey_archived'; end if;
  if p_id is not null then select * into st from journey_steps where id = p_id and journey_id = p_journey and removed_at is null; if st.id is null then raise exception 'not_found'; end if; end if;
  v_name := trim(coalesce(p->>'name', st.name, '')); if length(v_name) < 1 then raise exception 'name_required'; end if; if length(v_name) > 120 then raise exception 'name_too_long'; end if;
  if length(coalesce(p->>'description', '')) > 500 then raise exception 'text_too_long'; end if;
  v_rule := coalesce(nullif(p->>'completion_rule', ''), st.completion_rule, 'all_required'); if v_rule not in ('all_required','manual') then raise exception 'invalid_rule'; end if;
  v_resp := case when p ? 'responsible_id' then nullif(p->>'responsible_id', '')::uuid else st.responsible_id end; perform public.jr_check_follower(j.org_id, v_resp);
  v_pos := coalesce(st.position, (select coalesce(max(position), 0) + 1 from journey_steps where journey_id = p_journey and removed_at is null));
  v_req := case when p ? 'requires' then (select coalesce(array_agg(x::uuid), '{}') from jsonb_array_elements_text(coalesce(p->'requires', '[]'::jsonb)) x) else coalesce(st.requires, '{}') end;
  if cardinality(v_req) > 0 and exists (select 1 from unnest(v_req) x where not exists (select 1 from journey_steps s2 where s2.id = x and s2.journey_id = p_journey and s2.removed_at is null and s2.position < v_pos)) then raise exception 'invalid_requires'; end if;
  perform public.jr_bump(p_journey, p_version);
  if p_id is null then
    insert into journey_steps (journey_id, org_id, name, description, position, responsible_id, completion_rule, requires)
    values (p_journey, j.org_id, v_name, nullif(trim(coalesce(p->>'description', '')), ''), v_pos, v_resp, v_rule, v_req) returning id into v_new;
    perform public.jr_log(p_journey, null, j.org_id, 'step_add', jsonb_build_object('name', v_name));
    perform public.jr_recalc_all(p_journey);
    return jsonb_build_object('saved', true, 'id', v_new);
  end if;
  update journey_steps set name = v_name, description = case when p ? 'description' then nullif(trim(coalesce(p->>'description', '')), '') else description end, responsible_id = v_resp, completion_rule = v_rule, requires = v_req where id = p_id;
  perform public.jr_log(p_journey, null, j.org_id, 'step_edit', jsonb_build_object('name', v_name));
  perform public.jr_recalc_all(p_journey);
  return jsonb_build_object('saved', true, 'id', p_id);
end $$;

create or replace function public.journey_step_remove(p_id uuid, p_version int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st journey_steps; j journeys; v_used boolean;
begin
  select * into st from journey_steps where id = p_id and removed_at is null; if st.id is null then raise exception 'not_found'; end if;
  select * into j from journeys where id = st.journey_id;
  if not public.jr_can(j.org_id, 'admin') then raise exception 'forbidden'; end if;
  if exists (select 1 from journey_activities where step_id = p_id and removed_at is null) then raise exception 'step_not_empty'; end if;
  perform public.jr_bump(j.id, p_version);
  select exists (select 1 from journey_completions c join journey_activities a on a.id = c.activity_id where a.step_id = p_id) or exists (select 1 from journey_step_progress where step_id = p_id) into v_used;
  if v_used then update journey_steps set removed_at = now() where id = p_id; else delete from journey_steps where id = p_id; end if;
  update journey_steps set requires = array_remove(requires, p_id) where journey_id = j.id;
  perform public.jr_log(j.id, null, j.org_id, 'step_remove', jsonb_build_object('name', st.name, 'kept', v_used));
  perform public.jr_recalc_all(j.id);
  return jsonb_build_object('ok', true, 'kept', v_used);
end $$;

create or replace function public.journey_activity_save(p_step uuid, p_id uuid, p jsonb, p_version int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st journey_steps; j journeys; a journey_activities; v_title text; v_kind text; v_mode text; v_resp uuid; v_ev uuid; v_url text; v_new uuid; v_pos int; v_req boolean;
begin
  select * into st from journey_steps where id = p_step and removed_at is null; if st.id is null then raise exception 'not_found'; end if;
  select * into j from journeys where id = st.journey_id;
  if not public.jr_can(j.org_id, 'admin') then raise exception 'forbidden'; end if;
  if j.status = 'archived' then raise exception 'journey_archived'; end if;
  if p_id is not null then select * into a from journey_activities where id = p_id and step_id = p_step and removed_at is null; if a.id is null then raise exception 'not_found'; end if; end if;
  v_title := trim(coalesce(p->>'title', a.title, '')); if length(v_title) < 1 then raise exception 'name_required'; end if; if length(v_title) > 160 then raise exception 'name_too_long'; end if;
  v_kind := coalesce(nullif(p->>'kind', ''), a.kind, 'text'); if v_kind not in ('text','video','file','link','reading','quiz','task','meeting','event','accompanied') then raise exception 'invalid_kind'; end if;
  v_mode := coalesce(nullif(p->>'completion_mode', ''), a.completion_mode, 'self'); if v_mode not in ('self','responsible','auto','approval') then raise exception 'invalid_mode'; end if;
  v_resp := case when p ? 'responsible_id' then nullif(p->>'responsible_id', '')::uuid else a.responsible_id end; perform public.jr_check_follower(j.org_id, v_resp);
  v_ev := case when p ? 'event_id' then nullif(p->>'event_id', '')::uuid else a.event_id end;
  if v_ev is not null and not exists (select 1 from church_events where id = v_ev and org_id = j.org_id) then raise exception 'invalid_event'; end if;
  v_url := case when p ? 'content_url' then nullif(trim(coalesce(p->>'content_url', '')), '') else a.content_url end;
  if v_url is not null and v_url !~* '^https?://' then raise exception 'invalid_url'; end if;
  if v_mode = 'auto' and v_ev is null then raise exception 'auto_needs_event'; end if;
  if v_mode in ('responsible','approval') and v_resp is null and j.owner_id is null then null; end if;
  v_req := coalesce((p->>'required')::boolean, a.required, true);
  if length(coalesce(p->>'description', '')) > 1000 or length(coalesce(p->>'instructions', '')) > 1000 or length(coalesce(p->>'content_text', '')) > 4000 then raise exception 'text_too_long'; end if;
  v_pos := coalesce(a.position, (select coalesce(max(position), 0) + 1 from journey_activities where step_id = p_step and removed_at is null));
  perform public.jr_bump(j.id, p_version);
  if p_id is null then
    insert into journey_activities (step_id, journey_id, org_id, title, description, kind, instructions, content_url, content_text, event_id, responsible_id, completion_mode, required, position)
    values (p_step, j.id, j.org_id, v_title, nullif(trim(coalesce(p->>'description', '')), ''), v_kind, nullif(trim(coalesce(p->>'instructions', '')), ''), v_url, nullif(trim(coalesce(p->>'content_text', '')), ''), v_ev, v_resp, v_mode, v_req, v_pos)
    returning id into v_new;
    perform public.jr_log(j.id, null, j.org_id, 'activity_add', jsonb_build_object('title', v_title, 'kind', v_kind));
    perform public.jr_recalc_all(j.id);
    return jsonb_build_object('saved', true, 'id', v_new);
  end if;
  update journey_activities set title = v_title, description = case when p ? 'description' then nullif(trim(coalesce(p->>'description', '')), '') else description end, kind = v_kind,
         instructions = case when p ? 'instructions' then nullif(trim(coalesce(p->>'instructions', '')), '') else instructions end, content_url = v_url,
         content_text = case when p ? 'content_text' then nullif(trim(coalesce(p->>'content_text', '')), '') else content_text end, event_id = v_ev, responsible_id = v_resp, completion_mode = v_mode, required = v_req where id = p_id;
  perform public.jr_log(j.id, null, j.org_id, 'activity_edit', jsonb_build_object('title', v_title));
  perform public.jr_recalc_all(j.id);
  return jsonb_build_object('saved', true, 'id', p_id);
end $$;

create or replace function public.journey_activity_remove(p_id uuid, p_version int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a journey_activities; j journeys; v_used boolean;
begin
  select * into a from journey_activities where id = p_id and removed_at is null; if a.id is null then raise exception 'not_found'; end if;
  select * into j from journeys where id = a.journey_id;
  if not public.jr_can(j.org_id, 'admin') then raise exception 'forbidden'; end if;
  perform public.jr_bump(j.id, p_version);
  select exists (select 1 from journey_completions where activity_id = p_id) into v_used;
  if v_used then update journey_activities set removed_at = now() where id = p_id; else delete from journey_activities where id = p_id; end if;
  perform public.jr_log(j.id, null, j.org_id, 'activity_remove', jsonb_build_object('title', a.title, 'kept', v_used));
  perform public.jr_recalc_all(j.id);
  return jsonb_build_object('ok', true, 'kept', v_used);
end $$;

create or replace function public.journey_reorder(p_kind text, p_parent uuid, p_ids uuid[], p_version int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_j uuid; v_org uuid; v_n int; i int;
begin
  if p_kind = 'step' then select id, org_id into v_j, v_org from journeys where id = p_parent;
  elsif p_kind = 'activity' then select s.journey_id, s.org_id into v_j, v_org from journey_steps s where s.id = p_parent and s.removed_at is null;
  else raise exception 'invalid_kind'; end if;
  if v_j is null then raise exception 'not_found'; end if;
  if not public.jr_can(v_org, 'admin') then raise exception 'forbidden'; end if;
  if p_kind = 'step' then
    select count(*) into v_n from journey_steps where journey_id = p_parent and removed_at is null;
    if coalesce(cardinality(p_ids), 0) <> v_n or exists (select 1 from unnest(p_ids) x where not exists (select 1 from journey_steps where id = x and journey_id = p_parent and removed_at is null)) or (select count(distinct x) from unnest(p_ids) x) <> v_n then raise exception 'invalid_order'; end if;
  else
    select count(*) into v_n from journey_activities where step_id = p_parent and removed_at is null;
    if coalesce(cardinality(p_ids), 0) <> v_n or exists (select 1 from unnest(p_ids) x where not exists (select 1 from journey_activities where id = x and step_id = p_parent and removed_at is null)) or (select count(distinct x) from unnest(p_ids) x) <> v_n then raise exception 'invalid_order'; end if;
  end if;
  perform public.jr_bump(v_j, p_version);
  for i in 1 .. coalesce(cardinality(p_ids), 0) loop
    if p_kind = 'step' then update journey_steps set position = i where id = p_ids[i]; else update journey_activities set position = i where id = p_ids[i]; end if;
  end loop;
  if p_kind = 'step' then   -- pré-requisito só pode apontar para etapa anterior
    update journey_steps s set requires = coalesce((select array_agg(x) from unnest(s.requires) x where exists (select 1 from journey_steps o where o.id = x and o.position < s.position)), '{}') where s.journey_id = v_j;
  end if;
  perform public.jr_log(v_j, null, v_org, 'reorder', jsonb_build_object('kind', p_kind));
  perform public.jr_recalc_all(v_j);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- consulta administrativa
create or replace function public.jr_staff_of(p_journey uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare j journeys;
begin
  select * into j from journeys where id = p_journey; if j.id is null then return false; end if;
  if public.jr_can(j.org_id, 'admin') or public.jr_can(j.org_id, 'participants') or public.jr_can(j.org_id, 'indicators') then return true; end if;
  if not public.jr_can(j.org_id, 'follow') then return false; end if;
  return coalesce(j.owner_id = auth.uid(), false) or exists (select 1 from journey_participants where journey_id = p_journey and responsible_id = auth.uid())
      or exists (select 1 from journey_steps where journey_id = p_journey and removed_at is null and responsible_id = auth.uid())
      or exists (select 1 from journey_activities where journey_id = p_journey and removed_at is null and responsible_id = auth.uid());
end $$;
revoke execute on function public.jr_staff_of(uuid) from public, anon, authenticated;

create or replace function public.journey_list(p_org uuid, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_status text := nullif(p->>'status', ''); v_q text := nullif(trim(coalesce(p->>'q', '')), ''); v_res jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not (public.jr_can(p_org, 'admin') or public.jr_can(p_org, 'participants') or public.jr_can(p_org, 'follow') or public.jr_can(p_org, 'indicators')) then raise exception 'forbidden'; end if;
  if v_status is not null and v_status not in ('draft','active','paused','archived') then raise exception 'invalid_filter'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'name', j.name, 'description', j.description, 'image_url', j.image_url, 'status', j.status, 'visibility', j.visibility, 'for_converts', j.for_converts,
      'owner_name', case when j.owner_id is null then null else coalesce(public.welcome_name(j.org_id, j.owner_id), 'Usuário removido') end,
      'steps', (select count(*) from journey_steps s where s.journey_id = j.id and s.removed_at is null),
      'participants', (select count(*) from journey_participants x where x.journey_id = j.id and x.status <> 'cancelled'),
      'active', (select count(*) from journey_participants x where x.journey_id = j.id and x.status = 'active'),
      'completed', (select count(*) from journey_participants x where x.journey_id = j.id and x.status = 'completed')) order by (j.status = 'archived'), j.created_at desc), '[]'::jsonb) into v_res
    from journeys j where j.org_id = p_org and (v_status is null or j.status = v_status) and (v_q is null or j.name ilike '%' || v_q || '%') and public.jr_staff_of(j.id);
  return jsonb_build_object('items', v_res, 'can_admin', public.jr_can(p_org, 'admin'), 'can_indicators', public.jr_can(p_org, 'indicators') or public.jr_can(p_org, 'admin'), 'can_participants', public.jr_can(p_org, 'participants') or public.jr_can(p_org, 'admin'));
end $$;

create or replace function public.journey_get(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j journeys; v_steps jsonb;
begin
  select * into j from journeys where id = p_id; if j.id is null then raise exception 'not_found'; end if;
  if not public.jr_staff_of(p_id) then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description, 'position', s.position, 'responsible_id', s.responsible_id,
      'responsible_name', case when s.responsible_id is null then null else coalesce(public.welcome_name(j.org_id, s.responsible_id), 'Usuário removido') end, 'completion_rule', s.completion_rule, 'requires', s.requires,
      'activities', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'description', a.description, 'kind', a.kind, 'instructions', a.instructions, 'content_url', a.content_url, 'content_text', a.content_text,
          'event_id', a.event_id, 'event_title', (select title from church_events where id = a.event_id), 'responsible_id', a.responsible_id, 'completion_mode', a.completion_mode, 'required', a.required, 'position', a.position) order by a.position, a.created_at)
        from journey_activities a where a.step_id = s.id and a.removed_at is null), '[]'::jsonb)) order by s.position, s.created_at), '[]'::jsonb) into v_steps
    from journey_steps s where s.journey_id = p_id and s.removed_at is null;
  return jsonb_build_object('id', j.id, 'org_id', j.org_id, 'name', j.name, 'description', j.description, 'image_url', j.image_url, 'objective', j.objective, 'audience', j.audience, 'owner_id', j.owner_id,
    'owner_name', case when j.owner_id is null then null else coalesce(public.welcome_name(j.org_id, j.owner_id), 'Usuário removido') end, 'team_id', j.team_id, 'team_name', (select name from teams where id = j.team_id),
    'visibility', j.visibility, 'status', j.status, 'step_mode', j.step_mode, 'enroll_voluntary', j.enroll_voluntary, 'eligible_classes', j.eligible_classes, 'auto_finish', j.auto_finish, 'for_converts', j.for_converts,
    'auto_rule', j.auto_rule, 'notify', j.notify, 'version', j.version, 'created_at', j.created_at, 'created_by_name', case when j.created_by is null then null else coalesce(public.welcome_name(j.org_id, j.created_by), 'Usuário removido') end,
    'steps', v_steps, 'can_edit', public.jr_can(j.org_id, 'admin') and j.status <> 'archived', 'can_admin', public.jr_can(j.org_id, 'admin'), 'can_participants', public.jr_can(j.org_id, 'participants') or public.jr_can(j.org_id, 'admin'),
    'log', case when public.jr_can(j.org_id, 'admin') then coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'detail', l.detail, 'at', l.at, 'by', case when l.actor is null then 'Sistema' else coalesce(public.welcome_name(l.org_id, l.actor), 'Usuário removido') end) order by l.at desc, l.id desc)
        from (select * from journey_log where journey_id = p_id and participant_id is null order by at desc, id desc limit 50) l), '[]'::jsonb) else '[]'::jsonb end);
end $$;

create or replace function public.journey_responsibles(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.jr_can(p_org, 'admin') or public.jr_can(p_org, 'participants')) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', u, 'name', coalesce(public.welcome_name(p_org, u), 'Sem nome')) order by coalesce(public.welcome_name(p_org, u), '')) from (select distinct public.jr_users(p_org, 'follow') u) x
                   where exists (select 1 from org_members where org_id = p_org and user_id = x.u)), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- participantes
create or replace function public.jr_person_ok(p_org uuid, p_person uuid) returns people
language sql stable security definer set search_path = public as $$
  select * from people where id = p_person and org_id = p_org and status in ('active','inactive','pending')
$$;
revoke execute on function public.jr_person_ok(uuid, uuid) from public, anon, authenticated;

create or replace function public.journey_enroll(p_journey uuid, p_person uuid, p_responsible uuid default null, p_start boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j journeys; pe people; v_id uuid; v_status text := case when coalesce(p_start, true) then 'active' else 'waiting' end;
begin
  select * into j from journeys where id = p_journey; if j.id is null then raise exception 'not_found'; end if;
  if not (public.jr_can(j.org_id, 'admin') or public.jr_can(j.org_id, 'participants')) then raise exception 'forbidden'; end if;
  if j.status <> 'active' then raise exception 'journey_not_active'; end if;
  select * into pe from public.jr_person_ok(j.org_id, p_person); if pe.id is null then raise exception 'person_not_found'; end if;
  perform public.jr_check_follower(j.org_id, p_responsible);
  begin
    insert into journey_participants (journey_id, org_id, person_id, status, responsible_id, source, started_on, added_by)
    values (p_journey, j.org_id, p_person, v_status, coalesce(p_responsible, j.owner_id), 'admin', case when v_status = 'active' then public.jr_today() end, auth.uid()) returning id into v_id;
  exception when unique_violation then raise exception 'already_participant'; end;
  perform public.jr_log(p_journey, v_id, j.org_id, 'enroll', jsonb_build_object('person_id', p_person, 'status', v_status));
  perform public.jr_history(v_id, case when v_status = 'active' then 'Entrou em uma jornada' else 'Convidado(a) para uma jornada' end, null, 'enroll:' || v_id);
  perform public.jr_notify(p_journey, case when v_status = 'active' then 'enroll' else 'invite' end, pe.user_id, case when v_status = 'active' then 'Você foi incluído(a) em uma jornada' else 'Você foi convidado(a) para uma jornada' end, '#/jornadas/' || v_id);
  if coalesce(p_responsible, j.owner_id) is not null then perform public.jr_notify(p_journey, 'assign', coalesce(p_responsible, j.owner_id), 'Você acompanha uma nova pessoa em uma jornada', '#/gestao-jornadas/' || p_journey); end if;
  if v_status = 'active' then perform public.jr_auto_sync(v_id); perform public.jr_recalc(v_id); end if;
  return jsonb_build_object('saved', true, 'id', v_id);
end $$;

create or replace function public.journey_self_enroll(p_journey uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j journeys; pe people; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into j from journeys where id = p_journey; if j.id is null then raise exception 'not_found'; end if;
  if not exists (select 1 from org_members where org_id = j.org_id and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  if j.visibility <> 'public' or not j.enroll_voluntary then raise exception 'forbidden'; end if;
  if j.status <> 'active' then raise exception 'journey_not_active'; end if;
  select * into pe from people where org_id = j.org_id and user_id = auth.uid() and status in ('active','inactive','pending') order by created_at limit 1;
  if pe.id is null then raise exception 'no_person_record'; end if;
  if j.eligible_classes is not null and not (pe.classification = any (j.eligible_classes)) then raise exception 'not_eligible'; end if;
  begin
    insert into journey_participants (journey_id, org_id, person_id, status, responsible_id, source, started_on, added_by)
    values (p_journey, j.org_id, pe.id, 'active', j.owner_id, 'self', public.jr_today(), auth.uid()) returning id into v_id;
  exception when unique_violation then raise exception 'already_participant'; end;
  perform public.jr_log(p_journey, v_id, j.org_id, 'enroll', jsonb_build_object('self', true));
  perform public.jr_history(v_id, 'Entrou em uma jornada', null, 'enroll:' || v_id);
  perform public.jr_auto_sync(v_id); perform public.jr_recalc(v_id);
  return jsonb_build_object('saved', true, 'id', v_id);
end $$;

-- inclusão por critérios: só cria CONVITES (aguardando início); a pessoa decide se aceita
create or replace function public.journey_apply_rule(p_journey uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j journeys; r record; v_id uuid; n int := 0; v_cls text[];
begin
  select * into j from journeys where id = p_journey; if j.id is null then raise exception 'not_found'; end if;
  if not public.jr_can(j.org_id, 'admin') then raise exception 'forbidden'; end if;
  if j.status <> 'active' then raise exception 'journey_not_active'; end if;
  if j.auto_rule is null then raise exception 'no_rule'; end if;
  v_cls := (select array_agg(x) from jsonb_array_elements_text(coalesce(j.auto_rule->'classes', '[]'::jsonb)) x);
  if v_cls is null or cardinality(v_cls) = 0 then raise exception 'no_rule'; end if;
  for r in select p.id, p.user_id from people p where p.org_id = j.org_id and p.status = 'active' and p.classification = any (v_cls)
              and (j.eligible_classes is null or p.classification = any (j.eligible_classes))
              and not exists (select 1 from journey_participants x where x.journey_id = p_journey and x.person_id = p.id and x.status <> 'cancelled') limit 500 loop
    insert into journey_participants (journey_id, org_id, person_id, status, responsible_id, source, added_by) values (p_journey, j.org_id, r.id, 'waiting', j.owner_id, 'rule', auth.uid()) returning id into v_id;
    perform public.jr_log(p_journey, v_id, j.org_id, 'enroll', jsonb_build_object('rule', true));
    perform public.jr_history(v_id, 'Convidado(a) para uma jornada', null, 'enroll:' || v_id);
    perform public.jr_notify(p_journey, 'invite', r.user_id, 'Você foi convidado(a) para uma jornada', '#/jornadas/' || v_id);
    n := n + 1;
  end loop;
  perform public.jr_log(p_journey, null, j.org_id, 'apply_rule', jsonb_build_object('invited', n));
  return jsonb_build_object('ok', true, 'invited', n);
end $$;

create or replace function public.journey_respond(p_pid uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pt journey_participants; j journeys;
begin
  select * into pt from journey_participants where id = p_pid; if pt.id is null or not public.jr_is_self(p_pid) then raise exception 'forbidden'; end if;
  if pt.status <> 'waiting' then raise exception 'invalid_status'; end if;
  select * into j from journeys where id = pt.journey_id;
  if p_accept then
    if j.status <> 'active' then raise exception 'journey_not_active'; end if;
    update journey_participants set status = 'active', started_on = public.jr_today(), updated_at = now() where id = p_pid;
    perform public.jr_log(j.id, p_pid, pt.org_id, 'accept', '{}'::jsonb);
    perform public.jr_history(p_pid, 'Começou uma jornada', null, 'start:' || p_pid);
    perform public.jr_notify(j.id, 'enroll', coalesce(pt.responsible_id, j.owner_id), 'Uma pessoa aceitou começar a jornada', '#/gestao-jornadas/' || j.id);
    perform public.jr_auto_sync(p_pid); perform public.jr_recalc(p_pid);
  else
    update journey_participants set status = 'cancelled', cancel_reason = 'declined', updated_at = now() where id = p_pid;   -- a recusa não altera cadastro nem decisão
    perform public.jr_log(j.id, p_pid, pt.org_id, 'decline', '{}'::jsonb);
    perform public.jr_history(p_pid, 'Convite para jornada recusado', null, 'decline:' || p_pid);
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.journey_participant_status(p_pid uuid, p_action text, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pt journey_participants; j journeys; v_lvl text; v_self boolean; v_new text; v_pu uuid; v_req int; v_all boolean; v_title text;
begin
  select * into pt from journey_participants where id = p_pid; if pt.id is null then raise exception 'not_found'; end if;
  select * into j from journeys where id = pt.journey_id; v_lvl := coalesce(public.jr_level(p_pid), 'none'); v_self := public.jr_is_self(p_pid); v_pu := public.jr_person_user(pt.person_id);
  if v_lvl = 'none' and not v_self then raise exception 'forbidden'; end if;
  if p_action in ('pause','resume','cancel') then
    if not (v_self or v_lvl in ('staff','manager')) then raise exception 'forbidden'; end if;
  elsif p_action in ('start','complete') then
    if v_lvl not in ('staff','manager') then raise exception 'forbidden'; end if;
  elsif p_action = 'reopen' then
    if not public.jr_can(pt.org_id, 'admin') then raise exception 'forbidden'; end if;
  else raise exception 'invalid_action'; end if;
  if p_action = 'start' and pt.status = 'waiting' then v_new := 'active'; v_title := 'Começou uma jornada';
  elsif p_action = 'pause' and pt.status = 'active' then v_new := 'paused'; v_title := 'Jornada pausada';
  elsif p_action = 'resume' and pt.status = 'paused' then v_new := 'active'; v_title := 'Jornada retomada';
  elsif p_action = 'complete' and pt.status in ('active','paused') then
    select coalesce(sum(req_total), 0), coalesce(bool_and(complete), true) into v_req, v_all from public.jr_steps(p_pid);
    if not v_all and not (coalesce(p_force, false) and public.jr_can(pt.org_id, 'admin')) then raise exception 'required_pending'; end if;
    v_new := 'completed'; v_title := 'Jornada concluída';
  elsif p_action = 'cancel' and pt.status in ('waiting','active','paused') then v_new := 'cancelled'; v_title := 'Participação na jornada cancelada';
  elsif p_action = 'reopen' and pt.status in ('completed','cancelled') then
    if exists (select 1 from journey_participants where journey_id = pt.journey_id and person_id = pt.person_id and status <> 'cancelled' and id <> p_pid) then raise exception 'already_participant'; end if;
    v_new := 'active'; v_title := 'Jornada reaberta';
  else raise exception 'invalid_status'; end if;
  if p_action in ('start','resume','reopen') and j.status <> 'active' then raise exception 'journey_not_active'; end if;
  update journey_participants set status = v_new, updated_at = now(), started_on = case when v_new = 'active' and started_on is null then public.jr_today() else started_on end,
         completed_at = case when v_new = 'completed' then now() when p_action = 'reopen' then null else completed_at end,
         cancel_reason = case when v_new = 'cancelled' then (case when v_self then 'left' else 'staff' end) else null end where id = p_pid;
  perform public.jr_log(j.id, p_pid, pt.org_id, 'status', jsonb_build_object('from', pt.status, 'to', v_new, 'action', p_action));
  perform public.jr_history(p_pid, v_title, null, p_action || ':' || p_pid || ':' || extract(epoch from clock_timestamp())::bigint);
  if v_new = 'completed' then perform public.jr_notify(j.id, 'done', v_pu, 'Você concluiu uma jornada. Parabéns!', '#/jornadas/' || p_pid, not pt.notify); end if;
  if v_new = 'active' and p_action in ('start','reopen') then perform public.jr_notify(j.id, 'enroll', v_pu, 'Sua jornada começou', '#/jornadas/' || p_pid, not pt.notify); perform public.jr_auto_sync(p_pid); perform public.jr_recalc(p_pid); end if;
  if v_new = 'active' and p_action = 'resume' then perform public.jr_recalc(p_pid); end if;
  return jsonb_build_object('ok', true, 'status', v_new);
end $$;

create or replace function public.journey_assign(p_pid uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pt journey_participants; j journeys;
begin
  select * into pt from journey_participants where id = p_pid; if pt.id is null then raise exception 'not_found'; end if;
  select * into j from journeys where id = pt.journey_id;
  if not (public.jr_can(pt.org_id, 'admin') or public.jr_can(pt.org_id, 'participants')) then raise exception 'forbidden'; end if;
  perform public.jr_check_follower(pt.org_id, p_user);
  if p_user is not distinct from pt.responsible_id then return jsonb_build_object('ok', true, 'changed', false); end if;
  update journey_participants set responsible_id = p_user, updated_at = now() where id = p_pid;
  perform public.jr_log(j.id, p_pid, pt.org_id, 'assign', jsonb_build_object('from', pt.responsible_id, 'to', p_user));
  perform public.jr_history(p_pid, 'Responsável da jornada alterado', null, 'assign:' || p_pid || ':' || extract(epoch from clock_timestamp())::bigint);
  perform public.jr_notify(j.id, 'assign', p_user, 'Você acompanha uma pessoa em uma jornada', '#/gestao-jornadas/' || j.id);
  perform public.jr_notify(j.id, 'responsible', public.jr_person_user(pt.person_id), 'O responsável pela sua jornada mudou', '#/jornadas/' || p_pid, not pt.notify);
  return jsonb_build_object('ok', true, 'changed', true);
end $$;

create or replace function public.journey_notify_pref(p_pid uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.jr_is_self(p_pid) then raise exception 'forbidden'; end if;
  update journey_participants set notify = coalesce(p_on, true) where id = p_pid;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- acompanhamento: lista e detalhe
create or replace function public.journey_participants_list(p_journey uuid, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j journeys; v_all boolean; v_q text := nullif(trim(coalesce(p->>'q', '')), ''); v_status text := nullif(p->>'status', ''); v_resp uuid := nullif(p->>'responsible', '')::uuid; v_step uuid := nullif(p->>'step', '')::uuid;
        v_sf date; v_st date; v_cf date; v_ct date; v_res jsonb; v_lim int := least(greatest(coalesce(nullif(p->>'limit', '')::int, 50), 1), 200);
begin
  select * into j from journeys where id = p_journey; if j.id is null then raise exception 'not_found'; end if;
  if not public.jr_staff_of(p_journey) then raise exception 'forbidden'; end if;
  v_all := public.jr_can(j.org_id, 'admin') or public.jr_can(j.org_id, 'participants') or public.jr_can(j.org_id, 'indicators') or j.owner_id = auth.uid();
  begin v_sf := nullif(p->>'started_from', '')::date; v_st := nullif(p->>'started_to', '')::date; v_cf := nullif(p->>'completed_from', '')::date; v_ct := nullif(p->>'completed_to', '')::date; exception when others then raise exception 'invalid_date'; end;
  if v_status is not null and v_status not in ('waiting','active','paused','completed','cancelled') then raise exception 'invalid_filter'; end if;
  select coalesce(jsonb_agg(x.j order by x.nm), '[]'::jsonb) into v_res from (
    select pe.full_name as nm, jsonb_build_object('id', pt.id, 'person_id', pe.id, 'name', pe.full_name, 'photo_url', pe.photo_url, 'status', pt.status, 'source', pt.source,
        'responsible_id', pt.responsible_id, 'responsible_name', case when pt.responsible_id is null then null else coalesce(public.welcome_name(pt.org_id, pt.responsible_id), 'Usuário removido') end,
        'started_on', pt.started_on, 'completed_at', pt.completed_at, 'pct', public.jr_pct(pt.id), 'step', (select name from public.jr_current(pt.id)), 'step_id', (select step_id from public.jr_current(pt.id)),
        'pending_approvals', (select count(*) from journey_completions c where c.participant_id = pt.id and c.status = 'pending_approval')) as j
      from journey_participants pt join people pe on pe.id = pt.person_id
     where pt.journey_id = p_journey and (v_all or pt.responsible_id = auth.uid() or public.jr_level(pt.id) is not null)
       and (v_q is null or pe.full_name ilike '%' || v_q || '%') and (v_status is null or pt.status = v_status) and (v_resp is null or pt.responsible_id = v_resp)
       and (v_sf is null or pt.started_on >= v_sf) and (v_st is null or pt.started_on <= v_st)
       and (v_cf is null or pt.completed_at::date >= v_cf) and (v_ct is null or pt.completed_at::date <= v_ct)
       and (v_step is null or (select step_id from public.jr_current(pt.id)) = v_step)
     limit v_lim) x;
  return jsonb_build_object('items', v_res);
end $$;

-- detalhe de uma participação: a própria pessoa vê tudo da sua jornada; quem acompanha vê dentro do seu escopo
create or replace function public.journey_participant_get(p_pid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pt journey_participants; j journeys; pe people; v_lvl text; v_self boolean; v_steps jsonb; v_approve boolean; v_cur uuid; v_staff boolean;
begin
  select * into pt from journey_participants where id = p_pid; if pt.id is null then raise exception 'not_found'; end if;
  v_lvl := coalesce(public.jr_level(p_pid), 'none'); v_self := public.jr_is_self(p_pid);
  if v_lvl = 'none' and not v_self then raise exception 'forbidden'; end if;
  select * into j from journeys where id = pt.journey_id; select * into pe from people where id = pt.person_id;
  if pt.status = 'active' then perform public.jr_auto_sync(p_pid); select * into pt from journey_participants where id = p_pid; end if;
  v_staff := v_lvl in ('staff','manager'); v_approve := public.jr_can(pt.org_id, 'approve') and v_lvl <> 'none';
  select step_id into v_cur from public.jr_current(p_pid);
  select coalesce(jsonb_agg(jsonb_build_object('id', s.step_id, 'name', s.name, 'position', s.pos, 'description', st.description, 'responsible_name', case when st.responsible_id is null then null else coalesce(public.welcome_name(pt.org_id, st.responsible_id), 'Usuário removido') end,
      'unlocked', s.unlocked, 'complete', s.complete, 'rule', st.completion_rule, 'req_total', s.req_total, 'req_done', s.req_done, 'current', s.step_id = v_cur,
      'can_confirm', st.completion_rule = 'manual' and s.req_done = s.req_total and not s.confirmed and v_lvl <> 'none' and (v_staff or st.responsible_id = auth.uid()),
      'activities', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'kind', a.kind, 'required', a.required, 'mode', a.completion_mode, 'description', a.description,
          'instructions', case when s.unlocked or v_staff then a.instructions end, 'content_url', case when s.unlocked or v_staff then a.content_url end, 'content_text', case when s.unlocked or v_staff then a.content_text end,
          'event', case when a.event_id is null then null else (select jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'location', e.location) from church_events e where e.id = a.event_id) end,
          'responsible_name', case when a.responsible_id is null then null else coalesce(public.welcome_name(pt.org_id, a.responsible_id), 'Usuário removido') end,
          'state', case when c.status = 'done' then 'done' when c.status = 'pending_approval' then 'pending' when not s.unlocked then 'locked' else 'todo' end,
          'answer', c.answer, 'done_at', c.done_at, 'done_source', c.source,
          'can_complete', pt.status = 'active' and j.status = 'active' and s.unlocked and c.id is null and ((v_self and a.completion_mode in ('self','approval')) or (a.completion_mode = 'responsible' and v_lvl <> 'none' and (v_staff or a.responsible_id = auth.uid() or st.responsible_id = auth.uid()))),
          'can_approve', c.status = 'pending_approval' and v_approve and (v_staff or a.responsible_id = auth.uid() or st.responsible_id = auth.uid()),
          'can_reopen', c.id is not null and pt.status = 'active' and ((v_self and c.source = 'self') or (v_lvl <> 'none' and (v_staff or a.responsible_id = auth.uid() or st.responsible_id = auth.uid())))
        ) order by a.position, a.created_at)
        from journey_activities a left join journey_completions c on c.activity_id = a.id and c.participant_id = p_pid
        where a.step_id = s.step_id and (a.removed_at is null or c.id is not null)), '[]'::jsonb)) order by s.pos), '[]'::jsonb) into v_steps
    from public.jr_steps(p_pid) s join journey_steps st on st.id = s.step_id
    where v_self or v_lvl in ('staff','manager') or st.responsible_id = auth.uid() or exists (select 1 from journey_activities a2 where a2.step_id = s.step_id and a2.removed_at is null and a2.responsible_id = auth.uid());
  return jsonb_build_object('id', pt.id, 'journey', jsonb_build_object('id', j.id, 'name', j.name, 'description', j.description, 'objective', j.objective, 'image_url', j.image_url, 'status', j.status, 'step_mode', j.step_mode, 'visibility', j.visibility),
    'person', jsonb_build_object('id', pe.id, 'name', pe.full_name, 'photo_url', pe.photo_url, 'can_open', public.people_scope_all(pt.org_id) and public.has_people_perm(pt.org_id, 'people_view')),
    'status', pt.status, 'started_on', pt.started_on, 'completed_at', pt.completed_at, 'source', pt.source, 'notify', pt.notify, 'pct', public.jr_pct(p_pid),
    'responsible_id', pt.responsible_id, 'responsible_name', case when pt.responsible_id is null then null else coalesce(public.welcome_name(pt.org_id, pt.responsible_id), 'Usuário removido') end,
    'self', v_self, 'level', nullif(v_lvl, 'none'), 'steps', v_steps, 'pending_total', (select coalesce(sum(req_total - req_done), 0) from public.jr_steps(p_pid)),
    'can_manage', v_lvl in ('staff','manager'), 'can_assign', public.jr_can(pt.org_id, 'admin') or public.jr_can(pt.org_id, 'participants'), 'can_force', public.jr_can(pt.org_id, 'admin'),
    'notes', case when v_lvl <> 'none' then coalesce((select jsonb_agg(jsonb_build_object('text', l.detail->>'text', 'at', l.at, 'by', coalesce(public.welcome_name(l.org_id, l.actor), 'Usuário removido')) order by l.at desc)
              from (select * from journey_log where participant_id = p_pid and action = 'note' order by at desc limit 30) l), '[]'::jsonb) else '[]'::jsonb end,
    'log', case when v_lvl <> 'none' then coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'detail', l.detail - 'text', 'at', l.at, 'by', case when l.actor is null then 'Sistema' else coalesce(public.welcome_name(l.org_id, l.actor), 'Usuário removido') end) order by l.at desc, l.id desc)
              from (select * from journey_log where participant_id = p_pid and action <> 'note' order by at desc, id desc limit 60) l), '[]'::jsonb) else '[]'::jsonb end);
end $$;

-- registrar conclusão / aprovar / recusar / reabrir
create or replace function public.journey_record(p_pid uuid, p_activity uuid, p_action text, p_text text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pt journey_participants; j journeys; a journey_activities; st journey_steps; c journey_completions; v_lvl text; v_self boolean; v_unlocked boolean; v_scope boolean; v_text text := nullif(trim(coalesce(p_text, '')), ''); v_pu uuid; v_resp uuid;
begin
  select * into pt from journey_participants where id = p_pid; if pt.id is null then raise exception 'not_found'; end if;
  select * into a from journey_activities where id = p_activity and journey_id = pt.journey_id; if a.id is null then raise exception 'not_found'; end if;
  select * into st from journey_steps where id = a.step_id; select * into j from journeys where id = pt.journey_id;
  v_lvl := coalesce(public.jr_level(p_pid), 'none'); v_self := public.jr_is_self(p_pid); v_pu := public.jr_person_user(pt.person_id); v_resp := coalesce(a.responsible_id, pt.responsible_id, j.owner_id);
  if v_lvl = 'none' and not v_self then raise exception 'forbidden'; end if;
  if length(coalesce(v_text, '')) > 2000 then raise exception 'text_too_long'; end if;
  v_scope := v_lvl in ('staff','manager') or (v_lvl <> 'none' and coalesce(a.responsible_id = auth.uid() or st.responsible_id = auth.uid(), false));
  select * into c from journey_completions where participant_id = p_pid and activity_id = p_activity;
  if p_action in ('complete') then
    if pt.status <> 'active' then raise exception 'participation_not_active'; end if;
    if j.status <> 'active' then raise exception 'journey_not_active'; end if;
    if a.removed_at is not null or st.removed_at is not null then raise exception 'not_found'; end if;
    if c.id is not null then raise exception 'already_done'; end if;
    select unlocked into v_unlocked from public.jr_steps(p_pid) where step_id = a.step_id; if not coalesce(v_unlocked, false) then raise exception 'step_locked'; end if;
    if a.completion_mode = 'auto' then raise exception 'auto_only'; end if;
    if a.completion_mode in ('self','approval') then
      if not v_self then raise exception 'forbidden'; end if;
      insert into journey_completions (participant_id, activity_id, org_id, status, source, answer, done_by) values (p_pid, p_activity, pt.org_id, case when a.completion_mode = 'approval' then 'pending_approval' else 'done' end, 'self', v_text, auth.uid());
    else
      if not v_scope then raise exception 'forbidden'; end if;
      insert into journey_completions (participant_id, activity_id, org_id, status, source, answer, done_by) values (p_pid, p_activity, pt.org_id, 'done', 'responsible', v_text, auth.uid());
    end if;
    perform public.jr_log(j.id, p_pid, pt.org_id, 'activity_done', jsonb_build_object('activity', a.title, 'pending', a.completion_mode = 'approval'));
    if a.completion_mode = 'approval' then
      perform public.jr_notify(j.id, 'approve', v_resp, 'Uma atividade aguarda a sua aprovação', '#/gestao-jornadas/' || j.id);
    else
      perform public.jr_history(p_pid, 'Atividade concluída', a.title, 'act:' || p_pid || ':' || a.id);
    end if;
  elsif p_action in ('approve','reject') then
    if c.id is null or c.status <> 'pending_approval' then raise exception 'nothing_to_approve'; end if;
    if not (public.jr_can(pt.org_id, 'approve') and v_scope) then raise exception 'forbidden'; end if;
    if p_action = 'approve' then
      update journey_completions set status = 'done', approved_by = auth.uid(), approved_at = now() where id = c.id;
      perform public.jr_history(p_pid, 'Atividade concluída', a.title, 'act:' || p_pid || ':' || a.id);
    else delete from journey_completions where id = c.id; end if;
    perform public.jr_log(j.id, p_pid, pt.org_id, case when p_action = 'approve' then 'approve' else 'reject' end, jsonb_build_object('activity', a.title, 'note', v_text));
    perform public.jr_notify(j.id, 'approve', v_pu, case when p_action = 'approve' then 'Sua atividade foi aprovada' else 'Sua atividade precisa ser refeita' end, '#/jornadas/' || p_pid, not pt.notify);
  elsif p_action = 'reopen' then
    if c.id is null then raise exception 'nothing_to_reopen'; end if;
    if pt.status <> 'active' then raise exception 'participation_not_active'; end if;
    if not ((v_self and c.source = 'self') or v_scope) then raise exception 'forbidden'; end if;
    delete from journey_completions where id = c.id;
    perform public.jr_log(j.id, p_pid, pt.org_id, 'activity_reopen', jsonb_build_object('activity', a.title));
  else raise exception 'invalid_action'; end if;
  perform public.jr_recalc(p_pid);
  return jsonb_build_object('ok', true, 'pct', public.jr_pct(p_pid), 'status', (select status from journey_participants where id = p_pid));
end $$;

create or replace function public.journey_step_confirm(p_pid uuid, p_step uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pt journey_participants; st journey_steps; v_lvl text; r record;
begin
  select * into pt from journey_participants where id = p_pid; if pt.id is null then raise exception 'not_found'; end if;
  select * into st from journey_steps where id = p_step and journey_id = pt.journey_id and removed_at is null; if st.id is null then raise exception 'not_found'; end if;
  v_lvl := coalesce(public.jr_level(p_pid), 'none');
  if not (v_lvl in ('staff','manager') or (v_lvl <> 'none' and coalesce(st.responsible_id = auth.uid(), false))) then raise exception 'forbidden'; end if;
  if pt.status <> 'active' then raise exception 'participation_not_active'; end if;
  if st.completion_rule <> 'manual' then raise exception 'invalid_action'; end if;
  select * into r from public.jr_steps(p_pid) where step_id = p_step;
  if r.req_done <> r.req_total then raise exception 'required_pending'; end if;
  insert into journey_step_progress (participant_id, step_id, confirmed_by, confirmed_at) values (p_pid, p_step, auth.uid(), now())
    on conflict (participant_id, step_id) do update set confirmed_by = auth.uid(), confirmed_at = now();
  perform public.jr_log(pt.journey_id, p_pid, pt.org_id, 'step_confirm', jsonb_build_object('name', st.name));
  perform public.jr_history(p_pid, 'Etapa concluída', st.name, 'step:' || p_pid || ':' || p_step);
  perform public.jr_recalc(p_pid);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.journey_note_add(p_pid uuid, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pt journey_participants; v_text text := trim(coalesce(p_text, ''));
begin
  select * into pt from journey_participants where id = p_pid; if pt.id is null then raise exception 'not_found'; end if;
  if public.jr_level(p_pid) is null then raise exception 'forbidden'; end if;
  if length(v_text) < 1 then raise exception 'body_required'; end if; if length(v_text) > 500 then raise exception 'text_too_long'; end if;
  perform public.jr_log(pt.journey_id, p_pid, pt.org_id, 'note', jsonb_build_object('text', v_text));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- Minhas Jornadas
create or replace function public.journey_mine(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_people uuid[]; v_cls text; v_mine jsonb; v_av jsonb; r record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  select array_agg(id) into v_people from people where org_id = p_org and user_id = auth.uid() and status in ('active','inactive','pending');
  for r in select pt.id from journey_participants pt where pt.person_id = any (coalesce(v_people, '{}')) and pt.status = 'active' loop perform public.jr_auto_sync(r.id); end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id', pt.id, 'status', pt.status, 'started_on', pt.started_on, 'completed_at', pt.completed_at, 'pct', public.jr_pct(pt.id), 'journey_id', j.id, 'name', j.name, 'description', j.description,
        'image_url', j.image_url, 'journey_status', j.status, 'step', (select name from public.jr_current(pt.id)), 'pending', (select coalesce(sum(req_total - req_done), 0) from public.jr_steps(pt.id))) order by (pt.status in ('completed','cancelled')), pt.created_at desc), '[]'::jsonb) into v_mine
    from journey_participants pt join journeys j on j.id = pt.journey_id where pt.person_id = any (coalesce(v_people, '{}')) and not (pt.status = 'cancelled' and pt.cancel_reason = 'declined');
  select classification into v_cls from people where id = (v_people)[1];
  select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'name', j.name, 'description', j.description, 'objective', j.objective, 'image_url', j.image_url) order by j.created_at desc), '[]'::jsonb) into v_av
    from journeys j where j.org_id = p_org and j.status = 'active' and j.visibility = 'public' and j.enroll_voluntary and v_people is not null
     and (j.eligible_classes is null or v_cls = any (j.eligible_classes))
     and not exists (select 1 from journey_participants x where x.journey_id = j.id and x.person_id = any (v_people) and x.status <> 'cancelled');
  return jsonb_build_object('mine', v_mine, 'available', v_av, 'has_person', v_people is not null,
    'staff', public.jr_can(p_org, 'admin') or public.jr_can(p_org, 'participants') or public.jr_can(p_org, 'follow') or public.jr_can(p_org, 'indicators'));
end $$;

create or replace function public.journey_public_get(p_journey uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare j journeys;
begin
  select * into j from journeys where id = p_journey; if j.id is null then raise exception 'not_found'; end if;
  if not exists (select 1 from org_members where org_id = j.org_id and user_id = auth.uid()) or j.visibility <> 'public' or j.status <> 'active' then raise exception 'forbidden'; end if;
  return jsonb_build_object('id', j.id, 'name', j.name, 'description', j.description, 'objective', j.objective, 'audience', j.audience, 'image_url', j.image_url, 'can_enroll', j.enroll_voluntary,
    'steps', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'description', s.description) order by s.position) from journey_steps s where s.journey_id = j.id and s.removed_at is null), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- Ficha e Novos Convertidos
create or replace function public.journey_for_person(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from people where id = p_person; if pe.id is null then raise exception 'not_found'; end if;
  if not (public.jr_can(pe.org_id, 'admin') or public.jr_can(pe.org_id, 'participants') or public.jr_can(pe.org_id, 'follow')) then return jsonb_build_object('allowed', false, 'items', '[]'::jsonb); end if;
  return jsonb_build_object('allowed', true, 'items', coalesce((select jsonb_agg(jsonb_build_object('id', pt.id, 'journey_id', j.id, 'name', j.name, 'status', pt.status, 'started_on', pt.started_on, 'pct', public.jr_pct(pt.id), 'journey_status', j.status) order by pt.created_at desc)
      from journey_participants pt join journeys j on j.id = pt.journey_id where pt.person_id = p_person and public.jr_level(pt.id) is not null), '[]'::jsonb));
end $$;

create or replace function public.convert_journeys(p_decision uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d faith_decisions;
begin
  select * into d from faith_decisions where id = p_decision and voided_at is null; if d.id is null then raise exception 'not_found'; end if;
  if not (public.conv_can(d.org_id, 'view') or (public.conv_can(d.org_id, 'followup') and d.responsible_id = auth.uid())) then raise exception 'forbidden'; end if;
  return jsonb_build_object('person_id', d.person_id,
    'can_offer', d.person_id is not null and public.conv_can(d.org_id, 'followup') and (d.responsible_id = auth.uid() or public.conv_can(d.org_id, 'assign') or public.conv_can(d.org_id, 'admin')),
    'offerable', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'name', j.name) order by j.name) from journeys j where j.org_id = d.org_id and j.status = 'active' and j.for_converts
        and not exists (select 1 from journey_participants x where x.journey_id = j.id and x.person_id = d.person_id and x.status <> 'cancelled')), '[]'::jsonb),
    'participations', coalesce((select jsonb_agg(jsonb_build_object('id', pt.id, 'journey_id', j.id, 'name', j.name, 'status', pt.status, 'pct', public.jr_pct(pt.id), 'cancel_reason', pt.cancel_reason) order by pt.created_at desc)
        from journey_participants pt join journeys j on j.id = pt.journey_id where pt.decision_id = d.id), '[]'::jsonb));
end $$;

create or replace function public.journey_offer(p_decision uuid, p_journey uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d faith_decisions; j journeys; pe people; v_id uuid; v_resp uuid;
begin
  select * into d from faith_decisions where id = p_decision and voided_at is null; if d.id is null then raise exception 'not_found'; end if;
  if not (public.conv_can(d.org_id, 'followup') and (d.responsible_id = auth.uid() or public.conv_can(d.org_id, 'assign') or public.conv_can(d.org_id, 'admin'))) then raise exception 'forbidden'; end if;
  if d.person_id is null then raise exception 'link_required'; end if;
  select * into j from journeys where id = p_journey and org_id = d.org_id; if j.id is null then raise exception 'not_found'; end if;
  if not j.for_converts then raise exception 'not_for_converts'; end if;
  if j.status <> 'active' then raise exception 'journey_not_active'; end if;
  select * into pe from people where id = d.person_id;
  v_resp := case when d.responsible_id is not null and d.responsible_id in (select public.jr_users(d.org_id, 'follow')) then d.responsible_id else j.owner_id end;
  begin
    insert into journey_participants (journey_id, org_id, person_id, status, responsible_id, source, decision_id, added_by) values (p_journey, d.org_id, d.person_id, 'waiting', v_resp, 'convert', d.id, auth.uid()) returning id into v_id;
  exception when unique_violation then raise exception 'already_participant'; end;
  perform public.jr_log(p_journey, v_id, d.org_id, 'offer', jsonb_build_object('decision_id', d.id));
  perform public.conv_log(d.id, d.org_id, 'journey_offer', jsonb_build_object('journey_id', p_journey, 'participant_id', v_id));
  perform public.jr_history(v_id, 'Convidado(a) para uma jornada', null, 'enroll:' || v_id);
  perform public.jr_notify(p_journey, 'invite', pe.user_id, 'Você foi convidado(a) para uma jornada', '#/jornadas/' || v_id);
  return jsonb_build_object('saved', true, 'id', v_id);
end $$;

-- ---------------------------------------------------------------- indicadores (registros reais, sem leitura espiritual)
create or replace function public.journey_indicators(p_org uuid, p_journey uuid default null, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_res jsonb;
begin
  if not (public.jr_can(p_org, 'indicators') or public.jr_can(p_org, 'admin')) then raise exception 'forbidden'; end if;
  with pt as (select * from journey_participants where org_id = p_org and (p_journey is null or journey_id = p_journey) and (p_from is null or started_on >= p_from) and (p_to is null or started_on <= p_to))
  select jsonb_build_object(
    'participants', (select count(*) from pt where status <> 'cancelled'),
    'by_status', coalesce((select jsonb_agg(jsonb_build_object('status', s, 'n', n) order by s) from (select status s, count(*) n from pt group by 1) x), '[]'::jsonb),
    'steps_done', (select count(*) from journey_step_progress sp where sp.participant_id in (select id from pt)),
    'pending_approvals', (select count(*) from journey_completions c where c.participant_id in (select id from pt) and c.status = 'pending_approval'),
    'by_journey', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'name', j.name, 'status', j.status, 'participants', (select count(*) from pt where pt.journey_id = j.id and pt.status <> 'cancelled'),
        'active', (select count(*) from pt where pt.journey_id = j.id and pt.status = 'active'), 'paused', (select count(*) from pt where pt.journey_id = j.id and pt.status = 'paused'),
        'completed', (select count(*) from pt where pt.journey_id = j.id and pt.status = 'completed')) order by j.name) from journeys j where j.org_id = p_org and (p_journey is null or j.id = p_journey)), '[]'::jsonb)) into v_res;
  return v_res;
end $$;


-- busca de pessoas para incluir em jornada (não exige acesso à base inteira de pessoas)
create or replace function public.journey_people_search(p_org uuid, p_q text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_q text := trim(coalesce(p_q, ''));
begin
  if not (public.jr_can(p_org, 'admin') or public.jr_can(p_org, 'participants')) then raise exception 'forbidden'; end if;
  if length(v_q) < 2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'full_name', x.full_name, 'classification', x.classification, 'photo_url', x.photo_url) order by x.full_name)
    from (select id, full_name, classification, photo_url from people where org_id = p_org and status in ('active','inactive','pending') and full_name ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%' order by full_name limit 12) x), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- permissões de execução
revoke execute on function
  public.journey_save(uuid, uuid, jsonb, int), public.journey_set_status(uuid, text, int), public.journey_duplicate(uuid), public.journey_step_save(uuid, uuid, jsonb, int), public.journey_step_remove(uuid, int),
  public.journey_activity_save(uuid, uuid, jsonb, int), public.journey_activity_remove(uuid, int), public.journey_reorder(text, uuid, uuid[], int), public.journey_list(uuid, jsonb), public.journey_get(uuid),
  public.journey_responsibles(uuid), public.journey_enroll(uuid, uuid, uuid, boolean), public.journey_self_enroll(uuid), public.journey_apply_rule(uuid), public.journey_respond(uuid, boolean),
  public.journey_participant_status(uuid, text, boolean), public.journey_assign(uuid, uuid), public.journey_notify_pref(uuid, boolean), public.journey_participants_list(uuid, jsonb), public.journey_participant_get(uuid),
  public.journey_record(uuid, uuid, text, text), public.journey_step_confirm(uuid, uuid), public.journey_note_add(uuid, text), public.journey_mine(uuid), public.journey_public_get(uuid),
  public.journey_for_person(uuid), public.convert_journeys(uuid), public.journey_offer(uuid, uuid), public.journey_indicators(uuid, uuid, date, date), public.journey_people_search(uuid, text) from public, anon;
grant execute on function
  public.journey_save(uuid, uuid, jsonb, int), public.journey_set_status(uuid, text, int), public.journey_duplicate(uuid), public.journey_step_save(uuid, uuid, jsonb, int), public.journey_step_remove(uuid, int),
  public.journey_activity_save(uuid, uuid, jsonb, int), public.journey_activity_remove(uuid, int), public.journey_reorder(text, uuid, uuid[], int), public.journey_list(uuid, jsonb), public.journey_get(uuid),
  public.journey_responsibles(uuid), public.journey_enroll(uuid, uuid, uuid, boolean), public.journey_self_enroll(uuid), public.journey_apply_rule(uuid), public.journey_respond(uuid, boolean),
  public.journey_participant_status(uuid, text, boolean), public.journey_assign(uuid, uuid), public.journey_notify_pref(uuid, boolean), public.journey_participants_list(uuid, jsonb), public.journey_participant_get(uuid),
  public.journey_record(uuid, uuid, text, text), public.journey_step_confirm(uuid, uuid), public.journey_note_add(uuid, text), public.journey_mine(uuid), public.journey_public_get(uuid),
  public.journey_for_person(uuid), public.convert_journeys(uuid), public.journey_offer(uuid, uuid), public.journey_indicators(uuid, uuid, date, date), public.journey_people_search(uuid, text) to authenticated;

-- Conferência (retorna true):
--   select to_regclass('public.journeys') is not null
--      and to_regprocedure('public.journey_save(uuid,uuid,jsonb,integer)') is not null
--      and to_regprocedure('public.journey_record(uuid,uuid,text,text)') is not null
--      and 'people_journeys_admin' = any (public.all_actions()) as ok;

-- >>> supabase/migrations/20261202000001_solicitacoes_contato.sql
-- =====================================================================
-- SOMOS Recurso 09: Solicitações de contato
-- A pessoa pede contato pelo app (ou por um link público); a equipe recebe, encaminha, registra interações e conclui.
--  * categorias, textos e consentimento são configuráveis (nada fixo na tela); categorias iniciais criadas uma única vez por igreja;
--  * solicitação não é atendimento pastoral: iniciar o acompanhamento só cria um vínculo no registro pastoral existente (person_care), sem copiar a mensagem;
--  * permissões próprias (people_contacts_*), sempre validadas no servidor; participar de time não dá acesso; observações confidenciais exigem permissão específica;
--  * histórico administrativo (contact_log) separado das observações confidenciais; a ficha só mostra o fato (categoria e código), nunca a mensagem;
--  * envio duplicado não cria outra solicitação (chave do envio e janela de 10 minutos); sem lembretes nem cobranças automáticas;
--  * avisos pelo sistema de notificações existente, sem conteúdo da mensagem; nenhum envio externo (WhatsApp, SMS, e-mail) é feito aqui.
-- =====================================================================

-- ---------------------------------------------------------------- permissões novas
alter table public.access_grants drop constraint if exists access_grants_actions_check;
alter table public.access_grants add constraint access_grants_actions_check check (
  actions <@ array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
                   'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin',
                   'people_journeys_admin','people_journeys_participants','people_journeys_follow','people_journeys_approve','people_journeys_indicators','people_contacts_view','people_contacts_assigned','people_contacts_manage','people_contacts_assign','people_contacts_confidential','people_contacts_categories','people_contacts_reopen','people_contacts_cancel','people_contacts_admin']::text[]);
create or replace function public.all_actions() returns text[] language sql immutable as $$
  select array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
               'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin',
               'people_journeys_admin','people_journeys_participants','people_journeys_follow','people_journeys_approve','people_journeys_indicators','people_contacts_view','people_contacts_assigned','people_contacts_manage','people_contacts_assign','people_contacts_confidential','people_contacts_categories','people_contacts_reopen','people_contacts_cancel','people_contacts_admin']::text[]
$$;
create or replace function public.people_actions(p_org uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
      then array['people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
                 'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin',
                 'people_journeys_admin','people_journeys_participants','people_journeys_follow','people_journeys_approve','people_journeys_indicators','people_contacts_view','people_contacts_assigned','people_contacts_manage','people_contacts_assign','people_contacts_confidential','people_contacts_categories','people_contacts_reopen','people_contacts_cancel','people_contacts_admin']
    else coalesce((select array_agg(distinct a) from access_grants g, unnest(g.actions) a
                   where g.org_id = p_org and g.user_id = auth.uid() and a like 'people\_%'), '{}'::text[]) end
$$;

-- ---------------------------------------------------------------- utilitários de permissão
-- 'admin' do módulo vale para tudo, menos observações confidenciais (essas só com a permissão específica)
create or replace function public.ct_can(p_org uuid, p_mode text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from unnest(public.people_actions(p_org)) a where a = 'people_contacts_' || p_mode or (a = 'people_contacts_admin' and p_mode <> 'confidential'))
$$;
create or replace function public.ct_users(p_org uuid, p_mode text) returns setof uuid
language sql stable security definer set search_path = public as $$
  select om.user_id from org_members om where om.org_id = p_org and om.role = 'admin'
  union
  select g.user_id from access_grants g where g.org_id = p_org and ('people_contacts_' || p_mode = any (g.actions) or ('people_contacts_admin' = any (g.actions) and p_mode <> 'confidential'))
$$;
-- escopo: 'all' (vê todas), 'assigned' (só as atribuídas a ele) ou 'none'
create or replace function public.ct_scope(p_org uuid, p_responsible uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when public.ct_can(p_org, 'view') then 'all'
              when public.ct_can(p_org, 'assigned') and coalesce(p_responsible = auth.uid(), false) then 'assigned' else 'none' end
$$;
revoke execute on function public.ct_can(uuid, text), public.ct_users(uuid, text), public.ct_scope(uuid, uuid) from public, anon;
grant execute on function public.ct_can(uuid, text), public.ct_scope(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- tabelas
create sequence if not exists public.contact_code_seq;
create table if not exists public.contact_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  seeded boolean not null default false,
  intro_text text not null default 'Estamos aqui para caminhar com você. Se deseja conversar, precisa de orientação ou gostaria de receber informações sobre nossa igreja, envie sua solicitação. Nossa equipe terá alegria em entrar em contato.' check (length(intro_text) between 1 and 1000),
  consent_text text not null default 'Autorizo a igreja a usar os dados informados apenas para responder a esta solicitação de contato.' check (length(consent_text) between 1 and 600),
  consent_version int not null default 1,
  consent_purpose text not null default 'Responder à solicitação de contato' check (length(consent_purpose) between 1 and 200),
  other_channel text check (other_channel is null or length(trim(other_channel)) between 1 and 60),
  form_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  form_active boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists public.contact_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  description text check (description is null or length(description) <= 300),
  active boolean not null default true,
  position int not null default 0,
  default_team_id uuid references public.teams(id) on delete set null,
  default_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists contact_categories_org on public.contact_categories (org_id, position);
create table if not exists public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null unique default ('CT-' || lpad(nextval('public.contact_code_seq')::text, 5, '0')),
  person_id uuid references public.people(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 160),
  phone text check (phone is null or length(phone) <= 30),
  email text check (email is null or (length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  category_id uuid references public.contact_categories(id) on delete set null,
  category_name text not null,
  message text not null check (length(trim(message)) between 1 and 2000),
  pref_channel text not null check (pref_channel in ('whatsapp','call','email','other')),
  pref_other text check (pref_other is null or length(pref_other) <= 60),
  consent_at timestamptz not null default now(),
  consent_version int not null,
  consent_purpose text not null,
  status text not null default 'received' check (status in ('received','review','forwarded','in_progress','waiting','completed','cancelled')),
  responsible_id uuid references auth.users(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  source text not null default 'app' check (source in ('app','public_form','admin')),
  op_key text,
  notify_requester boolean not null default true,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
  completed_at timestamptz,
  care_at timestamptz,
  linked_at timestamptz,
  linked_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists contact_requests_opkey on public.contact_requests (org_id, op_key) where op_key is not null;
create index if not exists contact_requests_org on public.contact_requests (org_id, created_at desc);
create index if not exists contact_requests_person on public.contact_requests (person_id) where person_id is not null;
create index if not exists contact_requests_user on public.contact_requests (user_id) where user_id is not null;
create index if not exists contact_requests_resp on public.contact_requests (responsible_id) where responsible_id is not null;
create table if not exists public.contact_log (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.contact_requests(id) on delete cascade,
  org_id uuid not null,
  actor uuid references auth.users(id) on delete set null,
  action text not null,
  from_status text,
  to_status text,
  detail jsonb not null default '{}'::jsonb,
  restricted boolean not null default false,
  at timestamptz not null default now()
);
create index if not exists contact_log_req on public.contact_log (request_id, at desc);
create table if not exists public.contact_interactions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.contact_requests(id) on delete cascade,
  org_id uuid not null,
  kind text not null check (kind in ('call','message','in_person','email','attempt','reply','other')),
  description text not null check (length(trim(description)) between 1 and 2000),
  result text check (result is null or length(result) <= 500),
  occurred_at timestamptz not null default now(),
  author uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists contact_interactions_req on public.contact_interactions (request_id, occurred_at desc);
create table if not exists public.contact_notes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.contact_requests(id) on delete cascade,
  org_id uuid not null,
  body text not null check (length(trim(body)) between 1 and 4000),
  author uuid references auth.users(id) on delete set null,
  access text not null default 'confidential' check (access = 'confidential'),
  created_at timestamptz not null default now()
);
create index if not exists contact_notes_req on public.contact_notes (request_id, created_at desc);
alter table public.contact_settings enable row level security;
alter table public.contact_categories enable row level security;
alter table public.contact_requests enable row level security;
alter table public.contact_log enable row level security;
alter table public.contact_interactions enable row level security;
alter table public.contact_notes enable row level security;
revoke all on public.contact_settings, public.contact_categories, public.contact_requests, public.contact_log, public.contact_interactions, public.contact_notes from anon, authenticated;

insert into public.history_categories (org_id, key, label, manual, sort) values (null, 'contato', 'Solicitações de contato', false, 48)
  on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), key) do nothing;

-- ---------------------------------------------------------------- linha do tempo: solicitação só para quem pode ver solicitações
create or replace function public.person_timeline(p_person uuid, p_categories text[] default null, p_origin text default null,
                                                  p_from date default null, p_to date default null, p_by uuid default null,
                                                  p_limit int default 30, p_offset int default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people; v_full boolean; v_sup boolean; v_detail boolean; v_lim int := least(greatest(coalesce(p_limit, 30), 1), 100); v_res jsonb; v_more boolean;
begin
  select * into pe from people where id = p_person;
  if pe.id is null then raise exception 'not_found'; end if;
  v_full := public.people_scope_all(pe.org_id) and public.has_people_perm(pe.org_id, 'people_view');
  v_sup  := not v_full and public.people_supervised(pe.org_id, pe.user_id) and not public.person_is_minor(pe.birth_date);
  if not (v_full or v_sup) then raise exception 'forbidden'; end if;
  v_detail := v_full and public.has_people_perm(pe.org_id, 'people_edit');
  if p_origin is not null and p_origin not in ('auto', 'manual') then raise exception 'invalid_filter'; end if;

  with base as (
    select h.*, case when h.kind in ('field', 'self_update') and h.category = 'pessoais' and h.op_id is not null then 'g:' || h.op_id || ':' || h.kind || ':' || coalesce(h.actor::text, '') else 'r:' || h.id end as gk
      from person_history h
     where h.person_id = p_person and h.voided_at is null
       and (v_full or not h.restricted)
       and (h.kind <> 'decision' or public.conv_can(pe.org_id, 'view'))
       and (h.kind <> 'contact' or public.ct_can(pe.org_id, 'view'))
       and (p_categories is null or h.category = any (p_categories))
       and (p_origin is null or h.origin = p_origin)
       and (p_from is null or h.occurred_on >= p_from) and (p_to is null or h.occurred_on <= p_to)
       and (p_by is null or h.actor = p_by)
  ), grp as (
    select gk, max(id) as id, max(occurred_on) as occurred_on, max(at) as at, count(*) as n,
           (array_agg(id order by id))[1] as first_id
      from base group by gk
  ), page as (
    select q.*, row_number() over (order by q.occurred_on desc, q.at desc, q.id desc) as rn
      from (select g.* from grp g order by g.occurred_on desc, g.at desc, g.id desc offset greatest(coalesce(p_offset, 0), 0) limit v_lim + 1) q
  )
  select coalesce(jsonb_agg(x.j order by x.rn) filter (where x.rn <= v_lim), '[]'::jsonb), bool_or(x.rn > v_lim) into v_res, v_more
  from (
    select pg.rn, jsonb_build_object(
      'id', b.id, 'category', b.category, 'category_label', coalesce(c.label, 'Outros acontecimentos'),
      'title', case when pg.n > 1 then 'Dados pessoais atualizados' else case when b.restricted and not v_detail and b.kind not in ('decision','contact') then case b.kind when 'guardian' then 'Responsável legal atualizado' else 'Vida familiar atualizada' end else b.title end end,
      'description', case when pg.n > 1 then (select string_agg(distinct public.history_field_label(g2.field), ', ') from base g2 where g2.gk = pg.gk)
                          when b.restricted and not v_detail and b.kind not in ('decision','contact') then null else b.description end,
      'occurred_on', b.occurred_on, 'at', b.at, 'origin', b.origin, 'kind', b.kind,
      'by', case when b.actor is null then 'Sistema' else coalesce(public.welcome_name(b.org_id, b.actor), 'Usuário removido') end, 'by_id', b.actor,
      'edited', b.edited_at is not null, 'edited_at', b.edited_at,
      'notes', case when b.origin = 'manual' then b.meta->>'notes' end,
      'restricted', b.restricted and not v_detail and b.kind not in ('decision','contact'), 'op_id', b.op_id,
      'changes', case when b.kind in ('field', 'self_update') and b.category = 'pessoais' then
                  (select jsonb_agg(jsonb_build_object('field', public.history_field_label(g2.field), 'old', case when g2.field = 'cpf' then null else g2.old_value end, 'new', case when g2.field = 'cpf' then null else g2.new_value end) order by g2.id)
                     from base g2 where g2.gk = pg.gk) end,
      'can_edit', b.origin = 'manual' and public.can_timeline(b.org_id, 'edit')
    ) as j
    from page pg join person_history b on b.id = pg.id left join history_categories c on c.key = b.category and (c.org_id is null or c.org_id = b.org_id)
  ) x;
  return jsonb_build_object('items', v_res, 'has_more', coalesce(v_more, false), 'can_add', public.can_timeline(pe.org_id, 'add'));
end $$;


-- ---------------------------------------------------------------- utilitários internos
create or replace function public.ct_norm(p text) returns text language sql immutable as $$
  select lower(regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g'))
$$;
-- configurações e categorias iniciais (criadas uma única vez por igreja; depois são da igreja)
create or replace function public.ct_ensure(p_org uuid) returns contact_settings
language plpgsql security definer set search_path = public as $$
declare s contact_settings;
begin
  insert into contact_settings (org_id) values (p_org) on conflict (org_id) do nothing;
  select * into s from contact_settings where org_id = p_org for update;
  if not s.seeded then
    insert into contact_categories (org_id, name, position)
    select p_org, n, row_number() over ()::int from unnest(array['Conversar com um pastor','Orientação espiritual','Aconselhamento familiar','Dificuldades pessoais','Informações sobre a igreja','Quero participar de um ministério','Quero conhecer melhor a igreja','Outros assuntos']) n;
    update contact_settings set seeded = true where org_id = p_org returning * into s;
  end if;
  return s;
end $$;
create or replace function public.ct_log(p_req uuid, p_org uuid, p_action text, p_from text default null, p_to text default null, p_detail jsonb default '{}'::jsonb, p_restricted boolean default false) returns void
language sql security definer set search_path = public as $$
  insert into contact_log (request_id, org_id, actor, action, from_status, to_status, detail, restricted) values (p_req, p_org, auth.uid(), p_action, p_from, p_to, coalesce(p_detail, '{}'::jsonb), p_restricted)
$$;
-- avisos genéricos (nunca levam o conteúdo da mensagem)
create or replace function public.ct_notify(p_org uuid, p_mode text, p_title text, p_link text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select distinct x from public.ct_users(p_org, p_mode) x where x is distinct from auth.uid() loop
    perform public.notify_user(u, p_org, 'contact', p_title, null, p_link, null);
  end loop;
end $$;
-- acontecimento na linha do tempo da pessoa (restrito; só quem vê solicitações)
create or replace function public.ct_history(p_req uuid, p_title text, p_desc text, p_key text) returns void
language plpgsql security definer set search_path = public as $$
declare r contact_requests;
begin
  select * into r from contact_requests where id = p_req;
  if r.id is null or r.person_id is null then return; end if;
  insert into person_history (org_id, person_id, actor, kind, field, old_value, new_value, note, category, title, description, restricted, occurred_on, origin, op_id, op_key, meta)
  values (r.org_id, r.person_id, auth.uid(), 'contact', null, null, null, null, 'contato', p_title, p_desc, true, case when p_key = 'new' then (r.created_at at time zone 'America/Sao_Paulo')::date else (now() at time zone 'America/Sao_Paulo')::date end, 'auto', txid_current()::text, 'ct:' || p_req || ':' || p_key, jsonb_build_object('request_id', p_req))
  on conflict (person_id, op_key) where op_key is not null do nothing;
end $$;
create or replace function public.ct_eligible(p_org uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user is not null and (p_user in (select public.ct_users(p_org, 'manage')) or p_user in (select public.ct_users(p_org, 'assigned')))
$$;
create or replace function public.ct_status_label(p text) returns text language sql immutable as $$
  select case p when 'received' then 'Recebida' when 'review' then 'Em análise' when 'forwarded' then 'Encaminhada' when 'in_progress' then 'Em atendimento' when 'waiting' then 'Aguardando retorno' when 'completed' then 'Concluída' when 'cancelled' then 'Cancelada' else p end
$$;
-- transições permitidas (reabrir é tratado à parte)
create or replace function public.ct_next(p text) returns text[] language sql immutable as $$
  select case p
    when 'received' then array['review','forwarded','in_progress','waiting','completed','cancelled']
    when 'review' then array['forwarded','in_progress','waiting','completed','cancelled']
    when 'forwarded' then array['review','in_progress','waiting','completed','cancelled']
    when 'in_progress' then array['forwarded','waiting','completed','cancelled']
    when 'waiting' then array['forwarded','in_progress','completed','cancelled']
    else array[]::text[] end
$$;
revoke execute on function public.ct_norm(text), public.ct_ensure(uuid), public.ct_log(uuid, uuid, text, text, text, jsonb, boolean), public.ct_notify(uuid, text, text, text), public.ct_history(uuid, text, text, text),
  public.ct_eligible(uuid, uuid), public.ct_status_label(text), public.ct_next(text) from public, anon, authenticated;

-- valida e normaliza o envio
create or replace function public.ct_clean(p jsonb, p_other text) returns jsonb
language plpgsql immutable as $$
declare v_name text := trim(coalesce(p->>'name', '')); v_phone text := nullif(trim(coalesce(p->>'phone', '')), ''); v_email text := nullif(lower(trim(coalesce(p->>'email', ''))), '');
        v_msg text := trim(coalesce(p->>'message', '')); v_pref text := coalesce(nullif(trim(p->>'pref'), ''), 'whatsapp'); v_po text := nullif(trim(coalesce(p->>'pref_other', '')), '');
        v_key text := nullif(trim(coalesce(p->>'key', '')), ''); v_d text; v_cat uuid;
begin
  if length(v_name) < 1 then raise exception 'name_required'; end if;
  if length(v_name) > 160 then raise exception 'name_too_long'; end if;
  if v_phone is not null then v_d := public.digits(v_phone); if v_d is null or length(v_d) < 8 or length(v_d) > 15 or length(v_phone) > 30 then raise exception 'invalid_phone'; end if; end if;
  if v_email is not null and (length(v_email) > 200 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'invalid_email'; end if;
  if v_phone is null and v_email is null and v_po is null then raise exception 'contact_required'; end if;
  if v_pref not in ('whatsapp','call','email','other') then raise exception 'invalid_pref'; end if;
  if v_pref in ('whatsapp','call') and v_phone is null then raise exception 'pref_needs_phone'; end if;
  if v_pref = 'email' and v_email is null then raise exception 'pref_needs_email'; end if;
  if v_pref = 'other' and (p_other is null or v_po is null) then raise exception 'pref_other_required'; end if;
  if v_po is not null and length(v_po) > 60 then raise exception 'pref_other_required'; end if;
  if length(v_msg) < 1 then raise exception 'message_required'; end if;
  if length(v_msg) > 2000 then raise exception 'message_too_long'; end if;
  if v_key is not null and length(v_key) > 80 then v_key := left(v_key, 80); end if;
  begin v_cat := nullif(p->>'category_id', '')::uuid; exception when others then raise exception 'invalid_category'; end;
  if v_cat is null then raise exception 'invalid_category'; end if;
  if coalesce(lower(p->>'consent'), 'false') not in ('true','t','1') then raise exception 'consent_required'; end if;
  return jsonb_build_object('name', v_name, 'phone', v_phone, 'email', v_email, 'message', v_msg, 'pref', v_pref, 'pref_other', case when v_pref = 'other' then v_po end, 'key', v_key, 'category_id', v_cat,
                            'notify', coalesce(lower(p->>'notify'), 'true') not in ('false','f','0'));
end $$;
revoke execute on function public.ct_clean(jsonb, text) from public, anon, authenticated;

-- criação (usada pelo app, pelo formulário público e pela equipe)
create or replace function public.ct_create(p_org uuid, p_user uuid, p_person uuid, p jsonb, p_source text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s contact_settings; c jsonb; cat contact_categories; v_id uuid; v_code text; v_resp uuid; v_team uuid; r contact_requests;
begin
  s := public.ct_ensure(p_org);
  c := public.ct_clean(p, s.other_channel);
  select * into cat from contact_categories where id = (c->>'category_id')::uuid and org_id = p_org and active;
  if cat.id is null then raise exception 'invalid_category'; end if;
  if c->>'key' is not null then
    select * into r from contact_requests where org_id = p_org and op_key = c->>'key';
    if r.id is not null then return jsonb_build_object('id', r.id, 'code', r.code, 'repeated', true); end if;
  end if;
  select * into r from contact_requests where org_id = p_org and created_at > now() - interval '10 minutes' and message = c->>'message' and public.ct_norm(name) = public.ct_norm(c->>'name')
     and ((p_user is not null and user_id = p_user) or (p_user is null and user_id is null and coalesce(email, '') = coalesce(c->>'email', '') and coalesce(phone, '') = coalesce(c->>'phone', ''))) limit 1;
  if r.id is not null then return jsonb_build_object('id', r.id, 'code', r.code, 'repeated', true); end if;
  v_resp := case when public.ct_eligible(p_org, cat.default_user_id) then cat.default_user_id end;
  v_team := cat.default_team_id;
  begin
    insert into contact_requests (org_id, person_id, user_id, name, phone, email, category_id, category_name, message, pref_channel, pref_other, consent_version, consent_purpose, source, op_key, notify_requester, responsible_id, team_id, created_by)
    values (p_org, p_person, p_user, c->>'name', c->>'phone', c->>'email', cat.id, cat.name, c->>'message', c->>'pref', c->>'pref_other', s.consent_version, s.consent_purpose, p_source, c->>'key', (c->>'notify')::boolean, v_resp, v_team, auth.uid())
    returning id, code into v_id, v_code;
  exception when unique_violation then
    select * into r from contact_requests where org_id = p_org and op_key = c->>'key';
    return jsonb_build_object('id', r.id, 'code', r.code, 'repeated', true);
  end;
  perform public.ct_log(v_id, p_org, 'create', null, 'received', jsonb_build_object('source', p_source, 'consent_version', s.consent_version));
  if v_resp is not null or v_team is not null then perform public.ct_log(v_id, p_org, 'route_default', null, null, jsonb_build_object('responsible', v_resp, 'team', v_team)); end if;
  perform public.ct_history(v_id, 'Solicitação de contato enviada', cat.name || ' · ' || v_code, 'new');
  perform public.ct_notify(p_org, 'view', 'Nova solicitação de contato', '#/contatos/' || v_id);
  if v_resp is not null and v_resp is distinct from auth.uid() and not (v_resp in (select public.ct_users(p_org, 'view'))) then perform public.notify_user(v_resp, p_org, 'contact', 'Uma solicitação de contato foi encaminhada a você', null, '#/contatos/' || v_id, null); end if;
  if p_user is not null and (c->>'notify')::boolean then perform public.notify_user(p_user, p_org, 'contact', 'Recebemos sua solicitação (' || v_code || ')', 'Nossa equipe vai analisar e entrar em contato pelo canal informado.', '#/contato', null); end if;
  return jsonb_build_object('id', v_id, 'code', v_code, 'repeated', false);
end $$;
revoke execute on function public.ct_create(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- SOMOS Um: formulário, envio e acompanhamento do próprio pedido
create or replace function public.ct_cats(p_org uuid, p_all boolean default false) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description) order by c.position, c.created_at), '[]'::jsonb)
    from contact_categories c where c.org_id = p_org and (p_all or c.active)
$$;
revoke execute on function public.ct_cats(uuid, boolean) from public, anon, authenticated;

create or replace function public.contact_self_get(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s contact_settings; pe people; pr profiles; v_mail text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  s := public.ct_ensure(p_org);
  select * into pe from people where org_id = p_org and user_id = auth.uid() and status in ('active','inactive','pending') order by created_at limit 1;
  select * into pr from profiles where id = auth.uid();
  select email into v_mail from auth.users where id = auth.uid();
  return jsonb_build_object('name', coalesce(pe.full_name, nullif(pr.full_name, ''), public.welcome_name(p_org, auth.uid())), 'phone', coalesce(pe.phone, pr.phone), 'email', coalesce(pe.email, v_mail),
    'has_person', pe.id is not null, 'intro', s.intro_text, 'consent_text', s.consent_text, 'consent_version', s.consent_version, 'other_channel', s.other_channel,
    'categories', public.ct_cats(p_org), 'staff', public.ct_can(p_org, 'view') or public.ct_can(p_org, 'assigned') or public.ct_can(p_org, 'manage') or public.ct_can(p_org, 'categories'));
end $$;
create or replace function public.contact_submit(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  if (select count(*) from contact_requests where org_id = p_org and user_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then raise exception 'too_many_requests'; end if;
  select * into pe from people where org_id = p_org and user_id = auth.uid() and status in ('active','inactive','pending') order by created_at limit 1;
  return public.ct_create(p_org, auth.uid(), pe.id, p, 'app');
end $$;
create or replace function public.contact_mine(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'category', r.category_name, 'status', r.status, 'status_label', public.ct_status_label(r.status), 'created_at', r.created_at, 'completed_at', r.completed_at,
      'pref', r.pref_channel) order by r.created_at desc) from (select * from contact_requests where org_id = p_org and user_id = auth.uid() order by created_at desc limit 30) r), '[]'::jsonb);
end $$;
create or replace function public.contact_public_get(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s contact_settings; o organizations;
begin
  select * into s from contact_settings where form_token = p_token and form_active;
  if s.org_id is null then return null; end if;
  s := public.ct_ensure(s.org_id);
  select * into o from organizations where id = s.org_id;
  return jsonb_build_object('org_name', o.name, 'org_subtitle', o.subtitle, 'logo_url', o.logo_url, 'intro', s.intro_text, 'consent_text', s.consent_text, 'other_channel', s.other_channel, 'categories', public.ct_cats(s.org_id));
end $$;
create or replace function public.contact_public_submit(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s contact_settings; r jsonb;
begin
  select * into s from contact_settings where form_token = p_token and form_active;
  if s.org_id is null then raise exception 'form_closed'; end if;
  if nullif(trim(coalesce(p->>'website', '')), '') is not null then return jsonb_build_object('ok', true, 'code', 'CT-00000'); end if;   -- robô: finge sucesso
  if (select count(*) from contact_requests where org_id = s.org_id and source = 'public_form' and created_at > now() - interval '10 minutes') >= 40 then raise exception 'too_many_requests'; end if;
  r := public.ct_create(s.org_id, null, null, p, 'public_form');
  return jsonb_build_object('ok', true, 'code', r->>'code');
end $$;

-- ---------------------------------------------------------------- configuração (categorias, textos, link público)
create or replace function public.contact_settings_get(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s contact_settings;
begin
  if not public.ct_can(p_org, 'categories') then raise exception 'forbidden'; end if;
  s := public.ct_ensure(p_org);
  return jsonb_build_object('intro', s.intro_text, 'consent_text', s.consent_text, 'consent_version', s.consent_version, 'consent_purpose', s.consent_purpose, 'other_channel', s.other_channel,
    'form_active', s.form_active, 'form_token', s.form_token,
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description, 'active', c.active, 'position', c.position,
        'default_team_id', c.default_team_id, 'default_team_name', (select name from teams where id = c.default_team_id), 'default_user_id', c.default_user_id,
        'default_user_name', case when c.default_user_id is null then null else coalesce(public.welcome_name(p_org, c.default_user_id), 'Usuário removido') end,
        'total', (select count(*) from contact_requests r where r.category_id = c.id)) order by c.position, c.created_at) from contact_categories c where c.org_id = p_org), '[]'::jsonb));
end $$;
create or replace function public.contact_settings_save(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s contact_settings; v_intro text; v_cons text; v_other text; v_active boolean;
begin
  if not public.ct_can(p_org, 'categories') then raise exception 'forbidden'; end if;
  s := public.ct_ensure(p_org);
  v_intro := coalesce(nullif(trim(p->>'intro'), ''), s.intro_text); v_cons := coalesce(nullif(trim(p->>'consent_text'), ''), s.consent_text);
  v_other := case when p ? 'other_channel' then nullif(trim(coalesce(p->>'other_channel', '')), '') else s.other_channel end;
  v_active := case when p ? 'form_active' then coalesce((p->>'form_active')::boolean, false) else s.form_active end;
  if length(v_intro) > 1000 then raise exception 'text_too_long'; end if;
  if length(v_cons) > 600 then raise exception 'text_too_long'; end if;
  if v_other is not null and length(v_other) > 60 then raise exception 'text_too_long'; end if;
  update contact_settings set intro_text = v_intro, consent_text = v_cons, consent_version = consent_version + case when v_cons <> s.consent_text then 1 else 0 end,
    other_channel = v_other, form_active = v_active, form_token = case when coalesce((p->>'rotate')::boolean, false) then replace(gen_random_uuid()::text, '-', '') else form_token end, updated_at = now()
   where org_id = p_org;
  return jsonb_build_object('saved', true);
end $$;
create or replace function public.contact_category_save(p_org uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c contact_categories; v_name text := trim(coalesce(p->>'name', '')); v_team uuid; v_user uuid; v_id uuid;
begin
  if not public.ct_can(p_org, 'categories') then raise exception 'forbidden'; end if;
  perform public.ct_ensure(p_org);
  if p_id is not null then select * into c from contact_categories where id = p_id and org_id = p_org; if c.id is null then raise exception 'not_found'; end if; end if;
  if p_id is null or p ? 'name' then if length(v_name) < 1 then raise exception 'name_required'; end if; if length(v_name) > 80 then raise exception 'name_too_long'; end if; else v_name := c.name; end if;
  if p ? 'description' and length(coalesce(p->>'description', '')) > 300 then raise exception 'text_too_long'; end if;
  v_team := case when p ? 'default_team_id' then nullif(p->>'default_team_id', '')::uuid else c.default_team_id end;
  v_user := case when p ? 'default_user_id' then nullif(p->>'default_user_id', '')::uuid else c.default_user_id end;
  if v_team is not null and not exists (select 1 from teams where id = v_team and org_id = p_org) then raise exception 'invalid_team'; end if;
  if v_user is not null and not public.ct_eligible(p_org, v_user) then raise exception 'invalid_responsible'; end if;
  if p_id is null then
    insert into contact_categories (org_id, name, description, active, position, default_team_id, default_user_id)
    values (p_org, v_name, nullif(trim(coalesce(p->>'description', '')), ''), coalesce((p->>'active')::boolean, true), coalesce((select max(position) from contact_categories where org_id = p_org), 0) + 1, v_team, v_user) returning id into v_id;
  else
    update contact_categories set name = v_name, description = case when p ? 'description' then nullif(trim(coalesce(p->>'description', '')), '') else description end,
      active = case when p ? 'active' then coalesce((p->>'active')::boolean, active) else active end, default_team_id = v_team, default_user_id = v_user where id = p_id;
    v_id := p_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;
create or replace function public.contact_category_move(p_id uuid, p_dir int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c contact_categories; n contact_categories;
begin
  select * into c from contact_categories where id = p_id; if c.id is null then raise exception 'not_found'; end if;
  if not public.ct_can(c.org_id, 'categories') then raise exception 'forbidden'; end if;
  if p_dir = -1 then select * into n from contact_categories where org_id = c.org_id and (position, created_at) < (c.position, c.created_at) order by position desc, created_at desc limit 1;
  elsif p_dir = 1 then select * into n from contact_categories where org_id = c.org_id and (position, created_at) > (c.position, c.created_at) order by position, created_at limit 1;
  else raise exception 'invalid_order'; end if;
  if n.id is null then return jsonb_build_object('moved', false); end if;
  if n.position = c.position then update contact_categories set position = position + case when p_dir = 1 then 1 else -1 end where id = c.id;
  else update contact_categories set position = n.position where id = c.id; update contact_categories set position = c.position where id = n.id; end if;
  return jsonb_build_object('moved', true);
end $$;
create or replace function public.contact_responsibles(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.ct_can(p_org, 'assign') or public.ct_can(p_org, 'categories') or public.ct_can(p_org, 'view')) then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'users', coalesce((select jsonb_agg(jsonb_build_object('user_id', u, 'name', coalesce(public.welcome_name(p_org, u), 'Sem nome')) order by coalesce(public.welcome_name(p_org, u), ''))
                       from (select distinct x u from (select public.ct_users(p_org, 'manage') x union select public.ct_users(p_org, 'assigned')) y) z
                      where exists (select 1 from org_members where org_id = p_org and user_id = z.u)), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name) from teams t where t.org_id = p_org), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- SOMOS Chamados: central de solicitações
create or replace function public.contact_list(p_org uuid, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_all boolean; v_q text := nullif(trim(coalesce(p->>'q', '')), ''); v_status text := nullif(p->>'status', ''); v_cat uuid; v_resp text := nullif(p->>'responsible', '');
        v_from date; v_to date; v_asc boolean := coalesce(p->>'order', 'desc') = 'asc'; v_lim int; v_off int; v_items jsonb; v_total int; v_ind jsonb; v_ru uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_all := public.ct_can(p_org, 'view');
  if not (v_all or public.ct_can(p_org, 'assigned')) then raise exception 'forbidden'; end if;
  if v_status is not null and v_status not in ('received','review','forwarded','in_progress','waiting','completed','cancelled') then raise exception 'invalid_filter'; end if;
  begin v_cat := nullif(p->>'category', '')::uuid; v_from := nullif(p->>'from', '')::date; v_to := nullif(p->>'to', '')::date;
        v_ru := case when v_resp is not null and v_resp not in ('none','me') then v_resp::uuid end;
        v_lim := least(greatest(coalesce(nullif(p->>'limit', '')::int, 30), 1), 100); v_off := greatest(coalesce(nullif(p->>'offset', '')::int, 0), 0);
  exception when others then raise exception 'invalid_filter'; end;
  select jsonb_build_object('total', count(*), 'received', count(*) filter (where status = 'received'), 'review', count(*) filter (where status = 'review'), 'forwarded', count(*) filter (where status = 'forwarded'),
         'in_progress', count(*) filter (where status = 'in_progress'), 'waiting', count(*) filter (where status = 'waiting'), 'completed', count(*) filter (where status = 'completed'), 'cancelled', count(*) filter (where status = 'cancelled'))
    into v_ind from contact_requests r where r.org_id = p_org and (v_all or r.responsible_id = auth.uid());
  with f as (
    select r.* from contact_requests r
     where r.org_id = p_org and (v_all or r.responsible_id = auth.uid())
       and (v_q is null or r.name ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%' or r.code ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%')
       and (v_cat is null or r.category_id = v_cat) and (v_status is null or r.status = v_status)
       and (v_resp is null or (v_resp = 'none' and r.responsible_id is null) or (v_resp = 'me' and r.responsible_id = auth.uid()) or r.responsible_id = v_ru)
       and (v_from is null or (r.created_at at time zone 'America/Sao_Paulo')::date >= v_from) and (v_to is null or (r.created_at at time zone 'America/Sao_Paulo')::date <= v_to)
  )
  select (select count(*) from f), coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb) into v_total, v_items from (
    select case when v_asc then extract(epoch from q.created_at) else -extract(epoch from q.created_at) end as ord,
           jsonb_build_object('id', q.id, 'code', q.code, 'name', q.name, 'category', q.category_name, 'created_at', q.created_at, 'status', q.status, 'status_label', public.ct_status_label(q.status),
             'responsible_id', q.responsible_id, 'responsible_name', case when q.responsible_id is null then null else coalesce(public.welcome_name(q.org_id, q.responsible_id), 'Usuário removido') end,
             'team_name', (select name from teams where id = q.team_id), 'updated_at', q.updated_at, 'linked', q.person_id is not null) as j
      from (select * from f order by created_at desc, id limit 5000) q order by ord limit v_lim offset v_off) x;
  return jsonb_build_object('items', v_items, 'total', v_total, 'indicators', v_ind, 'view_all', v_all, 'can_create', public.ct_can(p_org, 'manage'), 'can_categories', public.ct_can(p_org, 'categories'),
    'categories', public.ct_cats(p_org, true));
end $$;

create or replace function public.contact_get(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r contact_requests; v_conf boolean; v_manage boolean; v_notes jsonb := '[]'::jsonb; pe people; v_next jsonb;
begin
  select * into r from contact_requests where id = p_id; if r.id is null then raise exception 'not_found'; end if;
  if public.ct_scope(r.org_id, r.responsible_id) = 'none' then raise exception 'forbidden'; end if;
  v_conf := public.ct_can(r.org_id, 'confidential'); v_manage := public.ct_can(r.org_id, 'manage');
  if r.person_id is not null then select * into pe from people where id = r.person_id; end if;
  if v_conf then
    v_notes := coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'at', n.created_at, 'by', coalesce(public.welcome_name(n.org_id, n.author), 'Usuário removido')) order by n.created_at desc) from contact_notes n where n.request_id = p_id), '[]'::jsonb);
    if not exists (select 1 from contact_log where request_id = p_id and actor = auth.uid() and action = 'notes_read' and at > now() - interval '30 minutes') then perform public.ct_log(p_id, r.org_id, 'notes_read', null, null, '{}'::jsonb, true); end if;
  end if;
  v_next := case when r.status in ('completed','cancelled') then '[]'::jsonb when not v_manage then '[]'::jsonb
    else (select coalesce(jsonb_agg(x), '[]'::jsonb) from unnest(public.ct_next(r.status)) x where x <> 'cancelled' or public.ct_can(r.org_id, 'cancel')) end;
  return jsonb_build_object('id', r.id, 'org_id', r.org_id, 'code', r.code, 'name', r.name, 'phone', r.phone, 'email', r.email, 'category', r.category_name, 'category_id', r.category_id, 'message', r.message,
    'pref', r.pref_channel, 'pref_other', r.pref_other, 'consent_at', r.consent_at, 'consent_version', r.consent_version, 'consent_purpose', r.consent_purpose, 'status', r.status, 'status_label', public.ct_status_label(r.status),
    'source', r.source, 'created_at', r.created_at, 'updated_at', r.updated_at, 'completed_at', r.completed_at, 'cancel_reason', r.cancel_reason, 'has_account', r.user_id is not null, 'care_at', r.care_at,
    'responsible_id', r.responsible_id, 'responsible_name', case when r.responsible_id is null then null else coalesce(public.welcome_name(r.org_id, r.responsible_id), 'Usuário removido') end,
    'team_id', r.team_id, 'team_name', (select name from teams where id = r.team_id),
    'person', case when pe.id is null then null else jsonb_build_object('id', pe.id, 'name', pe.full_name, 'photo_url', pe.photo_url, 'can_open', public.people_scope_all(r.org_id) and public.has_people_perm(r.org_id, 'people_view')) end,
    'next', v_next, 'can_manage', v_manage, 'can_assign', public.ct_can(r.org_id, 'assign') and r.status not in ('completed','cancelled'), 'can_reopen', public.ct_can(r.org_id, 'reopen') and r.status in ('completed','cancelled'),
    'can_confidential', v_conf, 'can_link', v_manage and r.person_id is null, 'can_create_person', public.has_people_perm(r.org_id, 'people_edit'),
    'can_care', r.person_id is not null and r.care_at is null and public.has_people_perm(r.org_id, 'people_care'),
    'log', coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'from', l.from_status, 'to', l.to_status, 'detail', l.detail, 'at', l.at, 'restricted', l.restricted,
        'by', case when l.actor is null then 'Sistema' else coalesce(public.welcome_name(l.org_id, l.actor), 'Usuário removido') end) order by l.at desc, l.id desc)
        from (select * from contact_log where request_id = p_id and (v_conf or not restricted) order by at desc, id desc limit 100) l), '[]'::jsonb),
    'interactions', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'description', i.description, 'result', i.result, 'at', i.occurred_at, 'by', coalesce(public.welcome_name(i.org_id, i.author), 'Usuário removido')) order by i.occurred_at desc)
        from contact_interactions i where i.request_id = p_id), '[]'::jsonb),
    'notes', v_notes);
end $$;

create or replace function public.contact_create(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_person uuid;
begin
  if not public.ct_can(p_org, 'manage') then raise exception 'forbidden'; end if;
  begin v_person := nullif(p->>'person_id', '')::uuid; exception when others then raise exception 'person_not_found'; end;
  if v_person is not null and not exists (select 1 from people where id = v_person and org_id = p_org and status in ('active','inactive','pending')) then raise exception 'person_not_found'; end if;
  return public.ct_create(p_org, null, v_person, p, 'admin');
end $$;

create or replace function public.contact_update(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r contact_requests; s contact_settings; v_name text; v_phone text; v_email text; v_pref text; v_po text; v_d text; v_fields text[] := '{}';
begin
  select * into r from contact_requests where id = p_id for update; if r.id is null then raise exception 'not_found'; end if;
  if public.ct_scope(r.org_id, r.responsible_id) = 'none' or not public.ct_can(r.org_id, 'manage') then raise exception 'forbidden'; end if;
  if r.status in ('completed','cancelled') then raise exception 'request_closed'; end if;
  select * into s from contact_settings where org_id = r.org_id;
  v_name := case when p ? 'name' then trim(coalesce(p->>'name', '')) else r.name end;
  v_phone := case when p ? 'phone' then nullif(trim(coalesce(p->>'phone', '')), '') else r.phone end;
  v_email := case when p ? 'email' then nullif(lower(trim(coalesce(p->>'email', ''))), '') else r.email end;
  v_pref := case when p ? 'pref' then p->>'pref' else r.pref_channel end;
  v_po := case when p ? 'pref_other' then nullif(trim(coalesce(p->>'pref_other', '')), '') else r.pref_other end;
  if length(v_name) < 1 then raise exception 'name_required'; end if;
  if length(v_name) > 160 then raise exception 'name_too_long'; end if;
  if v_phone is not null then v_d := public.digits(v_phone); if v_d is null or length(v_d) < 8 or length(v_d) > 15 or length(v_phone) > 30 then raise exception 'invalid_phone'; end if; end if;
  if v_email is not null and (length(v_email) > 200 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'invalid_email'; end if;
  if v_pref not in ('whatsapp','call','email','other') then raise exception 'invalid_pref'; end if;
  if v_pref in ('whatsapp','call') and v_phone is null then raise exception 'pref_needs_phone'; end if;
  if v_pref = 'email' and v_email is null then raise exception 'pref_needs_email'; end if;
  if v_pref = 'other' and (s.other_channel is null or v_po is null) then raise exception 'pref_other_required'; end if;
  if v_name is distinct from r.name then v_fields := array_append(v_fields, 'nome'); end if; if v_phone is distinct from r.phone then v_fields := array_append(v_fields, 'telefone'); end if;
  if v_email is distinct from r.email then v_fields := array_append(v_fields, 'e-mail'); end if; if v_pref is distinct from r.pref_channel or v_po is distinct from r.pref_other then v_fields := array_append(v_fields, 'preferência de contato'); end if;
  if cardinality(v_fields) = 0 then return jsonb_build_object('saved', false); end if;
  update contact_requests set name = v_name, phone = v_phone, email = v_email, pref_channel = v_pref, pref_other = case when v_pref = 'other' then v_po end, updated_at = now() where id = p_id;
  perform public.ct_log(p_id, r.org_id, 'edit', null, null, jsonb_build_object('fields', to_jsonb(v_fields)));
  return jsonb_build_object('saved', true);
end $$;

create or replace function public.contact_status(p_id uuid, p_status text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r contact_requests; v_reason text := nullif(trim(coalesce(p_reason, '')), ''); v_to text := p_status;
begin
  select * into r from contact_requests where id = p_id for update; if r.id is null then raise exception 'not_found'; end if;
  if public.ct_scope(r.org_id, r.responsible_id) = 'none' then raise exception 'forbidden'; end if;
  if v_reason is not null and length(v_reason) > 500 then raise exception 'text_too_long'; end if;
  if p_status is null or p_status not in ('received','review','forwarded','in_progress','waiting','completed','cancelled') then raise exception 'invalid_status'; end if;
  if p_status = r.status then raise exception 'same_status'; end if;
  if r.status in ('completed','cancelled') then
    if not public.ct_can(r.org_id, 'reopen') then raise exception 'forbidden'; end if;
    if p_status <> 'review' then raise exception 'reopen_first'; end if;
    if v_reason is null or length(v_reason) < 3 then raise exception 'reason_required'; end if;
    update contact_requests set status = 'review', completed_at = null, cancel_reason = null, updated_at = now() where id = p_id;
    perform public.ct_log(p_id, r.org_id, 'reopen', r.status, 'review', jsonb_build_object('reason', v_reason));
    if r.responsible_id is not null and r.responsible_id is distinct from auth.uid() then perform public.notify_user(r.responsible_id, r.org_id, 'contact', 'Uma solicitação de contato foi reaberta', null, '#/contatos/' || p_id, null); end if;
    return jsonb_build_object('status', 'review');
  end if;
  if not public.ct_can(r.org_id, 'manage') then raise exception 'forbidden'; end if;
  if not (p_status = any (public.ct_next(r.status))) then raise exception 'invalid_transition'; end if;
  if p_status = 'cancelled' then
    if not public.ct_can(r.org_id, 'cancel') then raise exception 'forbidden'; end if;
    if v_reason is null or length(v_reason) < 3 then raise exception 'reason_required'; end if;
  end if;
  update contact_requests set status = p_status, completed_at = case when p_status = 'completed' then now() end, cancel_reason = case when p_status = 'cancelled' then v_reason end, updated_at = now() where id = p_id;
  perform public.ct_log(p_id, r.org_id, 'status', r.status, p_status, jsonb_build_object('reason', v_reason));
  if p_status = 'completed' then perform public.ct_history(p_id, 'Solicitação de contato concluída', r.category_name || ' · ' || r.code, 'done'); end if;
  if r.user_id is not null and r.notify_requester and r.user_id is distinct from auth.uid() and p_status in ('in_progress','completed','cancelled') then
    perform public.notify_user(r.user_id, r.org_id, 'contact', case p_status when 'in_progress' then 'Sua solicitação está em atendimento' when 'completed' then 'Sua solicitação foi concluída' else 'Sua solicitação foi encerrada' end, r.code, '#/contato', null);
  end if;
  return jsonb_build_object('status', p_status);
end $$;

-- responsável individual, equipe, transferência e retirada: tudo por aqui
create or replace function public.contact_assign(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r contact_requests; v_user uuid; v_team uuid; v_note text := nullif(trim(coalesce(p->>'note', '')), ''); v_changed boolean := false; v_new_status text;
begin
  select * into r from contact_requests where id = p_id for update; if r.id is null then raise exception 'not_found'; end if;
  if public.ct_scope(r.org_id, r.responsible_id) = 'none' or not public.ct_can(r.org_id, 'assign') then raise exception 'forbidden'; end if;
  if r.status in ('completed','cancelled') then raise exception 'request_closed'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'text_too_long'; end if;
  v_user := r.responsible_id; v_team := r.team_id;
  begin
    if p ? 'user_id' then v_user := nullif(p->>'user_id', '')::uuid; end if;
    if p ? 'team_id' then v_team := nullif(p->>'team_id', '')::uuid; end if;
  exception when others then raise exception 'invalid_responsible'; end;
  if v_user is not null and v_user is distinct from r.responsible_id and not public.ct_eligible(r.org_id, v_user) then raise exception 'invalid_responsible'; end if;
  if v_team is not null and v_team is distinct from r.team_id and not exists (select 1 from teams where id = v_team and org_id = r.org_id) then raise exception 'invalid_team'; end if;
  if v_user is not distinct from r.responsible_id and v_team is not distinct from r.team_id then raise exception 'no_change'; end if;
  update contact_requests set responsible_id = v_user, team_id = v_team, updated_at = now() where id = p_id;
  if v_user is distinct from r.responsible_id then
    perform public.ct_log(p_id, r.org_id, case when v_user is null then 'unassign' when r.responsible_id is null then 'assign' else 'transfer' end, null, null,
      jsonb_build_object('from', r.responsible_id, 'to', v_user, 'from_name', case when r.responsible_id is null then null else coalesce(public.welcome_name(r.org_id, r.responsible_id), 'Usuário removido') end,
                         'to_name', case when v_user is null then null else coalesce(public.welcome_name(r.org_id, v_user), 'Usuário removido') end, 'note', v_note));
    v_changed := true;
    if v_user is not null and v_user is distinct from auth.uid() then perform public.notify_user(v_user, r.org_id, 'contact', case when r.responsible_id is null then 'Uma solicitação de contato foi atribuída a você' else 'Uma solicitação de contato foi transferida para você' end, null, '#/contatos/' || p_id, null); end if;
    if r.responsible_id is not null and r.responsible_id is distinct from auth.uid() and r.responsible_id is distinct from v_user then perform public.notify_user(r.responsible_id, r.org_id, 'contact', 'Uma solicitação de contato não está mais com você', null, null, null); end if;
  end if;
  if v_team is distinct from r.team_id then
    perform public.ct_log(p_id, r.org_id, 'team', null, null, jsonb_build_object('to_name', (select name from teams where id = v_team), 'from_name', (select name from teams where id = r.team_id), 'note', v_note));
    v_changed := true;
  end if;
  if r.status in ('received','review') and (v_user is not null or v_team is not null) then
    update contact_requests set status = 'forwarded' where id = p_id;
    perform public.ct_log(p_id, r.org_id, 'status', r.status, 'forwarded', jsonb_build_object('auto', true));
  end if;
  return jsonb_build_object('saved', v_changed);
end $$;

create or replace function public.contact_interaction_add(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r contact_requests; v_kind text := coalesce(p->>'kind', ''); v_desc text := trim(coalesce(p->>'description', '')); v_res text := nullif(trim(coalesce(p->>'result', '')), ''); v_at timestamptz := now();
begin
  select * into r from contact_requests where id = p_id; if r.id is null then raise exception 'not_found'; end if;
  if public.ct_scope(r.org_id, r.responsible_id) = 'none' or not public.ct_can(r.org_id, 'manage') then raise exception 'forbidden'; end if;
  if r.status in ('completed','cancelled') then raise exception 'request_closed'; end if;
  if v_kind not in ('call','message','in_person','email','attempt','reply','other') then raise exception 'invalid_kind'; end if;
  if length(v_desc) < 1 then raise exception 'description_required'; end if;
  if length(v_desc) > 2000 or length(coalesce(v_res, '')) > 500 then raise exception 'text_too_long'; end if;
  begin if nullif(p->>'at', '') is not null then v_at := (p->>'at')::timestamptz; end if; exception when others then raise exception 'invalid_date'; end;
  if v_at > now() + interval '10 minutes' or v_at < r.created_at - interval '1 day' then raise exception 'invalid_date'; end if;
  insert into contact_interactions (request_id, org_id, kind, description, result, occurred_at, author) values (p_id, r.org_id, v_kind, v_desc, v_res, v_at, auth.uid());
  update contact_requests set updated_at = now() where id = p_id;
  perform public.ct_log(p_id, r.org_id, 'interaction', null, null, jsonb_build_object('kind', v_kind));
  return jsonb_build_object('saved', true);
end $$;

create or replace function public.contact_note_add(p_id uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r contact_requests; v_body text := trim(coalesce(p_body, ''));
begin
  select * into r from contact_requests where id = p_id; if r.id is null then raise exception 'not_found'; end if;
  if public.ct_scope(r.org_id, r.responsible_id) = 'none' or not public.ct_can(r.org_id, 'confidential') then raise exception 'forbidden'; end if;
  if length(v_body) < 1 then raise exception 'note_required'; end if;
  if length(v_body) > 4000 then raise exception 'text_too_long'; end if;
  insert into contact_notes (request_id, org_id, body, author) values (p_id, r.org_id, v_body, auth.uid());
  perform public.ct_log(p_id, r.org_id, 'note', null, null, '{}'::jsonb, true);   -- o texto nunca vai para o histórico geral
  return jsonb_build_object('saved', true);
end $$;

-- ---------------------------------------------------------------- ficha da pessoa e atendimento pastoral
create or replace function public.contact_people_search(p_org uuid, p_q text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_q text := trim(coalesce(p_q, ''));
begin
  if not public.ct_can(p_org, 'manage') then raise exception 'forbidden'; end if;
  if length(v_q) < 2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'full_name', x.full_name, 'classification', x.classification, 'photo_url', x.photo_url) order by x.full_name)
    from (select id, full_name, classification, photo_url from people where org_id = p_org and status in ('active','inactive','pending') and full_name ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%' order by full_name limit 12) x), '[]'::jsonb);
end $$;
create or replace function public.contact_link(p_id uuid, p_person uuid, p_create boolean default false, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r contact_requests; v_pid uuid; v_dupes jsonb;
begin
  select * into r from contact_requests where id = p_id for update; if r.id is null then raise exception 'not_found'; end if;
  if public.ct_scope(r.org_id, r.responsible_id) = 'none' or not public.ct_can(r.org_id, 'manage') then raise exception 'forbidden'; end if;
  if r.person_id is not null then raise exception 'already_linked'; end if;
  if coalesce(p_create, false) then
    if not public.has_people_perm(r.org_id, 'people_edit') then raise exception 'forbidden'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'full_name', x.full_name)), '[]'::jsonb) into v_dupes from people x
     where x.org_id = r.org_id and x.status in ('active','inactive','pending') and ((r.email is not null and lower(x.email) = r.email) or (r.phone is not null and public.digits(x.phone) = public.digits(r.phone)));
    if jsonb_array_length(v_dupes) > 0 and not coalesce(p_force, false) then return jsonb_build_object('saved', false, 'candidates', v_dupes); end if;
    insert into people (org_id, full_name, phone, email, classification, status, source, registered_at, created_by, flagged_duplicate)
    values (r.org_id, r.name, r.phone, r.email, 'none', 'active', 'manual', (r.created_at at time zone 'America/Sao_Paulo')::date, auth.uid(), jsonb_array_length(v_dupes) > 0) returning id into v_pid;
    perform public.person_log(r.org_id, v_pid, 'create', null, null, 'none', 'cadastro criado a partir de uma solicitação de contato');
  else
    if p_person is null or not exists (select 1 from people where id = p_person and org_id = r.org_id and status in ('active','inactive','pending')) then raise exception 'person_not_found'; end if;
    v_pid := p_person;
  end if;
  update contact_requests set person_id = v_pid, linked_at = now(), linked_by = auth.uid(), updated_at = now() where id = p_id;
  perform public.ct_log(p_id, r.org_id, 'link', null, null, jsonb_build_object('person_id', v_pid, 'created', coalesce(p_create, false)));
  perform public.ct_history(p_id, 'Solicitação de contato enviada', r.category_name || ' · ' || r.code, 'new');
  if r.status = 'completed' then perform public.ct_history(p_id, 'Solicitação de contato concluída', r.category_name || ' · ' || r.code, 'done'); end if;
  return jsonb_build_object('saved', true, 'person_id', v_pid);
end $$;
create or replace function public.contact_for_person(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from people where id = p_person; if pe.id is null then raise exception 'not_found'; end if;
  if not (public.ct_can(pe.org_id, 'view') or public.ct_can(pe.org_id, 'assigned')) then return jsonb_build_object('allowed', false, 'items', '[]'::jsonb); end if;
  return jsonb_build_object('allowed', true, 'items', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'category', r.category_name, 'status', r.status, 'status_label', public.ct_status_label(r.status), 'created_at', r.created_at) order by r.created_at desc)
      from contact_requests r where r.person_id = p_person and public.ct_scope(r.org_id, r.responsible_id) <> 'none'), '[]'::jsonb));
end $$;
-- inicia o acompanhamento pastoral reaproveitando o registro existente (person_care): só o vínculo, sem copiar a mensagem
create or replace function public.contact_to_care(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r contact_requests;
begin
  select * into r from contact_requests where id = p_id for update; if r.id is null then raise exception 'not_found'; end if;
  if public.ct_scope(r.org_id, r.responsible_id) = 'none' or not public.has_people_perm(r.org_id, 'people_care') then raise exception 'forbidden'; end if;
  if r.person_id is null then raise exception 'link_required'; end if;
  if r.care_at is not null then raise exception 'already_started'; end if;
  insert into person_care (org_id, person_id, kind, note, created_by, created_by_name)
  values (r.org_id, r.person_id, 'other', 'Acompanhamento iniciado a partir da solicitação de contato ' || r.code || ' (' || r.category_name || '). O pedido original está na solicitação.', auth.uid(), public.welcome_name(r.org_id, auth.uid()));
  insert into person_care_access (org_id, person_id, actor, action) values (r.org_id, r.person_id, auth.uid(), 'add');
  update contact_requests set care_at = now(), updated_at = now() where id = p_id;
  perform public.ct_log(p_id, r.org_id, 'to_care', null, null, '{}'::jsonb);
  return jsonb_build_object('saved', true);
end $$;

-- ---------------------------------------------------------------- permissões de execução
revoke execute on function
  public.contact_self_get(uuid), public.contact_submit(uuid, jsonb), public.contact_mine(uuid), public.contact_public_get(text), public.contact_public_submit(text, jsonb),
  public.contact_settings_get(uuid), public.contact_settings_save(uuid, jsonb), public.contact_category_save(uuid, uuid, jsonb), public.contact_category_move(uuid, int), public.contact_responsibles(uuid),
  public.contact_list(uuid, jsonb), public.contact_get(uuid), public.contact_create(uuid, jsonb), public.contact_update(uuid, jsonb), public.contact_status(uuid, text, text), public.contact_assign(uuid, jsonb),
  public.contact_interaction_add(uuid, jsonb), public.contact_note_add(uuid, text), public.contact_people_search(uuid, text), public.contact_link(uuid, uuid, boolean, boolean), public.contact_for_person(uuid), public.contact_to_care(uuid) from public, anon;
grant execute on function
  public.contact_self_get(uuid), public.contact_submit(uuid, jsonb), public.contact_mine(uuid),
  public.contact_settings_get(uuid), public.contact_settings_save(uuid, jsonb), public.contact_category_save(uuid, uuid, jsonb), public.contact_category_move(uuid, int), public.contact_responsibles(uuid),
  public.contact_list(uuid, jsonb), public.contact_get(uuid), public.contact_create(uuid, jsonb), public.contact_update(uuid, jsonb), public.contact_status(uuid, text, text), public.contact_assign(uuid, jsonb),
  public.contact_interaction_add(uuid, jsonb), public.contact_note_add(uuid, text), public.contact_people_search(uuid, text), public.contact_link(uuid, uuid, boolean, boolean), public.contact_for_person(uuid), public.contact_to_care(uuid) to authenticated;
grant execute on function public.contact_public_get(text), public.contact_public_submit(text, jsonb) to anon, authenticated;

-- Conferência (retorna true):
--   select to_regclass('public.contact_requests') is not null
--      and to_regprocedure('public.contact_submit(uuid,jsonb)') is not null
--      and to_regprocedure('public.contact_status(uuid,text,text)') is not null
--      and 'people_contacts_view' = any (public.all_actions()) as ok;

-- >>> supabase/migrations/20261203000001_relatorios_pessoas.sql
-- =====================================================================
-- SOMOS Recurso 10: Relatórios de Pessoas
-- Indicadores calculados no servidor a partir dos dados reais (ficha, histórico, família, times, decisões de fé). Nada é carregado em massa no navegador.
--  * uma pessoa conta uma vez; vínculos ministeriais e participações por time são contados à parte; usuário do app sem ficha nunca vira membro;
--  * novos convertidos são evento (faith_decisions), não classificação; dado ausente aparece como "não informado" e nunca é presumido;
--  * evolução usa o histórico (data de OCORRÊNCIA, não a do registro) e informa a cobertura do histórico em vez de inventar números;
--  * permissões people_reports_*; escopo "igreja" ou "só o que lidero/superviso", sempre validado aqui; menores têm nome abreviado nas listas; sem CPF/contato nas listas;
--  * toda exportação (indicadores ou lista) fica registrada em report_exports.
-- =====================================================================
-- ---------------------------------------------------------------- permissões novas
alter table public.access_grants drop constraint if exists access_grants_actions_check;
alter table public.access_grants add constraint access_grants_actions_check check (
  actions <@ array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
                   'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin',
                   'people_journeys_admin','people_journeys_participants','people_journeys_follow','people_journeys_approve','people_journeys_indicators','people_contacts_view','people_contacts_assigned','people_contacts_manage','people_contacts_assign','people_contacts_confidential','people_contacts_categories','people_contacts_reopen','people_contacts_cancel','people_contacts_admin','people_reports_dashboard','people_reports_membership','people_reports_demographics','people_reports_family','people_reports_ministry','people_reports_individual','people_reports_export','people_reports_export_lists','people_reports_church','people_reports_own','people_reports_admin']::text[]);
create or replace function public.all_actions() returns text[] language sql immutable as $$
  select array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
               'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin',
               'people_journeys_admin','people_journeys_participants','people_journeys_follow','people_journeys_approve','people_journeys_indicators','people_contacts_view','people_contacts_assigned','people_contacts_manage','people_contacts_assign','people_contacts_confidential','people_contacts_categories','people_contacts_reopen','people_contacts_cancel','people_contacts_admin','people_reports_dashboard','people_reports_membership','people_reports_demographics','people_reports_family','people_reports_ministry','people_reports_individual','people_reports_export','people_reports_export_lists','people_reports_church','people_reports_own','people_reports_admin']::text[]
$$;
create or replace function public.people_actions(p_org uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
      then array['people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
                 'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin',
                 'people_journeys_admin','people_journeys_participants','people_journeys_follow','people_journeys_approve','people_journeys_indicators','people_contacts_view','people_contacts_assigned','people_contacts_manage','people_contacts_assign','people_contacts_confidential','people_contacts_categories','people_contacts_reopen','people_contacts_cancel','people_contacts_admin','people_reports_dashboard','people_reports_membership','people_reports_demographics','people_reports_family','people_reports_ministry','people_reports_individual','people_reports_export','people_reports_export_lists','people_reports_church','people_reports_own','people_reports_admin']
    else coalesce((select array_agg(distinct a) from access_grants g, unnest(g.actions) a
                   where g.org_id = p_org and g.user_id = auth.uid() and a like 'people\_%'), '{}'::text[]) end
$$;


-- ---------------------------------------------------------------- utilitários
create or replace function public.rp_can(p_org uuid, p_mode text) returns boolean
language sql stable security definer set search_path = public as $$
  select ('people_reports_' || p_mode) = any (public.people_actions(p_org))
$$;
-- escopo: 'church' (igreja inteira), 'own' (só quem está nos times que lidera ou nas redes que supervisiona) ou erro
create or replace function public.rp_scope_kind(p_org uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if public.rp_can(p_org, 'church') then return 'church'; end if;
  if public.rp_can(p_org, 'own') then return 'own'; end if;
  raise exception 'forbidden';
end $$;
create or replace function public.rp_own_teams(p_org uuid) returns table(tid uuid)
language sql stable security definer set search_path = public as $$
  select t.team_id from team_members t where t.user_id = auth.uid() and t.is_leader and t.org_id = p_org
  union
  select nt.team_id from access_grants g join network_teams nt on nt.network_id = g.network_id where g.user_id = auth.uid() and g.org_id = p_org and g.role_key = 'network_supervisor'
$$;
create or replace function public.rp_own(p_org uuid) returns table(sid uuid)
language sql stable security definer set search_path = public as $$
  select distinct pe.id from people pe join team_members tm on tm.user_id = pe.user_id
   where pe.org_id = p_org and tm.team_id in (select tid from public.rp_own_teams(p_org))
$$;
create or replace function public.rp_today() returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
create or replace function public.rp_arr(f jsonb, k text) returns text[] language sql immutable as $$
  select case when jsonb_typeof(f->k) = 'array' and jsonb_array_length(f->k) > 0 then array(select jsonb_array_elements_text(f->k)) end
$$;
revoke execute on function public.rp_can(uuid, text), public.rp_scope_kind(uuid), public.rp_own(uuid), public.rp_own_teams(uuid), public.rp_today(), public.rp_arr(jsonb, text) from public, anon, authenticated;

create table if not exists public.report_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  age_bands jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists public.report_exports (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor uuid references auth.users(id) on delete set null,
  area text not null,
  kind text not null check (kind in ('indicators','list')),
  format text not null check (format in ('xlsx','csv','pdf')),
  filters jsonb not null default '{}'::jsonb,
  row_count int,
  at timestamptz not null default now()
);
create index if not exists report_exports_org on public.report_exports (org_id, at desc);
alter table public.report_settings enable row level security;
alter table public.report_exports enable row level security;
revoke all on public.report_settings, public.report_exports from anon, authenticated;
create index if not exists people_org_registered on public.people (org_id, registered_at);
create index if not exists person_history_org_kind on public.person_history (org_id, kind, person_id);

create or replace function public.rp_bands(p_org uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select age_bands from report_settings where org_id = p_org),
    '[{"label":"0 a 12 anos","min":0,"max":12},{"label":"13 a 17 anos","min":13,"max":17},{"label":"18 a 24 anos","min":18,"max":24},{"label":"25 a 34 anos","min":25,"max":34},{"label":"35 a 44 anos","min":35,"max":44},{"label":"45 a 54 anos","min":45,"max":54},{"label":"55 a 64 anos","min":55,"max":64},{"label":"65 anos ou mais","min":65,"max":null}]'::jsonb)
$$;
revoke execute on function public.rp_bands(uuid) from public, anon, authenticated;

-- população considerada: escopo do usuário + filtros de perfil. Idade calculada hoje (fuso de São Paulo).
create or replace function public.rp_pop(p_org uuid, f jsonb default '{}'::jsonb) returns table(id uuid, full_name text, classification text, status text, sex text, marital text, neighborhood text, city text, birth_date date, age int, band int,
  user_id uuid, registered_at date, joined_at date, created_at timestamptz, incomplete boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_scope text := public.rp_scope_kind(p_org); v_bands jsonb := public.rp_bands(p_org); v_today date := public.rp_today(); v_net uuid; v_team uuid;
        a_cls text[] := public.rp_arr(f, 'classification'); a_st text[] := coalesce(public.rp_arr(f, 'status'), array['active','inactive']); a_band text[] := public.rp_arr(f, 'band'); a_sex text[] := public.rp_arr(f, 'sex');
        a_mar text[] := public.rp_arr(f, 'marital'); a_nei text[] := public.rp_arr(f, 'neighborhood'); a_city text[] := public.rp_arr(f, 'city');
begin
  if exists (select 1 from unnest(a_st) s where s not in ('active','inactive','pending')) then raise exception 'invalid_filter'; end if;
  begin v_net := nullif(f->>'network', '')::uuid; v_team := nullif(f->>'team', '')::uuid; exception when others then raise exception 'invalid_filter'; end;
  return query
  select pe.id, pe.full_name, pe.classification, pe.status, pe.sex, pe.marital_status, nullif(trim(coalesce(pe.neighborhood, '')), ''), nullif(trim(coalesce(pe.city, '')), ''), pe.birth_date, a.age, bd.i, pe.user_id, pe.registered_at, pe.joined_at, pe.created_at,
         (pe.birth_date is null or pe.sex is null or (coalesce(pe.phone, '') = '' and coalesce(pe.whatsapp, '') = '' and coalesce(pe.email, '') = '') or nullif(trim(coalesce(pe.city, '')), '') is null)
    from people pe
    left join lateral (select case when pe.birth_date is null then null else date_part('year', age(v_today, pe.birth_date))::int end as age) a on true
    left join lateral (select (t.o - 1)::int as i from jsonb_array_elements(v_bands) with ordinality t(b, o) where a.age is not null and a.age >= (t.b->>'min')::int and (t.b->>'max' is null or a.age <= (t.b->>'max')::int) limit 1) bd on true
   where pe.org_id = p_org and pe.status = any (a_st)
     and (v_scope = 'church' or pe.id in (select sid from public.rp_own(p_org)))
     and (a_cls is null or pe.classification = any (a_cls))
     and (a_sex is null or coalesce(pe.sex, 'none') = any (a_sex))
     and (a_mar is null or coalesce(pe.marital_status, 'none') = any (a_mar))
     and (a_nei is null or coalesce(nullif(trim(coalesce(pe.neighborhood, '')), ''), 'none') = any (a_nei))
     and (a_city is null or coalesce(nullif(trim(coalesce(pe.city, '')), ''), 'none') = any (a_city))
     and (a_band is null or coalesce(bd.i::text, 'none') = any (a_band))
     and (v_net is null or exists (select 1 from team_members tm join network_teams nt on nt.team_id = tm.team_id where tm.user_id = pe.user_id and nt.network_id = v_net and tm.org_id = p_org))
     and (v_team is null or exists (select 1 from team_members tm where tm.user_id = pe.user_id and tm.team_id = v_team and tm.org_id = p_org));
end $$;
revoke execute on function public.rp_pop(uuid, jsonb) from public, anon, authenticated;

-- linha do tempo de classificação reconstruída do histórico (data de OCORRÊNCIA, não a do registro)
create or replace function public.rp_events(p_org uuid, p_ids uuid[]) returns table(person_id uuid, cls text, d date, at timestamptz, k text, prev text)
language sql stable security definer set search_path = public as $$
  with raw as (
    select h.person_id, h.new_value as cls, 'create'::text as k, pe.registered_at as d, h.at, pe.joined_at
      from person_history h join people pe on pe.id = h.person_id
     where h.org_id = p_org and h.kind = 'create' and h.person_id = any (p_ids) and h.voided_at is null and h.new_value in ('member','attender','visitor','none')
    union all
    select h.person_id, h.new_value, 'class', coalesce(h.occurred_on, (h.at at time zone 'America/Sao_Paulo')::date), h.at, pe.joined_at
      from person_history h join people pe on pe.id = h.person_id
     where h.org_id = p_org and h.kind = 'classification' and h.person_id = any (p_ids) and h.voided_at is null and h.new_value in ('member','attender','visitor','none')
  ), r as (
    select raw.*, row_number() over (partition by person_id, (cls = 'member') order by d, at) as mrn from raw
  ), x as (
    select person_id, cls, case when cls = 'member' and mrn = 1 and joined_at is not null then joined_at else d end as d, at, k from r
  )
  select person_id, cls, d, at, k, lag(cls) over (partition by person_id order by d, at) as prev from x
$$;
revoke execute on function public.rp_events(uuid, uuid[]) from public, anon, authenticated;

-- movimento em um intervalo (cadastros, entradas por classificação, conversões, mudanças, inativações, reativações)
create or replace function public.rp_flows(p_org uuid, p_from date, p_to date, p_ids uuid[], p_unlinked boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  with ev as (select * from public.rp_events(p_org, p_ids)), st as (
    select h.person_id, h.old_value, h.new_value from person_history h
     where h.org_id = p_org and h.kind = 'field' and h.field = 'status' and h.person_id = any (p_ids) and h.voided_at is null
       and coalesce(h.occurred_on, (h.at at time zone 'America/Sao_Paulo')::date) between p_from and p_to)
  select jsonb_build_object(
    'new_registrations', (select count(*) from people pe where pe.id = any (p_ids) and pe.registered_at between p_from and p_to),
    'new_visitors', (select count(*) from ev where k = 'create' and cls = 'visitor' and d between p_from and p_to),
    'new_attenders', (select count(*) from ev where cls = 'attender' and prev is distinct from 'attender' and d between p_from and p_to),
    'new_members', (select count(*) from ev where cls = 'member' and prev is distinct from 'member' and d between p_from and p_to),
    'class_changes', (select count(*) from ev where k = 'class' and d between p_from and p_to),
    'inactivations', (select count(*) from st where old_value = 'active' and new_value = 'inactive'),
    'reactivations', (select count(*) from st where old_value = 'inactive' and new_value = 'active'),
    'converts', (select count(*) from faith_decisions fd where fd.org_id = p_org and fd.voided_at is null and fd.decided_on between p_from and p_to and (fd.person_id = any (p_ids) or (p_unlinked and fd.person_id is null))))
$$;
revoke execute on function public.rp_flows(uuid, date, date, uuid[], boolean) from public, anon, authenticated;

-- série por dia/semana/mês/ano + crescimento da membresia (estoque no fim de cada período)
create or replace function public.rp_series(p_org uuid, p_from date, p_to date, p_g text, p_ids uuid[], p_unlinked boolean) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_n int; v_step interval; v_first date; res jsonb;
begin
  if p_g not in ('day','week','month','year') then raise exception 'invalid_granularity'; end if;
  if p_from > p_to then raise exception 'invalid_period'; end if;
  v_step := case p_g when 'day' then interval '1 day' when 'week' then interval '1 week' when 'month' then interval '1 month' else interval '1 year' end;
  v_first := date_trunc(p_g, p_from)::date;
  select count(*) into v_n from generate_series(v_first::timestamp, p_to::timestamp, v_step);
  if v_n > 400 then raise exception 'too_many_points'; end if;
  with b as (select s::date as bs, (s + v_step - interval '1 day')::date as be from generate_series(v_first::timestamp, p_to::timestamp, v_step) s),
  ev as (select * from public.rp_events(p_org, p_ids)),
  iv as (select person_id, cls, d as s, lead(d) over (partition by person_id order by d, at) as e from ev),
  st as (select coalesce(h.occurred_on, (h.at at time zone 'America/Sao_Paulo')::date) as d, h.old_value, h.new_value from person_history h
          where h.org_id = p_org and h.kind = 'field' and h.field = 'status' and h.person_id = any (p_ids) and h.voided_at is null)
  select coalesce(jsonb_agg(jsonb_build_object('start', b.bs, 'end', b.be,
      'new_registrations', (select count(*) from people pe where pe.id = any (p_ids) and pe.registered_at between greatest(b.bs, p_from) and least(b.be, p_to)),
      'new_visitors', (select count(*) from ev where k = 'create' and cls = 'visitor' and d between greatest(b.bs, p_from) and least(b.be, p_to)),
      'new_attenders', (select count(*) from ev where cls = 'attender' and prev is distinct from 'attender' and d between greatest(b.bs, p_from) and least(b.be, p_to)),
      'new_members', (select count(*) from ev where cls = 'member' and prev is distinct from 'member' and d between greatest(b.bs, p_from) and least(b.be, p_to)),
      'class_changes', (select count(*) from ev where k = 'class' and d between greatest(b.bs, p_from) and least(b.be, p_to)),
      'inactivations', (select count(*) from st where old_value = 'active' and new_value = 'inactive' and d between greatest(b.bs, p_from) and least(b.be, p_to)),
      'reactivations', (select count(*) from st where old_value = 'inactive' and new_value = 'active' and d between greatest(b.bs, p_from) and least(b.be, p_to)),
      'converts', (select count(*) from faith_decisions fd where fd.org_id = p_org and fd.voided_at is null and fd.decided_on between greatest(b.bs, p_from) and least(b.be, p_to) and (fd.person_id = any (p_ids) or (p_unlinked and fd.person_id is null))),
      'members', (select count(*) from iv where cls = 'member' and s <= least(b.be, p_to) and (e is null or e > least(b.be, p_to)))) order by b.bs), '[]'::jsonb) into res from b;
  return res;
end $$;
revoke execute on function public.rp_series(uuid, date, date, text, uuid[], boolean) from public, anon, authenticated;

-- grupos familiares: componentes conexos dos vínculos entre pessoas da população (um grupo conta uma vez)
create or replace function public.rp_family(p_org uuid, p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_changed int := 1; v_loops int := 0; v_fam int; v_link int; v_kids int; v_sizes jsonb; v_mar jsonb;
begin
  drop table if exists _rp_f;
  create temporary table _rp_f (id uuid primary key, root text not null) on commit drop;
  insert into _rp_f select x, x::text from (select person_id x from person_relations where org_id = p_org and person_id = any (p_ids) and relative_id = any (p_ids)
                                            union select relative_id from person_relations where org_id = p_org and person_id = any (p_ids) and relative_id = any (p_ids)) n;
  while v_changed > 0 and v_loops < 200 loop
    update _rp_f f set root = m.r from (select a.id, min(least(a.root, b.root)) r from _rp_f a join (select person_id p, relative_id q from person_relations where org_id = p_org union all select relative_id, person_id from person_relations where org_id = p_org) e on e.p = a.id
                                         join _rp_f b on b.id = e.q group by a.id) m where m.id = f.id and m.r < f.root;
    get diagnostics v_changed = row_count; v_loops := v_loops + 1;
  end loop;
  select count(distinct root) into v_fam from _rp_f;
  select count(*) into v_link from _rp_f;
  select count(distinct c) into v_kids from (select relative_id c from person_relations where org_id = p_org and relation = 'child' and person_id = any (p_ids) and relative_id = any (p_ids)
                                             union select person_id from person_relations where org_id = p_org and relation = 'parent' and person_id = any (p_ids) and relative_id = any (p_ids)) k;
  select coalesce(jsonb_agg(jsonb_build_object('size', s, 'n', n) order by s), '[]'::jsonb) into v_sizes from (select least(c, 6) s, count(*) n from (select root, count(*) c from _rp_f group by root) g group by 1) z;
  return jsonb_build_object('families', v_fam, 'with_link', v_link, 'children', v_kids, 'sizes', v_sizes);
end $$;
revoke execute on function public.rp_family(uuid, uuid[]) from public, anon, authenticated;

create or replace function public.rp_delta(p_cur numeric, p_prev numeric) returns jsonb language sql immutable as $$
  select jsonb_build_object('cur', p_cur, 'prev', p_prev, 'abs', p_cur - p_prev, 'pct', case when coalesce(p_prev, 0) = 0 then null else round((p_cur - p_prev) * 100.0 / p_prev, 1) end)
$$;
revoke execute on function public.rp_delta(numeric, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------- relatório por área (agregado no servidor)
create or replace function public.rp_report(p_org uuid, p_area text, f jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_scope text; v_perm text; v_ids uuid[]; v_from date; v_to date; v_pf date; v_pt date; v_cmp text := coalesce(nullif(f->>'compare', ''), 'previous'); v_g text := coalesce(nullif(f->>'granularity', ''), 'month');
        v_unl boolean; v_total int; v_cov numeric; v_cur jsonb; v_prev jsonb; v_series jsonb; v_res jsonb; v_m0 int; v_lim jsonb := '[]'::jsonb; v_hist int; v_bands jsonb := public.rp_bands(p_org); v_fam jsonb;
begin
  v_scope := public.rp_scope_kind(p_org);
  v_perm := case p_area when 'overview' then 'dashboard' when 'profile' then 'demographics' when 'evolution' then 'membership' when 'family' then 'family' when 'ministry' then 'ministry' end;
  if v_perm is null then raise exception 'invalid_area'; end if;
  if not public.rp_can(p_org, v_perm) then raise exception 'forbidden'; end if;
  begin v_to := coalesce(nullif(f->>'to', '')::date, public.rp_today()); v_from := coalesce(nullif(f->>'from', '')::date, v_to - 364); exception when others then raise exception 'invalid_period'; end;
  if v_from > v_to or v_to - v_from > 3660 then raise exception 'invalid_period'; end if;
  if v_cmp not in ('previous','month','year','custom') then raise exception 'invalid_filter'; end if;
  if v_cmp = 'previous' then v_pt := v_from - 1; v_pf := v_pt - (v_to - v_from);
  elsif v_cmp = 'month' then v_pf := (date_trunc('month', v_to) - interval '1 month')::date; v_pt := (date_trunc('month', v_to) - interval '1 day')::date; v_from := date_trunc('month', v_to)::date;
  elsif v_cmp = 'year' then v_pf := (date_trunc('year', v_to) - interval '1 year')::date; v_pt := (date_trunc('year', v_to) - interval '1 day')::date; v_from := date_trunc('year', v_to)::date;
  else begin v_pf := (f->>'cfrom')::date; v_pt := (f->>'cto')::date; exception when others then raise exception 'invalid_period'; end; if v_pf is null or v_pt is null or v_pf > v_pt then raise exception 'invalid_period'; end if; end if;
  select coalesce(array_agg(id), '{}') into v_ids from public.rp_pop(p_org, f);
  v_total := cardinality(v_ids);
  v_unl := v_scope = 'church' and not (f ?| array['classification','status','band','sex','marital','neighborhood','city','network','team']);
  select count(distinct person_id) into v_hist from public.rp_events(p_org, v_ids);
  v_cov := case when v_total = 0 then 1 else v_hist::numeric / v_total end;
  if v_cov < 1 then v_lim := v_lim || to_jsonb((v_total - v_hist)::text || ' pessoa(s) não têm registro de cadastro ou classificação no histórico. Elas não entram no crescimento da membresia nem nas entradas por classificação.'); end if;

  if p_area = 'overview' or p_area = 'evolution' then
    v_cur := public.rp_flows(p_org, v_from, v_to, v_ids, v_unl); v_prev := public.rp_flows(p_org, v_pf, v_pt, v_ids, v_unl);
    select count(*) into v_m0 from (select cls, d, lead(d) over (partition by person_id order by d, at) e from public.rp_events(p_org, v_ids)) q where cls = 'member' and d <= v_from - 1 and (e is null or e > v_from - 1);
    v_series := public.rp_series(p_org, v_from, v_to, v_g, v_ids, v_unl);
  end if;

  if p_area = 'overview' then
    select jsonb_build_object('total', count(*), 'member', count(*) filter (where classification = 'member'), 'attender', count(*) filter (where classification = 'attender'), 'visitor', count(*) filter (where classification = 'visitor'),
      'none', count(*) filter (where classification not in ('member','attender','visitor')), 'active', count(*) filter (where status = 'active'), 'inactive', count(*) filter (where status = 'inactive'), 'incomplete', count(*) filter (where incomplete)) into v_res from public.rp_pop(p_org, f);
    return jsonb_build_object('area', 'overview', 'period', jsonb_build_object('from', v_from, 'to', v_to, 'prev_from', v_pf, 'prev_to', v_pt, 'compare', v_cmp), 'pop', v_res,
      'converts_total', (select count(*) from faith_decisions fd where fd.org_id = p_org and fd.voided_at is null and (fd.person_id = any (v_ids) or (v_unl and fd.person_id is null))),
      'converts_period', v_cur->'converts', 'flows', v_cur,
      'variation', jsonb_build_object('new_registrations', public.rp_delta((v_cur->>'new_registrations')::numeric, (v_prev->>'new_registrations')::numeric), 'new_visitors', public.rp_delta((v_cur->>'new_visitors')::numeric, (v_prev->>'new_visitors')::numeric),
                                      'converts', public.rp_delta((v_cur->>'converts')::numeric, (v_prev->>'converts')::numeric), 'new_members', public.rp_delta((v_cur->>'new_members')::numeric, (v_prev->>'new_members')::numeric),
                                      'members', case when v_cov = 1 then public.rp_delta((v_res->>'member')::numeric, v_m0) end),
      'series', v_series, 'granularity', v_g, 'history_coverage', round(v_cov, 3), 'limitations', v_lim);
  elsif p_area = 'evolution' then
    return jsonb_build_object('area', 'evolution', 'period', jsonb_build_object('from', v_from, 'to', v_to, 'prev_from', v_pf, 'prev_to', v_pt, 'compare', v_cmp), 'granularity', v_g, 'current', v_cur, 'previous', v_prev,
      'delta', (select jsonb_object_agg(k, public.rp_delta((v_cur->>k)::numeric, (v_prev->>k)::numeric)) from jsonb_object_keys(v_cur) k), 'series', v_series, 'members_start', case when v_cov = 1 then v_m0 end,
      'members_end', (select count(*) from public.rp_pop(p_org, f) where classification = 'member'), 'history_coverage', round(v_cov, 3),
      'limitations', v_lim || to_jsonb('Mudanças de classificação, inativações e reativações só existem a partir do momento em que passaram a ser registradas no histórico da ficha.'::text));
  elsif p_area = 'profile' then
    v_fam := public.rp_family(p_org, v_ids);
    return jsonb_build_object('area', 'profile', 'total', v_total,
      'bands', (select coalesce(jsonb_agg(jsonb_build_object('label', l, 'n', n, 'pct', case when v_total = 0 then null else round(n * 100.0 / v_total, 1) end, 'before', b4) order by o), '[]'::jsonb) from (
          select (t.o - 1) as o, t.b->>'label' as l, (select count(*) from public.rp_pop(p_org, f) x where x.band = t.o - 1) as n, (select count(*) from public.rp_pop(p_org, f) x where x.band = t.o - 1 and x.registered_at < v_from) as b4 from jsonb_array_elements(v_bands) with ordinality t(b, o)
          union all select 9999, 'Não informado', (select count(*) from public.rp_pop(p_org, f) x where x.band is null), (select count(*) from public.rp_pop(p_org, f) x where x.band is null and x.registered_at < v_from)) z),
      'sex', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n, 'pct', case when v_total = 0 then null else round(n * 100.0 / v_total, 1) end) order by n desc), '[]'::jsonb) from (select coalesce(sex, 'none') k, count(*) n from public.rp_pop(p_org, f) group by 1) s),
      'marital', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n, 'pct', case when v_total = 0 then null else round(n * 100.0 / v_total, 1) end) order by n desc), '[]'::jsonb) from (select coalesce(marital, 'none') k, count(*) n from public.rp_pop(p_org, f) group by 1) s),
      'classification', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n, 'pct', case when v_total = 0 then null else round(n * 100.0 / v_total, 1) end) order by n desc), '[]'::jsonb) from (select classification k, count(*) n from public.rp_pop(p_org, f) group by 1) s),
      'neighborhood', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc, k), '[]'::jsonb) from (select coalesce(neighborhood, 'none') k, count(*) n from public.rp_pop(p_org, f) group by 1 order by 2 desc limit 30) s),
      'city', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc, k), '[]'::jsonb) from (select coalesce(city, 'none') k, count(*) n from public.rp_pop(p_org, f) group by 1 order by 2 desc limit 30) s),
      'family_sizes', v_fam->'sizes', 'families', (v_fam->>'families')::int, 'without_family_link', v_total - (v_fam->>'with_link')::int, 'limitations', '[]'::jsonb);
  elsif p_area = 'family' then
    v_fam := public.rp_family(p_org, v_ids);
    return jsonb_build_object('area', 'family', 'total', v_total, 'families', (v_fam->>'families')::int, 'with_link', (v_fam->>'with_link')::int, 'without_link', v_total - (v_fam->>'with_link')::int, 'children', (v_fam->>'children')::int,
      'sizes', v_fam->'sizes', 'marital', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]'::jsonb) from (select coalesce(marital, 'none') k, count(*) n from public.rp_pop(p_org, f) group by 1) s),
      'limitations', to_jsonb(array['Só aparecem totais: nenhum nome ou dado de menor de idade é exibido neste relatório.', 'Um grupo familiar é o conjunto de pessoas ligadas entre si pelos vínculos da ficha e conta uma vez só. Grupos de uma única pessoa não são família.']));
  else
    return public.rp_ministry(p_org, v_ids, v_total);
  end if;
end $$;

create or replace function public.rp_ministry(p_org uuid, p_ids uuid[], p_total int) returns jsonb
language sql stable security definer set search_path = public as $$
  with p as (select pe.id, pe.user_id from people pe where pe.id = any (p_ids)),
  mem as (select tm.team_id, tm.is_leader, p.id as pid from team_members tm join p on p.user_id = tm.user_id where tm.org_id = p_org and (public.rp_scope_kind(p_org) = 'church' or tm.team_id in (select tid from public.rp_own_teams(p_org)))),
  per as (select pid, count(distinct team_id) c from mem group by pid)
  select jsonb_build_object('area', 'ministry', 'total', p_total,
    'unique_linked', (select count(*) from per), 'unlinked', p_total - (select count(*) from per), 'without_account', (select count(*) from p where user_id is null), 'links', (select count(*) from mem),
    'multi_team', (select count(*) from per where c > 1), 'by_team_count', (select coalesce(jsonb_agg(jsonb_build_object('teams', c, 'n', n) order by c), '[]'::jsonb) from (select least(c, 3) c, count(*) n from per group by 1) z),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'people', x.n, 'leaders', x.l, 'pct', case when p_total = 0 then null else round(x.n * 100.0 / p_total, 1) end,
        'networks', coalesce((select jsonb_agg(cn.name order by cn.name) from network_teams nt join church_networks cn on cn.id = nt.network_id where nt.team_id = t.id), '[]'::jsonb)) order by x.n desc, t.name)
        from (select team_id, count(distinct pid) n, count(distinct pid) filter (where is_leader) l from mem group by 1) x join teams t on t.id = x.team_id), '[]'::jsonb),
    'networks', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'people', n, 'links', l, 'teams', tc, 'pct', case when p_total = 0 then null else round(n * 100.0 / p_total, 1) end) order by n desc, name) from (
        select cn.id, cn.name, count(distinct m.pid) n, count(*) l, count(distinct m.team_id) tc from church_networks cn join network_teams nt on nt.network_id = cn.id join mem m on m.team_id = nt.team_id where cn.org_id = p_org group by cn.id, cn.name
        union all select null, 'Times sem ministério', count(distinct m.pid), count(*), count(distinct m.team_id) from mem m where not exists (select 1 from network_teams nt where nt.team_id = m.team_id) having count(*) > 0) q), '[]'::jsonb),
    'limitations', to_jsonb(array['Vínculo ministerial é o estado atual dos times. Só pessoas com conta no app entram em times, então quem não tem conta aparece como sem vínculo.', 'Pessoas únicas, vínculos e participações por time são números diferentes: quem está em três times conta uma vez no total e três vezes nos vínculos.']))
$$;
revoke execute on function public.rp_ministry(uuid, uuid[], int) from public, anon, authenticated;

-- ---------------------------------------------------------------- lista individual (campos autorizados; menores com nome abreviado)
create or replace function public.rp_list(p_org uuid, f jsonb default '{}'::jsonb, p_limit int default 50, p_offset int default 0, p_export boolean default false, p_format text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_lim int; v_items jsonb; v_total int; v_bands jsonb := public.rp_bands(p_org); v_open boolean;
begin
  perform public.rp_scope_kind(p_org);
  if not public.rp_can(p_org, 'individual') then raise exception 'forbidden'; end if;
  if p_export then
    if not public.rp_can(p_org, 'export_lists') then raise exception 'forbidden'; end if;
    if p_format not in ('xlsx','csv','pdf') then raise exception 'invalid_format'; end if;
  end if;
  v_lim := least(greatest(coalesce(p_limit, 50), 1), case when p_export then 5000 else 200 end);
  v_open := not p_export and public.people_scope_all(p_org) and public.has_people_perm(p_org, 'people_view');
  select count(*) into v_total from public.rp_pop(p_org, f);
  select coalesce(jsonb_agg(x.j order by x.nm), '[]'::jsonb) into v_items from (
    select pe.full_name as nm, jsonb_build_object('id', case when v_open then pe.id end, 'name', case when pe.age is not null and pe.age < 18 then regexp_replace(initcap(pe.full_name), '(\S)\S*\s*', '\1. ', 'g') else pe.full_name end,
      'minor', pe.age is not null and pe.age < 18, 'classification', pe.classification, 'status', pe.status, 'band', case when pe.band is null then 'Não informado' else v_bands->pe.band->>'label' end, 'sex', pe.sex, 'marital', pe.marital,
      'neighborhood', pe.neighborhood, 'city', pe.city, 'registered_at', pe.registered_at, 'joined_at', pe.joined_at, 'created_at', pe.created_at, 'incomplete', pe.incomplete) as j
      from public.rp_pop(p_org, f) pe order by pe.full_name limit v_lim offset greatest(coalesce(p_offset, 0), 0)) x;
  if p_export then insert into report_exports (org_id, actor, area, kind, format, filters, row_count) values (p_org, auth.uid(), 'list', 'list', p_format, coalesce(f, '{}'::jsonb), jsonb_array_length(v_items)); end if;
  return jsonb_build_object('items', v_items, 'total', v_total);
end $$;

-- ---------------------------------------------------------------- opções de filtro (só valores que existem) e configuração
create or replace function public.rp_options(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_scope text := public.rp_scope_kind(p_org); v_bands jsonb := public.rp_bands(p_org);
begin
  if not (public.rp_can(p_org, 'dashboard') or public.rp_can(p_org, 'membership') or public.rp_can(p_org, 'demographics') or public.rp_can(p_org, 'family') or public.rp_can(p_org, 'ministry')) then raise exception 'forbidden'; end if;
  return jsonb_build_object('scope', v_scope,
    'areas', jsonb_build_object('overview', public.rp_can(p_org, 'dashboard'), 'profile', public.rp_can(p_org, 'demographics'), 'evolution', public.rp_can(p_org, 'membership'), 'family', public.rp_can(p_org, 'family'), 'ministry', public.rp_can(p_org, 'ministry')),
    'can', jsonb_build_object('export', public.rp_can(p_org, 'export'), 'individual', public.rp_can(p_org, 'individual'), 'export_lists', public.rp_can(p_org, 'export_lists') and public.rp_can(p_org, 'individual'), 'admin', public.rp_can(p_org, 'admin')),
    'org_name', (select name from organizations where id = p_org),
    'classification', coalesce((select jsonb_agg(distinct classification) from public.rp_pop(p_org, '{"status":["active","inactive","pending"]}')), '[]'::jsonb),
    'status', coalesce((select jsonb_agg(distinct status) from public.rp_pop(p_org, '{"status":["active","inactive","pending"]}')), '[]'::jsonb),
    'sex', coalesce((select jsonb_agg(distinct coalesce(sex, 'none')) from public.rp_pop(p_org, '{}')), '[]'::jsonb),
    'marital', coalesce((select jsonb_agg(distinct coalesce(marital, 'none')) from public.rp_pop(p_org, '{}')), '[]'::jsonb),
    'neighborhood', coalesce((select jsonb_agg(k order by k) from (select distinct coalesce(neighborhood, 'none') k from public.rp_pop(p_org, '{}') limit 200) z), '[]'::jsonb),
    'city', coalesce((select jsonb_agg(k order by k) from (select distinct coalesce(city, 'none') k from public.rp_pop(p_org, '{}') limit 200) z), '[]'::jsonb),
    'bands', (select coalesce(jsonb_agg(jsonb_build_object('i', (t.o - 1)::text, 'label', t.b->>'label') order by t.o), '[]'::jsonb) from jsonb_array_elements(v_bands) with ordinality t(b, o) where exists (select 1 from public.rp_pop(p_org, '{}') x where x.band = t.o - 1))
      || case when exists (select 1 from public.rp_pop(p_org, '{}') x where x.band is null) then jsonb_build_array(jsonb_build_object('i', 'none', 'label', 'Não informado')) else '[]'::jsonb end,
    'networks', coalesce((select jsonb_agg(jsonb_build_object('id', cn.id, 'name', cn.name) order by cn.name) from church_networks cn where cn.org_id = p_org and exists (select 1 from network_teams nt join team_members tm on tm.team_id = nt.team_id where nt.network_id = cn.id)), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name) from teams t where t.org_id = p_org and exists (select 1 from team_members tm where tm.team_id = t.id)), '[]'::jsonb));
end $$;
create or replace function public.rp_settings_get(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.rp_scope_kind(p_org);
  return jsonb_build_object('age_bands', public.rp_bands(p_org), 'can_admin', public.rp_can(p_org, 'admin'));
end $$;
create or replace function public.rp_settings_save(p_org uuid, p_bands jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int; i int; b jsonb; v_prev_max int;
begin
  perform public.rp_scope_kind(p_org);
  if not public.rp_can(p_org, 'admin') then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_bands) <> 'array' then raise exception 'invalid_bands'; end if;
  n := jsonb_array_length(p_bands);
  if n < 2 or n > 15 then raise exception 'invalid_bands'; end if;
  for i in 0 .. n - 1 loop
    b := p_bands->i;
    if length(trim(coalesce(b->>'label', ''))) not between 1 and 40 then raise exception 'invalid_bands'; end if;
    begin perform (b->>'min')::int; if b->>'max' is not null then perform (b->>'max')::int; end if; exception when others then raise exception 'invalid_bands'; end;
    if i = 0 and (b->>'min')::int <> 0 then raise exception 'invalid_bands'; end if;
    if i > 0 and (b->>'min')::int <> v_prev_max + 1 then raise exception 'invalid_bands'; end if;
    if i < n - 1 then if b->>'max' is null or (b->>'max')::int < (b->>'min')::int then raise exception 'invalid_bands'; end if; v_prev_max := (b->>'max')::int;
    elsif b->>'max' is not null then raise exception 'invalid_bands'; end if;
  end loop;
  insert into report_settings (org_id, age_bands, updated_by) values (p_org, p_bands, auth.uid()) on conflict (org_id) do update set age_bands = excluded.age_bands, updated_by = auth.uid(), updated_at = now();
  return jsonb_build_object('saved', true);
end $$;

-- auditoria das exportações de indicadores (as de listas são registradas pela própria rp_list)
create or replace function public.report_export_log(p_org uuid, p_area text, p_format text, p_filters jsonb default '{}'::jsonb, p_rows int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.rp_scope_kind(p_org);
  if not public.rp_can(p_org, 'export') then raise exception 'forbidden'; end if;
  if p_area not in ('overview','profile','evolution','family','ministry') then raise exception 'invalid_area'; end if;
  if p_format not in ('xlsx','csv','pdf') then raise exception 'invalid_format'; end if;
  insert into report_exports (org_id, actor, area, kind, format, filters, row_count) values (p_org, auth.uid(), p_area, 'indicators', p_format, coalesce(p_filters, '{}'::jsonb), p_rows);
  return jsonb_build_object('saved', true);
end $$;
create or replace function public.rp_export_audit(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.rp_scope_kind(p_org);
  if not public.rp_can(p_org, 'admin') then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('area', e.area, 'kind', e.kind, 'format', e.format, 'rows', e.row_count, 'at', e.at, 'filters', e.filters, 'by', coalesce(public.welcome_name(e.org_id, e.actor), 'Usuário removido')) order by e.at desc)
    from (select * from report_exports where org_id = p_org order by at desc limit 100) e), '[]'::jsonb);
end $$;

revoke execute on function public.rp_report(uuid, text, jsonb), public.rp_list(uuid, jsonb, int, int, boolean, text), public.rp_options(uuid), public.rp_settings_get(uuid), public.rp_settings_save(uuid, jsonb),
  public.report_export_log(uuid, text, text, jsonb, int), public.rp_export_audit(uuid) from public, anon;
grant execute on function public.rp_report(uuid, text, jsonb), public.rp_list(uuid, jsonb, int, int, boolean, text), public.rp_options(uuid), public.rp_settings_get(uuid), public.rp_settings_save(uuid, jsonb),
  public.report_export_log(uuid, text, text, jsonb, int), public.rp_export_audit(uuid) to authenticated;

-- Conferência (retorna true):
--   select to_regclass('public.report_exports') is not null
--      and to_regprocedure('public.rp_report(uuid,text,jsonb)') is not null
--      and to_regprocedure('public.rp_list(uuid,jsonb,integer,integer,boolean,text)') is not null
--      and 'people_reports_dashboard' = any (public.all_actions()) as ok;
