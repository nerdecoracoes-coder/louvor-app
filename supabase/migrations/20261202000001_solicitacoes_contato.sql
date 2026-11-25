-- =====================================================================
-- SOMOS Recurso 09: Solicitações de contato
-- A pessoa pede contato pelo app (ou por um link público); a equipe recebe, encaminha, registra interações e conclui.
--  * categorias, textos e consentimento são configuráveis (nada fixo na tela); categorias iniciais criadas uma única vez por igreja;
--  * solicitação não é atendimento pastoral: iniciar o acompanhamento só cria um vínculo no registro pastoral existente (person_care), sem copiar a mensagem;
--  * permissões próprias (people_contacts_*), sempre validadas no servidor; participar de time não dá acesso; observações confidenciais exigem permissão específica;
--  * histórico administrativo (contact_log) separado das observações confidenciais; a ficha só mostra o fato (categoria e código), nunca a mensagem;
--  * envio duplicado não cria outra solicitação (chave do envio e janela de 10 minutos); sem lembretes nem cobranças automáticas;
--  * avisos pelo sistema de notificações existente, sem conteúdo da mensagem; nenhum envio externo (WhatsApp, SMS, e-mail) é feito aqui.
-- =====================================================================

-- ---------------------------------------------------------------- permissões novas
alter table public.access_grants drop constraint if exists access_grants_actions_check;
alter table public.access_grants add constraint access_grants_actions_check check (
  actions <@ array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
                   'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin',
                   'people_journeys_admin','people_journeys_participants','people_journeys_follow','people_journeys_approve','people_journeys_indicators','people_contacts_view','people_contacts_assigned','people_contacts_manage','people_contacts_assign','people_contacts_confidential','people_contacts_categories','people_contacts_reopen','people_contacts_cancel','people_contacts_admin']::text[]);
create or replace function public.all_actions() returns text[] language sql immutable as $$
  select array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
               'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin',
               'people_journeys_admin','people_journeys_participants','people_journeys_follow','people_journeys_approve','people_journeys_indicators','people_contacts_view','people_contacts_assigned','people_contacts_manage','people_contacts_assign','people_contacts_confidential','people_contacts_categories','people_contacts_reopen','people_contacts_cancel','people_contacts_admin']::text[]
