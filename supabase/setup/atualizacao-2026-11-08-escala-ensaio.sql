-- Ensaio da escala: data/horário e observações.
alter table public.schedules add column if not exists rehearsal_at timestamptz;
alter table public.schedules add column if not exists rehearsal_notes text;

-- O roteiro também pode ser montado por times de louvor (a aba Roteiro aparece na edição da escala).
drop policy if exists sc_write on public.schedule_cues;
create policy sc_write on public.schedule_cues for all to authenticated
  using (public.can_manage_team(team_id))
  with check (public.can_manage_team(team_id)
    and exists (select 1 from public.teams t where t.id = schedule_cues.team_id and ('roteiro' = any(t.features) or t.team_type = 'louvor'))
    and exists (select 1 from public.schedules s where s.id = schedule_id and s.team_id = schedule_cues.team_id and s.org_id = schedule_cues.org_id));
