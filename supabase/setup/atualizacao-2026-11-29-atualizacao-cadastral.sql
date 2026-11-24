-- =====================================================================
-- SOMOS Recurso 06: Atualização cadastral pelo aplicativo (Meu Cadastro)
-- Reaproveita a ficha (`people`), o histórico (`person_log`/linha do tempo), as notificações (`notify_user`), as permissões (`people_approve`)
-- e os responsáveis legais (`person_guardians`). Nada é recriado.
--  * Política por campo (direto / precisa de aprovação / bloqueado), configurável pelo administrador.
--  * Campo direto: grava na hora e registra no histórico. Campo com aprovação: vira solicitação; a ficha só muda quando aprovada, campo a campo.
--  * Conflito: se o dado oficial mudou enquanto a solicitação esperava, a aprovação exige decisão explícita.
--  * Solicitações analisadas nunca são apagadas (só somem junto com a pessoa, por LGPD).
-- =====================================================================

create table if not exists public.person_field_policy (
  org_id uuid not null references public.organizations(id) on delete cascade,
  field text not null,
  mode text not null check (mode in ('direct','approval','locked')),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (org_id, field)
);
create table if not exists public.person_field_policy_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  field text not null, old_mode text, new_mode text not null,
  actor uuid references auth.users(id) on delete set null,
  at timestamptz not null default now()
);
alter table public.person_field_policy_log enable row level security;
revoke all on public.person_field_policy_log from anon, authenticated;
create table if not exists public.person_update_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  on_behalf boolean not null default false,
  status text not null check (status in ('draft','pending','in_review','approved','partial','refused','cancelled')),
  draft jsonb,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  started_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz
);
create unique index if not exists person_update_draft on public.person_update_requests (person_id) where status = 'draft';
create index if not exists person_update_status on public.person_update_requests (org_id, status, submitted_at desc);
create table if not exists public.person_update_items (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.person_update_requests(id) on delete cascade,
  field text not null,
  old_value text,
  new_value text,
  decision text not null default 'pending' check (decision in ('pending','approved','refused')),
  reason text,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  conflict_overridden boolean not null default false
);
create index if not exists person_update_items_req on public.person_update_items (request_id);
alter table public.person_field_policy enable row level security;
alter table public.person_update_requests enable row level security;
alter table public.person_update_items enable row level security;
revoke all on public.person_field_policy, public.person_update_requests, public.person_update_items from anon, authenticated;

-- histórico: aprovação e recusa de alterações cadastrais
create or replace function public.history_describe(p_kind text, p_field text, p_old text, p_new text, p_note text,
                                                   out category text, out title text, out description text, out restricted boolean)
