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
