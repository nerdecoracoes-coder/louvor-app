-- =====================================================================
-- SOMOS — Fase 3: Financeiro (contas, lançamentos, contas a pagar/receber, orçamentos, aprovações, relatórios).
--  * Tabelas novas; nada existente é alterado. Nada é apagado: cancelar guarda motivo, quem e quando; estorno = cancelar um lançamento já baixado.
--  * Permissões novas (só administrador da igreja ou concessão; liderança/integrante de ministério e desenvolvedor NÃO ganham acesso):
--      fin_view (relatórios e lançamentos), fin_entry (lançar, baixar, cancelar o que está em aberto), fin_approve (aprovar/recusar despesas),
--      fin_manage (contas, categorias, centros de custo, campanhas, orçamentos, regras), fin_donors (ver quem contribuiu).
--  * Separação entre quem lança e quem aprova: ninguém aprova o que ele mesmo lançou ou alterou. Despesas a partir do valor configurado exigem aprovação antes de serem pagas.
--  * Contribuição anônima é permitida (sem pessoa e sem nome). Quem tem só fin_view vê valores, mas não vê quem contribuiu.
--  * Comprovantes ficam no bucket PRIVADO (fin/<org>/...), lidos só por quem tem permissão financeira.
--  * Pagamento online (Pix/cartão) NÃO está incluído: depende de provedor e credenciais. Há só o preparo (colunas source/external_ref para um webhook idempotente).
-- =====================================================================

create or replace function public.module_actions() returns text[] language sql immutable as $$
  select array['cells_view','cells_manage','cells_members','cells_meetings','cells_supervision','cells_reports',
               'prog_view','prog_manage','prog_publish','prog_run','roster_view','roster_manage','roster_approve',
               'media_request','discover_manage','ev_view','ev_manage','ev_publish','ev_checkin',
               'fin_view','fin_entry','fin_approve','fin_manage','fin_donors']::text[]
$$;

create table if not exists public.fin_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  kind text not null default 'bank' check (kind in ('cash','bank','digital')),
  opening_balance numeric(14,2) not null default 0 check (abs(opening_balance) < 10000000000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists fin_accounts_name on public.fin_accounts (org_id, lower(name));

create table if not exists public.fin_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('income','expense')),
  name text not null check (length(trim(name)) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists fin_categories_name on public.fin_categories (org_id, kind, lower(name));

create table if not exists public.fin_cost_centers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists fin_cost_centers_name on public.fin_cost_centers (org_id, lower(name));

create table if not exists public.fin_campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  goal numeric(14,2) check (goal is null or (goal > 0 and goal < 10000000000)),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists fin_campaigns_name on public.fin_campaigns (org_id, lower(name));

create table if not exists public.fin_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  approval_threshold numeric(14,2) check (approval_threshold is null or (approval_threshold >= 0 and approval_threshold < 10000000000)),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.fin_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('income','expense','transfer')),
  description text not null check (length(trim(description)) between 1 and 160),
  amount numeric(14,2) not null check (amount > 0 and amount < 10000000000),
  category_id uuid references public.fin_categories(id) on delete restrict,
  cost_center_id uuid references public.fin_cost_centers(id) on delete restrict,
  campaign_id uuid references public.fin_campaigns(id) on delete restrict,
  account_id uuid references public.fin_accounts(id) on delete restrict,
  to_account_id uuid references public.fin_accounts(id) on delete restrict,
  counterparty text check (counterparty is null or length(counterparty) <= 120),
  person_id uuid references public.people(id) on delete set null,
  anonymous boolean not null default false,
  method text check (method is null or method in ('cash','pix','card','transfer','boleto','check','other')),
  due_date date not null,
  paid_at date,
  status text not null default 'open' check (status in ('open','settled','cancelled')),
  approval text not null default 'none' check (approval in ('none','pending','approved','rejected')),
  approval_by uuid references auth.users(id) on delete set null,
  approval_at timestamptz,
  approval_reason text check (approval_reason is null or length(approval_reason) <= 300),
  series_id uuid,
  series_kind text check (series_kind is null or series_kind in ('installment','recurring')),
  installment int,
  installments int,
  receipt_path text check (receipt_path is null or length(receipt_path) <= 300),
  notes text check (notes is null or length(notes) <= 1000),
  source text not null default 'manual' check (source in ('manual','online')),
  external_ref text,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 300),
  cancelled_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  settled_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'transfer') = (to_account_id is not null)),
  check (kind <> 'transfer' or (account_id is not null and to_account_id <> account_id and status <> 'open')),
  check (kind <> 'income' or approval = 'none'),
  check (status <> 'settled' or (paid_at is not null and account_id is not null)),
  check (not anonymous or (person_id is null and counterparty is null))
);
create index if not exists fin_entries_org_due on public.fin_entries (org_id, status, due_date);
create index if not exists fin_entries_org_paid on public.fin_entries (org_id, paid_at) where status = 'settled';
create index if not exists fin_entries_series on public.fin_entries (series_id) where series_id is not null;
create unique index if not exists fin_entries_external on public.fin_entries (org_id, external_ref) where external_ref is not null;

create table if not exists public.fin_budgets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  year int not null check (year between 2000 and 2100),
  month int check (month is null or month between 1 and 12),
  category_id uuid references public.fin_categories(id) on delete cascade,
  cost_center_id uuid references public.fin_cost_centers(id) on delete cascade,
  amount numeric(14,2) not null check (amount >= 0 and amount < 10000000000),
  created_at timestamptz not null default now(),
  check (category_id is not null or cost_center_id is not null)
);
create unique index if not exists fin_budgets_line on public.fin_budgets (org_id, year, coalesce(month, 0), coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(cost_center_id, '00000000-0000-0000-0000-000000000000'::uuid));