language plpgsql immutable as $$
declare v_name text := split_part(coalesce(p_note, ''), ' · ', 1);
begin
  restricted := false; category := 'outros'; title := initcap(replace(coalesce(p_kind, 'evento'), '_', ' ')); description := nullif(p_note, '');
  if p_kind = 'create' then
    category := 'cadastro'; title := case p_new when 'visitor' then 'Cadastro inicial como visitante' else 'Ficha individual criada' end;
    description := trim(both ' ' from coalesce('Classificação: ' || public.history_class_label(p_new), '') || case when p_note is not null then ' · ' || p_note else '' end);
  elsif p_kind = 'classification' then
    category := 'cadastro';
    title := case when p_old is null or p_old = 'none' then 'Classificada como ' || public.history_class_label(p_new) else 'Passou de ' || public.history_class_label(p_old) || ' a ' || public.history_class_label(p_new) end;
    description := public.history_class_label(p_old) || ' → ' || public.history_class_label(p_new);
  elsif p_kind = 'field' and p_field = 'status' then
    category := 'cadastro';
    title := case when p_new = 'inactive' then 'Cadastro inativado' when p_old = 'inactive' and p_new = 'active' then 'Cadastro reativado' else 'Situação do cadastro alterada' end;
    description := null;
  elsif p_kind = 'field' and p_field = 'baptized' then
    category := 'batismo'; title := case when p_new = 'true' then 'Batismo registrado' else 'Batismo desmarcado' end; description := null;
  elsif p_kind = 'field' and p_field = 'baptism_date' then
    category := 'batismo'; title := 'Data do batismo registrada'; description := p_new;
  elsif p_kind in ('field', 'self_update') then
    category := 'pessoais'; title := case when p_kind = 'self_update' then 'Dado atualizado pela própria pessoa' else 'Dado pessoal atualizado' end; description := public.history_field_label(p_field);
  elsif p_kind = 'team_join' then
    category := 'ministerio'; title := 'Entrou em ' || coalesce(nullif(v_name, ''), 'um time'); description := case when p_note like '%entrou como líder%' then 'Entrou já como líder' end;
  elsif p_kind = 'team_leave' then
    category := 'ministerio'; title := 'Saiu de ' || coalesce(nullif(v_name, ''), 'um time'); description := null;
  elsif p_kind = 'team_role' then
    category := 'ministerio'; title := case when p_note like '%passou a líder%' then 'Nomeado(a) líder de ' else 'Deixou a liderança de ' end || coalesce(nullif(v_name, ''), 'um time'); description := null;
  elsif p_kind = 'visit' then category := 'acolhimento'; title := 'Visita registrada'; description := nullif(p_note, '');
  elsif p_kind = 'consent' then category := 'acolhimento'; title := case when p_new = 'true' then 'Contato autorizado' else 'Autorização de contato retirada' end; description := null;
  elsif p_kind = 'journey' then
    category := 'acolhimento'; title := 'Acolhimento: ' || case p_field when 'interest' then 'interesse em continuar' when 'request' then 'pedido registrado' when 'family' then 'conversa sobre família' when 'approach' then 'abordagem' when 'integration' then 'integração' when 'contact' then 'contato' else 'registro' end; description := null;
  elsif p_kind = 'family' then
    category := 'familia'; restricted := true;
    title := case when p_old is null then 'Vínculo familiar incluído' when p_new is null then 'Vínculo familiar encerrado' else 'Parentesco alterado' end;
    description := trim(both ' ' from coalesce(coalesce(p_new, p_old), '') || case when p_note is not null then ' · ' || p_note else '' end);
  elsif p_kind = 'guardian' then
    category := 'familia'; restricted := true;
    title := case when p_old is null then 'Responsável legal incluído' when p_new is null then 'Responsável legal removido' else 'Responsável legal alterado' end;
    description := trim(both ' ' from coalesce(coalesce(p_new, p_old), '') || case when p_note is not null then ' · ' || p_note else '' end);
  elsif p_kind = 'update_approved' then
    category := 'pessoais'; title := 'Alteração cadastral aprovada: ' || public.history_field_label(p_field);
    description := case when p_field = 'cpf' then nullif(p_note, '') else trim(both ' ' from coalesce(coalesce(p_old, '—') || ' → ' || coalesce(p_new, '—'), '') || case when p_note is not null then ' · ' || p_note else '' end) end;
  elsif p_kind = 'update_refused' then
    category := 'pessoais'; title := 'Alteração cadastral recusada: ' || public.history_field_label(p_field); description := nullif(p_note, '');
  elsif p_kind = 'approve' then category := 'cadastro'; title := 'Cadastro aprovado'; description := null;
  elsif p_kind = 'reject' then category := 'cadastro'; title := 'Cadastro rejeitado'; description := nullif(p_note, '');
  elsif p_kind = 'link' then category := 'cadastro'; title := 'Conta do aplicativo vinculada ao cadastro'; description := null;
  end if;
end $$;

create or replace function public.self_fields() returns text[] language sql immutable as $$
  select array['full_name','social_name','birth_date','sex','marital_status','cpf','phone','phone2','whatsapp','email','zip','address','address_number','address_complement','neighborhood','city','state','country','photo_url']
