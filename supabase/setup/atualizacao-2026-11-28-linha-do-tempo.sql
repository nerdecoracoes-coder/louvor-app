-- =====================================================================
-- SOMOS Recurso 05: Histórico do membro — Linha do Tempo individual
-- Estende person_history (a mesma trilha que já registra cadastro, classificação, família e times). Nada é recriado nem apagado.
--  * person_history ganha categoria, título, descrição, data do fato, origem (auto/manual), operação, chave anti-duplicidade e metadados.
--  * Categorias em tabela (ampliáveis pelo administrador). Registro manual com data retroativa e responsável sempre o usuário logado.
--  * Registros automáticos são imutáveis. Manuais só são corrigidos por quem tem permissão e cada correção guarda o valor anterior.
--  * Família e responsáveis legais ficam marcados como restritos: aparecem sem detalhes para quem não edita pessoas.
--  * Acompanhamento pastoral (person_care) continua separado: nada dele entra na linha do tempo.
--  * Todas as leituras passam por funções que conferem permissão (nenhuma escrita direta, nenhum acesso do desenvolvedor aos dados).
-- =====================================================================

-- ---------------------------------------------------------------- permissões novas
alter table public.access_grants drop constraint if exists access_grants_actions_check;
alter table public.access_grants add constraint access_grants_actions_check check (
  actions <@ array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit']::text[]);
create or replace function public.all_actions() returns text[] language sql immutable as $$
  select array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit']::text[]
$$;
create or replace function public.role_actions(p_role text) returns text[] language sql immutable as $$
  select case p_role
    when 'team_member'        then array['view']
    when 'team_leader'        then array['view','create','edit','delete','approve','manage']
    when 'network_supervisor' then array['view','approve','manage']
    when 'general_leader'     then array['view','create','edit','approve','manage','administer']
    when 'secretary'          then array['people_view','people_edit','people_approve','people_import','people_welcome','people_timeline_add','people_timeline_edit']
    else '{}' end::text[]
$$;
create or replace function public.people_actions(p_org uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
      then array['people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit']
    else coalesce((select array_agg(distinct a) from access_grants g, unnest(g.actions) a
                   where g.org_id = p_org and g.user_id = auth.uid() and a like 'people\_%'), '{}'::text[]) end
$$;
-- adicionar acontecimento: ação própria ou quem já edita pessoas; corrigir: idem
create or replace function public.can_timeline(p_org uuid, p_mode text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_people_perm(p_org, 'people_edit')
      or public.has_people_perm(p_org, case p_mode when 'add' then 'people_timeline_add' else 'people_timeline_edit' end)
$$;
revoke execute on function public.can_timeline(uuid, text) from public, anon;
grant execute on function public.can_timeline(uuid, text) to authenticated;

-- ---------------------------------------------------------------- colunas novas na trilha existente
alter table public.person_history
  add column if not exists category text,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists occurred_on date,
  add column if not exists origin text not null default 'auto' check (origin in ('auto','manual')),
  add column if not exists op_id text,
  add column if not exists op_key text,
  add column if not exists meta jsonb not null default '{}'::jsonb,
  add column if not exists restricted boolean not null default false,
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid references auth.users(id) on delete set null,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id) on delete set null,
  add column if not exists void_reason text;
create unique index if not exists person_history_opkey on public.person_history (person_id, op_key) where op_key is not null;
create index if not exists person_history_timeline on public.person_history (person_id, occurred_on desc, at desc, id desc);

-- cada correção ou anulação de registro manual guarda o estado anterior
create table if not exists public.person_history_edits (
  id bigint generated always as identity primary key,
  history_id bigint not null references public.person_history(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor uuid references auth.users(id) on delete set null,
  action text not null check (action in ('edit','void')),
  before jsonb not null,
  reason text,
  at timestamptz not null default now()
);
create index if not exists person_history_edits_h on public.person_history_edits (history_id, at desc);
alter table public.person_history_edits enable row level security;
revoke all on public.person_history_edits from anon, authenticated;

-- categorias (do sistema ou criadas pela igreja)
create table if not exists public.history_categories (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations(id) on delete cascade,   -- nulo = categoria do sistema
  key text not null,
  label text not null check (char_length(label) between 2 and 40),
  manual boolean not null default true,        -- pode ser escolhida em registro manual
  active boolean not null default true,
  sort int not null default 100,
  created_by uuid references auth.users(id) on delete set null
);
create unique index if not exists history_categories_key on public.history_categories (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
alter table public.history_categories enable row level security;
revoke all on public.history_categories from anon, authenticated;
insert into public.history_categories (org_id, key, label, manual, sort) values
  (null, 'cadastro',     'Cadastro e situação',      false, 10),
  (null, 'pessoais',     'Dados pessoais',           false, 20),
  (null, 'familia',      'Vida familiar',            false, 30),
  (null, 'acolhimento',  'Acolhimento',              true,  40),
  (null, 'participacao', 'Participação na igreja',   true,  50),
  (null, 'batismo',      'Batismo',                  true,  60),
  (null, 'membresia',    'Membresia',                true,  70),
  (null, 'integracao',   'Integração',               true,  80),
  (null, 'ministerio',   'Ministério',               true,  90),
  (null, 'formacao',     'Formação e capacitação',   true,  100),
  (null, 'outros',       'Outros acontecimentos',    true,  900)
on conflict do nothing;

-- ---------------------------------------------------------------- descrição automática (um só lugar para todos os eventos)
create or replace function public.history_class_label(p text) returns text language sql immutable as $$
  select case p when 'member' then 'Membro' when 'attender' then 'Frequentador' when 'visitor' then 'Visitante' when 'none' then 'Sem classificação' else coalesce(p, '') end
$$;
create or replace function public.history_field_label(p text) returns text language sql immutable as $$
  select case p when 'full_name' then 'Nome' when 'social_name' then 'Nome de preferência' when 'birth_date' then 'Nascimento' when 'sex' then 'Sexo' when 'marital_status' then 'Estado civil'
    when 'cpf' then 'CPF' when 'phone' then 'Telefone' when 'phone2' then 'Telefone secundário' when 'whatsapp' then 'WhatsApp' when 'email' then 'E-mail' when 'zip' then 'CEP'
    when 'address' then 'Logradouro' when 'address_number' then 'Número' when 'address_complement' then 'Complemento' when 'neighborhood' then 'Bairro' when 'city' then 'Cidade'
    when 'state' then 'UF' when 'country' then 'País' when 'photo_url' then 'Foto' when 'status' then 'Situação' when 'classification' then 'Classificação' when 'notes' then 'Observações'
    else coalesce(p, 'Campo') end
$$;
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
  elsif p_kind = 'approve' then category := 'cadastro'; title := 'Cadastro aprovado'; description := null;
  elsif p_kind = 'reject' then category := 'cadastro'; title := 'Cadastro rejeitado'; description := nullif(p_note, '');
  elsif p_kind = 'link' then category := 'cadastro'; title := 'Conta do aplicativo vinculada ao cadastro'; description := null;
  end if;
end $$;

-- registros que já existiam ganham categoria, título e data do fato (nada é apagado nem reescrito além disso)
update public.person_history h set category = d.category, title = d.title, description = d.description, restricted = d.restricted,
       occurred_on = (h.at at time zone 'America/Sao_Paulo')::date
  from (select x.id, (public.history_describe(x.kind, x.field, x.old_value, x.new_value, x.note)).* from public.person_history x where x.category is null) d
 where h.id = d.id;

-- ---------------------------------------------------------------- ponto único de registro de eventos (substitui person_log mantendo as mesmas chamadas)
drop function if exists public.person_log(uuid, uuid, text, text, text, text, text);
create or replace function public.person_log(p_org uuid, p_person uuid, p_kind text, p_field text, p_old text, p_new text, p_note text default null,
                                             p_occurred date default null, p_key text default null, p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare d record;
begin
  select * into d from public.history_describe(p_kind, p_field, p_old, p_new, p_note);
  insert into person_history (org_id, person_id, actor, kind, field, old_value, new_value, note, category, title, description, restricted, occurred_on, origin, op_id, op_key, meta)
  values (p_org, p_person, auth.uid(), p_kind, p_field, p_old, p_new, p_note, d.category, d.title, d.description, d.restricted,
          coalesce(p_occurred, (now() at time zone 'America/Sao_Paulo')::date), 'auto', txid_current()::text, p_key, coalesce(p_meta, '{}'::jsonb))
  on conflict (person_id, op_key) where op_key is not null do nothing;
end $$;
revoke execute on function public.person_log(uuid, uuid, text, text, text, text, text, date, text, jsonb) from public, anon, authenticated;
revoke execute on function public.history_describe(text, text, text, text, text), public.history_class_label(text), public.history_field_label(text) from public, anon, authenticated;

-- entrada/saída/liderança em times (mesmo gatilho de antes, agora com chave anti-duplicidade e "entrou como líder")
create or replace function public.team_member_history() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_tid uuid; v_org uuid; v_k text; v_note text; v_name text; r record;
begin
  begin
    if tg_op = 'DELETE' then v_uid := old.user_id; v_tid := old.team_id; v_org := old.org_id; v_k := 'team_leave';
    elsif tg_op = 'INSERT' then v_uid := new.user_id; v_tid := new.team_id; v_org := new.org_id; v_k := 'team_join';
    else
      if new.is_leader is not distinct from old.is_leader then return new; end if;
      v_uid := new.user_id; v_tid := new.team_id; v_org := new.org_id; v_k := 'team_role';
    end if;
    select name into v_name from teams where id = v_tid;
    v_note := coalesce(v_name, 'time') || case when v_k = 'team_role' then case when new.is_leader then ' · passou a líder' else ' · deixou de ser líder' end
                                               when v_k = 'team_join' and new.is_leader then ' · entrou como líder' else '' end;
    for r in select id from people where org_id = v_org and user_id = v_uid loop
      perform public.person_log(v_org, r.id, v_k, 'team', null, null, v_note, null, 'tm:' || txid_current() || ':' || v_tid || ':' || v_k || ':' || (case when tg_op = 'DELETE' then 'x' else new.is_leader::text end),
                                jsonb_build_object('team_id', v_tid));
    end loop;
  exception when others then null;
  end;
  return coalesce(new, old);
end $$;

-- a política de leitura direta: registros restritos (família e responsáveis) só para o administrador da igreja
drop policy if exists person_history_select on public.person_history;
create policy person_history_select on public.person_history for select to authenticated using (
  public.people_scope_all(org_id) and public.has_people_perm(org_id, 'people_view')
  and (not restricted or exists (select 1 from org_members om where om.org_id = person_history.org_id and om.user_id = auth.uid() and om.role = 'admin')));

-- ---------------------------------------------------------------- leitura da linha do tempo
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
      'title', case when pg.n > 1 then 'Dados pessoais atualizados' else case when b.restricted and not v_detail then case b.kind when 'guardian' then 'Responsável legal atualizado' else 'Vida familiar atualizada' end else b.title end end,
      'description', case when pg.n > 1 then (select string_agg(distinct public.history_field_label(g2.field), ', ') from base g2 where g2.gk = pg.gk)
                          when b.restricted and not v_detail then null else b.description end,
      'occurred_on', b.occurred_on, 'at', b.at, 'origin', b.origin, 'kind', b.kind,
      'by', case when b.actor is null then 'Sistema' else coalesce(public.welcome_name(b.org_id, b.actor), 'Usuário removido') end, 'by_id', b.actor,
      'edited', b.edited_at is not null, 'edited_at', b.edited_at,
      'notes', case when b.origin = 'manual' then b.meta->>'notes' end,
      'restricted', b.restricted and not v_detail, 'op_id', b.op_id,
      'changes', case when b.kind in ('field', 'self_update') and b.category = 'pessoais' then
                  (select jsonb_agg(jsonb_build_object('field', public.history_field_label(g2.field), 'old', case when g2.field = 'cpf' then null else g2.old_value end, 'new', case when g2.field = 'cpf' then null else g2.new_value end) order by g2.id)
                     from base g2 where g2.gk = pg.gk) end,
      'can_edit', b.origin = 'manual' and public.can_timeline(b.org_id, 'edit')
    ) as j
    from page pg join person_history b on b.id = pg.id left join history_categories c on c.key = b.category and (c.org_id is null or c.org_id = b.org_id)
  ) x;
  return jsonb_build_object('items', v_res, 'has_more', coalesce(v_more, false), 'can_add', public.can_timeline(pe.org_id, 'add'));
end $$;

-- ---------------------------------------------------------------- categorias
create or replace function public.history_categories_list(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_people_perm(p_org, 'people_view') or public.people_scope_all(p_org) or public.can_timeline(p_org, 'add') or public.people_supervised_any(p_org)) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('key', key, 'label', label, 'manual', manual, 'active', active, 'system', org_id is null) order by sort, label)
                   from history_categories where org_id is null or org_id = p_org), '[]'::jsonb);
