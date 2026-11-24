-- =====================================================================
-- Dados pessoais e familiares (27/11/2026) — complementa a Ficha Individual
--  * Endereço completo (logradouro já existia em "address"; novos: número, complemento, bairro, país) e telefone secundário.
--  * Tipos de parentesco numa tabela (relation_types): para ampliar no futuro basta inserir uma linha, sem mexer na estrutura.
--  * Vínculos validados: sem si mesmo, sem duplicar, sem ciclo de ascendência, idade coerente, um cônjuge por vez.
--  * Cadastrar familiar que ainda não existe (sem conta, e sem classificação eclesiástica: novo valor 'none').
--  * Alterar o grau de parentesco; encerrar vínculo (as fichas ficam, e o histórico guarda).
--  * Responsáveis legais em estrutura própria (parentesco não é responsabilidade), com tipo e observação.
--  * Proteção reforçada de menores de 18: o supervisor de rede deixa de enxergá-los; consultas à família de menores e aos responsáveis ficam
--    numa trilha de acesso que só o administrador lê.
--  * Nada existente é apagado; as pessoas e vínculos atuais continuam como estão.
-- =====================================================================

-- ---------------------------------------------------------------- campos novos de pessoa
alter table public.people add column if not exists phone2 text check (phone2 is null or length(phone2) <= 30);
alter table public.people add column if not exists address_number text check (address_number is null or length(address_number) <= 20);
alter table public.people add column if not exists address_complement text check (address_complement is null or length(address_complement) <= 120);
alter table public.people add column if not exists neighborhood text check (neighborhood is null or length(neighborhood) <= 120);
alter table public.people add column if not exists country text check (country is null or length(country) <= 80);
alter table public.people drop constraint if exists people_classification_check;
alter table public.people add constraint people_classification_check check (classification in ('member','attender','visitor','none'));

create or replace function public.person_is_minor(p_birth date) returns boolean language sql stable as $$
  select p_birth is not null and p_birth > (current_date - interval '18 years')::date
$$;

-- supervisor de rede não enxerga menores de 18 (proteção reforçada)
drop policy if exists people_select on public.people;
create policy people_select on public.people for select to authenticated using (
  user_id = auth.uid()
  or (public.people_scope_all(org_id) and public.has_people_perm(org_id, 'people_view'))
  or (public.people_supervised(org_id, user_id) and not public.person_is_minor(birth_date)));
create or replace function public.can_read_person(p_person uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from people p where p.id = p_person and (
    (public.people_scope_all(p.org_id) and public.has_people_perm(p.org_id, 'people_view'))
    or (public.people_supervised(p.org_id, p.user_id) and not public.person_is_minor(p.birth_date))))
$$;

