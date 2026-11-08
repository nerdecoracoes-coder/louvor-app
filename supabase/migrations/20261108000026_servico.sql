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
