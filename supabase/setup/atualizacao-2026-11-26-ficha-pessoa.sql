-- =====================================================================
-- Ficha individual de pessoas (26/11/2026)
-- Reaproveita people / person_history / person_visits / person_journey. Nada existente é alterado ou apagado.
--  * Família: relações entre pessoas JÁ cadastradas (sem criar pessoa nova), vistas dos dois lados.
--  * Vida na igreja: batismo (campos novos), visitas e jornada (já existentes) lidos numa só chamada.
--  * Times: vínculos reais lidos de team_members; entradas, saídas e mudança de função passam a entrar no histórico da pessoa (gatilho que
--    NUNCA bloqueia a operação original: qualquer falha ali é ignorada).
--  * Acompanhamento pastoral: ação própria "people_care", sem leitura direta nas tabelas, e cada leitura/registro fica numa trilha de acesso.
--    Não aparece no histórico geral que os líderes enxergam.
--  * Cartão do integrante para o líder do time: só nome, foto, classificação, contatos e aniversário (nada de CPF, endereço, notas ou pastoral).
--  * O desenvolvedor segue sem acesso aos dados pessoais (modo auditoria).
-- =====================================================================

-- ---------------------------------------------------------------- nova ação "people_care"
alter table public.access_grants drop constraint if exists access_grants_actions_check;
alter table public.access_grants add constraint access_grants_actions_check check (
  actions <@ array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care']::text[]);
create or replace function public.all_actions() returns text[] language sql immutable as $$
  select array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care']::text[]
$$;
create or replace function public.people_actions(p_org uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
      then array['people_view','people_edit','people_approve','people_import','people_welcome','people_care']
    else coalesce((select array_agg(distinct a) from access_grants g, unnest(g.actions) a
                   where g.org_id = p_org and g.user_id = auth.uid() and a like 'people\_%'), '{}'::text[]) end
$$;

-- ---------------------------------------------------------------- batismo (colunas novas, opcionais)
alter table public.people add column if not exists baptized boolean not null default false;
alter table public.people add column if not exists baptism_date date check (baptism_date is null or (baptism_date > date '1900-01-01' and baptism_date <= current_date));

-- ---------------------------------------------------------------- família
create table if not exists public.person_relations (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  relative_id uuid not null references public.people(id) on delete cascade,
  relation text not null check (relation in ('spouse','child','parent','sibling','other')),  -- "relative é <relation> de person"
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (person_id <> relative_id)
);
create unique index if not exists person_relations_pair on public.person_relations (least(person_id, relative_id), greatest(person_id, relative_id));
create index if not exists person_relations_a on public.person_relations (person_id);
create index if not exists person_relations_b on public.person_relations (relative_id);

-- ---------------------------------------------------------------- acompanhamento pastoral (restrito) e trilha de acesso
create table if not exists public.person_care (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  kind text not null check (kind in ('visit','prayer','counsel','other')),
  note text not null check (length(trim(note)) between 1 and 4000),
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text check (created_by_name is null or length(created_by_name) <= 160),
  created_at timestamptz not null default now()
);
create index if not exists person_care_person on public.person_care (person_id, created_at desc);
create table if not exists public.person_care_access (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid,                -- sem FK: a trilha sobrevive à pessoa
  actor uuid references auth.users(id) on delete set null,
  action text not null check (action in ('read','add')),
  at timestamptz not null default now()
);
create index if not exists person_care_access_person on public.person_care_access (person_id, at desc);

alter table public.person_relations enable row level security;
alter table public.person_care enable row level security;
alter table public.person_care_access enable row level security;
revoke all on public.person_relations, public.person_care, public.person_care_access from anon, authenticated;   -- tudo só por função

-- ---------------------------------------------------------------- leitura permitida da ficha (mesmo alcance da tabela people)
create or replace function public.can_read_person(p_person uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from people p where p.id = p_person and (
    (public.people_scope_all(p.org_id) and public.has_people_perm(p.org_id, 'people_view')) or public.people_supervised(p.org_id, p.user_id)))
$$;
revoke execute on function public.can_read_person(uuid) from public, anon;
grant execute on function public.can_read_person(uuid) to authenticated;

-- ---------------------------------------------------------------- família: listar, relacionar e desfazer
create or replace function public.person_family(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_read_person(p_person) then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'relative_id', x.rid, 'name', pe.full_name, 'photo_url', pe.photo_url, 'classification', pe.classification, 'relation', x.rel) order by pe.full_name)
    from (
      select r.id, r.relative_id as rid, r.relation as rel from person_relations r where r.person_id = p_person
      union all
      select r.id, r.person_id, case r.relation when 'child' then 'parent' when 'parent' then 'child' else r.relation end from person_relations r where r.relative_id = p_person
    ) x join people pe on pe.id = x.rid), '[]'::jsonb);