do $$ declare t text; begin
  foreach t in array array['fin_accounts','fin_categories','fin_cost_centers','fin_campaigns','fin_settings','fin_entries','fin_budgets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- comprovantes: bucket privado, caminho fin/<org>/<arquivo>; leitura e envio só para quem tem permissão financeira; sem remoção (histórico)
create or replace function public.fin_storage_ok(p_name text, p_actions text[]) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare f text[] := storage.foldername(p_name); v_org uuid;
begin
  if auth.uid() is null or array_length(f, 1) is null or f[1] <> 'fin' then return false; end if;
  begin v_org := f[2]::uuid; exception when others then return false; end;
  return public.fin_staff(v_org, p_actions);
end $$;

-- ---------------------------------------------------------------- auxiliares
create or replace function public.fin_staff(p_org uuid, p_actions text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
    or exists (select 1 from access_grants g where g.org_id = p_org and g.user_id = auth.uid() and g.actions && p_actions))
$$;
create or replace function public.fin_need(p_org uuid, p_actions text[]) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.fin_staff(p_org, p_actions) then raise exception 'forbidden'; end if;
end $$;
create or replace function public.fin_today() returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
create or replace function public.fin_view_any() returns text[] language sql immutable as $$ select array['fin_view','fin_entry','fin_approve','fin_manage','fin_donors']::text[] $$;

drop policy if exists "fin receipts read" on storage.objects;
create policy "fin receipts read" on storage.objects for select to authenticated
  using (bucket_id = 'private' and public.fin_storage_ok(name, public.fin_view_any()));
drop policy if exists "fin receipts write" on storage.objects;
create policy "fin receipts write" on storage.objects for insert to authenticated
  with check (bucket_id = 'private' and public.fin_storage_ok(name, array['fin_entry','fin_manage']));

-- primeira abertura: categorias e caixa padrão (editáveis); só cria se a igreja ainda não tem nenhuma
create or replace function public.fin_ensure(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from fin_categories where org_id = p_org) then return; end if;
  insert into fin_categories (org_id, kind, name) select p_org, 'income', n from unnest(array['Dízimos','Ofertas','Doações','Contribuições específicas','Campanhas','Eventos','Outras receitas']) n on conflict do nothing;
  insert into fin_categories (org_id, kind, name) select p_org, 'expense', n from unnest(array['Água, luz e internet','Aluguel e manutenção','Material e equipamentos','Ação social','Missões','Eventos','Comunicação','Transporte','Outras despesas']) n on conflict do nothing;
  insert into fin_accounts (org_id, name, kind) values (p_org, 'Caixa', 'cash') on conflict do nothing;
  perform public.mod_log(p_org, 'finance', 'setup', p_org, 'seed', null, null);
end $$;

-- saldo de uma conta: saldo inicial + entradas baixadas - saídas baixadas ± transferências (cancelados não contam)
create or replace function public.fin_balance(p_account uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select a.opening_balance
    + coalesce((select sum(case when e.kind = 'income' and e.account_id = a.id then e.amount
                                when e.kind = 'expense' and e.account_id = a.id then -e.amount
                                when e.kind = 'transfer' and e.account_id = a.id then -e.amount
                                when e.kind = 'transfer' and e.to_account_id = a.id then e.amount else 0 end)
                from fin_entries e where e.status = 'settled' and (e.account_id = a.id or e.to_account_id = a.id)), 0)
  from fin_accounts a where a.id = p_account
$$;

create or replace function public.fin_ref_ok(p_org uuid, p_table text, p_id uuid, p_kind text default null) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r boolean;
begin
  if p_id is null then return true; end if;
  if p_table = 'account' then select exists (select 1 from fin_accounts where id = p_id and org_id = p_org and active) into r;
  elsif p_table = 'category' then select exists (select 1 from fin_categories where id = p_id and org_id = p_org and active and (p_kind is null or kind = p_kind)) into r;
  elsif p_table = 'cost_center' then select exists (select 1 from fin_cost_centers where id = p_id and org_id = p_org and active) into r;
  elsif p_table = 'campaign' then select exists (select 1 from fin_campaigns where id = p_id and org_id = p_org and active) into r;
  else r := false; end if;
  return coalesce(r, false);
end $$;

revoke execute on function public.fin_storage_ok(text, text[]), public.fin_staff(uuid, text[]), public.fin_need(uuid, text[]), public.fin_today(), public.fin_view_any(),
  public.fin_ensure(uuid), public.fin_balance(uuid), public.fin_ref_ok(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.fin_storage_ok(text, text[]), public.fin_staff(uuid, text[]), public.fin_view_any() to authenticated;

-- ---------------------------------------------------------------- cadastros
create or replace function public.fin_catalog(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_donors boolean := public.fin_staff(p_org, array['fin_donors']);
begin
  perform public.fin_need(p_org, public.fin_view_any());
  perform public.fin_ensure(p_org);
  return jsonb_build_object(
    'can', jsonb_build_object('view', public.fin_staff(p_org, array['fin_view']), 'entry', public.fin_staff(p_org, array['fin_entry']), 'approve', public.fin_staff(p_org, array['fin_approve']),
                              'manage', public.fin_staff(p_org, array['fin_manage']), 'donors', v_donors),
    'accounts', coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object('balance', public.fin_balance(a.id)) order by a.active desc, lower(a.name)) from fin_accounts a where a.org_id = p_org), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(to_jsonb(c) order by c.kind, c.active desc, lower(c.name)) from fin_categories c where c.org_id = p_org), '[]'::jsonb),
    'cost_centers', coalesce((select jsonb_agg(to_jsonb(c) order by c.active desc, lower(c.name)) from fin_cost_centers c where c.org_id = p_org), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('raised', (select coalesce(sum(e.amount), 0) from fin_entries e where e.campaign_id = c.id and e.kind = 'income' and e.status = 'settled'))
                                          order by c.active desc, lower(c.name)) from fin_campaigns c where c.org_id = p_org), '[]'::jsonb),
    'settings', jsonb_build_object('approval_threshold', (select approval_threshold from fin_settings where org_id = p_org)),
    'payment', jsonb_build_object('enabled', false, 'status', 'not_configured'));
