-- Coordenador de agenda: quem monta a agenda da igreja e os avisos gerais (escolhido pelo administrador).
-- O evento da agenda indica quais ministérios ficam de serviço; cada líder recebe o aviso para criar a escala
-- e, a partir de 7 dias antes, é lembrado todo dia até a escala existir.

alter table public.org_members add column if not exists agenda_coordinator boolean not null default false;
alter table public.church_events add column if not exists kind text;
alter table public.schedules add column if not exists church_event_id uuid references public.church_events(id) on delete set null;
create index if not exists schedules_church_event_idx on public.schedules (church_event_id);

create table if not exists public.church_event_teams (
  event_id uuid not null references public.church_events(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, team_id)
);
alter table public.church_event_teams enable row level security;
revoke all on public.church_event_teams from anon;

create or replace function public.is_agenda_coordinator(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and agenda_coordinator)
$$;
create or replace function public.can_edit_agenda(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_org_admin(p_org) or public.is_agenda_coordinator(p_org)
$$;

-- agenda da igreja: todos leem; só administrador e coordenador(es) escrevem
drop policy if exists ce_select on public.church_events;
drop policy if exists ce_write on public.church_events;
drop policy if exists ce_insert on public.church_events;
drop policy if exists ce_update on public.church_events;
drop policy if exists ce_delete on public.church_events;
create policy ce_select on public.church_events for select to authenticated using (public.is_org_member(org_id));
create policy ce_insert on public.church_events for insert to authenticated with check (public.can_edit_agenda(org_id) and created_by = auth.uid());
create policy ce_update on public.church_events for update to authenticated using (public.can_edit_agenda(org_id)) with check (public.can_edit_agenda(org_id));
create policy ce_delete on public.church_events for delete to authenticated using (public.can_edit_agenda(org_id));

-- ministérios de serviço no evento
drop policy if exists cet_select on public.church_event_teams;
drop policy if exists cet_write on public.church_event_teams;
create policy cet_select on public.church_event_teams for select to authenticated using (public.is_org_member(org_id));
create policy cet_write on public.church_event_teams for all to authenticated
  using (public.can_edit_agenda(org_id))
  with check (public.can_edit_agenda(org_id) and public.team_org(team_id) = org_id);

-- avisos gerais (sem time): administrador e coordenador(es); avisos de time continuam com o líder do time
drop policy if exists an_insert on public.announcements;
drop policy if exists an_update on public.announcements;
drop policy if exists an_delete on public.announcements;
create policy an_insert on public.announcements for insert to authenticated
  with check (created_by = auth.uid() and
              case when team_id is null then public.can_edit_agenda(org_id)
                   else public.can_manage_team(team_id) and org_id = public.team_org(team_id) end);
create policy an_update on public.announcements for update to authenticated
  using (created_by = auth.uid() or public.is_org_admin(org_id) or (team_id is null and public.can_edit_agenda(org_id)))
  with check (created_by = auth.uid() or public.is_org_admin(org_id) or (team_id is null and public.can_edit_agenda(org_id)));
create policy an_delete on public.announcements for delete to authenticated
  using (created_by = auth.uid() or public.is_org_admin(org_id)
         or (team_id is null and public.can_edit_agenda(org_id))
         or (team_id is not null and public.can_manage_team(team_id)));

-- a escala do time já existe? (ligada ao evento, ou do mesmo time no mesmo dia)
create or replace function public.event_has_schedule(p_event uuid, p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from schedules s, church_events e
    where e.id = p_event and s.team_id = p_team
      and (s.church_event_id = e.id
           or (s.starts_at at time zone 'America/Sao_Paulo')::date = (e.starts_at at time zone 'America/Sao_Paulo')::date))
$$;
revoke execute on function public.event_has_schedule(uuid, uuid) from public, anon;

-- quem recebe o aviso do time: os líderes (se não houver, os administradores)
create or replace function public.team_alert_users(p_team uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select user_id from team_members where team_id = p_team and is_leader
  union
  select m.user_id from org_members m where m.role = 'admin' and m.org_id = public.team_org(p_team)
    and not exists (select 1 from team_members where team_id = p_team and is_leader)
$$;
revoke execute on function public.team_alert_users(uuid) from public, anon, authenticated;

-- aviso enfático assim que o ministério é marcado no evento
create or replace function public.notify_event_team() returns trigger
language plpgsql security definer set search_path = public as $$
declare e record; t record;
begin
  select * into e from church_events where id = new.event_id;
  select * into t from teams where id = new.team_id;
  if e.id is null or t.id is null then return null; end if;
  perform notify_user(u, new.org_id, 'escala_pendente', 'CRIE A ESCALA: ' || e.title,
    'O time ' || t.name || ' está de serviço em ' || to_char(e.starts_at at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI') || '. Crie a escala agora.',
    '#/escala/nova/' || new.team_id || '?evento=' || e.id, jsonb_build_object('event_id', e.id, 'team_id', new.team_id))
  from team_alert_users(new.team_id) u where u <> coalesce(e.created_by, '00000000-0000-0000-0000-000000000000'::uuid);
  return null;
end $$;
drop trigger if exists t_notify_event_team on public.church_event_teams;
create trigger t_notify_event_team after insert on public.church_event_teams for each row execute function public.notify_event_team();

-- lembrete diário: de 7 dias antes até o evento, quem ainda não criou a escala é avisado todo dia
create or replace function public.remind_pending_scales() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; r record; u uuid; dias integer; quando text;
begin
  for r in
    select e.id as event_id, e.title, e.starts_at, e.org_id, ct.team_id, t.name as team_name
    from church_event_teams ct
    join church_events e on e.id = ct.event_id
    join teams t on t.id = ct.team_id
    where e.starts_at > now() and e.starts_at <= now() + interval '7 days'
  loop
    if public.event_has_schedule(r.event_id, r.team_id) then continue; end if;
    dias := (r.starts_at at time zone 'America/Sao_Paulo')::date - (now() at time zone 'America/Sao_Paulo')::date;
    quando := case when dias <= 0 then 'é HOJE' when dias = 1 then 'é AMANHÃ' else 'é em ' || dias || ' dias' end;
    for u in select * from public.team_alert_users(r.team_id) loop
      if exists (select 1 from notifications x where x.user_id = u and x.kind = 'escala_lembrete' and x.data->>'event_id' = r.event_id::text
                 and x.data->>'team_id' = r.team_id::text and (x.created_at at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date) then continue; end if;
      perform notify_user(u, r.org_id, 'escala_lembrete', 'FALTA A ESCALA: ' || r.title || ' ' || quando,
        'O time ' || r.team_name || ' ainda não tem escala para este evento. Crie agora.',
        '#/escala/nova/' || r.team_id || '?evento=' || r.event_id, jsonb_build_object('event_id', r.event_id, 'team_id', r.team_id));
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public.remind_pending_scales() from public, anon, authenticated;

-- times que eu lidero (ou, sem líder, que eu administro)
create or replace function public.team_alert_users_for_me() returns setof uuid
language sql stable security definer set search_path = public as $$
  select t.id from teams t where
    exists (select 1 from team_members where team_id = t.id and user_id = auth.uid() and is_leader)
    or (not exists (select 1 from team_members where team_id = t.id and is_leader) and public.is_org_admin(t.org_id))
$$;
-- escalas pendentes de quem lidera (para o cartão fixo no início do time)
create or replace function public.my_pending_scales() returns table (event_id uuid, title text, kind text, starts_at timestamptz, team_id uuid, team_name text)
language sql stable security definer set search_path = public as $$
  select e.id, e.title, e.kind, e.starts_at, ct.team_id, t.name
  from church_event_teams ct
  join church_events e on e.id = ct.event_id
  join teams t on t.id = ct.team_id
  where e.starts_at > now() - interval '3 hours'
    and ct.team_id in (select x from public.team_alert_users_for_me() x)
    and not public.event_has_schedule(e.id, ct.team_id)
  order by e.starts_at
$$;
revoke execute on function public.my_pending_scales() from public, anon;
revoke execute on function public.team_alert_users_for_me() from public, anon;

-- agendamento diário às 09:00 (Brasília); se o pg_cron não estiver ativo, o app continua mostrando o cartão de pendência
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'somos-lembrar-escalas';
  perform cron.schedule('somos-lembrar-escalas', '0 12 * * *', 'select public.remind_pending_scales()');
exception when others then raise notice 'pg_cron indisponível: %', sqlerrm;
end $$;