end $$;

create or replace function public.person_relation_add(p_person uuid, p_relative uuid, p_relation text) returns void
language plpgsql security definer set search_path = public as $$
declare a people; b people; lbl text;
begin
  select * into a from people where id = p_person; select * into b from people where id = p_relative;
  if a.id is null or b.id is null or a.org_id <> b.org_id then raise exception 'not_found'; end if;
  if not public.has_people_perm(a.org_id, 'people_edit') then raise exception 'forbidden'; end if;
  if a.id = b.id then raise exception 'same_person'; end if;
  if p_relation not in ('spouse','child','parent','sibling','other') then raise exception 'invalid_relation'; end if;
  if exists (select 1 from person_relations where (person_id = a.id and relative_id = b.id) or (person_id = b.id and relative_id = a.id)) then raise exception 'already_related'; end if;
  insert into person_relations (org_id, person_id, relative_id, relation, created_by) values (a.org_id, a.id, b.id, p_relation, auth.uid());
  lbl := case p_relation when 'spouse' then 'cônjuge' when 'child' then 'filho(a)' when 'parent' then 'pai/mãe' when 'sibling' then 'irmão(ã)' else 'outro vínculo' end;
  perform public.person_log(a.org_id, a.id, 'family', 'relation', null, lbl, b.full_name);
  perform public.person_log(a.org_id, b.id, 'family', 'relation', null, case p_relation when 'child' then 'pai/mãe' when 'parent' then 'filho(a)' else lbl end, a.full_name);
end $$;

