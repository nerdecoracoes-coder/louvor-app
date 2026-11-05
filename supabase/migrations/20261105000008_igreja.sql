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
