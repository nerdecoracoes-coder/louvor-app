-- =====================================================================
-- SOMOS Recurso 07: Gestão de Novos Convertidos
-- A decisão de fé é um ACONTECIMENTO na trajetória da pessoa, não uma classificação:
--  * nunca altera a classificação (visitante/frequentador/membro), nunca cria vínculo com time/célula/ministério e nunca cria conta de acesso;
--  * a decisão pode existir antes de a pessoa ter ficha ("aguardando associação"); a associação é sempre uma escolha explícita (nunca automática por nome parecido);
--  * o acontecimento entra no histórico da pessoa como registro RESTRITO (crença religiosa é dado sensível): só quem tem permissão de ver convertidos o enxerga;
--  * telefone/e-mail são opcionais e só podem ser usados com autorização explícita ("não informado" nunca é consentimento);
--  * acompanhamento é flexível (sem etapas, prazos, metas ou alertas de ausência), pode ser encerrado/suspenso e a decisão permanece;
--  * exclusão só com permissão administrativa e justificativa; tudo fica no registro de auditoria. Permissões conferidas no banco.
-- =====================================================================

-- ---------------------------------------------------------------- permissões novas
alter table public.access_grants drop constraint if exists access_grants_actions_check;
alter table public.access_grants add constraint access_grants_actions_check check (
  actions <@ array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
                   'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin']::text[]);
create or replace function public.all_actions() returns text[] language sql immutable as $$
  select array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
               'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin']::text[]