-- ---------------------------------------------------------------- limpeza/validação/gravação com os campos novos
create or replace function public.person_clean(p jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare r jsonb := '{}'::jsonb; k text; v text;
begin
  foreach k in array array['full_name','social_name','sex','marital_status','phone','whatsapp','email','address','address_number','address_complement','neighborhood','country','phone2','city','state','photo_url','admin_notes'] loop
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

create or replace function public.person_check(c jsonb, p_need_name boolean) returns text
language plpgsql immutable set search_path = public as $$
begin
  if length(coalesce(c->>'address_number','')) > 20 or length(coalesce(c->>'address_complement','')) > 120 or length(coalesce(c->>'neighborhood','')) > 120
     or length(coalesce(c->>'country','')) > 80 or length(coalesce(c->>'phone2','')) > 30
     or length(coalesce(c->>'full_name','')) > 160 or length(coalesce(c->>'social_name','')) > 160 then return 'field_too_long'; end if;
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
  if v_class is not null and v_class not in ('member','attender','visitor','none') then raise exception 'invalid_classification'; end if;
  if v_status is not null and v_status not in ('active','inactive') then raise exception 'invalid_status'; end if;

  if p_id is null then
    select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'full_name', d.full_name, 'classification', d.classification, 'reason', d.reason)), '[]'::jsonb) into dup
      from public.people_find_dupes(p_org, c->>'cpf', c->>'email', c->>'full_name', nullif(c->>'birth_date', '')::date, null) d;
    if jsonb_array_length(dup) > 0 and not p_force then return jsonb_build_object('saved', false, 'duplicates', dup); end if;
    if (c->>'cpf') is not null and exists (select 1 from people where org_id = p_org and cpf = c->>'cpf') then raise exception 'duplicate_cpf'; end if;
    insert into people (org_id, full_name, social_name, birth_date, sex, cpf, marital_status, phone, whatsapp, email, address, address_number, address_complement, neighborhood, country, phone2, city, state, zip, photo_url,
                        classification, joined_at, status, admin_notes, source, flagged_duplicate, created_by)
    values (p_org, c->>'full_name', c->>'social_name', nullif(c->>'birth_date', '')::date, c->>'sex', c->>'cpf', c->>'marital_status', c->>'phone', c->>'whatsapp',
            c->>'email', c->>'address', c->>'address_number', c->>'address_complement', c->>'neighborhood', c->>'country', c->>'phone2', c->>'city', c->>'state', c->>'zip', c->>'photo_url', coalesce(v_class, 'visitor'), nullif(c->>'joined_at', '')::date,
            coalesce(v_status, 'active'), c->>'admin_notes', 'manual', jsonb_array_length(dup) > 0, auth.uid())
    returning id into v_id;
    perform public.person_log(p_org, v_id, 'create', null, null, coalesce(v_class, 'visitor'), 'cadastro manual');
    return jsonb_build_object('saved', true, 'id', v_id);
  end if;

  select * into old from people where id = p_id and org_id = p_org for update;
  if old.id is null then raise exception 'not_found'; end if;
  if (c->>'cpf') is not null and exists (select 1 from people where org_id = p_org and cpf = c->>'cpf' and id <> p_id) then raise exception 'duplicate_cpf'; end if;
  -- registra cada campo que mudou
  foreach k in array array['full_name','social_name','birth_date','sex','cpf','marital_status','phone','whatsapp','email','address','address_number','address_complement','neighborhood','country','phone2','city','state','zip','photo_url','joined_at','admin_notes'] loop
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
    address_number = case when c ? 'address_number' then c->>'address_number' else address_number end,
    address_complement = case when c ? 'address_complement' then c->>'address_complement' else address_complement end,
    neighborhood = case when c ? 'neighborhood' then c->>'neighborhood' else neighborhood end,
    country = case when c ? 'country' then c->>'country' else country end,
    phone2 = case when c ? 'phone2' then c->>'phone2' else phone2 end,
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

-- ---------------------------------------------------------------- tipos de parentesco (ampliáveis)
create table if not exists public.relation_types (
  key text primary key check (key ~ '^[a-z_]{2,30}$'),
  label text not null check (length(label) between 1 and 60),
  inverse text not null,                       -- como o outro lado enxerga ("child" ↔ "parent")
  kind text not null check (kind in ('spouse','up','down','side','other')),  -- up: o familiar é ascendente; down: descendente
  gens int not null default 0,
  sort int not null default 100,
  active boolean not null default true
);
insert into public.relation_types (key, label, inverse, kind, gens, sort) values
  ('spouse','Cônjuge','spouse','spouse',0,10), ('child','Filho(a)','parent','down',1,20), ('father','Pai','child','up',1,30),
  ('mother','Mãe','child','up',1,31), ('parent','Pai/Mãe','child','up',1,32), ('sibling','Irmão(ã)','sibling','side',0,40),
  ('grandparent','Avô/Avó','grandchild','up',2,50), ('grandchild','Neto(a)','grandparent','down',2,60), ('other','Outro vínculo familiar','other','other',0,90)
on conflict (key) do nothing;
alter table public.relation_types enable row level security;
revoke all on public.relation_types from anon, authenticated;
grant select on public.relation_types to authenticated;
drop policy if exists relation_types_select on public.relation_types;
create policy relation_types_select on public.relation_types for select to authenticated using (true);

alter table public.person_relations drop constraint if exists person_relations_relation_check;
alter table public.person_relations drop constraint if exists person_relations_relation_fkey;
alter table public.person_relations add constraint person_relations_relation_fkey foreign key (relation) references public.relation_types(key);

