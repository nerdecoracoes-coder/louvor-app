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
