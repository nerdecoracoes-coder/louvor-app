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
