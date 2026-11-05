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
