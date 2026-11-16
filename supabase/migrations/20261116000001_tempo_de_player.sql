-- Tempo de uso do player: cada pessoa registra o próprio tempo de escuta (por música e por dia);
-- só o líder da equipe (ou o administrador) consegue consultar o tempo dos integrantes.
create table if not exists public.player_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  org_id uuid not null,
  day date not null,
  schedule_id uuid not null default '00000000-0000-0000-0000-000000000000',
  seconds integer not null default 0,
  primary key (user_id, song_id, day, schedule_id)
);
create index if not exists player_usage_org_day on public.player_usage (org_id, day);
alter table public.player_usage enable row level security;
drop policy if exists pu_own_select on public.player_usage;
create policy pu_own_select on public.player_usage for select to authenticated using (user_id = auth.uid());

create or replace function public.log_listening(p_song uuid, p_seconds integer, p_schedule uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_org uuid; v_day date := (now() at time zone 'America/Sao_Paulo')::date; v_s integer := least(greatest(coalesce(p_seconds, 0), 0), 300);
begin
  if v_uid is null or v_s = 0 then return; end if;
  select org_id into v_org from songs where id = p_song;
  if v_org is null or not public.is_org_member(v_org) then return; end if;
  insert into player_usage (user_id, song_id, org_id, day, schedule_id, seconds)
  values (v_uid, p_song, v_org, v_day, coalesce(p_schedule, '00000000-0000-0000-0000-000000000000'), v_s)
  on conflict (user_id, song_id, day, schedule_id) do update set seconds = player_usage.seconds + excluded.seconds;
end $$;
revoke execute on function public.log_listening(uuid, integer, uuid) from public, anon;
grant execute on function public.log_listening(uuid, integer, uuid) to authenticated;

-- tempo de escuta dos integrantes do time: de uma escala (as músicas dela, desde que foi criada) ou de todas as músicas desde p_since
create or replace function public.team_listening(p_team uuid, p_schedule uuid default null, p_since date default null)
returns table (user_id uuid, song_id uuid, seconds bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_from date;
begin
  if not public.can_manage_team(p_team) then raise exception 'forbidden'; end if;
  select org_id into v_org from teams where id = p_team;
  if p_schedule is not null then
    select (s.created_at at time zone 'America/Sao_Paulo')::date into v_from from schedules s where s.id = p_schedule and s.team_id = p_team;
    if v_from is null then raise exception 'not_found'; end if;
    return query
      select u.user_id, u.song_id, sum(u.seconds)::bigint from player_usage u
      join team_members tm on tm.team_id = p_team and tm.user_id = u.user_id
      where u.org_id = v_org and u.day >= v_from
        and u.song_id in (select ss.song_id from schedule_songs ss where ss.schedule_id = p_schedule and ss.song_id is not null)
      group by u.user_id, u.song_id;
  else
    return query
      select u.user_id, u.song_id, sum(u.seconds)::bigint from player_usage u
      join team_members tm on tm.team_id = p_team and tm.user_id = u.user_id
      where u.org_id = v_org and u.day >= coalesce(p_since, current_date - 30)
      group by u.user_id, u.song_id;
  end if;
end $$;
revoke execute on function public.team_listening(uuid, uuid, date) from public, anon;
grant execute on function public.team_listening(uuid, uuid, date) to authenticated;

-- verificação:
-- select to_regclass('public.player_usage') is not null as tabela,
--   to_regprocedure('public.log_listening(uuid,integer,uuid)') is not null as registra,
--   to_regprocedure('public.team_listening(uuid,uuid,date)') is not null as consulta;