create or replace function public.person_relation_remove(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r person_relations; a people; b people;
begin
  select * into r from person_relations where id = p_id;
  if r.id is null then raise exception 'not_found'; end if;
  if not public.has_people_perm(r.org_id, 'people_edit') then raise exception 'forbidden'; end if;
  select * into a from people where id = r.person_id; select * into b from people where id = r.relative_id;
  delete from person_relations where id = p_id;
  perform public.person_log(r.org_id, a.id, 'family', 'relation', 'vínculo', null, b.full_name);
  perform public.person_log(r.org_id, b.id, 'family', 'relation', 'vínculo', null, a.full_name);
end $$;

-- ---------------------------------------------------------------- vida na igreja
create or replace function public.person_church_life_save(p_person uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare pe people; v_b boolean; v_d date;
begin
  select * into pe from people where id = p_person;
  if pe.id is null then raise exception 'not_found'; end if;
  if not public.has_people_perm(pe.org_id, 'people_edit') then raise exception 'forbidden'; end if;
  v_b := case when p ? 'baptized' then coalesce((p->>'baptized')::boolean, false) else pe.baptized end;
  v_d := case when p ? 'baptism_date' then nullif(p->>'baptism_date', '')::date else pe.baptism_date end;
  if p ? 'baptized' and not v_b and not (p ? 'baptism_date') then v_d := null; end if;
  if v_d is not null and (v_d > current_date or v_d < date '1900-01-02') then raise exception 'invalid_date'; end if;
  if v_d is not null then v_b := true; end if;
  if not v_b then v_d := null; end if;
  if v_b is distinct from pe.baptized then perform public.person_log(pe.org_id, p_person, 'field', 'baptized', pe.baptized::text, v_b::text); end if;
  if v_d is distinct from pe.baptism_date then perform public.person_log(pe.org_id, p_person, 'field', 'baptism_date', pe.baptism_date::text, v_d::text); end if;
  update people set baptized = v_b, baptism_date = v_d, updated_at = now() where id = p_person;
end $$;

create or replace function public.person_church_life(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from people where id = p_person;
  if pe.id is null or not public.can_read_person(p_person) then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'baptized', pe.baptized, 'baptism_date', pe.baptism_date,
    'first_visit_on', (select min(visited_on) from person_visits where person_id = p_person),
    'visits', coalesce((select jsonb_agg(jsonb_build_object('visited_on', v.visited_on, 'kind', v.kind, 'welcomed_by_name', v.welcomed_by_name) order by v.visited_on desc) from person_visits v where v.person_id = p_person), '[]'::jsonb),
    'stage', public.welcome_stage(p_person),
    'classification_changes', coalesce((select jsonb_agg(jsonb_build_object('at', h.at, 'from', h.old_value, 'to', h.new_value) order by h.at desc) from person_history h where h.person_id = p_person and h.kind = 'classification'), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- vínculos com times (leitura dos vínculos reais)
create or replace function public.person_teams(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from people where id = p_person;
  if pe.id is null or not public.can_read_person(p_person) then raise exception 'forbidden'; end if;
  if pe.user_id is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('team_id', t.id, 'name', t.name, 'role', case when tm.is_leader then 'leader' else 'member' end, 'joined_at', tm.joined_at, 'status', 'active') order by t.name)
    from team_members tm join teams t on t.id = tm.team_id where tm.user_id = pe.user_id and tm.org_id = pe.org_id), '[]'::jsonb);
end $$;

-- entrada, saída e mudança de função em times entram no histórico da pessoa (nunca bloqueia a operação original)
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
    v_note := coalesce(v_name, 'time') || case when v_k = 'team_role' then case when new.is_leader then ' · passou a líder' else ' · deixou de ser líder' end else '' end;
    for r in select id from people where org_id = v_org and user_id = v_uid loop
      insert into person_history (org_id, person_id, actor, kind, field, note) values (v_org, r.id, auth.uid(), v_k, 'team', v_note);
    end loop;
  exception when others then null;
  end;
  return coalesce(new, old);
end $$;
drop trigger if exists team_member_history on public.team_members;
create trigger team_member_history after insert or update or delete on public.team_members for each row execute function public.team_member_history();

-- ---------------------------------------------------------------- cartão do integrante para o líder do próprio time
create or replace function public.team_member_card(p_team uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t teams; pe people; v_name text;
begin
  select * into t from teams where id = p_team;
  if t.id is null then raise exception 'not_found'; end if;
  if not (exists (select 1 from team_members where team_id = p_team and user_id = auth.uid() and is_leader)
       or exists (select 1 from org_members where org_id = t.org_id and user_id = auth.uid() and role = 'admin')) then raise exception 'forbidden'; end if;
  if not exists (select 1 from team_members where team_id = p_team and user_id = p_user) then raise exception 'not_found'; end if;
  select * into pe from people where org_id = t.org_id and user_id = p_user limit 1;
  select coalesce(nullif(om.display_name, ''), p.full_name) into v_name from org_members om left join profiles p on p.id = om.user_id where om.org_id = t.org_id and om.user_id = p_user;
  return jsonb_build_object('name', coalesce(pe.full_name, v_name), 'social_name', pe.social_name, 'photo_url', pe.photo_url, 'has_person', pe.id is not null,
    'classification', pe.classification, 'phone', pe.phone, 'whatsapp', pe.whatsapp, 'email', pe.email,
    'birth_day', case when pe.birth_date is not null then to_char(pe.birth_date, 'DD/MM') end,
    'joined_at', (select joined_at from team_members where team_id = p_team and user_id = p_user),
    'is_leader', (select is_leader from team_members where team_id = p_team and user_id = p_user));
end $$;

-- ---------------------------------------------------------------- acompanhamento pastoral
create or replace function public.care_list(p_person uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from people where id = p_person;
  if pe.id is null then raise exception 'not_found'; end if;
  if not public.has_people_perm(pe.org_id, 'people_care') then raise exception 'forbidden'; end if;
  insert into person_care_access (org_id, person_id, actor, action) values (pe.org_id, p_person, auth.uid(), 'read');
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'note', c.note, 'by', c.created_by_name, 'at', c.created_at) order by c.created_at desc, c.id desc) from person_care c where c.person_id = p_person), '[]'::jsonb);
end $$;