$$;
-- política por campo: o que a igreja configurou; sem configuração, contatos e nome social são diretos e o restante precisa de aprovação
create or replace function public.field_mode(p_org uuid, p_field text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select mode from person_field_policy where org_id = p_org and field = p_field),
    case when p_field = any (array['social_name','phone','phone2','whatsapp','email','photo_url']) then 'direct'
         when p_field = any (public.self_fields()) then 'approval' else 'locked' end)
$$;
-- quem pode mexer no cadastro: a própria pessoa, ou o responsável legal registrado
create or replace function public.self_role(p_person uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from people where id = p_person and user_id = auth.uid()) then 'self'
    when exists (select 1 from person_guardians g join people gp on gp.id = g.guardian_id where g.ward_id = p_person and gp.user_id = auth.uid()) then 'guardian' end
$$;
create or replace function public.person_apply_fields(p_person uuid, c jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  update people set
    full_name = coalesce(c->>'full_name', full_name),
    social_name = case when c ? 'social_name' then c->>'social_name' else social_name end,
    birth_date = case when c ? 'birth_date' then nullif(c->>'birth_date', '')::date else birth_date end,
    sex = case when c ? 'sex' then c->>'sex' else sex end,
    cpf = case when c ? 'cpf' then c->>'cpf' else cpf end,
    marital_status = case when c ? 'marital_status' then c->>'marital_status' else marital_status end,
    phone = case when c ? 'phone' then c->>'phone' else phone end,
    phone2 = case when c ? 'phone2' then c->>'phone2' else phone2 end,
    whatsapp = case when c ? 'whatsapp' then c->>'whatsapp' else whatsapp end,
    email = case when c ? 'email' then c->>'email' else email end,
    zip = case when c ? 'zip' then c->>'zip' else zip end,
    address = case when c ? 'address' then c->>'address' else address end,
    address_number = case when c ? 'address_number' then c->>'address_number' else address_number end,
    address_complement = case when c ? 'address_complement' then c->>'address_complement' else address_complement end,
    neighborhood = case when c ? 'neighborhood' then c->>'neighborhood' else neighborhood end,
    city = case when c ? 'city' then c->>'city' else city end,
    state = case when c ? 'state' then c->>'state' else state end,
    country = case when c ? 'country' then c->>'country' else country end,
    photo_url = case when c ? 'photo_url' then c->>'photo_url' else photo_url end,
    updated_at = now()
  where id = p_person;
end $$;
create or replace function public.registration_notify_reviewers(p_org uuid, p_title text, p_body text, p_except uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select user_id from org_members where org_id = p_org and role = 'admin'
           union select user_id from access_grants where org_id = p_org and 'people_approve' = any (actions) loop
    if u is distinct from p_except then perform public.notify_user(u, p_org, 'registration', p_title, p_body, '#/atualizacoes-cadastrais', null); end if;
  end loop;
end $$;
revoke execute on function public.self_fields(), public.field_mode(uuid, text), public.self_role(uuid), public.person_apply_fields(uuid, jsonb), public.registration_notify_reviewers(uuid, text, text, uuid) from public, anon, authenticated;

-- envio: campos diretos gravam; campos com aprovação viram solicitação; p_send=false guarda rascunho
create or replace function public.registration_submit(p_person uuid, p jsonb, p_send boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people; v_role text; c jsonb; err text; k text; ov text; nv text; v_mode text; v_direct jsonb := '{}'::jsonb; v_appr jsonb := '{}'::jsonb;
        v_req uuid; v_applied text[] := '{}'; v_pending text[] := '{}'; v_who text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into pe from people where id = p_person for update;
  if pe.id is null then raise exception 'not_found'; end if;
  v_role := public.self_role(p_person);
  if v_role is null then raise exception 'forbidden'; end if;
  if exists (select 1 from jsonb_object_keys(coalesce(p, '{}'::jsonb)) x where x <> all (public.self_fields())) then raise exception 'field_locked'; end if;
  c := public.person_clean(coalesce(p, '{}'::jsonb));
  err := public.person_check(c, false);
  if err is not null then raise exception '%', err; end if;
  if (c->>'cpf') is not null and exists (select 1 from people where org_id = pe.org_id and cpf = c->>'cpf' and id <> pe.id) then raise exception 'duplicate_cpf'; end if;
  for k in select jsonb_object_keys(c) loop
    ov := to_jsonb(pe) ->> k; nv := c ->> k;
    if ov is not distinct from nv then continue; end if;
    v_mode := public.field_mode(pe.org_id, k);
    if v_mode = 'locked' then raise exception 'field_locked'; end if;
    if v_mode = 'direct' then v_direct := v_direct || jsonb_build_object(k, nv); else v_appr := v_appr || jsonb_build_object(k, nv); end if;
  end loop;
  if not p_send then
    delete from person_update_requests where person_id = pe.id and status = 'draft';
    insert into person_update_requests (org_id, person_id, requested_by, on_behalf, status, draft) values (pe.org_id, pe.id, auth.uid(), v_role = 'guardian', 'draft', v_direct || v_appr) returning id into v_req;
    return jsonb_build_object('draft', v_req);
  end if;
  delete from person_update_requests where person_id = pe.id and status = 'draft';
  if v_appr <> '{}'::jsonb and exists (select 1 from person_update_items i join person_update_requests r on r.id = i.request_id
        where r.person_id = pe.id and r.status in ('pending','in_review') and i.decision = 'pending' and i.field in (select jsonb_object_keys(v_appr))) then raise exception 'already_pending'; end if;
  if v_direct <> '{}'::jsonb then
    perform public.person_apply_fields(pe.id, v_direct);
    for k in select jsonb_object_keys(v_direct) loop
      perform public.person_log(pe.org_id, pe.id, 'self_update', k, to_jsonb(pe) ->> k, v_direct ->> k, case when v_role = 'guardian' then 'feito pelo responsável legal' end);
      v_applied := v_applied || k;
    end loop;
  end if;
  if v_appr <> '{}'::jsonb then
    insert into person_update_requests (org_id, person_id, requested_by, on_behalf, status, submitted_at) values (pe.org_id, pe.id, auth.uid(), v_role = 'guardian', 'pending', now()) returning id into v_req;
    for k in select jsonb_object_keys(v_appr) loop
      insert into person_update_items (request_id, field, old_value, new_value) values (v_req, k, to_jsonb(pe) ->> k, v_appr ->> k);
      v_pending := v_pending || k;
    end loop;
    perform public.notify_user(auth.uid(), pe.org_id, 'registration', 'Solicitação recebida', 'Sua alteração de cadastro foi enviada para análise. Acompanhe em Meu Cadastro.', '#/meu-cadastro', jsonb_build_object('request_id', v_req));
    v_who := coalesce(pe.social_name, pe.full_name);
    perform public.registration_notify_reviewers(pe.org_id, 'Atualização cadastral para analisar', v_who || ' enviou uma solicitação de atualização de dados.', auth.uid());
  end if;
  return jsonb_build_object('applied', to_jsonb(v_applied), 'pending', to_jsonb(v_pending), 'request_id', v_req);
end $$;

-- "meus dados" antigo: se a pessoa ainda não tem ficha, cria; se já tem, segue a política por campo
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
  return public.registration_submit(old.id, c, true);
end $$;

-- leitura do autoatendimento: só campos permitidos (nada de notas internas, pastoral ou histórico restrito)
create or replace function public.my_registration(p_org uuid, p_person uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people; v_id uuid := p_person; v_role text;
begin
  if auth.uid() is null or not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  if v_id is null then select id into v_id from people where org_id = p_org and user_id = auth.uid(); end if;
  if v_id is null then
    return jsonb_build_object('person', null, 'dependents', public.my_dependents(p_org));
  end if;
  select * into pe from people where id = v_id and org_id = p_org;
  v_role := public.self_role(v_id);
  if pe.id is null or v_role is null then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'role', v_role,
    'person', (select jsonb_object_agg(k, to_jsonb(pe) -> k) from unnest(public.self_fields()) k) || jsonb_build_object('id', pe.id),
    'policy', (select jsonb_object_agg(k, public.field_mode(p_org, k)) from unnest(public.self_fields()) k),
    'draft', (select draft from person_update_requests where person_id = pe.id and status = 'draft'),
    'pending_fields', coalesce((select jsonb_agg(distinct i.field) from person_update_items i join person_update_requests r on r.id = i.request_id where r.person_id = pe.id and r.status in ('pending','in_review') and i.decision = 'pending'), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'submitted_at', r.submitted_at, 'reviewed_at', r.reviewed_at, 'on_behalf', r.on_behalf,
        'by', coalesce(public.welcome_name(r.org_id, r.requested_by), '—'),
        'items', (select jsonb_agg(jsonb_build_object('field', i.field, 'label', public.history_field_label(i.field), 'old', case when i.field = 'cpf' then null else i.old_value end, 'new', case when i.field = 'cpf' then null else i.new_value end, 'decision', i.decision, 'reason', i.reason) order by i.id) from person_update_items i where i.request_id = r.id))
        order by r.submitted_at desc) from (select * from person_update_requests where person_id = pe.id and status <> 'draft' order by submitted_at desc limit 20) r), '[]'::jsonb),
    'family', coalesce((select jsonb_agg(jsonb_build_object('name', o.full_name, 'photo_url', o.photo_url, 'label', public.relation_label(x.rel)) order by o.full_name)
      from (select r.relative_id as rid, r.relation as rel from person_relations r where r.person_id = pe.id
            union all select r.person_id, case t.inverse when 'parent' then case q.sex when 'M' then 'father' when 'F' then 'mother' else 'parent' end else t.inverse end
              from person_relations r join relation_types t on t.key = r.relation join people q on q.id = r.person_id where r.relative_id = pe.id) x
      join people o on o.id = x.rid where not public.person_is_minor(o.birth_date) or v_role = 'self'), '[]'::jsonb),
    'dependents', public.my_dependents(p_org));