end $$;
create or replace function public.people_supervised_any(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from access_grants g where g.org_id = p_org and g.user_id = auth.uid() and g.role_key = 'network_supervisor' and 'people_view' = any (g.actions))
$$;
create or replace function public.history_category_save(p_org uuid, p_key text, p_label text, p_active boolean default true) returns text
language plpgsql security definer set search_path = public as $$
declare v_label text := trim(coalesce(p_label, '')); v_key text := p_key; c history_categories;
begin
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin') then raise exception 'forbidden'; end if;
  if char_length(v_label) < 2 or char_length(v_label) > 40 then raise exception 'invalid_label'; end if;
  if exists (select 1 from history_categories where (org_id is null or org_id = p_org) and lower(label) = lower(v_label) and key is distinct from p_key) then raise exception 'already_exists'; end if;
  if v_key is null then
    v_key := 'c_' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
    insert into history_categories (org_id, key, label, manual, active, sort, created_by) values (p_org, v_key, v_label, true, coalesce(p_active, true), 500, auth.uid());
  else
    select * into c from history_categories where key = v_key and org_id = p_org;
    if c.id is null then raise exception 'not_found'; end if;
    update history_categories set label = v_label, active = coalesce(p_active, true) where id = c.id;
  end if;
  return v_key;
end $$;