-- ---------------------------------------------------------------- responsáveis legais (estrutura própria)
create table if not exists public.person_guardians (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  ward_id uuid not null references public.people(id) on delete cascade,        -- quem está sob responsabilidade
  guardian_id uuid not null references public.people(id) on delete cascade,    -- o responsável
  kind text not null check (kind in ('parental','guardian','curator','other')),
  note text check (note is null or length(note) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (ward_id, guardian_id),
  check (ward_id <> guardian_id)
);
create index if not exists person_guardians_guardian on public.person_guardians (guardian_id);
create table if not exists public.person_sensitive_access (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid,
  actor uuid references auth.users(id) on delete set null,
  area text not null check (area in ('family_minor','guardians')),
  at timestamptz not null default now()
);
create index if not exists person_sensitive_access_person on public.person_sensitive_access (person_id, at desc);
alter table public.person_guardians enable row level security;
alter table public.person_sensitive_access enable row level security;
revoke all on public.person_guardians, public.person_sensitive_access from anon, authenticated;

-- ---------------------------------------------------------------- validação central de um vínculo
create or replace function public.relation_edges(p_org uuid, p_exclude bigint default null) returns table (src uuid, dst uuid)
language sql stable security definer set search_path = public as $$
  select case t.kind when 'down' then r.person_id else r.relative_id end, case t.kind when 'down' then r.relative_id else r.person_id end
    from person_relations r join relation_types t on t.key = r.relation where r.org_id = p_org and r.id is distinct from p_exclude and t.kind in ('up','down')
$$;
create or replace function public.relation_validate(a uuid, b uuid, p_rel text, p_exclude bigint default null) returns void
language plpgsql stable security definer set search_path = public as $$
declare pa people; pb people; t relation_types; anc uuid; des uuid; anc_b date; des_b date; cyc boolean;
begin
  select * into pa from people where id = a; select * into pb from people where id = b;
  if pa.id is null or pb.id is null or pa.org_id <> pb.org_id then raise exception 'not_found'; end if;
  if a = b then raise exception 'same_person'; end if;
  select * into t from relation_types where key = p_rel and active;
  if t.key is null then raise exception 'invalid_relation'; end if;
  if exists (select 1 from person_relations where id is distinct from p_exclude and ((person_id = a and relative_id = b) or (person_id = b and relative_id = a))) then raise exception 'already_related'; end if;
  if t.kind = 'spouse' and exists (select 1 from person_relations r join relation_types x on x.key = r.relation
       where r.id is distinct from p_exclude and x.kind = 'spouse' and (r.person_id in (a, b) or r.relative_id in (a, b))) then raise exception 'already_has_spouse'; end if;
  if t.kind in ('up','down') then
    if t.kind = 'down' then anc := a; des := b; anc_b := pa.birth_date; des_b := pb.birth_date; else anc := b; des := a; anc_b := pb.birth_date; des_b := pa.birth_date; end if;
    if anc_b is not null and des_b is not null and anc_b >= des_b then raise exception 'invalid_age'; end if;
    with recursive d(id) as (select des union select e.dst from relation_edges(pa.org_id, p_exclude) e join d on e.src = d.id)
      select exists (select 1 from d where id = anc) into cyc;
    if cyc then raise exception 'invalid_cycle'; end if;
  end if;
end $$;

create or replace function public.relation_label(p_key text) returns text language sql stable as $$ select label from relation_types where key = p_key $$;

-- edição dos próprios dados (inclui os novos campos)
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
    insert into people (org_id, user_id, full_name, social_name, birth_date, sex, cpf, marital_status, phone, whatsapp, email, address, address_number, address_complement, neighborhood, country, phone2, city, state, zip, photo_url, classification, source, created_by)
    values (p_org, auth.uid(), v_name, c->>'social_name', nullif(c->>'birth_date', '')::date, c->>'sex', c->>'cpf', c->>'marital_status', c->>'phone', c->>'whatsapp',
            coalesce(c->>'email', lower(v_email)), c->>'address', c->>'address_number', c->>'address_complement', c->>'neighborhood', c->>'country', c->>'phone2', c->>'city', c->>'state', c->>'zip', c->>'photo_url', 'visitor', 'self', auth.uid())
    returning id into v_id;
    perform public.person_log(p_org, v_id, 'create', null, null, 'visitor', 'cadastro feito pela própria pessoa');
    return jsonb_build_object('id', v_id);
  end if;
  if (c->>'cpf') is not null and exists (select 1 from people where org_id = p_org and cpf = c->>'cpf' and id <> old.id) then raise exception 'duplicate_cpf'; end if;
  foreach k in array array['full_name','social_name','birth_date','sex','cpf','marital_status','phone','whatsapp','email','address','address_number','address_complement','neighborhood','country','phone2','city','state','zip','photo_url'] loop
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
    address_number = case when c ? 'address_number' then c->>'address_number' else address_number end,
    address_complement = case when c ? 'address_complement' then c->>'address_complement' else address_complement end,
    neighborhood = case when c ? 'neighborhood' then c->>'neighborhood' else neighborhood end,
    country = case when c ? 'country' then c->>'country' else country end,
    phone2 = case when c ? 'phone2' then c->>'phone2' else phone2 end,
    city = case when c ? 'city' then c->>'city' else city end,
    state = case when c ? 'state' then c->>'state' else state end,
    zip = case when c ? 'zip' then c->>'zip' else zip end,
    photo_url = case when c ? 'photo_url' then c->>'photo_url' else photo_url end,
    updated_at = now()
  where id = old.id;
  return jsonb_build_object('id', old.id);
end $$;

-- ---------------------------------------------------------------- vínculos: relacionar, cadastrar familiar novo, alterar, encerrar
create or replace function public.person_relation_add(p_person uuid, p_relative uuid, p_relation text) returns void
language plpgsql security definer set search_path = public as $$
declare a people; b people; inv text;
begin
  select * into a from people where id = p_person; select * into b from people where id = p_relative;
  if a.id is null or b.id is null or a.org_id <> b.org_id then raise exception 'not_found'; end if;
  if not public.has_people_perm(a.org_id, 'people_edit') then raise exception 'forbidden'; end if;
  perform public.relation_validate(a.id, b.id, p_relation);
  insert into person_relations (org_id, person_id, relative_id, relation, created_by) values (a.org_id, a.id, b.id, p_relation, auth.uid());
  select inverse into inv from relation_types where key = p_relation;
  if inv = 'parent' then inv := case a.sex when 'M' then 'father' when 'F' then 'mother' else 'parent' end; end if;
  perform public.person_log(a.org_id, a.id, 'family', 'relation', null, public.relation_label(p_relation), b.full_name);
  perform public.person_log(a.org_id, b.id, 'family', 'relation', null, public.relation_label(inv), a.full_name);
end $$;

create or replace function public.person_relation_create(p_person uuid, p_relation text, p jsonb, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a people; r jsonb; v_id uuid; v_p jsonb := coalesce(p, '{}'::jsonb);
begin
  select * into a from people where id = p_person;
  if a.id is null then raise exception 'not_found'; end if;
  if not public.has_people_perm(a.org_id, 'people_edit') then raise exception 'forbidden'; end if;
  if not exists (select 1 from relation_types where key = p_relation and active) then raise exception 'invalid_relation'; end if;
  -- o familiar não vira membro automaticamente: sem classificação informada, fica "sem classificação"
  if coalesce(nullif(trim(v_p->>'classification'), ''), '') = '' then v_p := v_p || jsonb_build_object('classification', 'none'); end if;
  r := public.person_save(a.org_id, null, v_p, p_force);
  if not coalesce((r->>'saved')::boolean, false) then return r; end if;
  v_id := (r->>'id')::uuid;
  perform public.person_relation_add(p_person, v_id, p_relation);   -- se o vínculo for inválido, tudo é desfeito (inclusive o cadastro)
  return jsonb_build_object('saved', true, 'id', v_id);
end $$;

create or replace function public.person_relation_update(p_id bigint, p_relation text, p_from uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare r person_relations; a people; b people; old_l text; v_new text := p_relation; inv text;
begin
  select * into r from person_relations where id = p_id;
  if r.id is null then raise exception 'not_found'; end if;
  if not public.has_people_perm(r.org_id, 'people_edit') then raise exception 'forbidden'; end if;
  if not exists (select 1 from relation_types where key = p_relation and active) then raise exception 'invalid_relation'; end if;
  -- visto de quem é o "relative" do vínculo guardado, o tipo escolhido vale ao contrário
  if p_from is not null and p_from = r.relative_id then select inverse into v_new from relation_types where key = p_relation; end if;
  if r.relation = v_new then return; end if;
  perform public.relation_validate(r.person_id, r.relative_id, v_new, p_id);
  select * into a from people where id = r.person_id; select * into b from people where id = r.relative_id;
  old_l := public.relation_label(r.relation);
  update person_relations set relation = v_new where id = p_id;
  perform public.person_log(r.org_id, a.id, 'family', 'relation', old_l, public.relation_label(v_new), b.full_name);
  perform public.person_log(r.org_id, b.id, 'family', 'relation', old_l, public.relation_label(v_new), a.full_name);
end $$;

create or replace function public.person_family(p_person uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people; v_full boolean;
begin
  select * into pe from people where id = p_person;
  if pe.id is null or not public.can_read_person(p_person) then raise exception 'forbidden'; end if;
  v_full := public.people_scope_all(pe.org_id) and public.has_people_perm(pe.org_id, 'people_view');
  if public.person_is_minor(pe.birth_date) then insert into person_sensitive_access (org_id, person_id, actor, area) values (pe.org_id, p_person, auth.uid(), 'family_minor'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'relative_id', x.rid, 'name', o.full_name, 'photo_url', o.photo_url, 'classification', o.classification, 'status', o.status,
                                        'relation', x.rel, 'label', public.relation_label(x.rel), 'minor', public.person_is_minor(o.birth_date)) order by o.full_name)
    from (
      select r.id, r.relative_id as rid, r.relation as rel from person_relations r where r.person_id = p_person
      union all
      select r.id, r.person_id, case t.inverse when 'parent' then case q.sex when 'M' then 'father' when 'F' then 'mother' else 'parent' end else t.inverse end
        from person_relations r join relation_types t on t.key = r.relation join people q on q.id = r.person_id where r.relative_id = p_person
    ) x join people o on o.id = x.rid
    where v_full or not public.person_is_minor(o.birth_date)), '[]'::jsonb);
end $$;

create or replace function public.relation_types_list() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label) order by sort), '[]'::jsonb) from relation_types where active and key <> 'parent'
$$;

