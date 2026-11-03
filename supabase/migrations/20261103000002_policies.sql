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