end $$;

-- p_type: account | category | cost_center | campaign. p traz name e, conforme o tipo, kind / opening_balance / goal / active
create or replace function public.fin_catalog_save(p_org uuid, p_type text, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_name text := trim(coalesce(p->>'name', '')); v_id uuid := p_id; v_active boolean := coalesce((p->>'active')::boolean, true); v_kind text;
        v_bal numeric := coalesce(nullif(p->>'opening_balance', '')::numeric, 0); v_goal numeric := nullif(p->>'goal', '')::numeric; v_before jsonb;
begin
  perform public.fin_need(p_org, array['fin_manage']);
  if length(v_name) = 0 then raise exception 'name_required'; end if;
  begin
    if p_type = 'account' then
      v_kind := coalesce(nullif(p->>'kind', ''), 'bank'); if v_kind not in ('cash','bank','digital') then raise exception 'invalid_kind'; end if;
      if p_id is null then insert into fin_accounts (org_id, name, kind, opening_balance, active) values (p_org, v_name, v_kind, v_bal, v_active) returning id into v_id;
      else select to_jsonb(a) into v_before from fin_accounts a where id = p_id and org_id = p_org; if v_before is null then raise exception 'not_found'; end if;
        update fin_accounts set name = v_name, kind = v_kind, opening_balance = v_bal, active = v_active where id = p_id; end if;
    elsif p_type = 'category' then
      if p_id is null then
        v_kind := p->>'kind'; if v_kind not in ('income','expense') then raise exception 'invalid_kind'; end if;
        insert into fin_categories (org_id, kind, name, active) values (p_org, v_kind, v_name, v_active) returning id into v_id;
      else select to_jsonb(c) into v_before from fin_categories c where id = p_id and org_id = p_org; if v_before is null then raise exception 'not_found'; end if;
        update fin_categories set name = v_name, active = v_active where id = p_id; end if;
    elsif p_type = 'cost_center' then
      if p_id is null then insert into fin_cost_centers (org_id, name, active) values (p_org, v_name, v_active) returning id into v_id;
      else select to_jsonb(c) into v_before from fin_cost_centers c where id = p_id and org_id = p_org; if v_before is null then raise exception 'not_found'; end if;
        update fin_cost_centers set name = v_name, active = v_active where id = p_id; end if;
    elsif p_type = 'campaign' then
      if p_id is null then insert into fin_campaigns (org_id, name, goal, active) values (p_org, v_name, v_goal, v_active) returning id into v_id;
      else select to_jsonb(c) into v_before from fin_campaigns c where id = p_id and org_id = p_org; if v_before is null then raise exception 'not_found'; end if;
        update fin_campaigns set name = v_name, goal = v_goal, active = v_active where id = p_id; end if;
    else raise exception 'invalid_type'; end if;
  exception when unique_violation then raise exception 'name_taken'; when check_violation then raise exception 'fin_invalid_data'; end;
  perform public.mod_log(p_org, 'finance', p_type, v_id, case when p_id is null then 'create' else 'update' end, null, jsonb_build_object('name', v_name, 'before', v_before));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- regra de aprovação: despesas a partir deste valor (0 = todas; vazio = nenhuma) precisam de aprovação antes de serem pagas
create or replace function public.fin_settings_save(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v numeric := nullif(p->>'approval_threshold', '')::numeric; v_old numeric;
begin
  perform public.fin_need(p_org, array['fin_manage']);
  if v is not null and (v < 0 or v >= 10000000000) then raise exception 'fin_invalid_data'; end if;
  select approval_threshold into v_old from fin_settings where org_id = p_org;
  insert into fin_settings (org_id, approval_threshold, updated_by, updated_at) values (p_org, v, auth.uid(), now())
    on conflict (org_id) do update set approval_threshold = excluded.approval_threshold, updated_by = excluded.updated_by, updated_at = now();
  perform public.mod_log(p_org, 'finance', 'settings', p_org, 'update', null, jsonb_build_object('before', v_old, 'after', v));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- lançamentos
-- cria (p_id nulo) ou altera um lançamento em aberto. Parcelamento: installments + series_kind=installment (valor total dividido);
-- recorrência: installments + series_kind=recurring (mesmo valor todo mês). paid_at preenchido baixa na hora (receita/despesa única); transferência é sempre baixada.
create or replace function public.fin_entry_save(p_org uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e fin_entries; v_kind text; v_amt numeric; v_desc text := trim(coalesce(p->>'description', '')); v_n int := coalesce(nullif(p->>'installments', '')::int, 1);
        v_sk text := coalesce(nullif(p->>'series_kind', ''), 'installment'); v_due date := nullif(p->>'due_date', '')::date; v_paid date := nullif(p->>'paid_at', '')::date;
        v_cat uuid := nullif(p->>'category_id', '')::uuid; v_cc uuid := nullif(p->>'cost_center_id', '')::uuid; v_camp uuid := nullif(p->>'campaign_id', '')::uuid;
        v_acc uuid := nullif(p->>'account_id', '')::uuid; v_to uuid := nullif(p->>'to_account_id', '')::uuid; v_person uuid := nullif(p->>'person_id', '')::uuid;
        v_anon boolean := coalesce((p->>'anonymous')::boolean, false); v_cp text := nullif(trim(coalesce(p->>'counterparty', '')), ''); v_method text := nullif(p->>'method', '');
        v_rec text := nullif(p->>'receipt_path', ''); v_notes text := nullif(trim(coalesce(p->>'notes', '')), ''); v_thr numeric; v_appr text := 'none'; v_series uuid; v_id uuid; v_first uuid;
        v_each numeric; v_i int; v_status text := 'open'; v_today date := public.fin_today(); v_ids uuid[] := '{}';
begin
  perform public.fin_need(p_org, array['fin_entry']);
  if p_id is null then v_kind := p->>'kind'; else
    select * into e from fin_entries where id = p_id and org_id = p_org for update; if e.id is null then raise exception 'not_found'; end if;
    if e.status <> 'open' then raise exception 'entry_locked'; end if;
    v_kind := e.kind;
  end if;
  if v_kind not in ('income','expense','transfer') then raise exception 'invalid_kind'; end if;
  begin v_amt := (p->>'amount')::numeric; exception when others then raise exception 'invalid_amount'; end;
  if v_amt is null or v_amt <= 0 or v_amt >= 10000000000 then raise exception 'invalid_amount'; end if;
  v_amt := round(v_amt, 2);
  if length(v_desc) = 0 then raise exception 'fin_description_required'; end if;
  if v_method is not null and v_method not in ('cash','pix','card','transfer','boleto','check','other') then raise exception 'invalid_method'; end if;
  if v_rec is not null and v_rec not like 'fin/' || p_org::text || '/%' then raise exception 'invalid_receipt'; end if;
  if v_kind = 'transfer' then
    if p_id is not null then raise exception 'entry_locked'; end if;
    if v_acc is null or v_to is null or v_acc = v_to then raise exception 'invalid_accounts'; end if;
    if not (public.fin_ref_ok(p_org, 'account', v_acc) and public.fin_ref_ok(p_org, 'account', v_to)) then raise exception 'invalid_reference'; end if;
    v_cat := null; v_cc := null; v_camp := null; v_person := null; v_cp := null; v_anon := false; v_n := 1;
    v_due := coalesce(v_paid, v_due, v_today); v_paid := v_due; if v_paid > v_today then raise exception 'fin_future_date'; end if;
  else
    v_to := null;
    if v_due is null then raise exception 'due_required'; end if;
    if v_cat is null then raise exception 'category_required'; end if;
    if not public.fin_ref_ok(p_org, 'category', v_cat, v_kind) then raise exception 'invalid_reference'; end if;
    if not (public.fin_ref_ok(p_org, 'cost_center', v_cc) and public.fin_ref_ok(p_org, 'campaign', v_camp) and public.fin_ref_ok(p_org, 'account', v_acc)) then raise exception 'invalid_reference'; end if;
    if v_kind = 'expense' then v_person := null; v_anon := false; v_camp := null; end if;
    if p_id is not null and v_kind = 'income' and not public.fin_staff(p_org, array['fin_donors']) then v_person := e.person_id; v_cp := e.counterparty; v_anon := e.anonymous; end if;
    if v_anon then v_person := null; v_cp := null; end if;
    if v_person is not null and not exists (select 1 from people where id = v_person and org_id = p_org) then raise exception 'invalid_reference'; end if;
    if (v_person is not null or v_cp is not null) and v_kind = 'income' and not public.fin_staff(p_org, array['fin_donors']) and (p_id is null or v_person is distinct from e.person_id or v_cp is distinct from e.counterparty) then raise exception 'donor_forbidden'; end if;
    if v_n < 1 or v_n > 60 then raise exception 'invalid_installments'; end if;
    if v_sk not in ('installment','recurring') then raise exception 'invalid_installments'; end if;
    if v_paid is not null then
      if v_n > 1 then raise exception 'invalid_installments'; end if;
      if v_acc is null then raise exception 'account_required'; end if;
      if v_paid > v_today then raise exception 'fin_future_date'; end if;
    end if;
  end if;

  if v_kind = 'expense' then
    select approval_threshold into v_thr from fin_settings where org_id = p_org;
    if v_thr is not null and v_amt >= v_thr then v_appr := 'pending'; end if;
    if p_id is not null and e.approval = 'approved' and e.amount = v_amt then v_appr := 'approved'; end if;
    if v_paid is not null and v_appr = 'pending' then raise exception 'approval_required'; end if;
  end if;
  if v_kind = 'transfer' or v_paid is not null then v_status := 'settled'; end if;

  begin
    if p_id is null then
      v_series := case when v_n > 1 then gen_random_uuid() end;
      v_each := case when v_n > 1 and v_sk = 'installment' then trunc(v_amt / v_n, 2) else v_amt end;
      for v_i in 0 .. v_n - 1 loop
        insert into fin_entries (org_id, kind, description, amount, category_id, cost_center_id, campaign_id, account_id, to_account_id, counterparty, person_id, anonymous, method, due_date, paid_at,
                                 status, approval, series_id, series_kind, installment, installments, receipt_path, notes, settled_by, created_by, updated_by)
        values (p_org, v_kind, case when v_n > 1 and v_sk = 'installment' then left(v_desc, 150) || ' (' || (v_i + 1) || '/' || v_n || ')' else v_desc end,
                case when v_i = 0 and v_n > 1 and v_sk = 'installment' then v_amt - v_each * (v_n - 1) else v_each end,
                v_cat, v_cc, v_camp, v_acc, v_to, v_cp, v_person, v_anon, v_method, (v_due + (v_i || ' months')::interval)::date, v_paid,
                v_status, v_appr, v_series, case when v_n > 1 then v_sk end, case when v_n > 1 then v_i + 1 end, case when v_n > 1 then v_n end, v_rec, v_notes,
                case when v_status = 'settled' then auth.uid() end, auth.uid(), auth.uid()) returning id into v_id;
        v_ids := v_ids || v_id; if v_i = 0 then v_first := v_id; end if;
      end loop;
      perform public.mod_log(p_org, 'finance', 'entry', v_first, case when v_status = 'settled' then 'create_settled' else 'create' end, null,
        jsonb_build_object('kind', v_kind, 'amount', v_amt, 'description', v_desc, 'installments', v_n, 'series_kind', case when v_n > 1 then v_sk end));
      if v_appr = 'pending' then perform public.fin_notify_approvers(p_org, v_first, v_desc, v_amt); end if;
    else
      update fin_entries set description = v_desc, amount = v_amt, category_id = v_cat, cost_center_id = v_cc, campaign_id = v_camp, account_id = v_acc, counterparty = v_cp, person_id = v_person,
        anonymous = v_anon, method = v_method, due_date = v_due, status = v_status, paid_at = v_paid, settled_by = case when v_status = 'settled' then auth.uid() end,
        approval = v_appr, approval_by = case when v_appr = e.approval then e.approval_by end, approval_at = case when v_appr = e.approval then e.approval_at end,
        receipt_path = coalesce(v_rec, receipt_path), notes = v_notes, updated_by = auth.uid(), updated_at = now() where id = p_id;
      v_id := p_id;
      perform public.mod_log(p_org, 'finance', 'entry', p_id, 'update', null, jsonb_build_object('before', to_jsonb(e) - 'created_by' - 'updated_by', 'amount', v_amt, 'description', v_desc));
      if v_appr = 'pending' and e.approval <> 'pending' then perform public.fin_notify_approvers(p_org, p_id, v_desc, v_amt); end if;
    end if;
  exception when check_violation then raise exception 'fin_invalid_data'; end;
  return jsonb_build_object('ok', true, 'id', coalesce(v_first, v_id), 'count', coalesce(array_length(v_ids, 1), 1), 'approval', v_appr, 'status', v_status);
end $$;

create or replace function public.fin_notify_approvers(p_org uuid, p_entry uuid, p_desc text, p_amount numeric) returns void
language plpgsql security definer set search_path = public as $$
declare g record;
begin
  for g in select distinct u from (
      select user_id as u from org_members where org_id = p_org and role = 'admin'
      union select user_id from access_grants where org_id = p_org and 'fin_approve' = any (actions)) x
    where u is not null and u is distinct from auth.uid() loop
    perform public.notify_user(g.u, p_org, 'fin_approval', 'Despesa aguardando aprovação', left(p_desc, 80) || ' · R$ ' || to_char(p_amount, 'FM999G999G990D00'), '#/financeiro', jsonb_build_object('entry_id', p_entry));
  end loop;
end $$;
revoke execute on function public.fin_notify_approvers(uuid, uuid, text, numeric) from public, anon, authenticated;

-- aprovar ou recusar despesa; p_series aplica a todas as pendentes da mesma série. Ninguém aprova o que lançou ou alterou.
create or replace function public.fin_entry_decide(p_id uuid, p_decision text, p_reason text default null, p_series boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e fin_entries; r fin_entries; n int := 0;
begin
  select * into e from fin_entries where id = p_id for update; if e.id is null then raise exception 'not_found'; end if;
  perform public.fin_need(e.org_id, array['fin_approve']);
  if p_decision not in ('approve','reject') then raise exception 'invalid_decision'; end if;
  if e.kind <> 'expense' or e.status <> 'open' or e.approval <> 'pending' then raise exception 'fin_not_pending'; end if;
  if p_decision = 'reject' and length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'reason_required'; end if;
  for r in select * from fin_entries where org_id = e.org_id and kind = 'expense' and status = 'open' and approval = 'pending'
           and (id = e.id or (coalesce(p_series, false) and series_id is not null and series_id = e.series_id)) order by due_date for update loop
    if auth.uid() in (r.created_by, r.updated_by) then
      if r.id = e.id then raise exception 'fin_self_approval'; else continue; end if;
    end if;
    if p_decision = 'approve' then
      update fin_entries set approval = 'approved', approval_by = auth.uid(), approval_at = now(), approval_reason = null, updated_at = now() where id = r.id;
    else
      update fin_entries set approval = 'rejected', approval_by = auth.uid(), approval_at = now(), approval_reason = left(trim(p_reason), 300), status = 'cancelled',
        cancel_reason = 'Despesa recusada: ' || left(trim(p_reason), 260), cancelled_by = auth.uid(), cancelled_at = now(), updated_at = now() where id = r.id;
    end if;
    perform public.mod_log(r.org_id, 'finance', 'entry', r.id, p_decision, p_reason, jsonb_build_object('amount', r.amount, 'description', r.description));
    n := n + 1;
  end loop;
  if e.created_by is not null and e.created_by is distinct from auth.uid() then
    perform public.notify_user(e.created_by, e.org_id, 'fin_approval_result', case when p_decision = 'approve' then 'Despesa aprovada' else 'Despesa recusada' end,
      left(e.description, 80) || case when p_decision = 'reject' then ' · ' || left(trim(p_reason), 100) else '' end, '#/financeiro', jsonb_build_object('entry_id', e.id));
  end if;
  return jsonb_build_object('ok', true, 'count', n);
end $$;

-- baixa (pagamento/recebimento). Despesa que exige aprovação só é baixada depois de aprovada.
create or replace function public.fin_entry_settle(p_id uuid, p_date date default null, p_account uuid default null, p_method text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e fin_entries; v_date date := coalesce(p_date, public.fin_today()); v_acc uuid;
begin
  select * into e from fin_entries where id = p_id for update; if e.id is null then raise exception 'not_found'; end if;
  perform public.fin_need(e.org_id, array['fin_entry']);
  if e.status <> 'open' then raise exception 'entry_locked'; end if;
  if e.kind = 'expense' and e.approval = 'pending' then raise exception 'approval_required'; end if;
  if v_date > public.fin_today() then raise exception 'fin_future_date'; end if;
  v_acc := coalesce(p_account, e.account_id); if v_acc is null then raise exception 'account_required'; end if;
  if not public.fin_ref_ok(e.org_id, 'account', v_acc) then raise exception 'invalid_reference'; end if;
  if p_method is not null and p_method not in ('cash','pix','card','transfer','boleto','check','other') then raise exception 'invalid_method'; end if;
  update fin_entries set status = 'settled', paid_at = v_date, account_id = v_acc, method = coalesce(p_method, method), settled_by = auth.uid(), updated_by = auth.uid(), updated_at = now() where id = p_id;
  perform public.mod_log(e.org_id, 'finance', 'entry', p_id, 'settle', null, jsonb_build_object('amount', e.amount, 'date', v_date, 'account', v_acc));
  return jsonb_build_object('ok', true);
end $$;

-- cancela (motivo obrigatório; o registro permanece). Em aberto: quem lança. Já baixado (estorno): só quem administra o financeiro.
-- p_series cancela também as parcelas seguintes ainda em aberto.
create or replace function public.fin_entry_cancel(p_id uuid, p_reason text, p_series boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e fin_entries; r fin_entries; n int := 0;
begin
  select * into e from fin_entries where id = p_id for update; if e.id is null then raise exception 'not_found'; end if;
  if e.status = 'cancelled' then raise exception 'entry_locked'; end if;
  if e.status = 'settled' then perform public.fin_need(e.org_id, array['fin_manage']); else perform public.fin_need(e.org_id, array['fin_entry']); end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'reason_required'; end if;
  for r in select * from fin_entries where org_id = e.org_id and status <> 'cancelled'
           and (id = e.id or (coalesce(p_series, false) and series_id is not null and series_id = e.series_id and status = 'open' and due_date >= e.due_date)) for update loop
    update fin_entries set status = 'cancelled', cancel_reason = left(trim(p_reason), 300), cancelled_by = auth.uid(), cancelled_at = now(), updated_at = now() where id = r.id;
    perform public.mod_log(r.org_id, 'finance', 'entry', r.id, case when r.status = 'settled' then 'reverse' else 'cancel' end, p_reason, jsonb_build_object('amount', r.amount, 'description', r.description));
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'count', n);
end $$;

-- lista com filtros. Nome de quem contribuiu só aparece para fin_donors.
create or replace function public.fin_entries_list(p_org uuid, p_filter jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_donors boolean; v_from date := nullif(p_filter->>'from', '')::date; v_to date := nullif(p_filter->>'to', '')::date; v_kind text := nullif(p_filter->>'kind', ''); v_st text := nullif(p_filter->>'status', '');
        v_q text := nullif(trim(coalesce(p_filter->>'q', '')), ''); v_lim int := least(coalesce(nullif(p_filter->>'limit', '')::int, 200), 500); v_today date := public.fin_today();
begin
  perform public.fin_need(p_org, array['fin_view','fin_entry','fin_approve','fin_manage','fin_donors']);
  v_donors := public.fin_staff(p_org, array['fin_donors']);
  return coalesce((select jsonb_agg(row_to_json(x)::jsonb order by x.sort_date desc, x.created_at desc) from (
    select e.id, e.kind, e.description, e.amount, e.status, e.approval, e.due_date, e.paid_at, coalesce(e.paid_at, e.due_date) as sort_date, e.created_at,
           (e.status = 'open' and e.due_date < v_today) as overdue, e.method, e.series_id, e.installment, e.installments, e.series_kind, e.receipt_path is not null as has_receipt,
           e.category_id, c.name as category, e.cost_center_id, cc.name as cost_center, e.campaign_id, cp.name as campaign, e.account_id, a.name as account, e.to_account_id, ta.name as to_account,
           case when e.kind = 'income' and not v_donors then null else e.counterparty end as counterparty, e.anonymous,
           (e.kind = 'income' and not v_donors and (e.person_id is not null or e.counterparty is not null)) as donor_hidden,
           e.created_by = auth.uid() as mine
      from fin_entries e left join fin_categories c on c.id = e.category_id left join fin_cost_centers cc on cc.id = e.cost_center_id left join fin_campaigns cp on cp.id = e.campaign_id
      left join fin_accounts a on a.id = e.account_id left join fin_accounts ta on ta.id = e.to_account_id
     where e.org_id = p_org
       and (v_kind is null or e.kind = v_kind)
       and (v_from is null or coalesce(e.paid_at, e.due_date) >= v_from) and (v_to is null or coalesce(e.paid_at, e.due_date) <= v_to)
       and (v_st is null or (v_st = 'overdue' and e.status = 'open' and e.due_date < v_today) or (v_st = 'awaiting' and e.status = 'open' and e.approval = 'pending') or (v_st in ('open','settled','cancelled') and e.status = v_st))
       and (nullif(p_filter->>'account_id', '') is null or e.account_id = (p_filter->>'account_id')::uuid or e.to_account_id = (p_filter->>'account_id')::uuid)
       and (nullif(p_filter->>'category_id', '') is null or e.category_id = (p_filter->>'category_id')::uuid)
       and (nullif(p_filter->>'cost_center_id', '') is null or e.cost_center_id = (p_filter->>'cost_center_id')::uuid)
       and (nullif(p_filter->>'campaign_id', '') is null or e.campaign_id = (p_filter->>'campaign_id')::uuid)
       and (v_q is null or e.description ilike '%' || v_q || '%' or (e.kind = 'expense' and e.counterparty ilike '%' || v_q || '%') or (v_donors and e.counterparty ilike '%' || v_q || '%'))
     order by coalesce(e.paid_at, e.due_date) desc, e.created_at desc limit v_lim) x), '[]'::jsonb);
end $$;

create or replace function public.fin_entry_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e fin_entries; v_donors boolean; v_cat text; v_cc text; v_camp text; v_acc text; v_to text; v_person text; v_apr text; v_cr text;
begin
  select * into e from fin_entries where id = p_id; if e.id is null then raise exception 'not_found'; end if;
  perform public.fin_need(e.org_id, array['fin_view','fin_entry','fin_approve','fin_manage','fin_donors']);
  v_donors := public.fin_staff(e.org_id, array['fin_donors']);
  select name into v_cat from fin_categories where id = e.category_id; select name into v_cc from fin_cost_centers where id = e.cost_center_id;
  select name into v_camp from fin_campaigns where id = e.campaign_id; select name into v_acc from fin_accounts where id = e.account_id; select name into v_to from fin_accounts where id = e.to_account_id;
  if e.person_id is not null and (e.kind <> 'income' or v_donors) then v_person := public.mod_pname(e.person_id); end if;
  return jsonb_build_object('entry', (to_jsonb(e) - 'created_by' - 'updated_by' - 'approval_by' - 'cancelled_by' - 'settled_by')
        || jsonb_build_object('category', v_cat, 'cost_center', v_cc, 'campaign', v_camp, 'account', v_acc, 'to_account', v_to, 'person', v_person,
           'counterparty', case when e.kind = 'income' and not v_donors then null else e.counterparty end, 'person_id', case when e.kind = 'income' and not v_donors then null else e.person_id end,
           'donor_hidden', e.kind = 'income' and not v_donors and (e.person_id is not null or e.counterparty is not null), 'mine', e.created_by = auth.uid(),
           'overdue', e.status = 'open' and e.due_date < public.fin_today()),
    'can_decide', public.fin_staff(e.org_id, array['fin_approve']) and e.kind = 'expense' and e.status = 'open' and e.approval = 'pending' and auth.uid() not in (coalesce(e.created_by, gen_random_uuid()), coalesce(e.updated_by, gen_random_uuid())),
    'history', public.mod_history(e.org_id, 'finance', 'entry', e.id));
end $$;

-- ---------------------------------------------------------------- relatórios
-- período por data de baixa (efetivado). Transferências não entram em receitas/despesas.
create or replace function public.fin_reports(p_org uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_today date := public.fin_today();
begin
  perform public.fin_need(p_org, array['fin_view','fin_manage']);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 then raise exception 'invalid_period'; end if;
  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'totals', (select jsonb_build_object('income', coalesce(sum(amount) filter (where kind = 'income'), 0), 'expense', coalesce(sum(amount) filter (where kind = 'expense'), 0))
               from fin_entries where org_id = p_org and status = 'settled' and kind in ('income','expense') and paid_at between p_from and p_to),
    'flow', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'income', i, 'expense', x) order by m) from (
        select to_char(paid_at, 'YYYY-MM') m, sum(amount) filter (where kind = 'income') i, sum(amount) filter (where kind = 'expense') x
          from fin_entries where org_id = p_org and status = 'settled' and kind in ('income','expense') and paid_at between p_from and p_to group by 1) f), '[]'::jsonb),
    'income_by_category', coalesce((select jsonb_agg(jsonb_build_object('name', n, 'total', t) order by t desc) from (
        select c.name n, sum(e.amount) t from fin_entries e join fin_categories c on c.id = e.category_id where e.org_id = p_org and e.status = 'settled' and e.kind = 'income' and e.paid_at between p_from and p_to group by c.name) q), '[]'::jsonb),
    'expense_by_category', coalesce((select jsonb_agg(jsonb_build_object('name', n, 'total', t) order by t desc) from (
        select c.name n, sum(e.amount) t from fin_entries e join fin_categories c on c.id = e.category_id where e.org_id = p_org and e.status = 'settled' and e.kind = 'expense' and e.paid_at between p_from and p_to group by c.name) q), '[]'::jsonb),
    'expense_by_cost_center', coalesce((select jsonb_agg(jsonb_build_object('name', n, 'total', t) order by t desc) from (
        select coalesce(cc.name, 'Sem centro de custo') n, sum(e.amount) t from fin_entries e left join fin_cost_centers cc on cc.id = e.cost_center_id where e.org_id = p_org and e.status = 'settled' and e.kind = 'expense' and e.paid_at between p_from and p_to group by 1) q), '[]'::jsonb),
    'income_by_campaign', coalesce((select jsonb_agg(jsonb_build_object('name', n, 'total', t) order by t desc) from (
        select cp.name n, sum(e.amount) t from fin_entries e join fin_campaigns cp on cp.id = e.campaign_id where e.org_id = p_org and e.status = 'settled' and e.kind = 'income' and e.paid_at between p_from and p_to group by cp.name) q), '[]'::jsonb),
    'balances', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'active', a.active, 'balance', public.fin_balance(a.id)) order by a.active desc, lower(a.name)) from fin_accounts a where a.org_id = p_org), '[]'::jsonb),
    'pending', (select jsonb_build_object(
        'receivable', coalesce(sum(amount) filter (where kind = 'income'), 0), 'receivable_count', count(*) filter (where kind = 'income'),
        'receivable_overdue', coalesce(sum(amount) filter (where kind = 'income' and due_date < v_today), 0),
        'payable', coalesce(sum(amount) filter (where kind = 'expense'), 0), 'payable_count', count(*) filter (where kind = 'expense'),
        'payable_overdue', coalesce(sum(amount) filter (where kind = 'expense' and due_date < v_today), 0),
        'awaiting_approval', count(*) filter (where kind = 'expense' and approval = 'pending'))
      from fin_entries where org_id = p_org and status = 'open'));