-- ---------------------------------------------------------------- registro manual
create or replace function public.timeline_add(p_person uuid, p_category text, p_title text, p_description text default null,
                                               p_occurred_on date default null, p_notes text default null, p_key text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare pe people; v_t text := trim(coalesce(p_title, '')); v_d text := nullif(trim(coalesce(p_description, '')), ''); v_n text := nullif(trim(coalesce(p_notes, '')), '');
        v_on date := coalesce(p_occurred_on, (now() at time zone 'America/Sao_Paulo')::date); v_id bigint;
begin
  select * into pe from people where id = p_person;
  if pe.id is null then raise exception 'not_found'; end if;
  if not public.can_timeline(pe.org_id, 'add') then raise exception 'forbidden'; end if;
  if not exists (select 1 from history_categories where key = p_category and manual and active and (org_id is null or org_id = pe.org_id)) then raise exception 'invalid_category'; end if;
  if char_length(v_t) < 2 or char_length(v_t) > 120 then raise exception 'invalid_title'; end if;
  if char_length(coalesce(v_d, '')) > 1000 or char_length(coalesce(v_n, '')) > 1000 then raise exception 'text_too_long'; end if;
  if v_on < date '1900-01-01' or v_on > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'invalid_date'; end if;
  insert into person_history (org_id, person_id, actor, kind, category, title, description, occurred_on, origin, op_id, op_key, meta)
  values (pe.org_id, pe.id, auth.uid(), 'manual', p_category, v_t, v_d, v_on, 'manual', txid_current()::text,
          case when p_key is null then null else 'manual:' || left(p_key, 80) end, case when v_n is null then '{}'::jsonb else jsonb_build_object('notes', v_n) end)
  on conflict (person_id, op_key) where op_key is not null do nothing returning id into v_id;
  if v_id is null then select id into v_id from person_history where person_id = pe.id and op_key = 'manual:' || left(p_key, 80); end if;
  return v_id;
end $$;

create or replace function public.timeline_correct(p_id bigint, p_title text, p_description text default null, p_occurred_on date default null,
                                                   p_notes text default null, p_category text default null, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare h person_history; v_t text := trim(coalesce(p_title, '')); v_d text := nullif(trim(coalesce(p_description, '')), ''); v_n text := nullif(trim(coalesce(p_notes, '')), '');
        v_on date := coalesce(p_occurred_on, null); v_cat text; v_r text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into h from person_history where id = p_id;
  if h.id is null then raise exception 'not_found'; end if;
  if not public.can_timeline(h.org_id, 'edit') then raise exception 'forbidden'; end if;
  if h.origin <> 'manual' then raise exception 'auto_protected'; end if;
  if h.voided_at is not null then raise exception 'voided'; end if;
  v_cat := coalesce(p_category, h.category);
  if not exists (select 1 from history_categories where key = v_cat and (org_id is null or org_id = h.org_id) and (key = h.category or (manual and active))) then raise exception 'invalid_category'; end if;
  if char_length(v_t) < 2 or char_length(v_t) > 120 then raise exception 'invalid_title'; end if;
  if char_length(coalesce(v_d, '')) > 1000 or char_length(coalesce(v_n, '')) > 1000 or char_length(coalesce(v_r, '')) > 500 then raise exception 'text_too_long'; end if;
  v_on := coalesce(p_occurred_on, h.occurred_on);
  if v_on < date '1900-01-01' or v_on > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'invalid_date'; end if;
  insert into person_history_edits (history_id, org_id, actor, action, before, reason)
  values (h.id, h.org_id, auth.uid(), 'edit', jsonb_build_object('title', h.title, 'description', h.description, 'occurred_on', h.occurred_on, 'category', h.category, 'notes', h.meta->>'notes'), v_r);
  update person_history set title = v_t, description = v_d, occurred_on = v_on, category = v_cat,
         meta = case when v_n is null then meta - 'notes' else meta || jsonb_build_object('notes', v_n) end, edited_at = now(), edited_by = auth.uid() where id = h.id;
end $$;

create or replace function public.timeline_void(p_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare h person_history; v_r text := trim(coalesce(p_reason, ''));
begin
  select * into h from person_history where id = p_id;
  if h.id is null then raise exception 'not_found'; end if;
  if not public.can_timeline(h.org_id, 'edit') then raise exception 'forbidden'; end if;
  if h.origin <> 'manual' then raise exception 'auto_protected'; end if;
  if h.voided_at is not null then raise exception 'voided'; end if;
  if char_length(v_r) < 3 or char_length(v_r) > 500 then raise exception 'reason_required'; end if;
  insert into person_history_edits (history_id, org_id, actor, action, before, reason)
  values (h.id, h.org_id, auth.uid(), 'void', jsonb_build_object('title', h.title, 'description', h.description, 'occurred_on', h.occurred_on, 'category', h.category, 'notes', h.meta->>'notes'), v_r);
  update person_history set voided_at = now(), voided_by = auth.uid(), void_reason = v_r where id = h.id;
end $$;

-- auditoria da linha do tempo (correções e anulações): só o administrador da igreja
create or replace function public.timeline_audit(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from people where id = p_person;
  if pe.id is null then raise exception 'not_found'; end if;
  if not exists (select 1 from org_members where org_id = pe.org_id and user_id = auth.uid() and role = 'admin') then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'action', e.action, 'by', coalesce(public.welcome_name(e.org_id, e.actor), 'Usuário removido'), 'reason', e.reason, 'before', e.before,
                                                        'now_title', h.title, 'entry_by', coalesce(public.welcome_name(h.org_id, h.actor), '—')) order by e.at desc)
                   from person_history_edits e join person_history h on h.id = e.history_id where h.person_id = p_person), '[]'::jsonb);