-- ---------------------------------------------------------------- responsáveis legais
create or replace function public.person_guardians(p_person uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from people where id = p_person;
  if pe.id is null or not (public.people_scope_all(pe.org_id) and public.has_people_perm(pe.org_id, 'people_view')) then raise exception 'forbidden'; end if;
  insert into person_sensitive_access (org_id, person_id, actor, area) values (pe.org_id, p_person, auth.uid(), 'guardians');
  return jsonb_build_object(
    'guardians', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'person_id', o.id, 'name', o.full_name, 'photo_url', o.photo_url, 'classification', o.classification, 'kind', g.kind, 'note', g.note) order by o.full_name)
                           from person_guardians g join people o on o.id = g.guardian_id where g.ward_id = p_person), '[]'::jsonb),
    'wards', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'person_id', o.id, 'name', o.full_name, 'photo_url', o.photo_url, 'classification', o.classification, 'kind', g.kind, 'note', g.note) order by o.full_name)
                       from person_guardians g join people o on o.id = g.ward_id where g.guardian_id = p_person), '[]'::jsonb));
end $$;

create or replace function public.guardian_add(p_ward uuid, p_guardian uuid, p_kind text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare w people; g people; v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into w from people where id = p_ward; select * into g from people where id = p_guardian;
  if w.id is null or g.id is null or w.org_id <> g.org_id then raise exception 'not_found'; end if;
  if not public.has_people_perm(w.org_id, 'people_edit') then raise exception 'forbidden'; end if;
  if w.id = g.id then raise exception 'same_person'; end if;
  if p_kind not in ('parental','guardian','curator','other') then raise exception 'invalid_kind'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'note_too_long'; end if;
  if g.birth_date is not null and public.person_is_minor(g.birth_date) then raise exception 'guardian_minor'; end if;
  if w.birth_date is not null and not public.person_is_minor(w.birth_date) and p_kind <> 'curator' then raise exception 'ward_not_minor'; end if;
  if exists (select 1 from person_guardians where ward_id = w.id and guardian_id = g.id) then raise exception 'already_guardian'; end if;
  insert into person_guardians (org_id, ward_id, guardian_id, kind, note, created_by) values (w.org_id, w.id, g.id, p_kind, v_note, auth.uid());
  perform public.person_log(w.org_id, w.id, 'guardian', 'guardian', null, 'responsável legal', g.full_name);
  perform public.person_log(w.org_id, g.id, 'guardian', 'guardian', null, 'responsável por', w.full_name);
end $$;

create or replace function public.guardian_update(p_id bigint, p_kind text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r person_guardians; v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into r from person_guardians where id = p_id;
  if r.id is null then raise exception 'not_found'; end if;
  if not public.has_people_perm(r.org_id, 'people_edit') then raise exception 'forbidden'; end if;
  if p_kind not in ('parental','guardian','curator','other') then raise exception 'invalid_kind'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'note_too_long'; end if;
  update person_guardians set kind = p_kind, note = v_note where id = p_id;
  perform public.person_log(r.org_id, r.ward_id, 'guardian', 'guardian', r.kind, p_kind, 'tipo de responsabilidade alterado');
end $$;

create or replace function public.guardian_remove(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r person_guardians; w people; g people;
begin
  select * into r from person_guardians where id = p_id;
  if r.id is null then raise exception 'not_found'; end if;
  if not public.has_people_perm(r.org_id, 'people_edit') then raise exception 'forbidden'; end if;
  select * into w from people where id = r.ward_id; select * into g from people where id = r.guardian_id;
  delete from person_guardians where id = p_id;
  perform public.person_log(r.org_id, w.id, 'guardian', 'guardian', 'responsável legal', null, g.full_name);
  perform public.person_log(r.org_id, g.id, 'guardian', 'guardian', 'responsável por', null, w.full_name);
end $$;

-- quem consultou dados protegidos (família de menores e responsáveis): só o administrador
create or replace function public.person_access_history(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from people where id = p_person;
  if pe.id is null then raise exception 'not_found'; end if;
  if not exists (select 1 from org_members where org_id = pe.org_id and user_id = auth.uid() and role = 'admin') then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'area', a.area, 'by', public.welcome_name(pe.org_id, a.actor)) order by a.at desc)
    from (select * from person_sensitive_access where person_id = p_person order by at desc limit 50) a), '[]'::jsonb);