end $$;

-- orçado × realizado. Sem mês: linhas anuais contra o ano inteiro; com mês: linhas daquele mês. Realizado = baixado (receita por categoria de receita, despesa por categoria de despesa).
create or replace function public.fin_budget_report(p_org uuid, p_year int, p_month int default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_from date; v_to date;
begin
  perform public.fin_need(p_org, array['fin_view','fin_manage']);
  if p_year is null or p_year not between 2000 and 2100 or (p_month is not null and p_month not between 1 and 12) then raise exception 'invalid_period'; end if;
  v_from := make_date(p_year, coalesce(p_month, 1), 1); v_to := case when p_month is null then make_date(p_year, 12, 31) else (v_from + interval '1 month - 1 day')::date end;
  return coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'month', b.month, 'category_id', b.category_id, 'category', c.name, 'kind', c.kind, 'cost_center_id', b.cost_center_id, 'cost_center', cc.name,
      'planned', b.amount,
      'actual', coalesce((select sum(e.amount) from fin_entries e where e.org_id = p_org and e.status = 'settled' and e.kind in ('income','expense') and e.paid_at between v_from and v_to
                 and (b.category_id is null or e.category_id = b.category_id) and (b.cost_center_id is null or e.cost_center_id = b.cost_center_id)
                 and (c.kind is null or e.kind = c.kind) and (c.kind is not null or e.kind = 'expense')), 0))
      order by coalesce(c.kind, 'expense'), coalesce(c.name, cc.name))
    from fin_budgets b left join fin_categories c on c.id = b.category_id left join fin_cost_centers cc on cc.id = b.cost_center_id
    where b.org_id = p_org and b.year = p_year and b.month is not distinct from p_month), '[]'::jsonb);
