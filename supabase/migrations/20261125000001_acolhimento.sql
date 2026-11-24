-- =====================================================================
-- Acolhimento e jornada de visitantes (25/11/2026)
--  * Reaproveita a base central "people" (o visitante é uma pessoa com classification = 'visitor'; ao virar frequentador ou membro
--    continua sendo o MESMO registro, com o mesmo histórico). Nada é duplicado e nenhum dado existente é alterado.
--  * Cadastro inicial mínimo: nome, data da primeira visita, responsável pelo acolhimento e, só se a pessoa quiser, telefone + autorização de contato.
--  * Visitas ficam em "person_visits" (a primeira visita nunca é sobrescrita); aproximação, integração, interesses e contatos em "person_journey".
--    Ambas só crescem: não há função para editar ou apagar um registro antigo.
--  * A etapa da jornada (primeira visita, retorno, aproximação, integração) é CALCULADA a partir dos registros reais. Não há alerta,
--    pendência, meta ou cobrança por ausência: quem não volta simplesmente continua na etapa em que está.
--  * Nova ação de permissão "people_welcome" (registrar acolhimento). Também vale para quem já tem "people_edit". Validada sempre no servidor.
--    O desenvolvedor não recebe acesso automático (modo auditoria).
-- =====================================================================

-- ---------------------------------------------------------------- nova ação de permissão
alter table public.access_grants drop constraint if exists access_grants_actions_check;
alter table public.access_grants add constraint access_grants_actions_check check (
  actions <@ array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome']::text[]);

create or replace function public.all_actions() returns text[] language sql immutable as $$
  select array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome']::text[]
$$;
create or replace function public.role_actions(p_role text) returns text[] language sql immutable as $$
  select case p_role
    when 'team_member'        then array['view']
    when 'team_leader'        then array['view','create','edit','delete','approve','manage']
    when 'network_supervisor' then array['view','approve','manage']
    when 'general_leader'     then array['view','create','edit','approve','manage','administer']
    when 'secretary'          then array['people_view','people_edit','people_approve','people_import','people_welcome']
    else '{}' end::text[]
$$;
create or replace function public.people_actions(p_org uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
      then array['people_view','people_edit','people_approve','people_import','people_welcome']
    else coalesce((select array_agg(distinct a) from access_grants g, unnest(g.actions) a
                   where g.org_id = p_org and g.user_id = auth.uid() and a like 'people\_%'), '{}'::text[]) end
$$;
create or replace function public.can_welcome(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_people_perm(p_org, 'people_welcome') or public.has_people_perm(p_org, 'people_edit')
$$;
revoke execute on function public.can_welcome(uuid) from public, anon;
grant execute on function public.can_welcome(uuid) to authenticated;

-- ---------------------------------------------------------------- consentimento de contato (na própria pessoa)
alter table public.people add column if not exists contact_consent boolean not null default false;
alter table public.people add column if not exists contact_consent_at timestamptz;

-- ---------------------------------------------------------------- visitas e jornada
create table if not exists public.person_visits (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  visited_on date not null,
  kind text not null check (kind in ('first','return')),
  welcomed_by uuid references auth.users(id) on delete set null,
  welcomed_by_name text check (welcomed_by_name is null or length(welcomed_by_name) <= 160),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (person_id, visited_on)
);
create index if not exists person_visits_org on public.person_visits (org_id, visited_on desc);

create table if not exists public.person_journey (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  kind text not null check (kind in ('contact','interest','request','family','approach','integration')),
  note text not null check (length(trim(note)) between 1 and 1000),
  happened_on date not null default current_date,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text check (created_by_name is null or length(created_by_name) <= 160),
  created_at timestamptz not null default now()
);
create index if not exists person_journey_person on public.person_journey (person_id, happened_on desc);

alter table public.person_visits enable row level security;
alter table public.person_journey enable row level security;
revoke all on public.person_visits, public.person_journey from anon, authenticated;
grant select on public.person_visits, public.person_journey to authenticated;
drop policy if exists person_visits_select on public.person_visits;
create policy person_visits_select on public.person_visits for select to authenticated using (
  public.people_scope_all(org_id) and public.has_people_perm(org_id, 'people_view'));
drop policy if exists person_journey_select on public.person_journey;
create policy person_journey_select on public.person_journey for select to authenticated using (
  public.people_scope_all(org_id) and public.has_people_perm(org_id, 'people_view'));

-- ---------------------------------------------------------------- utilitários internos
create or replace function public.welcome_name(p_org uuid, p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(om.display_name, ''), nullif(p.full_name, ''), 'Sem nome') from org_members om left join profiles p on p.id = om.user_id
   where om.org_id = p_org and om.user_id = p_user
$$;
create or replace function public.welcome_today() returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
-- etapa calculada: só muda por fatos registrados (nunca pelo passar do tempo)
create or replace function public.welcome_stage(p_person uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from person_journey where person_id = p_person and kind = 'integration') then 'integration'
    when exists (select 1 from person_journey where person_id = p_person and kind in ('interest','request','family','approach')) then 'approach'
    when (select count(*) from person_visits where person_id = p_person) > 1 then 'returning'
    else 'first_visit' end
$$;
create or replace function public.welcome_norm(p text) returns text language sql immutable as $$
  select lower(regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g'))
$$;
revoke execute on function public.welcome_name(uuid, uuid), public.welcome_stage(uuid), public.welcome_norm(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- cadastro simples depois da conversa
create or replace function public.welcome_register(p_org uuid, p_name text, p_phone text default null, p_consent boolean default false,
  p_visited_on date default null, p_welcomer uuid default null, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_name text := trim(coalesce(p_name, '')); v_phone text := nullif(trim(coalesce(p_phone, '')), ''); v_d text; v_day date := coalesce(p_visited_on, public.welcome_today());
        v_w uuid := coalesce(p_welcomer, auth.uid()); dup jsonb; v_id uuid; v_consent boolean := coalesce(p_consent, false);
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.can_welcome(p_org) then raise exception 'forbidden'; end if;
  if length(v_name) < 1 then raise exception 'name_required'; end if;
  if length(v_name) > 160 then raise exception 'name_too_long'; end if;
  if v_day > public.welcome_today() or v_day < date '2000-01-01' then raise exception 'invalid_date'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = v_w and role <> 'guest') then raise exception 'invalid_welcomer'; end if;
  if v_phone is not null then
    v_d := public.digits(v_phone);
    if v_d is null or length(v_d) < 8 or length(v_d) > 15 or length(v_phone) > 30 then raise exception 'invalid_phone'; end if;
    if not v_consent then raise exception 'phone_needs_consent'; end if;
  elsif v_consent then raise exception 'consent_needs_phone';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'full_name', x.full_name, 'classification', x.classification, 'reason', x.reason)), '[]'::jsonb) into dup from (
    select p.id, p.full_name, p.classification, 'nome'::text as reason from people p
      where p.org_id = p_org and p.status in ('active','inactive','pending') and public.welcome_norm(p.full_name) = public.welcome_norm(v_name)
    union
    select p.id, p.full_name, p.classification, 'telefone' from people p
      where p.org_id = p_org and v_d is not null and p.status in ('active','inactive','pending')
        and (public.digits(p.phone) = v_d or public.digits(p.whatsapp) = v_d)
    limit 5) x;
  if jsonb_array_length(dup) > 0 and not coalesce(p_force, false) then return jsonb_build_object('saved', false, 'duplicates', dup); end if;

  insert into people (org_id, full_name, phone, classification, status, source, registered_at, contact_consent, contact_consent_at, flagged_duplicate, created_by)
  values (p_org, v_name, v_phone, 'visitor', 'active', 'manual', v_day, v_consent, case when v_consent then now() end, jsonb_array_length(dup) > 0, auth.uid())
  returning id into v_id;
  insert into person_visits (org_id, person_id, visited_on, kind, welcomed_by, welcomed_by_name, created_by)
  values (p_org, v_id, v_day, 'first', v_w, public.welcome_name(p_org, v_w), auth.uid());
  perform public.person_log(p_org, v_id, 'create', null, null, 'visitor', 'acolhimento: primeira visita');
  if v_consent then perform public.person_log(p_org, v_id, 'consent', 'contact_consent', 'false', 'true', 'autorizou contato'); end if;
  return jsonb_build_object('saved', true, 'id', v_id);
end $$;

-- ---------------------------------------------------------------- retorno (nova visita no mesmo cadastro)
create or replace function public.welcome_visit(p_person uuid, p_visited_on date default null, p_welcomer uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people; v_day date := coalesce(p_visited_on, public.welcome_today()); v_w uuid := coalesce(p_welcomer, auth.uid()); v_first date; v_kind text;
begin
  select * into pe from people where id = p_person;
  if pe.id is null or pe.status not in ('active','inactive') then raise exception 'not_found'; end if;
  if not public.can_welcome(pe.org_id) then raise exception 'forbidden'; end if;
  if v_day > public.welcome_today() then raise exception 'invalid_date'; end if;
  if not exists (select 1 from org_members where org_id = pe.org_id and user_id = v_w and role <> 'guest') then raise exception 'invalid_welcomer'; end if;
  select min(visited_on) into v_first from person_visits where person_id = p_person;
  if v_first is not null and v_day < v_first then raise exception 'before_first_visit'; end if;
  if exists (select 1 from person_visits where person_id = p_person and visited_on = v_day) then raise exception 'already_registered'; end if;
  v_kind := case when v_first is null then 'first' else 'return' end;
  insert into person_visits (org_id, person_id, visited_on, kind, welcomed_by, welcomed_by_name, created_by)
  values (pe.org_id, p_person, v_day, v_kind, v_w, public.welcome_name(pe.org_id, v_w), auth.uid());
  perform public.person_log(pe.org_id, p_person, 'visit', null, null, v_day::text, case when v_kind = 'first' then 'primeira visita registrada' else 'retorno' end);
  return jsonb_build_object('ok', true, 'kind', v_kind, 'stage', public.welcome_stage(p_person));
end $$;

-- ---------------------------------------------------------------- aproximação, integração, interesses e contatos (só acrescenta)
create or replace function public.welcome_note(p_person uuid, p_kind text, p_note text, p_on date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people; v_day date := coalesce(p_on, public.welcome_today()); v_note text := trim(coalesce(p_note, ''));
begin
  select * into pe from people where id = p_person;
  if pe.id is null or pe.status not in ('active','inactive') then raise exception 'not_found'; end if;
  if not public.can_welcome(pe.org_id) then raise exception 'forbidden'; end if;
  if p_kind not in ('contact','interest','request','family','approach','integration') then raise exception 'invalid_kind'; end if;
  if length(v_note) < 1 then raise exception 'note_required'; end if;
  if length(v_note) > 1000 then raise exception 'note_too_long'; end if;
  if v_day > public.welcome_today() or v_day < date '2000-01-01' then raise exception 'invalid_date'; end if;
  if p_kind = 'contact' and not pe.contact_consent then raise exception 'no_contact_consent'; end if;
  insert into person_journey (org_id, person_id, kind, note, happened_on, created_by, created_by_name)
  values (pe.org_id, p_person, p_kind, v_note, v_day, auth.uid(), public.welcome_name(pe.org_id, auth.uid()));
  perform public.person_log(pe.org_id, p_person, 'journey', p_kind, null, null, null);
  return jsonb_build_object('ok', true, 'stage', public.welcome_stage(p_person));
end $$;

-- ---------------------------------------------------------------- corrigir nome, telefone e autorização (o que mudou fica registrado)
create or replace function public.welcome_update(p_person uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people; v_name text; v_phone text; v_d text; v_consent boolean;
begin
  select * into pe from people where id = p_person;
  if pe.id is null or pe.status not in ('active','inactive') then raise exception 'not_found'; end if;
  if not public.can_welcome(pe.org_id) then raise exception 'forbidden'; end if;
  v_name := case when p ? 'full_name' then trim(coalesce(p->>'full_name', '')) else pe.full_name end;
  if length(v_name) < 1 then raise exception 'name_required'; end if;
  if length(v_name) > 160 then raise exception 'name_too_long'; end if;
  v_consent := case when p ? 'consent' then coalesce((p->>'consent')::boolean, false) else pe.contact_consent end;
  v_phone := case when p ? 'phone' then nullif(trim(coalesce(p->>'phone', '')), '') else pe.phone end;
  -- tirar a autorização de contato remove também o telefone
  if pe.contact_consent and not v_consent then v_phone := null; end if;
  if v_phone is not null and (v_phone is distinct from pe.phone) then
    v_d := public.digits(v_phone);
    if v_d is null or length(v_d) < 8 or length(v_d) > 15 or length(v_phone) > 30 then raise exception 'invalid_phone'; end if;
    if not v_consent then raise exception 'phone_needs_consent'; end if;
  end if;
  if v_consent and v_phone is null then raise exception 'consent_needs_phone'; end if;
  if v_name is distinct from pe.full_name then perform public.person_log(pe.org_id, p_person, 'field', 'full_name', pe.full_name, v_name); end if;
  if v_phone is distinct from pe.phone then perform public.person_log(pe.org_id, p_person, 'field', 'phone', pe.phone, v_phone); end if;
  if v_consent is distinct from pe.contact_consent then
    perform public.person_log(pe.org_id, p_person, 'consent', 'contact_consent', pe.contact_consent::text, v_consent::text, case when v_consent then 'autorizou contato' else 'retirou a autorização de contato' end);
  end if;
  update people set full_name = v_name, phone = v_phone, contact_consent = v_consent,
    contact_consent_at = case when v_consent and not pe.contact_consent then now() when not v_consent then null else contact_consent_at end,
    updated_at = now() where id = p_person;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- lista de acolhimento (sem dados sensíveis; telefone só com autorização)
create or replace function public.welcome_list(p_org uuid, p_q text default null, p_limit int default 30, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_q text := nullif(trim(coalesce(p_q, '')), ''); v_rows jsonb; v_total int; v_lim int := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.can_welcome(p_org) then raise exception 'forbidden'; end if;
  with f as (
    select p.*, (select min(visited_on) from person_visits v where v.person_id = p.id) as first_on,
                (select max(visited_on) from person_visits v where v.person_id = p.id) as last_on,
                (select count(*) from person_visits v where v.person_id = p.id) as n
      from people p
     where p.org_id = p_org and p.status in ('active','inactive')
       and (p.classification = 'visitor' or exists (select 1 from person_visits v where v.person_id = p.id))
       and (v_q is null or p.full_name ilike '%' || v_q || '%')
  ), t as (select count(*) as n from f),
  pg as (select * from f order by coalesce(last_on, registered_at) desc, lower(full_name) limit v_lim offset greatest(coalesce(p_offset, 0), 0))
  select (select n from t), coalesce(jsonb_agg(jsonb_build_object('id', pg.id, 'full_name', pg.full_name, 'classification', pg.classification,
      'first_visit_on', pg.first_on, 'last_visit_on', pg.last_on, 'visits', pg.n, 'stage', public.welcome_stage(pg.id),
      'consent', pg.contact_consent, 'phone', case when pg.contact_consent then pg.phone end,
      'welcomed_by_name', (select welcomed_by_name from person_visits v where v.person_id = pg.id order by visited_on, id limit 1)
    ) order by coalesce(pg.last_on, pg.registered_at) desc, lower(pg.full_name)), '[]'::jsonb)
    into v_total, v_rows from pg;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

-- ---------------------------------------------------------------- ficha de acolhimento (visitas, jornada, autorizações)
create or replace function public.welcome_get(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from people where id = p_person;
  if pe.id is null or pe.status not in ('active','inactive') then raise exception 'not_found'; end if;
  if not public.can_welcome(pe.org_id) then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'person', jsonb_build_object('id', pe.id, 'full_name', pe.full_name, 'classification', pe.classification, 'status', pe.status,
      'consent', pe.contact_consent, 'consent_at', pe.contact_consent_at, 'phone', case when pe.contact_consent then pe.phone end, 'registered_at', pe.registered_at),
    'stage', public.welcome_stage(pe.id),
    'visits', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'visited_on', v.visited_on, 'kind', v.kind, 'welcomed_by_name', v.welcomed_by_name) order by v.visited_on desc, v.id desc)
                        from person_visits v where v.person_id = pe.id), '[]'::jsonb),
    'journey', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'kind', j.kind, 'note', j.note, 'happened_on', j.happened_on, 'by', j.created_by_name) order by j.happened_on desc, j.id desc)
                         from person_journey j where j.person_id = pe.id), '[]'::jsonb),
    'consents', coalesce((select jsonb_agg(jsonb_build_object('at', h.at, 'value', h.new_value = 'true', 'by', public.welcome_name(pe.org_id, h.actor)) order by h.at desc)
                          from person_history h where h.person_id = pe.id and h.kind = 'consent'), '[]'::jsonb));
end $$;

revoke execute on function public.welcome_register(uuid, text, text, boolean, date, uuid, boolean), public.welcome_visit(uuid, date, uuid), public.welcome_note(uuid, text, text, date),
  public.welcome_update(uuid, jsonb), public.welcome_list(uuid, text, int, int), public.welcome_get(uuid) from public, anon;
grant execute on function public.welcome_register(uuid, text, text, boolean, date, uuid, boolean), public.welcome_visit(uuid, date, uuid), public.welcome_note(uuid, text, text, date),
  public.welcome_update(uuid, jsonb), public.welcome_list(uuid, text, int, int), public.welcome_get(uuid) to authenticated;

-- verificação:
--   select to_regclass('public.person_visits') is not null as visitas, to_regclass('public.person_journey') is not null as jornada,
--          to_regprocedure('public.welcome_register(uuid,text,text,boolean,date,uuid,boolean)') is not null as cadastro,
--          'people_welcome' = any (public.all_actions()) as permissao;
-- REVERSÃO: drop table public.person_journey, public.person_visits; alter table public.people drop column contact_consent, drop column contact_consent_at;
--           (e as funções welcome_*, se quiser)
