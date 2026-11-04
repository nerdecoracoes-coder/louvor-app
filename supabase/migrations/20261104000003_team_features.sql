-- =====================================================================
-- Recursos de cada time (04/11/2026)
-- O tipo do time sugere os recursos (Louvor já vem com o repertório), e o administrador pode ajustar.
-- Recursos disponíveis hoje:
--   repertorio  Músicas, player multitrack e integração com o Google Drive
-- O acesso ao repertório passa a depender do recurso do time (e não mais só do tipo).
-- A integração com o Drive pode ser gerenciada pelo administrador e pelos líderes de times com repertório.
-- =====================================================================

alter table public.teams add column if not exists features text[];

-- recursos sugeridos para cada tipo de time
create or replace function public.team_feature_preset(p_type text) returns text[]
language sql immutable as $$
  select case when p_type = 'louvor' then array['repertorio']::text[] else '{}'::text[] end
$$;

update public.teams set features = public.team_feature_preset(team_type) where features is null;

-- novo time sem recursos informados recebe os do tipo; só o administrador altera os recursos de um time
create or replace function public.fill_team_features() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.features is null then new.features := team_feature_preset(new.team_type); end if;
  new.features := array(select distinct x from unnest(new.features) x where x in ('repertorio') order by 1);
  if tg_op = 'UPDATE' and new.features is distinct from old.features
     and auth.uid() is not null and not is_org_admin(new.org_id) then
    raise exception 'only_admin_sets_features';
  end if;
  return new;
end $$;
drop trigger if exists t_fill_team_features on public.teams;
create trigger t_fill_team_features before insert or update on public.teams
  for each row execute function public.fill_team_features();

create or replace function public.team_has_repertoire(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams where id = p_team and 'repertorio' = any(features))
$$;

create or replace function public.has_repertoire(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_org_admin(p_org) or exists (
    select 1 from team_members tm join teams t on t.id = tm.team_id
    where tm.org_id = p_org and tm.user_id = auth.uid() and 'repertorio' = any(t.features)
      and (tm.access_until is null or tm.access_until >= (now() at time zone 'America/Sao_Paulo')::date))
$$;

create or replace function public.is_repertoire_staff(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_org_admin(p_org) or exists (
    select 1 from team_members tm join teams t on t.id = tm.team_id
    where tm.org_id = p_org and tm.user_id = auth.uid() and tm.is_leader and 'repertorio' = any(t.features))
$$;

-- Google Drive: administrador e líderes de times com repertório acompanham e gerenciam a integração
drop policy if exists di_select on public.drive_integrations;
create policy di_select on public.drive_integrations for select to authenticated using (public.is_repertoire_staff(org_id));
drop policy if exists sr_select on public.sync_runs;
create policy sr_select on public.sync_runs for select to authenticated using (public.is_repertoire_staff(org_id));
drop policy if exists se_select on public.sync_events;
create policy se_select on public.sync_events for select to authenticated using (public.is_repertoire_staff(org_id));
