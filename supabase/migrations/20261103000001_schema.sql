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