$$;
create or replace function public.people_actions(p_org uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
      then array['people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
                 'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin',
                 'people_journeys_admin','people_journeys_participants','people_journeys_follow','people_journeys_approve','people_journeys_indicators','people_contacts_view','people_contacts_assigned','people_contacts_manage','people_contacts_assign','people_contacts_confidential','people_contacts_categories','people_contacts_reopen','people_contacts_cancel','people_contacts_admin']
    else coalesce((select array_agg(distinct a) from access_grants g, unnest(g.actions) a
                   where g.org_id = p_org and g.user_id = auth.uid() and a like 'people\_%'), '{}'::text[]) end
$$;

-- ---------------------------------------------------------------- utilitários de permissão
-- 'admin' do módulo vale para tudo, menos observações confidenciais (essas só com a permissão específica)
create or replace function public.ct_can(p_org uuid, p_mode text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from unnest(public.people_actions(p_org)) a where a = 'people_contacts_' || p_mode or (a = 'people_contacts_admin' and p_mode <> 'confidential'))
$$;
create or replace function public.ct_users(p_org uuid, p_mode text) returns setof uuid
language sql stable security definer set search_path = public as $$
  select om.user_id from org_members om where om.org_id = p_org and om.role = 'admin'
  union
  select g.user_id from access_grants g where g.org_id = p_org and ('people_contacts_' || p_mode = any (g.actions) or ('people_contacts_admin' = any (g.actions) and p_mode <> 'confidential'))
$$;
-- escopo: 'all' (vê todas), 'assigned' (só as atribuídas a ele) ou 'none'
create or replace function public.ct_scope(p_org uuid, p_responsible uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when public.ct_can(p_org, 'view') then 'all'
              when public.ct_can(p_org, 'assigned') and coalesce(p_responsible = auth.uid(), false) then 'assigned' else 'none' end
$$;
revoke execute on function public.ct_can(uuid, text), public.ct_users(uuid, text), public.ct_scope(uuid, uuid) from public, anon;
grant execute on function public.ct_can(uuid, text), public.ct_scope(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- tabelas
create sequence if not exists public.contact_code_seq;
create table if not exists public.contact_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  seeded boolean not null default false,
  intro_text text not null default 'Estamos aqui para caminhar com você. Se deseja conversar, precisa de orientação ou gostaria de receber informações sobre nossa igreja, envie sua solicitação. Nossa equipe terá alegria em entrar em contato.' check (length(intro_text) between 1 and 1000),
  consent_text text not null default 'Autorizo a igreja a usar os dados informados apenas para responder a esta solicitação de contato.' check (length(consent_text) between 1 and 600),
  consent_version int not null default 1,
  consent_purpose text not null default 'Responder à solicitação de contato' check (length(consent_purpose) between 1 and 200),
  other_channel text check (other_channel is null or length(trim(other_channel)) between 1 and 60),
  form_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  form_active boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists public.contact_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  description text check (description is null or length(description) <= 300),
  active boolean not null default true,
  position int not null default 0,
  default_team_id uuid references public.teams(id) on delete set null,
  default_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists contact_categories_org on public.contact_categories (org_id, position);
create table if not exists public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null unique default ('CT-' || lpad(nextval('public.contact_code_seq')::text, 5, '0')),
  person_id uuid references public.people(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 160),
  phone text check (phone is null or length(phone) <= 30),
  email text check (email is null or (length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  category_id uuid references public.contact_categories(id) on delete set null,
  category_name text not null,
  message text not null check (length(trim(message)) between 1 and 2000),
  pref_channel text not null check (pref_channel in ('whatsapp','call','email','other')),
  pref_other text check (pref_other is null or length(pref_other) <= 60),
  consent_at timestamptz not null default now(),
  consent_version int not null,
  consent_purpose text not null,
  status text not null default 'received' check (status in ('received','review','forwarded','in_progress','waiting','completed','cancelled')),
  responsible_id uuid references auth.users(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  source text not null default 'app' check (source in ('app','public_form','admin')),
  op_key text,
  notify_requester boolean not null default true,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
  completed_at timestamptz,
  care_at timestamptz,
  linked_at timestamptz,
  linked_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists contact_requests_opkey on public.contact_requests (org_id, op_key) where op_key is not null;
create index if not exists contact_requests_org on public.contact_requests (org_id, created_at desc);
create index if not exists contact_requests_person on public.contact_requests (person_id) where person_id is not null;
create index if not exists contact_requests_user on public.contact_requests (user_id) where user_id is not null;
create index if not exists contact_requests_resp on public.contact_requests (responsible_id) where responsible_id is not null;
create table if not exists public.contact_log (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.contact_requests(id) on delete cascade,
  org_id uuid not null,
  actor uuid references auth.users(id) on delete set null,
  action text not null,
  from_status text,
  to_status text,
  detail jsonb not null default '{}'::jsonb,
  restricted boolean not null default false,
  at timestamptz not null default now()
);
create index if not exists contact_log_req on public.contact_log (request_id, at desc);
create table if not exists public.contact_interactions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.contact_requests(id) on delete cascade,
  org_id uuid not null,
  kind text not null check (kind in ('call','message','in_person','email','attempt','reply','other')),
  description text not null check (length(trim(description)) between 1 and 2000),
  result text check (result is null or length(result) <= 500),
  occurred_at timestamptz not null default now(),
  author uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists contact_interactions_req on public.contact_interactions (request_id, occurred_at desc);
create table if not exists public.contact_notes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.contact_requests(id) on delete cascade,
  org_id uuid not null,
  body text not null check (length(trim(body)) between 1 and 4000),
  author uuid references auth.users(id) on delete set null,
  access text not null default 'confidential' check (access = 'confidential'),
  created_at timestamptz not null default now()
);
create index if not exists contact_notes_req on public.contact_notes (request_id, created_at desc);
alter table public.contact_settings enable row level security;
alter table public.contact_categories enable row level security;
alter table public.contact_requests enable row level security;
alter table public.contact_log enable row level security;
alter table public.contact_interactions enable row level security;
alter table public.contact_notes enable row level security;
revoke all on public.contact_settings, public.contact_categories, public.contact_requests, public.contact_log, public.contact_interactions, public.contact_notes from anon, authenticated;

insert into public.history_categories (org_id, key, label, manual, sort) values (null, 'contato', 'Solicitações de contato', false, 48)
  on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), key) do nothing;

-- ---------------------------------------------------------------- linha do tempo: solicitação só para quem pode ver solicitações
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
       and (h.kind <> 'contact' or public.ct_can(pe.org_id, 'view'))
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
      'title', case when pg.n > 1 then 'Dados pessoais atualizados' else case when b.restricted and not v_detail and b.kind not in ('decision','contact') then case b.kind when 'guardian' then 'Responsável legal atualizado' else 'Vida familiar atualizada' end else b.title end end,
      'description', case when pg.n > 1 then (select string_agg(distinct public.history_field_label(g2.field), ', ') from base g2 where g2.gk = pg.gk)
                          when b.restricted and not v_detail and b.kind not in ('decision','contact') then null else b.description end,
      'occurred_on', b.occurred_on, 'at', b.at, 'origin', b.origin, 'kind', b.kind,
      'by', case when b.actor is null then 'Sistema' else coalesce(public.welcome_name(b.org_id, b.actor), 'Usuário removido') end, 'by_id', b.actor,
      'edited', b.edited_at is not null, 'edited_at', b.edited_at,
      'notes', case when b.origin = 'manual' then b.meta->>'notes' end,
      'restricted', b.restricted and not v_detail and b.kind not in ('decision','contact'), 'op_id', b.op_id,
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
create or replace function public.ct_norm(p text) returns text language sql immutable as $$
  select lower(regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g'))
$$;
-- configurações e categorias iniciais (criadas uma única vez por igreja; depois são da igreja)
create or replace function public.ct_ensure(p_org uuid) returns contact_settings
language plpgsql security definer set search_path = public as $$
declare s contact_settings;
begin
  insert into contact_settings (org_id) values (p_org) on conflict (org_id) do nothing;
  select * into s from contact_settings where org_id = p_org for update;
  if not s.seeded then
    insert into contact_categories (org_id, name, position)
    select p_org, n, row_number() over ()::int from unnest(array['Conversar com um pastor','Orientação espiritual','Aconselhamento familiar','Dificuldades pessoais','Informações sobre a igreja','Quero participar de um ministério','Quero conhecer melhor a igreja','Outros assuntos']) n;
    update contact_settings set seeded = true where org_id = p_org returning * into s;
  end if;
  return s;
end $$;
create or replace function public.ct_log(p_req uuid, p_org uuid, p_action text, p_from text default null, p_to text default null, p_detail jsonb default '{}'::jsonb, p_restricted boolean default false) returns void
language sql security definer set search_path = public as $$
  insert into contact_log (request_id, org_id, actor, action, from_status, to_status, detail, restricted) values (p_req, p_org, auth.uid(), p_action, p_from, p_to, coalesce(p_detail, '{}'::jsonb), p_restricted)
$$;
-- avisos genéricos (nunca levam o conteúdo da mensagem)
create or replace function public.ct_notify(p_org uuid, p_mode text, p_title text, p_link text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select distinct x from public.ct_users(p_org, p_mode) x where x is distinct from auth.uid() loop
    perform public.notify_user(u, p_org, 'contact', p_title, null, p_link, null);
  end loop;
end $$;
-- acontecimento na linha do tempo da pessoa (restrito; só quem vê solicitações)
create or replace function public.ct_history(p_req uuid, p_title text, p_desc text, p_key text) returns void
language plpgsql security definer set search_path = public as $$
declare r contact_requests;
begin
  select * into r from contact_requests where id = p_req;
  if r.id is null or r.person_id is null then return; end if;
  insert into person_history (org_id, person_id, actor, kind, field, old_value, new_value, note, category, title, description, restricted, occurred_on, origin, op_id, op_key, meta)
  values (r.org_id, r.person_id, auth.uid(), 'contact', null, null, null, null, 'contato', p_title, p_desc, true, case when p_key = 'new' then (r.created_at at time zone 'America/Sao_Paulo')::date else (now() at time zone 'America/Sao_Paulo')::date end, 'auto', txid_current()::text, 'ct:' || p_req || ':' || p_key, jsonb_build_object('request_id', p_req))
  on conflict (person_id, op_key) where op_key is not null do nothing;
end $$;
create or replace function public.ct_eligible(p_org uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user is not null and (p_user in (select public.ct_users(p_org, 'manage')) or p_user in (select public.ct_users(p_org, 'assigned')))
$$;
create or replace function public.ct_status_label(p text) returns text language sql immutable as $$
  select case p when 'received' then 'Recebida' when 'review' then 'Em análise' when 'forwarded' then 'Encaminhada' when 'in_progress' then 'Em atendimento' when 'waiting' then 'Aguardando retorno' when 'completed' then 'Concluída' when 'cancelled' then 'Cancelada' else p end
$$;
-- transições permitidas (reabrir é tratado à parte)
create or replace function public.ct_next(p text) returns text[] language sql immutable as $$
  select case p
    when 'received' then array['review','forwarded','in_progress','waiting','completed','cancelled']
    when 'review' then array['forwarded','in_progress','waiting','completed','cancelled']
    when 'forwarded' then array['review','in_progress','waiting','completed','cancelled']
    when 'in_progress' then array['forwarded','waiting','completed','cancelled']
    when 'waiting' then array['forwarded','in_progress','completed','cancelled']
    else array[]::text[] end
$$;
revoke execute on function public.ct_norm(text), public.ct_ensure(uuid), public.ct_log(uuid, uuid, text, text, text, jsonb, boolean), public.ct_notify(uuid, text, text, text), public.ct_history(uuid, text, text, text),
  public.ct_eligible(uuid, uuid), public.ct_status_label(text), public.ct_next(text) from public, anon, authenticated;

-- valida e normaliza o envio
create or replace function public.ct_clean(p jsonb, p_other text) returns jsonb
language plpgsql immutable as $$
declare v_name text := trim(coalesce(p->>'name', '')); v_phone text := nullif(trim(coalesce(p->>'phone', '')), ''); v_email text := nullif(lower(trim(coalesce(p->>'email', ''))), '');
        v_msg text := trim(coalesce(p->>'message', '')); v_pref text := coalesce(nullif(trim(p->>'pref'), ''), 'whatsapp'); v_po text := nullif(trim(coalesce(p->>'pref_other', '')), '');
        v_key text := nullif(trim(coalesce(p->>'key', '')), ''); v_d text; v_cat uuid;
begin
  if length(v_name) < 1 then raise exception 'name_required'; end if;
  if length(v_name) > 160 then raise exception 'name_too_long'; end if;
  if v_phone is not null then v_d := public.digits(v_phone); if v_d is null or length(v_d) < 8 or length(v_d) > 15 or length(v_phone) > 30 then raise exception 'invalid_phone'; end if; end if;
  if v_email is not null and (length(v_email) > 200 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'invalid_email'; end if;
  if v_phone is null and v_email is null and v_po is null then raise exception 'contact_required'; end if;
  if v_pref not in ('whatsapp','call','email','other') then raise exception 'invalid_pref'; end if;
  if v_pref in ('whatsapp','call') and v_phone is null then raise exception 'pref_needs_phone'; end if;
  if v_pref = 'email' and v_email is null then raise exception 'pref_needs_email'; end if;
  if v_pref = 'other' and (p_other is null or v_po is null) then raise exception 'pref_other_required'; end if;
  if v_po is not null and length(v_po) > 60 then raise exception 'pref_other_required'; end if;
  if length(v_msg) < 1 then raise exception 'message_required'; end if;
  if length(v_msg) > 2000 then raise exception 'message_too_long'; end if;
  if v_key is not null and length(v_key) > 80 then v_key := left(v_key, 80); end if;
  begin v_cat := nullif(p->>'category_id', '')::uuid; exception when others then raise exception 'invalid_category'; end;
  if v_cat is null then raise exception 'invalid_category'; end if;
  if coalesce(lower(p->>'consent'), 'false') not in ('true','t','1') then raise exception 'consent_required'; end if;
  return jsonb_build_object('name', v_name, 'phone', v_phone, 'email', v_email, 'message', v_msg, 'pref', v_pref, 'pref_other', case when v_pref = 'other' then v_po end, 'key', v_key, 'category_id', v_cat,
                            'notify', coalesce(lower(p->>'notify'), 'true') not in ('false','f','0'));
end $$;
revoke execute on function public.ct_clean(jsonb, text) from public, anon, authenticated;

-- criação (usada pelo app, pelo formulário público e pela equipe)
create or replace function public.ct_create(p_org uuid, p_user uuid, p_person uuid, p jsonb, p_source text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s contact_settings; c jsonb; cat contact_categories; v_id uuid; v_code text; v_resp uuid; v_team uuid; r contact_requests;
begin
  s := public.ct_ensure(p_org);
  c := public.ct_clean(p, s.other_channel);
  select * into cat from contact_categories where id = (c->>'category_id')::uuid and org_id = p_org and active;
  if cat.id is null then raise exception 'invalid_category'; end if;
  if c->>'key' is not null then
    select * into r from contact_requests where org_id = p_org and op_key = c->>'key';
    if r.id is not null then return jsonb_build_object('id', r.id, 'code', r.code, 'repeated', true); end if;
  end if;
  select * into r from contact_requests where org_id = p_org and created_at > now() - interval '10 minutes' and message = c->>'message' and public.ct_norm(name) = public.ct_norm(c->>'name')
     and ((p_user is not null and user_id = p_user) or (p_user is null and user_id is null and coalesce(email, '') = coalesce(c->>'email', '') and coalesce(phone, '') = coalesce(c->>'phone', ''))) limit 1;
  if r.id is not null then return jsonb_build_object('id', r.id, 'code', r.code, 'repeated', true); end if;
  v_resp := case when public.ct_eligible(p_org, cat.default_user_id) then cat.default_user_id end;
  v_team := cat.default_team_id;
  begin
    insert into contact_requests (org_id, person_id, user_id, name, phone, email, category_id, category_name, message, pref_channel, pref_other, consent_version, consent_purpose, source, op_key, notify_requester, responsible_id, team_id, created_by)
    values (p_org, p_person, p_user, c->>'name', c->>'phone', c->>'email', cat.id, cat.name, c->>'message', c->>'pref', c->>'pref_other', s.consent_version, s.consent_purpose, p_source, c->>'key', (c->>'notify')::boolean, v_resp, v_team, auth.uid())
    returning id, code into v_id, v_code;
  exception when unique_violation then
    select * into r from contact_requests where org_id = p_org and op_key = c->>'key';
    return jsonb_build_object('id', r.id, 'code', r.code, 'repeated', true);
  end;
  perform public.ct_log(v_id, p_org, 'create', null, 'received', jsonb_build_object('source', p_source, 'consent_version', s.consent_version));
  if v_resp is not null or v_team is not null then perform public.ct_log(v_id, p_org, 'route_default', null, null, jsonb_build_object('responsible', v_resp, 'team', v_team)); end if;
  perform public.ct_history(v_id, 'Solicitação de contato enviada', cat.name || ' · ' || v_code, 'new');
  perform public.ct_notify(p_org, 'view', 'Nova solicitação de contato', '#/contatos/' || v_id);
  if v_resp is not null and v_resp is distinct from auth.uid() and not (v_resp in (select public.ct_users(p_org, 'view'))) then perform public.notify_user(v_resp, p_org, 'contact', 'Uma solicitação de contato foi encaminhada a você', null, '#/contatos/' || v_id, null); end if;
  if p_user is not null and (c->>'notify')::boolean then perform public.notify_user(p_user, p_org, 'contact', 'Recebemos sua solicitação (' || v_code || ')', 'Nossa equipe vai analisar e entrar em contato pelo canal informado.', '#/contato', null); end if;
  return jsonb_build_object('id', v_id, 'code', v_code, 'repeated', false);
end $$;
revoke execute on function public.ct_create(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- SOMOS Um: formulário, envio e acompanhamento do próprio pedido
create or replace function public.ct_cats(p_org uuid, p_all boolean default false) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description) order by c.position, c.created_at), '[]'::jsonb)
    from contact_categories c where c.org_id = p_org and (p_all or c.active)
$$;
revoke execute on function public.ct_cats(uuid, boolean) from public, anon, authenticated;

create or replace function public.contact_self_get(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s contact_settings; pe people; pr profiles; v_mail text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  s := public.ct_ensure(p_org);
  select * into pe from people where org_id = p_org and user_id = auth.uid() and status in ('active','inactive','pending') order by created_at limit 1;
  select * into pr from profiles where id = auth.uid();
  select email into v_mail from auth.users where id = auth.uid();
  return jsonb_build_object('name', coalesce(pe.full_name, nullif(pr.full_name, ''), public.welcome_name(p_org, auth.uid())), 'phone', coalesce(pe.phone, pr.phone), 'email', coalesce(pe.email, v_mail),
    'has_person', pe.id is not null, 'intro', s.intro_text, 'consent_text', s.consent_text, 'consent_version', s.consent_version, 'other_channel', s.other_channel,
    'categories', public.ct_cats(p_org), 'staff', public.ct_can(p_org, 'view') or public.ct_can(p_org, 'assigned') or public.ct_can(p_org, 'manage') or public.ct_can(p_org, 'categories'));
end $$;
create or replace function public.contact_submit(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  if (select count(*) from contact_requests where org_id = p_org and user_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then raise exception 'too_many_requests'; end if;
  select * into pe from people where org_id = p_org and user_id = auth.uid() and status in ('active','inactive','pending') order by created_at limit 1;
  return public.ct_create(p_org, auth.uid(), pe.id, p, 'app');
end $$;
create or replace function public.contact_mine(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'category', r.category_name, 'status', r.status, 'status_label', public.ct_status_label(r.status), 'created_at', r.created_at, 'completed_at', r.completed_at,
      'pref', r.pref_channel) order by r.created_at desc) from (select * from contact_requests where org_id = p_org and user_id = auth.uid() order by created_at desc limit 30) r), '[]'::jsonb);
end $$;
create or replace function public.contact_public_get(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s contact_settings; o organizations;
begin
  select * into s from contact_settings where form_token = p_token and form_active;
  if s.org_id is null then return null; end if;
  s := public.ct_ensure(s.org_id);
  select * into o from organizations where id = s.org_id;
  return jsonb_build_object('org_name', o.name, 'org_subtitle', o.subtitle, 'logo_url', o.logo_url, 'intro', s.intro_text, 'consent_text', s.consent_text, 'other_channel', s.other_channel, 'categories', public.ct_cats(s.org_id));
end $$;
create or replace function public.contact_public_submit(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s contact_settings; r jsonb;
begin
  select * into s from contact_settings where form_token = p_token and form_active;
  if s.org_id is null then raise exception 'form_closed'; end if;
  if nullif(trim(coalesce(p->>'website', '')), '') is not null then return jsonb_build_object('ok', true, 'code', 'CT-00000'); end if;   -- robô: finge sucesso
  if (select count(*) from contact_requests where org_id = s.org_id and source = 'public_form' and created_at > now() - interval '10 minutes') >= 40 then raise exception 'too_many_requests'; end if;
  r := public.ct_create(s.org_id, null, null, p, 'public_form');
  return jsonb_build_object('ok', true, 'code', r->>'code');
end $$;

-- ---------------------------------------------------------------- configuração (categorias, textos, link público)
create or replace function public.contact_settings_get(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s contact_settings;
begin
  if not public.ct_can(p_org, 'categories') then raise exception 'forbidden'; end if;
  s := public.ct_ensure(p_org);
  return jsonb_build_object('intro', s.intro_text, 'consent_text', s.consent_text, 'consent_version', s.consent_version, 'consent_purpose', s.consent_purpose, 'other_channel', s.other_channel,
    'form_active', s.form_active, 'form_token', s.form_token,
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description, 'active', c.active, 'position', c.position,
        'default_team_id', c.default_team_id, 'default_team_name', (select name from teams where id = c.default_team_id), 'default_user_id', c.default_user_id,
        'default_user_name', case when c.default_user_id is null then null else coalesce(public.welcome_name(p_org, c.default_user_id), 'Usuário removido') end,
        'total', (select count(*) from contact_requests r where r.category_id = c.id)) order by c.position, c.created_at) from contact_categories c where c.org_id = p_org), '[]'::jsonb));
end $$;
create or replace function public.contact_settings_save(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s contact_settings; v_intro text; v_cons text; v_other text; v_active boolean;
begin
  if not public.ct_can(p_org, 'categories') then raise exception 'forbidden'; end if;
  s := public.ct_ensure(p_org);
  v_intro := coalesce(nullif(trim(p->>'intro'), ''), s.intro_text); v_cons := coalesce(nullif(trim(p->>'consent_text'), ''), s.consent_text);
  v_other := case when p ? 'other_channel' then nullif(trim(coalesce(p->>'other_channel', '')), '') else s.other_channel end;
  v_active := case when p ? 'form_active' then coalesce((p->>'form_active')::boolean, false) else s.form_active end;
  if length(v_intro) > 1000 then raise exception 'text_too_long'; end if;
  if length(v_cons) > 600 then raise exception 'text_too_long'; end if;
  if v_other is not null and length(v_other) > 60 then raise exception 'text_too_long'; end if;
  update contact_settings set intro_text = v_intro, consent_text = v_cons, consent_version = consent_version + case when v_cons <> s.consent_text then 1 else 0 end,
    other_channel = v_other, form_active = v_active, form_token = case when coalesce((p->>'rotate')::boolean, false) then replace(gen_random_uuid()::text, '-', '') else form_token end, updated_at = now()
   where org_id = p_org;
  return jsonb_build_object('saved', true);
end $$;
create or replace function public.contact_category_save(p_org uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c contact_categories; v_name text := trim(coalesce(p->>'name', '')); v_team uuid; v_user uuid; v_id uuid;
begin
  if not public.ct_can(p_org, 'categories') then raise exception 'forbidden'; end if;
  perform public.ct_ensure(p_org);
  if p_id is not null then select * into c from contact_categories where id = p_id and org_id = p_org; if c.id is null then raise exception 'not_found'; end if; end if;
  if p_id is null or p ? 'name' then if length(v_name) < 1 then raise exception 'name_required'; end if; if length(v_name) > 80 then raise exception 'name_too_long'; end if; else v_name := c.name; end if;
  if p ? 'description' and length(coalesce(p->>'description', '')) > 300 then raise exception 'text_too_long'; end if;
  v_team := case when p ? 'default_team_id' then nullif(p->>'default_team_id', '')::uuid else c.default_team_id end;
  v_user := case when p ? 'default_user_id' then nullif(p->>'default_user_id', '')::uuid else c.default_user_id end;
  if v_team is not null and not exists (select 1 from teams where id = v_team and org_id = p_org) then raise exception 'invalid_team'; end if;
  if v_user is not null and not public.ct_eligible(p_org, v_user) then raise exception 'invalid_responsible'; end if;
  if p_id is null then
    insert into contact_categories (org_id, name, description, active, position, default_team_id, default_user_id)
    values (p_org, v_name, nullif(trim(coalesce(p->>'description', '')), ''), coalesce((p->>'active')::boolean, true), coalesce((select max(position) from contact_categories where org_id = p_org), 0) + 1, v_team, v_user) returning id into v_id;
  else
    update contact_categories set name = v_name, description = case when p ? 'description' then nullif(trim(coalesce(p->>'description', '')), '') else description end,
      active = case when p ? 'active' then coalesce((p->>'active')::boolean, active) else active end, default_team_id = v_team, default_user_id = v_user where id = p_id;
    v_id := p_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;
create or replace function public.contact_category_move(p_id uuid, p_dir int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c contact_categories; n contact_categories;
begin
  select * into c from contact_categories where id = p_id; if c.id is null then raise exception 'not_found'; end if;
  if not public.ct_can(c.org_id, 'categories') then raise exception 'forbidden'; end if;
  if p_dir = -1 then select * into n from contact_categories where org_id = c.org_id and (position, created_at) < (c.position, c.created_at) order by position desc, created_at desc limit 1;
  elsif p_dir = 1 then select * into n from contact_categories where org_id = c.org_id and (position, created_at) > (c.position, c.created_at) order by position, created_at limit 1;
  else raise exception 'invalid_order'; end if;
  if n.id is null then return jsonb_build_object('moved', false); end if;
  if n.position = c.position then update contact_categories set position = position + case when p_dir = 1 then 1 else -1 end where id = c.id;
  else update contact_categories set position = n.position where id = c.id; update contact_categories set position = c.position where id = n.id; end if;
  return jsonb_build_object('moved', true);
end $$;
create or replace function public.contact_responsibles(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.ct_can(p_org, 'assign') or public.ct_can(p_org, 'categories') or public.ct_can(p_org, 'view')) then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'users', coalesce((select jsonb_agg(jsonb_build_object('user_id', u, 'name', coalesce(public.welcome_name(p_org, u), 'Sem nome')) order by coalesce(public.welcome_name(p_org, u), ''))
                       from (select distinct x u from (select public.ct_users(p_org, 'manage') x union select public.ct_users(p_org, 'assigned')) y) z
                      where exists (select 1 from org_members where org_id = p_org and user_id = z.u)), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name) from teams t where t.org_id = p_org), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- SOMOS Chamados: central de solicitações
create or replace function public.contact_list(p_org uuid, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_all boolean; v_q text := nullif(trim(coalesce(p->>'q', '')), ''); v_status text := nullif(p->>'status', ''); v_cat uuid; v_resp text := nullif(p->>'responsible', '');
        v_from date; v_to date; v_asc boolean := coalesce(p->>'order', 'desc') = 'asc'; v_lim int; v_off int; v_items jsonb; v_total int; v_ind jsonb; v_ru uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_all := public.ct_can(p_org, 'view');
  if not (v_all or public.ct_can(p_org, 'assigned')) then raise exception 'forbidden'; end if;
  if v_status is not null and v_status not in ('received','review','forwarded','in_progress','waiting','completed','cancelled') then raise exception 'invalid_filter'; end if;
  begin v_cat := nullif(p->>'category', '')::uuid; v_from := nullif(p->>'from', '')::date; v_to := nullif(p->>'to', '')::date;
        v_ru := case when v_resp is not null and v_resp not in ('none','me') then v_resp::uuid end;
        v_lim := least(greatest(coalesce(nullif(p->>'limit', '')::int, 30), 1), 100); v_off := greatest(coalesce(nullif(p->>'offset', '')::int, 0), 0);
  exception when others then raise exception 'invalid_filter'; end;
  select jsonb_build_object('total', count(*), 'received', count(*) filter (where status = 'received'), 'review', count(*) filter (where status = 'review'), 'forwarded', count(*) filter (where status = 'forwarded'),
         'in_progress', count(*) filter (where status = 'in_progress'), 'waiting', count(*) filter (where status = 'waiting'), 'completed', count(*) filter (where status = 'completed'), 'cancelled', count(*) filter (where status = 'cancelled'))
    into v_ind from contact_requests r where r.org_id = p_org and (v_all or r.responsible_id = auth.uid());
  with f as (
    select r.* from contact_requests r
     where r.org_id = p_org and (v_all or r.responsible_id = auth.uid())
       and (v_q is null or r.name ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%' or r.code ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%')
       and (v_cat is null or r.category_id = v_cat) and (v_status is null or r.status = v_status)
       and (v_resp is null or (v_resp = 'none' and r.responsible_id is null) or (v_resp = 'me' and r.responsible_id = auth.uid()) or r.responsible_id = v_ru)
       and (v_from is null or (r.created_at at time zone 'America/Sao_Paulo')::date >= v_from) and (v_to is null or (r.created_at at time zone 'America/Sao_Paulo')::date <= v_to)
  )
  select (select count(*) from f), coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb) into v_total, v_items from (
    select case when v_asc then extract(epoch from q.created_at) else -extract(epoch from q.created_at) end as ord,
           jsonb_build_object('id', q.id, 'code', q.code, 'name', q.name, 'category', q.category_name, 'created_at', q.created_at, 'status', q.status, 'status_label', public.ct_status_label(q.status),
             'responsible_id', q.responsible_id, 'responsible_name', case when q.responsible_id is null then null else coalesce(public.welcome_name(q.org_id, q.responsible_id), 'Usuário removido') end,
             'team_name', (select name from teams where id = q.team_id), 'updated_at', q.updated_at, 'linked', q.person_id is not null) as j
      from (select * from f order by created_at desc, id limit 5000) q order by ord limit v_lim offset v_off) x;
  return jsonb_build_object('items', v_items, 'total', v_total, 'indicators', v_ind, 'view_all', v_all, 'can_create', public.ct_can(p_org, 'manage'), 'can_categories', public.ct_can(p_org, 'categories'),
    'categories', public.ct_cats(p_org, true));
end $$;

create or replace function public.contact_get(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r contact_requests; v_conf boolean; v_manage boolean; v_notes jsonb := '[]'::jsonb; pe people; v_next jsonb;
begin
  select * into r from contact_requests where id = p_id; if r.id is null then raise exception 'not_found'; end if;
  if public.ct_scope(r.org_id, r.responsible_id) = 'none' then raise exception 'forbidden'; end if;
  v_conf := public.ct_can(r.org_id, 'confidential'); v_manage := public.ct_can(r.org_id, 'manage');
  if r.person_id is not null then select * into pe from people where id = r.person_id; end if;
  if v_conf then
    v_notes := coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'at', n.created_at, 'by', coalesce(public.welcome_name(n.org_id, n.author), 'Usuário removido')) order by n.created_at desc) from contact_notes n where n.request_id = p_id), '[]'::jsonb);
    if not exists (select 1 from contact_log where request_id = p_id and actor = auth.uid() and action = 'notes_read' and at > now() - interval '30 minutes') then perform public.ct_log(p_id, r.org_id, 'notes_read', null, null, '{}'::jsonb, true); end if;
  end if;
  v_next := case when r.status in ('completed','cancelled') then '[]'::jsonb when not v_manage then '[]'::jsonb
    else (select coalesce(jsonb_agg(x), '[]'::jsonb) from unnest(public.ct_next(r.status)) x where x <> 'cancelled' or public.ct_can(r.org_id, 'cancel')) end;
  return jsonb_build_object('id', r.id, 'org_id', r.org_id, 'code', r.code, 'name', r.name, 'phone', r.phone, 'email', r.email, 'category', r.category_name, 'category_id', r.category_id, 'message', r.message,
    'pref', r.pref_channel, 'pref_other', r.pref_other, 'consent_at', r.consent_at, 'consent_version', r.consent_version, 'consent_purpose', r.consent_purpose, 'status', r.status, 'status_label', public.ct_status_label(r.status),
    'source', r.source, 'created_at', r.created_at, 'updated_at', r.updated_at, 'completed_at', r.completed_at, 'cancel_reason', r.cancel_reason, 'has_account', r.user_id is not null, 'care_at', r.care_at,
    'responsible_id', r.responsible_id, 'responsible_name', case when r.responsible_id is null then null else coalesce(public.welcome_name(r.org_id, r.responsible_id), 'Usuário removido') end,
    'team_id', r.team_id, 'team_name', (select name from teams where id = r.team_id),
    'person', case when pe.id is null then null else jsonb_build_object('id', pe.id, 'name', pe.full_name, 'photo_url', pe.photo_url, 'can_open', public.people_scope_all(r.org_id) and public.has_people_perm(r.org_id, 'people_view')) end,
    'next', v_next, 'can_manage', v_manage, 'can_assign', public.ct_can(r.org_id, 'assign') and r.status not in ('completed','cancelled'), 'can_reopen', public.ct_can(r.org_id, 'reopen') and r.status in ('completed','cancelled'),
    'can_confidential', v_conf, 'can_link', v_manage and r.person_id is null, 'can_create_person', public.has_people_perm(r.org_id, 'people_edit'),
    'can_care', r.person_id is not null and r.care_at is null and public.has_people_perm(r.org_id, 'people_care'),
    'log', coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'from', l.from_status, 'to', l.to_status, 'detail', l.detail, 'at', l.at, 'restricted', l.restricted,
        'by', case when l.actor is null then 'Sistema' else coalesce(public.welcome_name(l.org_id, l.actor), 'Usuário removido') end) order by l.at desc, l.id desc)
        from (select * from contact_log where request_id = p_id and (v_conf or not restricted) order by at desc, id desc limit 100) l), '[]'::jsonb),
    'interactions', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'description', i.description, 'result', i.result, 'at', i.occurred_at, 'by', coalesce(public.welcome_name(i.org_id, i.author), 'Usuário removido')) order by i.occurred_at desc)
        from contact_interactions i where i.request_id = p_id), '[]'::jsonb),
    'notes', v_notes);