$$;
create or replace function public.people_actions(p_org uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
      then array['people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
                 'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin']
    else coalesce((select array_agg(distinct a) from access_grants g, unnest(g.actions) a
                   where g.org_id = p_org and g.user_id = auth.uid() and a like 'people\_%'), '{}'::text[]) end
$$;
create or replace function public.conv_can(p_org uuid, p_mode text) returns boolean
language sql stable security definer set search_path = public as $$
  select ('people_converts_' || p_mode) = any (public.people_actions(p_org))
$$;
-- quem tem determinada permissão de convertidos (administradores + concedidas); usado para avisos e para escolher responsável
create or replace function public.conv_users(p_org uuid, p_mode text) returns setof uuid
language sql stable security definer set search_path = public as $$
  select om.user_id from org_members om where om.org_id = p_org and om.role = 'admin'
  union
  select g.user_id from access_grants g where g.org_id = p_org and ('people_converts_' || p_mode) = any (g.actions)
$$;
create or replace function public.conv_origin_label(p text) returns text language sql immutable as $$
  select case p when 'culto' then 'Culto' when 'celula' then 'Célula' when 'evento' then 'Evento' when 'transmissao' then 'Transmissão ao vivo'
                when 'evangelismo' then 'Evangelismo' when 'acao_externa' then 'Ação externa' when 'atendimento' then 'Atendimento pessoal' else 'Outro' end
$$;
revoke execute on function public.conv_can(uuid, text), public.conv_users(uuid, text), public.conv_origin_label(text) from public, anon;
grant execute on function public.conv_can(uuid, text) to authenticated;

-- ---------------------------------------------------------------- tabelas
create table if not exists public.faith_decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid references public.people(id) on delete set null,       -- nulo = aguardando associação
  display_name text not null check (length(trim(display_name)) between 1 and 160),
  decided_on date not null check (decided_on >= date '2000-01-01'),
  decided_time time,
  place text check (place is null or length(place) <= 120),
  origin text not null check (origin in ('culto','celula','evento','transmissao','evangelismo','acao_externa','atendimento','outro')),
  source text not null default 'admin' check (source in ('admin','app','public_form')),
  phone text check (phone is null or length(phone) <= 30),
  email text check (email is null or (length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  contact_consent text not null default 'unknown' check (contact_consent in ('authorized','declined','unknown')),
  consent_at timestamptz,
  admin_note text check (admin_note is null or length(admin_note) <= 500),
  wants_followup boolean,
  fu_status text not null default 'registered' check (fu_status in ('registered','offered','in_progress','suspended','ended','declined')),
  responsible_id uuid references auth.users(id) on delete set null,
  assigned_at timestamptz,
  assigned_by uuid references auth.users(id) on delete set null,
  registered_by uuid references auth.users(id) on delete set null,
  self_user uuid references auth.users(id) on delete set null,
  op_key text,
  linked_at timestamptz,
  linked_by uuid references auth.users(id) on delete set null,
  edited_at timestamptz,
  edited_by uuid references auth.users(id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  void_reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists faith_decisions_opkey on public.faith_decisions (org_id, op_key) where op_key is not null;
create index if not exists faith_decisions_org on public.faith_decisions (org_id, decided_on desc) where voided_at is null;
create index if not exists faith_decisions_person on public.faith_decisions (person_id) where person_id is not null;

create table if not exists public.faith_followup_entries (
  id bigint generated always as identity primary key,
  decision_id uuid not null references public.faith_decisions(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('contact','note','interest','referral')),
  occurred_on date not null,
  channel text check (channel is null or channel in ('whatsapp','phone','email','presencial','outro')),
  body text not null check (length(trim(body)) between 1 and 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists faith_entries_decision on public.faith_followup_entries (decision_id, occurred_on desc);

create table if not exists public.faith_decision_log (
  id bigint generated always as identity primary key,
  decision_id uuid not null,                       -- sem FK: a auditoria sobrevive
  org_id uuid not null,
  actor uuid references auth.users(id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists faith_log_decision on public.faith_decision_log (decision_id, at desc);

create table if not exists public.convert_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  form_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  form_active boolean not null default false,
  form_title text not null default 'Decidi seguir a Jesus' check (length(trim(form_title)) between 1 and 120),
  highlight_days int check (highlight_days is null or highlight_days between 1 and 365),
  updated_at timestamptz not null default now()
);

alter table public.faith_decisions enable row level security;
alter table public.faith_followup_entries enable row level security;
alter table public.faith_decision_log enable row level security;
alter table public.convert_settings enable row level security;
revoke all on public.faith_decisions, public.faith_followup_entries, public.faith_decision_log, public.convert_settings from anon, authenticated;

insert into public.history_categories (org_id, key, label, manual, sort) values (null, 'decisao', 'Decisão de fé', false, 45)
  on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), key) do nothing;

-- ---------------------------------------------------------------- linha do tempo: decisão de fé só para quem vê convertidos
create or replace function public.person_timeline(p_person uuid, p_categories text[] default null, p_origin text default null,
                                                  p_from date default null, p_to date default null, p_by uuid default null,
                                                  p_limit int default 30, p_offset int default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people; v_full boolean; v_sup boolean; v_detail boolean; v_lim int := least(greatest(coalesce(p_limit, 30), 1), 100); v_res jsonb; v_more boolean;
begin
  select * into pe from people where id = p_person;
  if pe.id is null then raise exception 'not_found'; end if;
  v_full := public.people_scope_all(pe.org_id) and public.has_people_perm(pe.org_id, 'people_view');
  v_sup  := not v_full and public.people_supervised(pe.org_id, pe.user_id) and not public.person_is_minor(pe.birth_date);
  if not (v_full or v_sup) then raise exception 'forbidden'; end if;
  v_detail := v_full and public.has_people_perm(pe.org_id, 'people_edit');
  if p_origin is not null and p_origin not in ('auto', 'manual') then raise exception 'invalid_filter'; end if;

  with base as (
    select h.*, case when h.kind in ('field', 'self_update') and h.category = 'pessoais' and h.op_id is not null then 'g:' || h.op_id || ':' || h.kind || ':' || coalesce(h.actor::text, '') else 'r:' || h.id end as gk
      from person_history h
     where h.person_id = p_person and h.voided_at is null
       and (v_full or not h.restricted)
       and (h.kind <> 'decision' or public.conv_can(pe.org_id, 'view'))
       and (p_categories is null or h.category = any (p_categories))
       and (p_origin is null or h.origin = p_origin)
       and (p_from is null or h.occurred_on >= p_from) and (p_to is null or h.occurred_on <= p_to)
       and (p_by is null or h.actor = p_by)
  ), grp as (
    select gk, max(id) as id, max(occurred_on) as occurred_on, max(at) as at, count(*) as n,
           (array_agg(id order by id))[1] as first_id
      from base group by gk
  ), page as (
    select q.*, row_number() over (order by q.occurred_on desc, q.at desc, q.id desc) as rn
      from (select g.* from grp g order by g.occurred_on desc, g.at desc, g.id desc offset greatest(coalesce(p_offset, 0), 0) limit v_lim + 1) q
  )
  select coalesce(jsonb_agg(x.j order by x.rn) filter (where x.rn <= v_lim), '[]'::jsonb), bool_or(x.rn > v_lim) into v_res, v_more
  from (
    select pg.rn, jsonb_build_object(
      'id', b.id, 'category', b.category, 'category_label', coalesce(c.label, 'Outros acontecimentos'),
      'title', case when pg.n > 1 then 'Dados pessoais atualizados' else case when b.restricted and not v_detail and b.kind <> 'decision' then case b.kind when 'guardian' then 'Responsável legal atualizado' else 'Vida familiar atualizada' end else b.title end end,
      'description', case when pg.n > 1 then (select string_agg(distinct public.history_field_label(g2.field), ', ') from base g2 where g2.gk = pg.gk)
                          when b.restricted and not v_detail and b.kind <> 'decision' then null else b.description end,
      'occurred_on', b.occurred_on, 'at', b.at, 'origin', b.origin, 'kind', b.kind,
      'by', case when b.actor is null then 'Sistema' else coalesce(public.welcome_name(b.org_id, b.actor), 'Usuário removido') end, 'by_id', b.actor,
      'edited', b.edited_at is not null, 'edited_at', b.edited_at,
      'notes', case when b.origin = 'manual' then b.meta->>'notes' end,
      'restricted', b.restricted and not v_detail and b.kind <> 'decision', 'op_id', b.op_id,
      'changes', case when b.kind in ('field', 'self_update') and b.category = 'pessoais' then
                  (select jsonb_agg(jsonb_build_object('field', public.history_field_label(g2.field), 'old', case when g2.field = 'cpf' then null else g2.old_value end, 'new', case when g2.field = 'cpf' then null else g2.new_value end) order by g2.id)
                     from base g2 where g2.gk = pg.gk) end,
      'can_edit', b.origin = 'manual' and public.can_timeline(b.org_id, 'edit')
    ) as j
    from page pg join person_history b on b.id = pg.id left join history_categories c on c.key = b.category and (c.org_id is null or c.org_id = b.org_id)
  ) x;
  return jsonb_build_object('items', v_res, 'has_more', coalesce(v_more, false), 'can_add', public.can_timeline(pe.org_id, 'add'));
end $$;

-- ---------------------------------------------------------------- utilitários internos
create or replace function public.conv_log(p_dec uuid, p_org uuid, p_action text, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public as $$
  insert into faith_decision_log (decision_id, org_id, actor, action, detail) values (p_dec, p_org, auth.uid(), p_action, coalesce(p_detail, '{}'::jsonb))
$$;
create or replace function public.conv_notify(p_org uuid, p_mode text, p_title text, p_body text, p_link text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select distinct x from public.conv_users(p_org, p_mode) x where x is distinct from auth.uid() loop
    perform public.notify_user(u, p_org, 'convert', p_title, p_body, p_link, null);
  end loop;
end $$;
-- registra o acontecimento na trajetória da pessoa (restrito; uma vez por decisão)
create or replace function public.conv_history(p_dec uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d faith_decisions;
begin
  select * into d from faith_decisions where id = p_dec;
  if d.id is null or d.person_id is null or d.voided_at is not null then return; end if;
  insert into person_history (org_id, person_id, actor, kind, field, old_value, new_value, note, category, title, description, restricted, occurred_on, origin, op_id, op_key, meta)
  values (d.org_id, d.person_id, auth.uid(), 'decision', null, null, null, null, 'decisao', 'Decisão de fé registrada',
          trim(both ' ' from public.conv_origin_label(d.origin) || coalesce(' · ' || d.place, '')),
          true, d.decided_on, 'auto', txid_current()::text, 'dec:' || d.id, jsonb_build_object('decision_id', d.id))
  on conflict (person_id, op_key) where op_key is not null do nothing;
end $$;
create or replace function public.conv_norm(p text) returns text language sql immutable as $$
  select lower(regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g'))
$$;
revoke execute on function public.conv_log(uuid, uuid, text, jsonb), public.conv_notify(uuid, text, text, text, text), public.conv_history(uuid), public.conv_norm(text) from public, anon, authenticated;

-- valida e normaliza os campos comuns
create or replace function public.conv_clean(p jsonb) returns jsonb
language plpgsql immutable as $$
declare v_name text := trim(coalesce(p->>'name', '')); v_phone text := nullif(trim(coalesce(p->>'phone', '')), ''); v_email text := nullif(lower(trim(coalesce(p->>'email', ''))), '');
        v_place text := nullif(trim(coalesce(p->>'place', '')), ''); v_note text := nullif(trim(coalesce(p->>'note', '')), ''); v_origin text := coalesce(nullif(trim(p->>'origin'), ''), 'culto');
        v_consent text := coalesce(nullif(trim(p->>'consent'), ''), 'unknown'); v_time text := nullif(trim(coalesce(p->>'time', '')), ''); v_d text;
begin
  if length(v_name) < 1 then raise exception 'name_required'; end if;
  if length(v_name) > 160 then raise exception 'name_too_long'; end if;
  if v_origin not in ('culto','celula','evento','transmissao','evangelismo','acao_externa','atendimento','outro') then raise exception 'invalid_origin'; end if;
  if v_consent not in ('authorized','declined','unknown') then raise exception 'invalid_consent'; end if;
  if v_phone is not null then
    v_d := public.digits(v_phone);
    if v_d is null or length(v_d) < 8 or length(v_d) > 15 or length(v_phone) > 30 then raise exception 'invalid_phone'; end if;
  end if;
  if v_email is not null and (length(v_email) > 200 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'invalid_email'; end if;
  if v_place is not null and length(v_place) > 120 then raise exception 'place_too_long'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'note_too_long'; end if;
  if v_time is not null and v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'invalid_time'; end if;
  return jsonb_build_object('name', v_name, 'phone', v_phone, 'email', v_email, 'place', v_place, 'note', v_note, 'origin', v_origin, 'consent', v_consent, 'time', v_time);
end $$;
revoke execute on function public.conv_clean(jsonb) from public, anon, authenticated;

create or replace function public.conv_today() returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
revoke execute on function public.conv_today() from public, anon, authenticated;

-- ---------------------------------------------------------------- candidatos (para escolher a ficha certa; nunca associa sozinho)
create or replace function public.convert_candidates(p_org uuid, p_name text, p_phone text default null, p_email text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_name text := public.conv_norm(p_name); v_d text := public.digits(p_phone); v_toks text[]; v_res jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not (public.conv_can(p_org, 'register') or public.conv_can(p_org, 'link')) then raise exception 'forbidden'; end if;
  v_toks := array(select t from unnest(string_to_array(v_name, ' ')) t where length(t) >= 2);
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'full_name', x.full_name, 'classification', x.classification, 'photo_url', x.photo_url, 'has_account', x.user_id is not null, 'reason', x.reason) order by x.o, x.full_name), '[]'::jsonb) into v_res from (
    select * from (
      select p.id, p.full_name, p.classification, p.photo_url, p.user_id,
             case when public.conv_norm(p.full_name) = v_name then 'nome igual'
                  when v_d is not null and length(v_d) >= 8 and (public.digits(p.phone) = v_d or public.digits(p.whatsapp) = v_d) then 'telefone igual'
                  when nullif(trim(coalesce(p_email, '')), '') is not null and lower(p.email) = lower(trim(p_email)) then 'e-mail igual'
                  else 'nome parecido' end as reason,
             case when public.conv_norm(p.full_name) = v_name then 1 when v_d is not null and length(v_d) >= 8 and (public.digits(p.phone) = v_d or public.digits(p.whatsapp) = v_d) then 2
                  when nullif(trim(coalesce(p_email, '')), '') is not null and lower(p.email) = lower(trim(p_email)) then 3 else 4 end as o
        from people p
       where p.org_id = p_org and p.status in ('active','inactive','pending')
         and (public.conv_norm(p.full_name) = v_name
              or (v_d is not null and length(v_d) >= 8 and (public.digits(p.phone) = v_d or public.digits(p.whatsapp) = v_d))
              or (nullif(trim(coalesce(p_email, '')), '') is not null and lower(p.email) = lower(trim(p_email)))
              or (cardinality(v_toks) >= 1 and not exists (select 1 from unnest(v_toks) t where lower(p.full_name) not like '%' || t || '%')))
    ) q order by q.o, q.full_name limit 8) x;
  return v_res;
end $$;

-- ---------------------------------------------------------------- registro da decisão
create or replace function public.convert_register(p_org uuid, p jsonb, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; v_mode text := coalesce(nullif(trim(p->>'mode'), ''), 'await'); v_day date; v_person uuid := nullif(p->>'person_id', '')::uuid; v_key text := nullif(trim(coalesce(p->>'key', '')), '');
        v_id uuid; v_pid uuid; v_dupes jsonb; v_wants boolean := case lower(coalesce(p->>'wants_followup', '')) when 'true' then true when 'false' then false else null end;
        v_existing uuid; v_resp uuid := nullif(p->>'responsible_id', '')::uuid; v_ph text; v_em text; v_dc jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.conv_can(p_org, 'register') then raise exception 'forbidden'; end if;
  if v_mode not in ('link','create','await') then raise exception 'invalid_mode'; end if;
  if v_key is not null then
    select id into v_existing from faith_decisions where org_id = p_org and op_key = v_key;
    if v_existing is not null then return jsonb_build_object('saved', true, 'id', v_existing, 'repeated', true); end if;
  end if;
  c := public.conv_clean(p);
  begin v_day := coalesce(nullif(p->>'decided_on', '')::date, public.conv_today()); exception when others then raise exception 'invalid_date'; end;
  if v_day > public.conv_today() or v_day < date '2000-01-01' then raise exception 'invalid_date'; end if;
  if v_mode in ('link','create') and not public.conv_can(p_org, 'link') then raise exception 'forbidden'; end if;
  if v_resp is not null and not (v_resp in (select public.conv_users(p_org, 'followup'))) then raise exception 'invalid_responsible'; end if;
  if v_resp is not null and not public.conv_can(p_org, 'assign') then raise exception 'forbidden'; end if;
  v_ph := c->>'phone'; v_em := c->>'email';

  if v_mode = 'link' then
    if v_person is null or not exists (select 1 from people where id = v_person and org_id = p_org and status in ('active','inactive','pending')) then raise exception 'person_not_found'; end if;
    v_pid := v_person;
    if exists (select 1 from faith_decisions where person_id = v_pid and decided_on = v_day and voided_at is null) and not p_force then raise exception 'duplicate_decision'; end if;
  elsif v_mode = 'create' then
    select public.convert_candidates(p_org, c->>'name', v_ph, v_em) into v_dupes;
    if jsonb_array_length(v_dupes) > 0 and not p_force then return jsonb_build_object('saved', false, 'candidates', v_dupes); end if;
    insert into people (org_id, full_name, phone, email, classification, status, source, registered_at, created_by, contact_consent, contact_consent_at, flagged_duplicate)
    values (p_org, c->>'name', case when c->>'consent' = 'authorized' then v_ph end, case when c->>'consent' = 'authorized' then v_em end, 'none', 'active', 'manual', v_day, auth.uid(),
            false, null, jsonb_array_length(v_dupes) > 0)
    returning id into v_pid;
    perform public.person_log(p_org, v_pid, 'create', null, null, 'none', 'cadastro criado a partir de uma decisão de fé');
  else
    if exists (select 1 from faith_decisions where org_id = p_org and person_id is null and voided_at is null and decided_on = v_day and public.conv_norm(display_name) = public.conv_norm(c->>'name')) and not p_force then
      raise exception 'duplicate_decision';
    end if;
  end if;

  insert into faith_decisions (org_id, person_id, display_name, decided_on, decided_time, place, origin, source, phone, email, contact_consent, consent_at, admin_note, wants_followup,
                               fu_status, responsible_id, assigned_at, assigned_by, registered_by, op_key, linked_at, linked_by)
  values (p_org, v_pid, c->>'name', v_day, nullif(c->>'time', '')::time, c->>'place', c->>'origin', 'admin', v_ph, v_em, c->>'consent', case when c->>'consent' <> 'unknown' then now() end, c->>'note', v_wants,
          case when v_wants is true then 'offered' when v_wants is false then 'declined' else 'registered' end,
          v_resp, case when v_resp is not null then now() end, case when v_resp is not null then auth.uid() end, auth.uid(), v_key,
          case when v_pid is not null then now() end, case when v_pid is not null then auth.uid() end)
  returning id into v_id;
  perform public.conv_log(v_id, p_org, 'register', jsonb_build_object('mode', v_mode, 'person_id', v_pid, 'decided_on', v_day));
  perform public.conv_history(v_id);
  if v_resp is not null and v_resp <> auth.uid() then
    perform public.notify_user(v_resp, p_org, 'convert', 'Você foi designado(a) para acompanhar uma nova decisão', null, '#/novos-convertidos/' || v_id, null);
  end if;
  if v_pid is null then perform public.conv_notify(p_org, 'link', 'Decisão de fé aguardando associação', 'Escolha a ficha da pessoa para concluir o registro.', '#/novos-convertidos');
  else perform public.conv_notify(p_org, 'view', 'Nova decisão de fé registrada', null, '#/novos-convertidos/' || v_id); end if;
  return jsonb_build_object('saved', true, 'id', v_id, 'person_id', v_pid);
end $$;

-- ---------------------------------------------------------------- associar uma decisão "aguardando" à ficha
create or replace function public.convert_link(p_id uuid, p_person uuid, p_create boolean default false, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d faith_decisions; v_pid uuid; v_dupes jsonb;
begin
  select * into d from faith_decisions where id = p_id and voided_at is null;
  if d.id is null then raise exception 'not_found'; end if;
  if not public.conv_can(d.org_id, 'link') then raise exception 'forbidden'; end if;
  if d.person_id is not null then raise exception 'already_linked'; end if;
  if coalesce(p_create, false) then
    select public.convert_candidates(d.org_id, d.display_name, d.phone, d.email) into v_dupes;
    if jsonb_array_length(v_dupes) > 0 and not coalesce(p_force, false) then return jsonb_build_object('saved', false, 'candidates', v_dupes); end if;
    insert into people (org_id, full_name, phone, email, classification, status, source, registered_at, created_by, flagged_duplicate)
    values (d.org_id, d.display_name, case when d.contact_consent = 'authorized' then d.phone end, case when d.contact_consent = 'authorized' then d.email end, 'none', 'active', 'manual', d.decided_on, auth.uid(), jsonb_array_length(v_dupes) > 0)
    returning id into v_pid;
    perform public.person_log(d.org_id, v_pid, 'create', null, null, 'none', 'cadastro criado a partir de uma decisão de fé');
  else
    if p_person is null or not exists (select 1 from people where id = p_person and org_id = d.org_id and status in ('active','inactive','pending')) then raise exception 'person_not_found'; end if;
    v_pid := p_person;
    if exists (select 1 from faith_decisions where person_id = v_pid and decided_on = d.decided_on and voided_at is null and id <> d.id) and not coalesce(p_force, false) then raise exception 'duplicate_decision'; end if;
  end if;
  update faith_decisions set person_id = v_pid, linked_at = now(), linked_by = auth.uid() where id = p_id;
  perform public.conv_log(p_id, d.org_id, 'link', jsonb_build_object('person_id', v_pid, 'created', coalesce(p_create, false)));
  perform public.conv_history(p_id);
  return jsonb_build_object('saved', true, 'person_id', v_pid);
end $$;

-- ---------------------------------------------------------------- correção das informações administrativas (guarda o valor anterior)
create or replace function public.convert_update(p_id uuid, p jsonb, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d faith_decisions; c jsonb; v_day date; v_ch jsonb := '{}'::jsonb; v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into d from faith_decisions where id = p_id and voided_at is null;
  if d.id is null then raise exception 'not_found'; end if;
  if not public.conv_can(d.org_id, 'edit') then raise exception 'forbidden'; end if;
  c := public.conv_clean(jsonb_build_object('name', coalesce(p->>'name', d.display_name), 'phone', case when p ? 'phone' then p->>'phone' else d.phone end,
        'email', case when p ? 'email' then p->>'email' else d.email end, 'place', case when p ? 'place' then p->>'place' else d.place end,
        'note', case when p ? 'note' then p->>'note' else d.admin_note end, 'origin', coalesce(p->>'origin', d.origin),
        'consent', coalesce(p->>'consent', d.contact_consent), 'time', case when p ? 'time' then p->>'time' else to_char(d.decided_time, 'HH24:MI') end));
  begin v_day := coalesce(nullif(p->>'decided_on', '')::date, d.decided_on); exception when others then raise exception 'invalid_date'; end;
  if v_day > public.conv_today() or v_day < date '2000-01-01' then raise exception 'invalid_date'; end if;
  if (v_day <> d.decided_on or (c->>'name') <> d.display_name) and v_reason is null then raise exception 'reason_required'; end if;
  if d.person_id is not null and v_day <> d.decided_on and exists (select 1 from faith_decisions where person_id = d.person_id and decided_on = v_day and voided_at is null and id <> d.id) then raise exception 'duplicate_decision'; end if;
  if (c->>'name') is distinct from d.display_name then v_ch := v_ch || jsonb_build_object('name', jsonb_build_array(d.display_name, c->>'name')); end if;
  if v_day <> d.decided_on then v_ch := v_ch || jsonb_build_object('decided_on', jsonb_build_array(d.decided_on, v_day)); end if;
  if (c->>'place') is distinct from d.place then v_ch := v_ch || jsonb_build_object('place', jsonb_build_array(d.place, c->>'place')); end if;
  if (c->>'origin') is distinct from d.origin then v_ch := v_ch || jsonb_build_object('origin', jsonb_build_array(d.origin, c->>'origin')); end if;
  if (c->>'consent') is distinct from d.contact_consent then v_ch := v_ch || jsonb_build_object('consent', jsonb_build_array(d.contact_consent, c->>'consent')); end if;
  if (c->>'note') is distinct from d.admin_note then v_ch := v_ch || jsonb_build_object('note', true); end if;
  if (c->>'phone') is distinct from d.phone or (c->>'email') is distinct from d.email then v_ch := v_ch || jsonb_build_object('contact', true); end if;
  if (c->>'time') is distinct from to_char(d.decided_time, 'HH24:MI') then v_ch := v_ch || jsonb_build_object('time', true); end if;
  if v_ch = '{}'::jsonb then return jsonb_build_object('saved', true, 'changed', false); end if;
  update faith_decisions set display_name = c->>'name', decided_on = v_day, decided_time = nullif(c->>'time', '')::time, place = c->>'place', origin = c->>'origin', phone = c->>'phone', email = c->>'email',
         contact_consent = c->>'consent', consent_at = case when (c->>'consent') is distinct from d.contact_consent then (case when c->>'consent' = 'unknown' then null else now() end) else d.consent_at end,
         admin_note = c->>'note', edited_at = now(), edited_by = auth.uid() where id = p_id;
  if d.person_id is not null then
    update person_history set occurred_on = v_day, description = trim(both ' ' from public.conv_origin_label(c->>'origin') || coalesce(' · ' || (c->>'place'), '')), edited_at = now(), edited_by = auth.uid()
     where person_id = d.person_id and op_key = 'dec:' || p_id;
  end if;
  perform public.conv_log(p_id, d.org_id, 'update', jsonb_build_object('changes', v_ch, 'reason', v_reason));
  return jsonb_build_object('saved', true, 'changed', true);
end $$;

-- ---------------------------------------------------------------- exclusão (restrita, justificada, auditada). Retifique preferencialmente.
create or replace function public.convert_void(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d faith_decisions; v_reason text := trim(coalesce(p_reason, ''));
begin
  select * into d from faith_decisions where id = p_id and voided_at is null;
  if d.id is null then raise exception 'not_found'; end if;
  if not public.conv_can(d.org_id, 'admin') then raise exception 'forbidden'; end if;
  if length(v_reason) < 5 then raise exception 'reason_required'; end if;
  if length(v_reason) > 500 then raise exception 'reason_too_long'; end if;
  update faith_decisions set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = p_id;
  if d.person_id is not null then
    update person_history set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where person_id = d.person_id and op_key = 'dec:' || p_id and voided_at is null;
  end if;
  perform public.conv_log(p_id, d.org_id, 'void', jsonb_build_object('reason', v_reason));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- lista com filtros e busca
create or replace function public.convert_list(p_org uuid, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_all boolean; v_q text := nullif(trim(coalesce(p->>'q', '')), ''); v_from date; v_to date; v_lim int := least(greatest(coalesce(nullif(p->>'limit', '')::int, 30), 1), 100); v_off int := greatest(coalesce(nullif(p->>'offset', '')::int, 0), 0);
        v_status text := nullif(p->>'status', ''); v_consent text := nullif(p->>'consent', ''); v_origin text := nullif(p->>'origin', ''); v_place text := nullif(trim(coalesce(p->>'place', '')), '');
        v_resp uuid := nullif(p->>'responsible', '')::uuid; v_nocontact boolean := coalesce((p->>'no_contact')::boolean, false); v_hl int; v_res jsonb; v_total int;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_all := public.conv_can(p_org, 'view');
  if not (v_all or public.conv_can(p_org, 'followup')) then raise exception 'forbidden'; end if;
  begin v_from := nullif(p->>'from', '')::date; v_to := nullif(p->>'to', '')::date; exception when others then raise exception 'invalid_date'; end;
  if v_status is not null and v_status not in ('awaiting','registered','offered','in_progress','suspended','ended','declined') then raise exception 'invalid_filter'; end if;
  if v_consent is not null and v_consent not in ('authorized','declined','unknown') then raise exception 'invalid_filter'; end if;
  select highlight_days into v_hl from convert_settings where org_id = p_org;

  with f as (
    select d.* from faith_decisions d left join people pe on pe.id = d.person_id
     where d.org_id = p_org and d.voided_at is null
       and (v_all or d.responsible_id = auth.uid())
       and (v_q is null or d.display_name ilike '%' || v_q || '%' or pe.full_name ilike '%' || v_q || '%')
       and (v_from is null or d.decided_on >= v_from) and (v_to is null or d.decided_on <= v_to)
       and (v_origin is null or d.origin = v_origin)
       and (v_place is null or d.place ilike '%' || v_place || '%')
       and (v_resp is null or d.responsible_id = v_resp)
       and (v_status is null or (v_status = 'awaiting' and d.person_id is null) or (v_status <> 'awaiting' and d.fu_status = v_status))
       and (v_consent is null or d.contact_consent = v_consent)
       and (not v_nocontact or (d.phone is null and d.email is null))
  ), pg as (select * from f order by decided_on desc, created_at desc offset v_off limit v_lim)
  select (select count(*) from f), coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id, 'name', g.display_name, 'person_id', g.person_id, 'photo_url', pe.photo_url, 'decided_on', g.decided_on, 'place', g.place, 'origin', g.origin, 'origin_label', public.conv_origin_label(g.origin),
      'source', g.source, 'responsible_id', g.responsible_id, 'responsible_name', case when g.responsible_id is null then null else coalesce(public.welcome_name(g.org_id, g.responsible_id), 'Usuário removido') end,
      'fu_status', g.fu_status, 'awaiting_link', g.person_id is null, 'consent', g.contact_consent, 'has_contact', (g.phone is not null or g.email is not null),
      'wants_followup', g.wants_followup, 'highlight', v_hl is not null and g.decided_on >= public.conv_today() - v_hl) order by g.decided_on desc, g.created_at desc), '[]'::jsonb)
    into v_total, v_res
    from pg g left join people pe on pe.id = g.person_id;
  return jsonb_build_object('items', v_res, 'total', v_total, 'scope', case when v_all then 'all' else 'mine' end,
                            'can_register', public.conv_can(p_org, 'register'), 'can_indicators', public.conv_can(p_org, 'indicators'), 'can_admin', public.conv_can(p_org, 'admin'));
end $$;

-- ---------------------------------------------------------------- indicadores (registros reais; cada decisão conta uma vez, pessoas distintas à parte)
create or replace function public.convert_indicators(p_org uuid, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_res jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.conv_can(p_org, 'indicators') then raise exception 'forbidden'; end if;
  with f as (select * from faith_decisions where org_id = p_org and voided_at is null and (p_from is null or decided_on >= p_from) and (p_to is null or decided_on <= p_to))
  select jsonb_build_object(
    'total', (select count(*) from f),
    'people', (select count(distinct person_id) from f where person_id is not null),
    'awaiting_link', (select count(*) from faith_decisions where org_id = p_org and voided_at is null and person_id is null),
    'followup_accepted', (select count(*) from f where wants_followup is true or fu_status in ('in_progress','suspended','ended')),
    'no_contact', (select count(*) from f where phone is null and email is null),
    'by_month', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'n', n) order by m) from (select to_char(decided_on, 'YYYY-MM') m, count(*) n from f group by 1) x), '[]'::jsonb),
    'by_origin', coalesce((select jsonb_agg(jsonb_build_object('origin', origin, 'label', public.conv_origin_label(origin), 'n', n) order by n desc) from (select origin, count(*) n from f group by 1) x), '[]'::jsonb),
    'by_status', coalesce((select jsonb_agg(jsonb_build_object('status', s, 'n', n) order by n desc) from (select fu_status s, count(*) n from f group by 1) x), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;

-- ---------------------------------------------------------------- detalhe
create or replace function public.convert_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d faith_decisions; v_all boolean; v_mine boolean; v_pe people; v_entries jsonb; v_log jsonb; v_auth boolean; v_fu boolean;
begin
  select * into d from faith_decisions where id = p_id and voided_at is null;
  if d.id is null then raise exception 'not_found'; end if;
  v_all := public.conv_can(d.org_id, 'view'); v_mine := coalesce(d.responsible_id = auth.uid(), false) and public.conv_can(d.org_id, 'followup');
  if not (v_all or v_mine) then raise exception 'forbidden'; end if;
  v_auth := d.contact_consent = 'authorized';
  v_fu := public.conv_can(d.org_id, 'followup') and (coalesce(d.responsible_id = auth.uid(), false) or public.conv_can(d.org_id, 'assign') or public.conv_can(d.org_id, 'admin'));
  select * into v_pe from people where id = d.person_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'occurred_on', e.occurred_on, 'channel', e.channel, 'body', e.body,
           'by', coalesce(public.welcome_name(e.org_id, e.created_by), 'Usuário removido'), 'at', e.created_at) order by e.occurred_on desc, e.id desc), '[]'::jsonb) into v_entries
    from (select * from faith_followup_entries where decision_id = p_id order by occurred_on desc, id desc limit 100) e;
  if public.conv_can(d.org_id, 'admin') or public.conv_can(d.org_id, 'view') then
    select coalesce(jsonb_agg(jsonb_build_object('action', l.action, 'detail', l.detail, 'at', l.at, 'by', case when l.actor is null then 'Sistema' else coalesce(public.welcome_name(l.org_id, l.actor), 'Usuário removido') end) order by l.at desc, l.id desc), '[]'::jsonb) into v_log
      from (select * from faith_decision_log where decision_id = p_id order by at desc, id desc limit 60) l;
  else v_log := '[]'::jsonb; end if;
  return jsonb_build_object(
    'id', d.id, 'org_id', d.org_id, 'name', d.display_name, 'decided_on', d.decided_on, 'time', to_char(d.decided_time, 'HH24:MI'), 'place', d.place, 'origin', d.origin, 'origin_label', public.conv_origin_label(d.origin),
    'source', d.source, 'consent', d.contact_consent, 'consent_at', d.consent_at, 'has_contact', (d.phone is not null or d.email is not null),
    'phone', case when v_auth then d.phone end, 'email', case when v_auth then d.email end,
    'admin_note', d.admin_note, 'wants_followup', d.wants_followup, 'fu_status', d.fu_status, 'awaiting_link', d.person_id is null,
    'responsible_id', d.responsible_id, 'responsible_name', case when d.responsible_id is null then null else coalesce(public.welcome_name(d.org_id, d.responsible_id), 'Usuário removido') end, 'assigned_at', d.assigned_at,
    'registered_by', case when d.registered_by is null then null else coalesce(public.welcome_name(d.org_id, d.registered_by), 'Usuário removido') end, 'created_at', d.created_at, 'edited_at', d.edited_at,
    'person', case when v_pe.id is null then null else jsonb_build_object('id', v_pe.id, 'full_name', v_pe.full_name, 'classification', v_pe.classification, 'photo_url', v_pe.photo_url, 'has_account', v_pe.user_id is not null,
                 'can_open', public.people_scope_all(d.org_id) and public.has_people_perm(d.org_id, 'people_view')) end,
    'others', (select count(*) from faith_decisions o where o.person_id = d.person_id and o.id <> d.id and o.voided_at is null and d.person_id is not null),
    'entries', v_entries, 'log', v_log,
    'can_edit', public.conv_can(d.org_id, 'edit'), 'can_link', public.conv_can(d.org_id, 'link'), 'can_assign', public.conv_can(d.org_id, 'assign'),
    'can_followup', v_fu, 'can_void', public.conv_can(d.org_id, 'admin'));
end $$;

-- decisões de uma ficha (seção "Decisão de fé" na ficha; só quem vê convertidos)
create or replace function public.convert_for_person(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from people where id = p_person;
  if pe.id is null then raise exception 'not_found'; end if;
  if not public.conv_can(pe.org_id, 'view') then return jsonb_build_object('allowed', false, 'items', '[]'::jsonb); end if;
  return jsonb_build_object('allowed', true, 'can_register', public.conv_can(pe.org_id, 'register') and public.conv_can(pe.org_id, 'link'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'decided_on', d.decided_on, 'place', d.place, 'origin_label', public.conv_origin_label(d.origin), 'fu_status', d.fu_status,
                  'consent', d.contact_consent, 'responsible_name', case when d.responsible_id is null then null else coalesce(public.welcome_name(d.org_id, d.responsible_id), 'Usuário removido') end) order by d.decided_on desc)
                  from faith_decisions d where d.person_id = p_person and d.voided_at is null), '[]'::jsonb));
end $$;

create or replace function public.convert_responsibles(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.conv_can(p_org, 'assign') or public.conv_can(p_org, 'register')) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', u, 'name', coalesce(public.welcome_name(p_org, u), 'Sem nome')) order by coalesce(public.welcome_name(p_org, u), '')) from (select distinct public.conv_users(p_org, 'followup') u) x
                   where exists (select 1 from org_members where org_id = p_org and user_id = x.u)), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- responsável e acompanhamento
create or replace function public.convert_assign(p_id uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d faith_decisions;
begin
  select * into d from faith_decisions where id = p_id and voided_at is null;
  if d.id is null then raise exception 'not_found'; end if;
  if not public.conv_can(d.org_id, 'assign') then raise exception 'forbidden'; end if;
  if p_user is not null and not (p_user in (select public.conv_users(d.org_id, 'followup'))) then raise exception 'invalid_responsible'; end if;
  if p_user is not distinct from d.responsible_id then return jsonb_build_object('ok', true, 'changed', false); end if;
  update faith_decisions set responsible_id = p_user, assigned_at = case when p_user is null then null else now() end, assigned_by = case when p_user is null then null else auth.uid() end where id = p_id;
  perform public.conv_log(p_id, d.org_id, case when p_user is null then 'unassign' else 'assign' end, jsonb_build_object('from', d.responsible_id, 'to', p_user));
  if p_user is not null and p_user <> auth.uid() then
    perform public.notify_user(p_user, d.org_id, 'convert', 'Você foi designado(a) para acompanhar uma nova decisão', null, '#/novos-convertidos/' || p_id, null);
  end if;
  return jsonb_build_object('ok', true, 'changed', true);
end $$;

create or replace function public.convert_followup_status(p_id uuid, p_action text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d faith_decisions; v_new text; v_wants boolean;
begin
  select * into d from faith_decisions where id = p_id and voided_at is null;
  if d.id is null then raise exception 'not_found'; end if;
  if not (public.conv_can(d.org_id, 'followup') and (coalesce(d.responsible_id = auth.uid(), false) or public.conv_can(d.org_id, 'assign') or public.conv_can(d.org_id, 'admin'))) then raise exception 'forbidden'; end if;
  if length(coalesce(p_note, '')) > 300 then raise exception 'note_too_long'; end if;
  v_new := case p_action when 'offer' then 'offered' when 'start' then 'in_progress' when 'resume' then 'in_progress' when 'suspend' then 'suspended' when 'end' then 'ended' when 'decline' then 'declined' else null end;
  if v_new is null then raise exception 'invalid_action'; end if;
  if v_new = d.fu_status then return jsonb_build_object('ok', true, 'changed', false); end if;
  v_wants := case when v_new = 'declined' then false when v_new in ('in_progress') then true else d.wants_followup end;
  update faith_decisions set fu_status = v_new, wants_followup = v_wants where id = p_id;
  perform public.conv_log(p_id, d.org_id, 'status', jsonb_build_object('from', d.fu_status, 'to', v_new, 'note', nullif(trim(coalesce(p_note, '')), '')));
  return jsonb_build_object('ok', true, 'changed', true, 'fu_status', v_new);
end $$;

create or replace function public.convert_entry_add(p_id uuid, p_kind text, p_body text, p_on date default null, p_channel text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d faith_decisions; v_body text := trim(coalesce(p_body, '')); v_day date := coalesce(p_on, public.conv_today()); v_ch text := nullif(trim(coalesce(p_channel, '')), '');
begin
  select * into d from faith_decisions where id = p_id and voided_at is null;
  if d.id is null then raise exception 'not_found'; end if;
  if not (public.conv_can(d.org_id, 'followup') and (coalesce(d.responsible_id = auth.uid(), false) or public.conv_can(d.org_id, 'assign') or public.conv_can(d.org_id, 'admin'))) then raise exception 'forbidden'; end if;
  if p_kind not in ('contact','note','interest','referral') then raise exception 'invalid_kind'; end if;
  if length(v_body) < 1 then raise exception 'body_required'; end if;
  if length(v_body) > 1000 then raise exception 'body_too_long'; end if;
  if v_day > public.conv_today() or v_day < d.decided_on then raise exception 'invalid_date'; end if;
  if v_ch is not null and v_ch not in ('whatsapp','phone','email','presencial','outro') then raise exception 'invalid_channel'; end if;
  if p_kind = 'contact' then
    if d.contact_consent <> 'authorized' then raise exception 'contact_not_authorized'; end if;
    if d.fu_status = 'declined' then raise exception 'followup_declined'; end if;
  else v_ch := null; end if;
  insert into faith_followup_entries (decision_id, org_id, kind, occurred_on, channel, body, created_by) values (p_id, d.org_id, p_kind, v_day, v_ch, v_body, auth.uid());
  perform public.conv_log(p_id, d.org_id, 'entry', jsonb_build_object('kind', p_kind));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- configurações (formulário por link e destaque opcional)
create or replace function public.convert_settings_get(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s convert_settings;
begin
  if not public.conv_can(p_org, 'admin') then raise exception 'forbidden'; end if;
  insert into convert_settings (org_id) values (p_org) on conflict do nothing;
  select * into s from convert_settings where org_id = p_org;
  return jsonb_build_object('form_token', s.form_token, 'form_active', s.form_active, 'form_title', s.form_title, 'highlight_days', s.highlight_days);
end $$;
create or replace function public.convert_settings_save(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s convert_settings; v_title text; v_hl int;
begin
  if not public.conv_can(p_org, 'admin') then raise exception 'forbidden'; end if;
  insert into convert_settings (org_id) values (p_org) on conflict do nothing;
  select * into s from convert_settings where org_id = p_org;
  v_title := coalesce(nullif(trim(p->>'form_title'), ''), s.form_title);
  if length(v_title) > 120 then raise exception 'title_too_long'; end if;
  if p ? 'highlight_days' then
    v_hl := nullif(p->>'highlight_days', '')::int;
    if v_hl is not null and (v_hl < 1 or v_hl > 365) then raise exception 'invalid_highlight'; end if;
  else v_hl := s.highlight_days; end if;
  update convert_settings set form_title = v_title, highlight_days = v_hl,
         form_active = coalesce((p->>'form_active')::boolean, form_active),
         form_token = case when coalesce((p->>'rotate')::boolean, false) then replace(gen_random_uuid()::text, '-', '') else form_token end, updated_at = now() where org_id = p_org;
  perform public.conv_log(p_org, p_org, 'settings', jsonb_build_object('form_active', p->>'form_active', 'rotate', p->>'rotate', 'highlight_days', v_hl));
  return public.convert_settings_get(p_org);
end $$;

-- ---------------------------------------------------------------- formulário público (sem login; não devolve nada sobre quem já existe)
create or replace function public.convert_public_get(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('title', s.form_title, 'org_name', o.name, 'org_subtitle', o.subtitle, 'logo_url', o.logo_url)
    from convert_settings s join organizations o on o.id = s.org_id where s.form_token = p_token and s.form_active
$$;
create or replace function public.convert_public_submit(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s convert_settings; c jsonb; v_day date; v_recent int; v_wants boolean := case lower(coalesce(p->>'wants_followup', '')) when 'true' then true else null end; v_origin text; v_id uuid;
begin
  select * into s from convert_settings where form_token = p_token and form_active;
  if s.org_id is null then raise exception 'form_closed'; end if;
  if nullif(trim(coalesce(p->>'website', '')), '') is not null then return jsonb_build_object('ok', true); end if;   -- robô: finge sucesso
  select count(*) into v_recent from faith_decisions where org_id = s.org_id and source = 'public_form' and created_at > now() - interval '10 minutes';
  if v_recent >= 40 then raise exception 'too_many_requests'; end if;
  v_origin := case when p->>'origin' in ('culto','celula','evento','transmissao','outro') then p->>'origin' else 'outro' end;
  c := public.conv_clean(jsonb_build_object('name', p->>'name', 'phone', p->>'phone', 'email', p->>'email', 'place', p->>'place', 'origin', v_origin, 'consent', coalesce(p->>'consent', 'unknown')));
  begin v_day := coalesce(nullif(p->>'decided_on', '')::date, public.conv_today()); exception when others then raise exception 'invalid_date'; end;
  if v_day > public.conv_today() or v_day < public.conv_today() - 60 then raise exception 'invalid_date'; end if;
  if exists (select 1 from faith_decisions where org_id = s.org_id and source = 'public_form' and decided_on = v_day and public.conv_norm(display_name) = public.conv_norm(c->>'name') and voided_at is null) then
    return jsonb_build_object('ok', true);      -- repetição do mesmo envio: não duplica e não revela nada
  end if;
  insert into faith_decisions (org_id, display_name, decided_on, place, origin, source, phone, email, contact_consent, consent_at, wants_followup, fu_status)
  values (s.org_id, c->>'name', v_day, c->>'place', c->>'origin', 'public_form', c->>'phone', c->>'email', c->>'consent', case when c->>'consent' <> 'unknown' then now() end, v_wants,
          case when v_wants is true then 'offered' else 'registered' end)
  returning id into v_id;
  perform public.conv_log(v_id, s.org_id, 'register', jsonb_build_object('mode', 'public_form'));
  perform public.conv_notify(s.org_id, 'link', 'Decisão de fé aguardando associação', 'Recebida pelo formulário. Escolha a ficha da pessoa para concluir o registro.', '#/novos-convertidos');
  if v_wants is true then perform public.conv_notify(s.org_id, 'assign', 'Uma pessoa pediu acompanhamento', null, '#/novos-convertidos/' || v_id); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- formulário dentro do app (usuário logado)
create or replace function public.convert_self_get(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  select * into pe from people where org_id = p_org and user_id = auth.uid() and status in ('active','inactive','pending') order by created_at limit 1;
  return jsonb_build_object('person', case when pe.id is null then null else jsonb_build_object('id', pe.id, 'full_name', pe.full_name) end,
                            'name', coalesce(pe.full_name, public.welcome_name(p_org, auth.uid())));
end $$;
create or replace function public.convert_self_submit(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people; c jsonb; v_day date; v_origin text; v_wants boolean := case lower(coalesce(p->>'wants_followup', '')) when 'true' then true else null end; v_id uuid; v_ex uuid; v_name text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  select * into pe from people where org_id = p_org and user_id = auth.uid() and status in ('active','inactive','pending') order by created_at limit 1;
  if pe.id is not null and not coalesce((p->>'confirm_identity')::boolean, false) then raise exception 'confirm_identity'; end if;
  v_name := coalesce(pe.full_name, nullif(trim(coalesce(p->>'name', '')), ''), public.welcome_name(p_org, auth.uid()));
  v_origin := case when p->>'origin' in ('culto','celula','evento','transmissao','outro') then p->>'origin' else 'outro' end;
  c := public.conv_clean(jsonb_build_object('name', v_name, 'phone', p->>'phone', 'email', p->>'email', 'place', p->>'place', 'origin', v_origin, 'consent', coalesce(p->>'consent', 'unknown')));
  begin v_day := coalesce(nullif(p->>'decided_on', '')::date, public.conv_today()); exception when others then raise exception 'invalid_date'; end;
  if v_day > public.conv_today() or v_day < public.conv_today() - 365 then raise exception 'invalid_date'; end if;
  select id into v_ex from faith_decisions where org_id = p_org and voided_at is null and decided_on = v_day and ((pe.id is not null and person_id = pe.id) or self_user = auth.uid()) limit 1;
  if v_ex is not null then return jsonb_build_object('ok', true, 'repeated', true); end if;
  insert into faith_decisions (org_id, person_id, display_name, decided_on, place, origin, source, phone, email, contact_consent, consent_at, wants_followup, fu_status, self_user, registered_by, linked_at, linked_by)
  values (p_org, pe.id, c->>'name', v_day, c->>'place', c->>'origin', 'app', c->>'phone', c->>'email', c->>'consent', case when c->>'consent' <> 'unknown' then now() end, v_wants,
          case when v_wants is true then 'offered' else 'registered' end, auth.uid(), auth.uid(), case when pe.id is not null then now() end, case when pe.id is not null then auth.uid() end)
  returning id into v_id;
  perform public.conv_log(v_id, p_org, 'register', jsonb_build_object('mode', 'app', 'person_id', pe.id));
  perform public.conv_history(v_id);
  if pe.id is null then perform public.conv_notify(p_org, 'link', 'Decisão de fé aguardando associação', 'Registrada pela própria pessoa no app. Escolha a ficha para concluir.', '#/novos-convertidos');
  else perform public.conv_notify(p_org, 'view', 'Nova decisão de fé registrada', null, '#/novos-convertidos/' || v_id); end if;
  if v_wants is true then perform public.conv_notify(p_org, 'assign', 'Uma pessoa pediu acompanhamento', null, '#/novos-convertidos/' || v_id); end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ---------------------------------------------------------------- permissões de execução
revoke execute on function
  public.convert_candidates(uuid, text, text, text), public.convert_register(uuid, jsonb, boolean), public.convert_link(uuid, uuid, boolean, boolean), public.convert_update(uuid, jsonb, text),
  public.convert_void(uuid, text), public.convert_list(uuid, jsonb), public.convert_indicators(uuid, date, date), public.convert_get(uuid), public.convert_for_person(uuid),
  public.convert_responsibles(uuid), public.convert_assign(uuid, uuid), public.convert_followup_status(uuid, text, text), public.convert_entry_add(uuid, text, text, date, text),
  public.convert_settings_get(uuid), public.convert_settings_save(uuid, jsonb), public.convert_public_get(text), public.convert_public_submit(text, jsonb),
  public.convert_self_get(uuid), public.convert_self_submit(uuid, jsonb) from public, anon;
grant execute on function
  public.convert_candidates(uuid, text, text, text), public.convert_register(uuid, jsonb, boolean), public.convert_link(uuid, uuid, boolean, boolean), public.convert_update(uuid, jsonb, text),
  public.convert_void(uuid, text), public.convert_list(uuid, jsonb), public.convert_indicators(uuid, date, date), public.convert_get(uuid), public.convert_for_person(uuid),
  public.convert_responsibles(uuid), public.convert_assign(uuid, uuid), public.convert_followup_status(uuid, text, text), public.convert_entry_add(uuid, text, text, date, text),
  public.convert_settings_get(uuid), public.convert_settings_save(uuid, jsonb), public.convert_self_get(uuid), public.convert_self_submit(uuid, jsonb) to authenticated;
grant execute on function public.convert_public_get(text), public.convert_public_submit(text, jsonb) to anon, authenticated;

-- Conferência (retorna true):
--   select to_regclass('public.faith_decisions') is not null
--      and to_regprocedure('public.convert_register(uuid,jsonb,boolean)') is not null
--      and to_regprocedure('public.convert_public_submit(text,jsonb)') is not null
--      and 'people_converts_view' = any (public.all_actions()) as ok;