end $$;

-- define (ou remove, com amount vazio) uma linha do orçamento
create or replace function public.fin_budget_save(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_year int := (p->>'year')::int; v_month int := nullif(p->>'month', '')::int; v_cat uuid := nullif(p->>'category_id', '')::uuid; v_cc uuid := nullif(p->>'cost_center_id', '')::uuid;
        v_amt numeric := nullif(p->>'amount', '')::numeric; v_id uuid;
begin
  perform public.fin_need(p_org, array['fin_manage']);
  if v_year is null or v_year not between 2000 and 2100 or (v_month is not null and v_month not between 1 and 12) then raise exception 'invalid_period'; end if;
  if v_cat is null and v_cc is null then raise exception 'category_required'; end if;
  if (v_cat is not null and not exists (select 1 from fin_categories where id = v_cat and org_id = p_org)) or (v_cc is not null and not exists (select 1 from fin_cost_centers where id = v_cc and org_id = p_org)) then raise exception 'invalid_reference'; end if;
  select id into v_id from fin_budgets where org_id = p_org and year = v_year and month is not distinct from v_month and category_id is not distinct from v_cat and cost_center_id is not distinct from v_cc;
  if v_amt is null then
    if v_id is not null then delete from fin_budgets where id = v_id; perform public.mod_log(p_org, 'finance', 'budget', v_id, 'delete', null, jsonb_build_object('year', v_year, 'month', v_month)); end if;
    return jsonb_build_object('ok', true, 'removed', v_id is not null);
  end if;
  if v_amt < 0 or v_amt >= 10000000000 then raise exception 'invalid_amount'; end if;
  begin
    if v_id is null then insert into fin_budgets (org_id, year, month, category_id, cost_center_id, amount) values (p_org, v_year, v_month, v_cat, v_cc, round(v_amt, 2)) returning id into v_id;
    else update fin_budgets set amount = round(v_amt, 2) where id = v_id; end if;
  exception when check_violation then raise exception 'fin_invalid_data'; end;
  perform public.mod_log(p_org, 'finance', 'budget', v_id, 'save', null, jsonb_build_object('year', v_year, 'month', v_month, 'amount', v_amt));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

revoke execute on function public.fin_catalog(uuid), public.fin_catalog_save(uuid, text, uuid, jsonb), public.fin_settings_save(uuid, jsonb), public.fin_entry_save(uuid, uuid, jsonb),
  public.fin_entry_decide(uuid, text, text, boolean), public.fin_entry_settle(uuid, date, uuid, text), public.fin_entry_cancel(uuid, text, boolean), public.fin_entries_list(uuid, jsonb),
  public.fin_entry_get(uuid), public.fin_reports(uuid, date, date), public.fin_budget_report(uuid, int, int), public.fin_budget_save(uuid, jsonb) from public, anon;
grant execute on function public.fin_catalog(uuid), public.fin_catalog_save(uuid, text, uuid, jsonb), public.fin_settings_save(uuid, jsonb), public.fin_entry_save(uuid, uuid, jsonb),
  public.fin_entry_decide(uuid, text, text, boolean), public.fin_entry_settle(uuid, date, uuid, text), public.fin_entry_cancel(uuid, text, boolean), public.fin_entries_list(uuid, jsonb),
  public.fin_entry_get(uuid), public.fin_reports(uuid, date, date), public.fin_budget_report(uuid, int, int), public.fin_budget_save(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Para desfazer (se necessário): drop das funções fin_*, das políticas "fin receipts read/write" e das tabelas fin_*; module_actions volta à versão anterior.
-- ---------------------------------------------------------------------
-- Verificação (deve retornar true):
select to_regclass('public.fin_entries') is not null and to_regclass('public.fin_budgets') is not null
   and 'fin_approve' = any (public.module_actions()) and 'fin_donors' = any (public.module_actions())
   and exists (select 1 from pg_proc where proname = 'fin_entry_decide') as financeiro_ok;
