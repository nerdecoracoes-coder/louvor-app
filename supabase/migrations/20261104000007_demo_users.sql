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