end $$;

revoke execute on function public.person_relation_add(uuid, uuid, text), public.person_relation_create(uuid, text, jsonb, boolean), public.person_relation_update(bigint, text, uuid),
  public.person_family(uuid), public.relation_types_list(), public.person_guardians(uuid), public.guardian_add(uuid, uuid, text, text), public.guardian_update(bigint, text, text),
  public.guardian_remove(bigint), public.person_access_history(uuid) from public, anon;
grant execute on function public.person_relation_add(uuid, uuid, text), public.person_relation_create(uuid, text, jsonb, boolean), public.person_relation_update(bigint, text, uuid),
  public.person_family(uuid), public.relation_types_list(), public.person_guardians(uuid), public.guardian_add(uuid, uuid, text, text), public.guardian_update(bigint, text, text),
  public.guardian_remove(bigint), public.person_access_history(uuid) to authenticated;
revoke execute on function public.relation_edges(uuid, bigint), public.relation_validate(uuid, uuid, text, bigint), public.relation_label(text), public.person_is_minor(date) from public, anon, authenticated;
grant execute on function public.person_is_minor(date), public.relation_label(text) to authenticated;   -- usados dentro da política de leitura

-- verificação:
--   select to_regclass('public.relation_types') is not null as tipos, to_regclass('public.person_guardians') is not null as responsaveis,
--          to_regprocedure('public.person_relation_create(uuid,text,jsonb,boolean)') is not null as familiar_novo,
--          exists (select 1 from information_schema.columns where table_name = 'people' and column_name = 'neighborhood') as endereco;
-- REVERSÃO: drop table public.person_sensitive_access, public.person_guardians; alter table public.person_relations drop constraint person_relations_relation_fkey;
--           drop table public.relation_types; alter table public.people drop column phone2, drop column address_number, drop column address_complement, drop column neighborhood, drop column country;