end $$;

revoke execute on function public.person_timeline(uuid, text[], text, date, date, uuid, int, int), public.history_categories_list(uuid), public.people_supervised_any(uuid),
  public.history_category_save(uuid, text, text, boolean), public.timeline_add(uuid, text, text, text, date, text, text),
  public.timeline_correct(bigint, text, text, date, text, text, text), public.timeline_void(bigint, text), public.timeline_audit(uuid) from public, anon;
grant execute on function public.person_timeline(uuid, text[], text, date, date, uuid, int, int), public.history_categories_list(uuid), public.people_supervised_any(uuid),
  public.history_category_save(uuid, text, text, boolean), public.timeline_add(uuid, text, text, text, date, text, text),
  public.timeline_correct(bigint, text, text, date, text, text, text), public.timeline_void(bigint, text), public.timeline_audit(uuid) to authenticated;

-- verificação:
--   select to_regclass('public.history_categories') is not null as categorias, to_regprocedure('public.person_timeline(uuid,text[],text,date,date,uuid,integer,integer)') is not null as linha_do_tempo,
--          exists (select 1 from information_schema.columns where table_name = 'person_history' and column_name = 'origin') as colunas, 'people_timeline_add' = any (public.all_actions()) as permissao;
-- REVERSÃO: drop table public.person_history_edits, public.history_categories; alter table public.person_history drop column category, drop column title, drop column description, drop column occurred_on,
--           drop column origin, drop column op_id, drop column op_key, drop column meta, drop column restricted, drop column edited_at, drop column edited_by, drop column voided_at, drop column voided_by, drop column void_reason;
--           (e recriar person_log com 7 parâmetros a partir de 20261124000001_pessoas.sql)