end $$;

create or replace function public.contact_create(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_person uuid;
begin
  if not public.ct_can(p_org, 'manage') then raise exception 'forbidden'; end if;
  begin v_person := nullif(p->>'person_id', '')::uuid; exception when others then raise exception 'person_not_found'; end;
  if v_person is not null and not exists (select 1 from people where id = v_person and org_id = p_org and status in ('active','inactive','pending')) then raise exception 'person_not_found'; end if;
  return public.ct_create(p_org, null, v_person, p, 'admin');
end $$;

create or replace function public.contact_update(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r contact_requests; s contact_settings; v_name text; v_phone text; v_email text; v_pref text; v_po text; v_d text; v_fields text[] := '{}';
begin
  select * into r from contact_requests where id = p_id for update; if r.id is null then raise exception 'not_found'; end if;
  if public.ct_scope(r.org_id, r.responsible_id) = 'none' or not public.ct_can(r.org_id, 'manage') then raise exception 'forbidden'; end if;
  if r.status in ('completed','cancelled') then raise exception 'request_closed'; end if;
  select * into s from contact_settings where org_id = r.org_id;
  v_name := case when p ? 'name' then trim(coalesce(p->>'name', '')) else r.name end;
  v_phone := case when p ? 'phone' then nullif(trim(coalesce(p->>'phone', '')), '') else r.phone end;
  v_email := case when p ? 'email' then nullif(lower(trim(coalesce(p->>'email', ''))), '') else r.email end;
  v_pref := case when p ? 'pref' then p->>'pref' else r.pref_channel end;
  v_po := case when p ? 'pref_other' then nullif(trim(coalesce(p->>'pref_other', '')), '') else r.pref_other end;
  if length(v_name) < 1 then raise exception 'name_required'; end if;
  if length(v_name) > 160 then raise exception 'name_too_long'; end if;
  if v_phone is not null then v_d := public.digits(v_phone); if v_d is null or length(v_d) < 8 or length(v_d) > 15 or length(v_phone) > 30 then raise exception 'invalid_phone'; end if; end if;
  if v_email is not null and (length(v_email) > 200 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'invalid_email'; end if;
  if v_pref not in ('whatsapp','call','email','other') then raise exception 'invalid_pref'; end if;
  if v_pref in ('whatsapp','call') and v_phone is null then raise exception 'pref_needs_phone'; end if;
  if v_pref = 'email' and v_email is null then raise exception 'pref_needs_email'; end if;
  if v_pref = 'other' and (s.other_channel is null or v_po is null) then raise exception 'pref_other_required'; end if;
  if v_name is distinct from r.name then v_fields := array_append(v_fields, 'nome'); end if; if v_phone is distinct from r.phone then v_fields := array_append(v_fields, 'telefone'); end if;
  if v_email is distinct from r.email then v_fields := array_append(v_fields, 'e-mail'); end if; if v_pref is distinct from r.pref_channel or v_po is distinct from r.pref_other then v_fields := array_append(v_fields, 'preferência de contato'); end if;
  if cardinality(v_fields) = 0 then return jsonb_build_object('saved', false); end if;
  update contact_requests set name = v_name, phone = v_phone, email = v_email, pref_channel = v_pref, pref_other = case when v_pref = 'other' then v_po end, updated_at = now() where id = p_id;
  perform public.ct_log(p_id, r.org_id, 'edit', null, null, jsonb_build_object('fields', to_jsonb(v_fields)));
  return jsonb_build_object('saved', true);
end $$;

create or replace function public.contact_status(p_id uuid, p_status text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r contact_requests; v_reason text := nullif(trim(coalesce(p_reason, '')), ''); v_to text := p_status;
begin
  select * into r from contact_requests where id = p_id for update; if r.id is null then raise exception 'not_found'; end if;
  if public.ct_scope(r.org_id, r.responsible_id) = 'none' then raise exception 'forbidden'; end if;
  if v_reason is not null and length(v_reason) > 500 then raise exception 'text_too_long'; end if;
  if p_status is null or p_status not in ('received','review','forwarded','in_progress','waiting','completed','cancelled') then raise exception 'invalid_status'; end if;
  if p_status = r.status then raise exception 'same_status'; end if;
  if r.status in ('completed','cancelled') then
    if not public.ct_can(r.org_id, 'reopen') then raise exception 'forbidden'; end if;
    if p_status <> 'review' then raise exception 'reopen_first'; end if;
    if v_reason is null or length(v_reason) < 3 then raise exception 'reason_required'; end if;
    update contact_requests set status = 'review', completed_at = null, cancel_reason = null, updated_at = now() where id = p_id;
    perform public.ct_log(p_id, r.org_id, 'reopen', r.status, 'review', jsonb_build_object('reason', v_reason));
    if r.responsible_id is not null and r.responsible_id is distinct from auth.uid() then perform public.notify_user(r.responsible_id, r.org_id, 'contact', 'Uma solicitação de contato foi reaberta', null, '#/contatos/' || p_id, null); end if;
    return jsonb_build_object('status', 'review');
  end if;
  if not public.ct_can(r.org_id, 'manage') then raise exception 'forbidden'; end if;
  if not (p_status = any (public.ct_next(r.status))) then raise exception 'invalid_transition'; end if;
  if p_status = 'cancelled' then
    if not public.ct_can(r.org_id, 'cancel') then raise exception 'forbidden'; end if;
    if v_reason is null or length(v_reason) < 3 then raise exception 'reason_required'; end if;
  end if;
  update contact_requests set status = p_status, completed_at = case when p_status = 'completed' then now() end, cancel_reason = case when p_status = 'cancelled' then v_reason end, updated_at = now() where id = p_id;
  perform public.ct_log(p_id, r.org_id, 'status', r.status, p_status, jsonb_build_object('reason', v_reason));
  if p_status = 'completed' then perform public.ct_history(p_id, 'Solicitação de contato concluída', r.category_name || ' · ' || r.code, 'done'); end if;
  if r.user_id is not null and r.notify_requester and r.user_id is distinct from auth.uid() and p_status in ('in_progress','completed','cancelled') then
    perform public.notify_user(r.user_id, r.org_id, 'contact', case p_status when 'in_progress' then 'Sua solicitação está em atendimento' when 'completed' then 'Sua solicitação foi concluída' else 'Sua solicitação foi encerrada' end, r.code, '#/contato', null);
  end if;
  return jsonb_build_object('status', p_status);
end $$;

-- responsável individual, equipe, transferência e retirada: tudo por aqui
create or replace function public.contact_assign(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r contact_requests; v_user uuid; v_team uuid; v_note text := nullif(trim(coalesce(p->>'note', '')), ''); v_changed boolean := false; v_new_status text;
begin
  select * into r from contact_requests where id = p_id for update; if r.id is null then raise exception 'not_found'; end if;
  if public.ct_scope(r.org_id, r.responsible_id) = 'none' or not public.ct_can(r.org_id, 'assign') then raise exception 'forbidden'; end if;
  if r.status in ('completed','cancelled') then raise exception 'request_closed'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'text_too_long'; end if;
  v_user := r.responsible_id; v_team := r.team_id;
  begin
    if p ? 'user_id' then v_user := nullif(p->>'user_id', '')::uuid; end if;
    if p ? 'team_id' then v_team := nullif(p->>'team_id', '')::uuid; end if;
  exception when others then raise exception 'invalid_responsible'; end;
  if v_user is not null and v_user is distinct from r.responsible_id and not public.ct_eligible(r.org_id, v_user) then raise exception 'invalid_responsible'; end if;
  if v_team is not null and v_team is distinct from r.team_id and not exists (select 1 from teams where id = v_team and org_id = r.org_id) then raise exception 'invalid_team'; end if;
  if v_user is not distinct from r.responsible_id and v_team is not distinct from r.team_id then raise exception 'no_change'; end if;
  update contact_requests set responsible_id = v_user, team_id = v_team, updated_at = now() where id = p_id;
  if v_user is distinct from r.responsible_id then
    perform public.ct_log(p_id, r.org_id, case when v_user is null then 'unassign' when r.responsible_id is null then 'assign' else 'transfer' end, null, null,
      jsonb_build_object('from', r.responsible_id, 'to', v_user, 'from_name', case when r.responsible_id is null then null else coalesce(public.welcome_name(r.org_id, r.responsible_id), 'Usuário removido') end,
                         'to_name', case when v_user is null then null else coalesce(public.welcome_name(r.org_id, v_user), 'Usuário removido') end, 'note', v_note));
    v_changed := true;
    if v_user is not null and v_user is distinct from auth.uid() then perform public.notify_user(v_user, r.org_id, 'contact', case when r.responsible_id is null then 'Uma solicitação de contato foi atribuída a você' else 'Uma solicitação de contato foi transferida para você' end, null, '#/contatos/' || p_id, null); end if;
    if r.responsible_id is not null and r.responsible_id is distinct from auth.uid() and r.responsible_id is distinct from v_user then perform public.notify_user(r.responsible_id, r.org_id, 'contact', 'Uma solicitação de contato não está mais com você', null, null, null); end if;
  end if;
  if v_team is distinct from r.team_id then
    perform public.ct_log(p_id, r.org_id, 'team', null, null, jsonb_build_object('to_name', (select name from teams where id = v_team), 'from_name', (select name from teams where id = r.team_id), 'note', v_note));
    v_changed := true;
  end if;
  if r.status in ('received','review') and (v_user is not null or v_team is not null) then
    update contact_requests set status = 'forwarded' where id = p_id;
    perform public.ct_log(p_id, r.org_id, 'status', r.status, 'forwarded', jsonb_build_object('auto', true));
  end if;
  return jsonb_build_object('saved', v_changed);
end $$;

create or replace function public.contact_interaction_add(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r contact_requests; v_kind text := coalesce(p->>'kind', ''); v_desc text := trim(coalesce(p->>'description', '')); v_res text := nullif(trim(coalesce(p->>'result', '')), ''); v_at timestamptz := now();
begin
  select * into r from contact_requests where id = p_id; if r.id is null then raise exception 'not_found'; end if;
  if public.ct_scope(r.org_id, r.responsible_id) = 'none' or not public.ct_can(r.org_id, 'manage') then raise exception 'forbidden'; end if;
  if r.status in ('completed','cancelled') then raise exception 'request_closed'; end if;
  if v_kind not in ('call','message','in_person','email','attempt','reply','other') then raise exception 'invalid_kind'; end if;
  if length(v_desc) < 1 then raise exception 'description_required'; end if;
  if length(v_desc) > 2000 or length(coalesce(v_res, '')) > 500 then raise exception 'text_too_long'; end if;
  begin if nullif(p->>'at', '') is not null then v_at := (p->>'at')::timestamptz; end if; exception when others then raise exception 'invalid_date'; end;
  if v_at > now() + interval '10 minutes' or v_at < r.created_at - interval '1 day' then raise exception 'invalid_date'; end if;
  insert into contact_interactions (request_id, org_id, kind, description, result, occurred_at, author) values (p_id, r.org_id, v_kind, v_desc, v_res, v_at, auth.uid());
  update contact_requests set updated_at = now() where id = p_id;
  perform public.ct_log(p_id, r.org_id, 'interaction', null, null, jsonb_build_object('kind', v_kind));
  return jsonb_build_object('saved', true);
end $$;

create or replace function public.contact_note_add(p_id uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r contact_requests; v_body text := trim(coalesce(p_body, ''));
begin
  select * into r from contact_requests where id = p_id; if r.id is null then raise exception 'not_found'; end if;
  if public.ct_scope(r.org_id, r.responsible_id) = 'none' or not public.ct_can(r.org_id, 'confidential') then raise exception 'forbidden'; end if;
  if length(v_body) < 1 then raise exception 'note_required'; end if;
  if length(v_body) > 4000 then raise exception 'text_too_long'; end if;
  insert into contact_notes (request_id, org_id, body, author) values (p_id, r.org_id, v_body, auth.uid());
  perform public.ct_log(p_id, r.org_id, 'note', null, null, '{}'::jsonb, true);   -- o texto nunca vai para o histórico geral
  return jsonb_build_object('saved', true);
end $$;

-- ---------------------------------------------------------------- ficha da pessoa e atendimento pastoral
create or replace function public.contact_people_search(p_org uuid, p_q text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_q text := trim(coalesce(p_q, ''));
begin
  if not public.ct_can(p_org, 'manage') then raise exception 'forbidden'; end if;
  if length(v_q) < 2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'full_name', x.full_name, 'classification', x.classification, 'photo_url', x.photo_url) order by x.full_name)
    from (select id, full_name, classification, photo_url from people where org_id = p_org and status in ('active','inactive','pending') and full_name ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%' order by full_name limit 12) x), '[]'::jsonb);
end $$;
create or replace function public.contact_link(p_id uuid, p_person uuid, p_create boolean default false, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r contact_requests; v_pid uuid; v_dupes jsonb;
begin
  select * into r from contact_requests where id = p_id for update; if r.id is null then raise exception 'not_found'; end if;
  if public.ct_scope(r.org_id, r.responsible_id) = 'none' or not public.ct_can(r.org_id, 'manage') then raise exception 'forbidden'; end if;
  if r.person_id is not null then raise exception 'already_linked'; end if;
  if coalesce(p_create, false) then
    if not public.has_people_perm(r.org_id, 'people_edit') then raise exception 'forbidden'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'full_name', x.full_name)), '[]'::jsonb) into v_dupes from people x
     where x.org_id = r.org_id and x.status in ('active','inactive','pending') and ((r.email is not null and lower(x.email) = r.email) or (r.phone is not null and public.digits(x.phone) = public.digits(r.phone)));
    if jsonb_array_length(v_dupes) > 0 and not coalesce(p_force, false) then return jsonb_build_object('saved', false, 'candidates', v_dupes); end if;
    insert into people (org_id, full_name, phone, email, classification, status, source, registered_at, created_by, flagged_duplicate)
    values (r.org_id, r.name, r.phone, r.email, 'none', 'active', 'manual', (r.created_at at time zone 'America/Sao_Paulo')::date, auth.uid(), jsonb_array_length(v_dupes) > 0) returning id into v_pid;
    perform public.person_log(r.org_id, v_pid, 'create', null, null, 'none', 'cadastro criado a partir de uma solicitação de contato');
  else
    if p_person is null or not exists (select 1 from people where id = p_person and org_id = r.org_id and status in ('active','inactive','pending')) then raise exception 'person_not_found'; end if;
    v_pid := p_person;
  end if;
  update contact_requests set person_id = v_pid, linked_at = now(), linked_by = auth.uid(), updated_at = now() where id = p_id;
  perform public.ct_log(p_id, r.org_id, 'link', null, null, jsonb_build_object('person_id', v_pid, 'created', coalesce(p_create, false)));
  perform public.ct_history(p_id, 'Solicitação de contato enviada', r.category_name || ' · ' || r.code, 'new');
  if r.status = 'completed' then perform public.ct_history(p_id, 'Solicitação de contato concluída', r.category_name || ' · ' || r.code, 'done'); end if;
  return jsonb_build_object('saved', true, 'person_id', v_pid);
end $$;
create or replace function public.contact_for_person(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from people where id = p_person; if pe.id is null then raise exception 'not_found'; end if;
  if not (public.ct_can(pe.org_id, 'view') or public.ct_can(pe.org_id, 'assigned')) then return jsonb_build_object('allowed', false, 'items', '[]'::jsonb); end if;
  return jsonb_build_object('allowed', true, 'items', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'category', r.category_name, 'status', r.status, 'status_label', public.ct_status_label(r.status), 'created_at', r.created_at) order by r.created_at desc)
      from contact_requests r where r.person_id = p_person and public.ct_scope(r.org_id, r.responsible_id) <> 'none'), '[]'::jsonb));
end $$;
-- inicia o acompanhamento pastoral reaproveitando o registro existente (person_care): só o vínculo, sem copiar a mensagem
create or replace function public.contact_to_care(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r contact_requests;
begin
  select * into r from contact_requests where id = p_id for update; if r.id is null then raise exception 'not_found'; end if;
  if public.ct_scope(r.org_id, r.responsible_id) = 'none' or not public.has_people_perm(r.org_id, 'people_care') then raise exception 'forbidden'; end if;
  if r.person_id is null then raise exception 'link_required'; end if;
  if r.care_at is not null then raise exception 'already_started'; end if;
  insert into person_care (org_id, person_id, kind, note, created_by, created_by_name)
  values (r.org_id, r.person_id, 'other', 'Acompanhamento iniciado a partir da solicitação de contato ' || r.code || ' (' || r.category_name || '). O pedido original está na solicitação.', auth.uid(), public.welcome_name(r.org_id, auth.uid()));
  insert into person_care_access (org_id, person_id, actor, action) values (r.org_id, r.person_id, auth.uid(), 'add');
  update contact_requests set care_at = now(), updated_at = now() where id = p_id;
  perform public.ct_log(p_id, r.org_id, 'to_care', null, null, '{}'::jsonb);
  return jsonb_build_object('saved', true);
end $$;

-- ---------------------------------------------------------------- permissões de execução
revoke execute on function
  public.contact_self_get(uuid), public.contact_submit(uuid, jsonb), public.contact_mine(uuid), public.contact_public_get(text), public.contact_public_submit(text, jsonb),
  public.contact_settings_get(uuid), public.contact_settings_save(uuid, jsonb), public.contact_category_save(uuid, uuid, jsonb), public.contact_category_move(uuid, int), public.contact_responsibles(uuid),
  public.contact_list(uuid, jsonb), public.contact_get(uuid), public.contact_create(uuid, jsonb), public.contact_update(uuid, jsonb), public.contact_status(uuid, text, text), public.contact_assign(uuid, jsonb),
  public.contact_interaction_add(uuid, jsonb), public.contact_note_add(uuid, text), public.contact_people_search(uuid, text), public.contact_link(uuid, uuid, boolean, boolean), public.contact_for_person(uuid), public.contact_to_care(uuid) from public, anon;
grant execute on function
  public.contact_self_get(uuid), public.contact_submit(uuid, jsonb), public.contact_mine(uuid),
  public.contact_settings_get(uuid), public.contact_settings_save(uuid, jsonb), public.contact_category_save(uuid, uuid, jsonb), public.contact_category_move(uuid, int), public.contact_responsibles(uuid),
  public.contact_list(uuid, jsonb), public.contact_get(uuid), public.contact_create(uuid, jsonb), public.contact_update(uuid, jsonb), public.contact_status(uuid, text, text), public.contact_assign(uuid, jsonb),
  public.contact_interaction_add(uuid, jsonb), public.contact_note_add(uuid, text), public.contact_people_search(uuid, text), public.contact_link(uuid, uuid, boolean, boolean), public.contact_for_person(uuid), public.contact_to_care(uuid) to authenticated;
grant execute on function public.contact_public_get(text), public.contact_public_submit(text, jsonb) to anon, authenticated;

-- Conferência (retorna true):
--   select to_regclass('public.contact_requests') is not null
--      and to_regprocedure('public.contact_submit(uuid,jsonb)') is not null
--      and to_regprocedure('public.contact_status(uuid,text,text)') is not null
--      and 'people_contacts_view' = any (public.all_actions()) as ok;