create or replace function public.care_add(p_person uuid, p_kind text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare pe people; v_note text := trim(coalesce(p_note, ''));
begin
  select * into pe from people where id = p_person;
  if pe.id is null then raise exception 'not_found'; end if;
  if not public.has_people_perm(pe.org_id, 'people_care') then raise exception 'forbidden'; end if;
  if p_kind not in ('visit','prayer','counsel','other') then raise exception 'invalid_kind'; end if;
  if length(v_note) < 1 then raise exception 'note_required'; end if;
  if length(v_note) > 4000 then raise exception 'note_too_long'; end if;
  insert into person_care (org_id, person_id, kind, note, created_by, created_by_name) values (pe.org_id, p_person, p_kind, v_note, auth.uid(), public.welcome_name(pe.org_id, auth.uid()));
  insert into person_care_access (org_id, person_id, actor, action) values (pe.org_id, p_person, auth.uid(), 'add');
end $$;

-- quem acessou os registros pastorais: só o administrador da igreja
create or replace function public.care_access_log(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from people where id = p_person;
  if pe.id is null then raise exception 'not_found'; end if;
  if not exists (select 1 from org_members where org_id = pe.org_id and user_id = auth.uid() and role = 'admin') then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'action', a.action, 'by', public.welcome_name(pe.org_id, a.actor)) order by a.at desc)
    from (select * from person_care_access where person_id = p_person order by at desc limit 50) a), '[]'::jsonb);
end $$;

revoke execute on function public.person_family(uuid), public.person_relation_add(uuid, uuid, text), public.person_relation_remove(bigint), public.person_church_life_save(uuid, jsonb),
  public.person_church_life(uuid), public.person_teams(uuid), public.team_member_card(uuid, uuid), public.care_list(uuid), public.care_add(uuid, text, text), public.care_access_log(uuid) from public, anon;
grant execute on function public.person_family(uuid), public.person_relation_add(uuid, uuid, text), public.person_relation_remove(bigint), public.person_church_life_save(uuid, jsonb),
  public.person_church_life(uuid), public.person_teams(uuid), public.team_member_card(uuid, uuid), public.care_list(uuid), public.care_add(uuid, text, text), public.care_access_log(uuid) to authenticated;
revoke execute on function public.team_member_history() from public, anon, authenticated;

-- verificação:
--   select to_regclass('public.person_relations') is not null as familia, to_regclass('public.person_care') is not null as pastoral,
--          to_regprocedure('public.person_teams(uuid)') is not null as times, 'people_care' = any (public.all_actions()) as permissao,
--          exists (select 1 from pg_trigger where tgname = 'team_member_history') as gatilho;
-- REVERSÃO: drop trigger team_member_history on public.team_members; drop table public.person_care_access, public.person_care, public.person_relations;
--           alter table public.people drop column baptized, drop column baptism_date;
