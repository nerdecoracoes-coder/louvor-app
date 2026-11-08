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