end $$;
create or replace function public.my_dependents(p_org uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.full_name, 'photo_url', w.photo_url) order by w.full_name), '[]'::jsonb)
  from person_guardians g join people gp on gp.id = g.guardian_id and gp.user_id = auth.uid() join people w on w.id = g.ward_id where g.org_id = p_org
$$;

create or replace function public.registration_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r person_update_requests;
begin
  select * into r from person_update_requests where id = p_id for update;
  if r.id is null or public.self_role(r.person_id) is null then raise exception 'not_found'; end if;
  if r.status not in ('draft','pending') or exists (select 1 from person_update_items where request_id = r.id and decision <> 'pending') then raise exception 'cannot_cancel'; end if;
  if r.status = 'draft' then delete from person_update_requests where id = r.id; return; end if;   -- rascunho nunca foi enviado: não há o que auditar
  update person_update_requests set status = 'cancelled', reviewed_at = now(), reviewed_by = auth.uid() where id = r.id;
end $$;

-- ---------------------------------------------------------------- painel dos responsáveis
create or replace function public.registration_requests(p_org uuid, p_status text default null, p_person uuid default null, p_from date default null, p_to date default null,
                                                        p_reviewer uuid default null, p_limit int default 20, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_lim int := least(greatest(coalesce(p_limit, 20), 1), 50); v_res jsonb; v_more boolean;
begin
  if not public.has_people_perm(p_org, 'people_approve') then raise exception 'forbidden'; end if;
  if p_status is not null and p_status not in ('pending','in_review','approved','partial','refused','cancelled') then raise exception 'invalid_filter'; end if;
  select coalesce(jsonb_agg(x.j order by x.rn) filter (where x.rn <= v_lim), '[]'::jsonb), coalesce(bool_or(x.rn > v_lim), false) into v_res, v_more
  from (
    select q.rn, jsonb_build_object('id', r.id, 'status', r.status, 'submitted_at', r.submitted_at, 'started_at', r.started_at, 'reviewed_at', r.reviewed_at, 'on_behalf', r.on_behalf,
      'person', jsonb_build_object('id', pe.id, 'name', pe.full_name, 'photo_url', pe.photo_url), 'requested_by', coalesce(public.welcome_name(r.org_id, r.requested_by), '—'),
      'reviewer', case when r.reviewed_by is null then null else coalesce(public.welcome_name(r.org_id, r.reviewed_by), '—') end,
      'items', (select jsonb_agg(jsonb_build_object('id', i.id, 'field', i.field, 'label', public.history_field_label(i.field), 'old', i.old_value, 'new', i.new_value, 'decision', i.decision, 'reason', i.reason,
                   'decided_by', case when i.decided_by is null then null else coalesce(public.welcome_name(r.org_id, i.decided_by), '—') end, 'decided_at', i.decided_at, 'overridden', i.conflict_overridden,
                   'current', to_jsonb(pe) ->> i.field, 'conflict', i.decision = 'pending' and (to_jsonb(pe) ->> i.field) is distinct from i.old_value) order by i.id) from person_update_items i where i.request_id = r.id)) as j
    from (select r2.*, row_number() over (order by r2.submitted_at desc, r2.id) as rn
            from (select * from person_update_requests where org_id = p_org and status <> 'draft'
                    and (p_status is null or status = p_status) and (p_person is null or person_id = p_person)
                    and (p_from is null or submitted_at >= p_from::timestamptz) and (p_to is null or submitted_at < (p_to + 1)::timestamptz)
                    and (p_reviewer is null or reviewed_by = p_reviewer)
                    order by submitted_at desc, id offset greatest(coalesce(p_offset, 0), 0) limit v_lim + 1) r2) q
         join person_update_requests r on r.id = q.id join people pe on pe.id = r.person_id
  ) x;
  return jsonb_build_object('items', v_res, 'has_more', v_more,
    'counts', (select jsonb_object_agg(status, n) from (select status, count(*) n from person_update_requests where org_id = p_org and status <> 'draft' group by status) s));
end $$;
create or replace function public.registration_pending_count(p_org uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when public.has_people_perm(p_org, 'people_approve') then (select count(*)::int from person_update_requests where org_id = p_org and status in ('pending','in_review')) else 0 end
$$;
create or replace function public.registration_start(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r person_update_requests;
begin
  select * into r from person_update_requests where id = p_id for update;
  if r.id is null then raise exception 'not_found'; end if;
  if not public.has_people_perm(r.org_id, 'people_approve') then raise exception 'forbidden'; end if;
  if r.status <> 'pending' then return; end if;
  update person_update_requests set status = 'in_review', started_by = auth.uid(), started_at = now() where id = r.id;
  if r.requested_by is not null then perform public.notify_user(r.requested_by, r.org_id, 'registration', 'Solicitação em análise', 'Sua solicitação de atualização cadastral começou a ser analisada.', '#/meu-cadastro', jsonb_build_object('request_id', r.id)); end if;
end $$;

create or replace function public.registration_decide(p_id uuid, p_decisions jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r person_update_requests; pe people; d jsonb; it person_update_items; v_conf bigint[] := '{}'; v_apply jsonb := '{}'::jsonb; v_reason text; v_force boolean;
        n_pend int; n_app int; n_ref int; v_status text; v_req_name text; v_me text; v_title text; v_body text; v_cur text;
begin
  select * into r from person_update_requests where id = p_id for update;
  if r.id is null then raise exception 'not_found'; end if;
  if not public.has_people_perm(r.org_id, 'people_approve') then raise exception 'forbidden'; end if;
  if r.status not in ('pending','in_review') then raise exception 'already_decided'; end if;
  if r.requested_by = auth.uid() and not exists (select 1 from org_members where org_id = r.org_id and user_id = auth.uid() and role = 'admin') then raise exception 'self_approval'; end if;
  select * into pe from people where id = r.person_id for update;
  if jsonb_typeof(p_decisions) <> 'array' or jsonb_array_length(p_decisions) = 0 then raise exception 'invalid_decision'; end if;
  -- 1ª passada: valida tudo e procura conflitos, sem gravar nada
  for d in select * from jsonb_array_elements(p_decisions) loop
    select * into it from person_update_items where id = (d->>'item_id')::bigint and request_id = r.id and decision = 'pending';
    if it.id is null then raise exception 'not_found'; end if;
    if d->>'decision' = 'refuse' then
      if char_length(trim(coalesce(d->>'reason', ''))) < 3 or char_length(trim(d->>'reason')) > 500 then raise exception 'reason_required'; end if;
    elsif d->>'decision' = 'approve' then
      v_cur := to_jsonb(pe) ->> it.field;
      if v_cur is distinct from it.old_value and not coalesce((d->>'force')::boolean, false) then v_conf := v_conf || it.id; end if;
      if it.field = 'cpf' and it.new_value is not null and exists (select 1 from people where org_id = r.org_id and cpf = it.new_value and id <> pe.id) then raise exception 'duplicate_cpf'; end if;
    else raise exception 'invalid_decision'; end if;
  end loop;
  if array_length(v_conf, 1) > 0 then return jsonb_build_object('ok', false, 'conflicts', to_jsonb(v_conf)); end if;
  v_req_name := coalesce(public.welcome_name(r.org_id, r.requested_by), 'a própria pessoa');
  v_me := coalesce(public.welcome_name(r.org_id, auth.uid()), 'responsável');
  -- 2ª passada: aplica
  for d in select * from jsonb_array_elements(p_decisions) loop
    select * into it from person_update_items where id = (d->>'item_id')::bigint;
    v_force := coalesce((d->>'force')::boolean, false);
    if d->>'decision' = 'approve' then
      v_cur := to_jsonb(pe) ->> it.field;
      v_apply := v_apply || jsonb_build_object(it.field, it.new_value);
      update person_update_items set decision = 'approved', decided_by = auth.uid(), decided_at = now(), conflict_overridden = (v_cur is distinct from it.old_value and v_force) where id = it.id;
      perform public.person_log(r.org_id, pe.id, 'update_approved', it.field, v_cur, it.new_value, 'Solicitado por ' || v_req_name || ' · aprovado por ' || v_me, null, null,
                                jsonb_build_object('request_id', r.id, 'requested_by', r.requested_by, 'approved_by', auth.uid()));
    else
      v_reason := trim(d->>'reason');
      update person_update_items set decision = 'refused', reason = v_reason, decided_by = auth.uid(), decided_at = now() where id = it.id;
      perform public.person_log(r.org_id, pe.id, 'update_refused', it.field, null, null, 'Recusado por ' || v_me || ': ' || v_reason, null, null,
                                jsonb_build_object('request_id', r.id, 'requested_by', r.requested_by, 'refused_by', auth.uid()));
    end if;
  end loop;
  if v_apply <> '{}'::jsonb then perform public.person_apply_fields(pe.id, v_apply); end if;
  select count(*) filter (where decision = 'pending'), count(*) filter (where decision = 'approved'), count(*) filter (where decision = 'refused') into n_pend, n_app, n_ref from person_update_items where request_id = r.id;
  if n_pend > 0 then
    update person_update_requests set status = 'in_review', started_by = coalesce(started_by, auth.uid()), started_at = coalesce(started_at, now()) where id = r.id;
    return jsonb_build_object('ok', true, 'status', 'in_review');
  end if;
  v_status := case when n_ref = 0 then 'approved' when n_app = 0 then 'refused' else 'partial' end;
  update person_update_requests set status = v_status, reviewed_by = auth.uid(), reviewed_at = now(), started_by = coalesce(started_by, auth.uid()), started_at = coalesce(started_at, now()) where id = r.id;
  v_title := case v_status when 'approved' then 'Alteração aprovada' when 'refused' then 'Alteração recusada' else 'Alteração parcialmente aprovada' end;
  v_body := case v_status when 'approved' then 'Os dados que você pediu para atualizar foram aprovados.' when 'refused' then 'Sua solicitação foi recusada. Veja o motivo em Meu Cadastro.' else 'Parte da sua solicitação foi aprovada e parte recusada. Veja os detalhes em Meu Cadastro.' end;
  if r.requested_by is not null then perform public.notify_user(r.requested_by, r.org_id, 'registration', v_title, v_body, '#/meu-cadastro', jsonb_build_object('request_id', r.id, 'status', v_status)); end if;
  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

-- regras por campo (administrador da igreja)
create or replace function public.registration_policy_list(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin') then raise exception 'forbidden'; end if;
  return (select jsonb_agg(jsonb_build_object('field', k, 'label', public.history_field_label(k), 'mode', public.field_mode(p_org, k)) order by ord) from unnest(public.self_fields()) with ordinality t(k, ord));
end $$;
create or replace function public.registration_policy_save(p_org uuid, p_field text, p_mode text) returns void
language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin') then raise exception 'forbidden'; end if;
  if not (p_field = any (public.self_fields())) then raise exception 'invalid_field'; end if;
  if p_mode not in ('direct','approval','locked') then raise exception 'invalid_mode'; end if;
  v_old := public.field_mode(p_org, p_field);
  insert into person_field_policy (org_id, field, mode, updated_by) values (p_org, p_field, p_mode, auth.uid())
  on conflict (org_id, field) do update set mode = excluded.mode, updated_by = auth.uid(), updated_at = now();
  insert into person_field_policy_log (org_id, field, old_mode, new_mode, actor) values (p_org, p_field, v_old, p_mode, auth.uid());
end $$;

revoke execute on function public.registration_submit(uuid, jsonb, boolean), public.my_registration(uuid, uuid), public.my_dependents(uuid), public.registration_cancel(uuid),
  public.registration_requests(uuid, text, uuid, date, date, uuid, int, int), public.registration_pending_count(uuid), public.registration_start(uuid), public.registration_decide(uuid, jsonb),
  public.registration_policy_list(uuid), public.registration_policy_save(uuid, text, text) from public, anon;
grant execute on function public.registration_submit(uuid, jsonb, boolean), public.my_registration(uuid, uuid), public.my_dependents(uuid), public.registration_cancel(uuid),
  public.registration_requests(uuid, text, uuid, date, date, uuid, int, int), public.registration_pending_count(uuid), public.registration_start(uuid), public.registration_decide(uuid, jsonb),
  public.registration_policy_list(uuid), public.registration_policy_save(uuid, text, text) to authenticated;

-- verificação:
--   select to_regclass('public.person_update_requests') is not null as solicitacoes, to_regclass('public.person_field_policy') is not null as regras,
--          to_regprocedure('public.registration_decide(uuid,jsonb)') is not null as aprovacao, to_regprocedure('public.my_registration(uuid,uuid)') is not null as meu_cadastro;
-- REVERSÃO: drop table public.person_update_items, public.person_update_requests, public.person_field_policy;
--           (my_person_update e history_describe voltam às versões de 20261127000001 e 20261128000001)
