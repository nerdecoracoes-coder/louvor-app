-- =====================================================================
-- Tipos de time e repertório exclusivo de alguns tipos (a princípio: Louvor)
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

-- Quem criou cada time passa a ser integrante e líder dele (corrige times criados antes desta versão)
insert into public.team_members (team_id, user_id, org_id, is_leader)
select t.id, t.created_by, t.org_id, true from public.teams t
where t.created_by is not null
  and exists (select 1 from public.org_members m where m.org_id = t.org_id and m.user_id = t.created_by)
on conflict (team_id, user_id) do nothing;
