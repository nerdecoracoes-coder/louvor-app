-- App de equipe de louvor: cada grupo que se cadastra tem o seu espaço próprio e isolado (sem ligação com outras igrejas).
-- team_only: a pessoa só enxerga a página da equipe, inclusive o administrador (as áreas de igreja e de outros ministérios ficam fechadas).
alter table public.organizations add column if not exists team_only boolean not null default false;

-- cadastro de uma nova equipe de louvor: cria o espaço, a equipe e deixa quem cadastrou como líder
create or replace function public.create_louvor_team(p_name text, p_church text default null, p_accent text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_org uuid; v_team uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required'; end if;
  v_org := public.create_organization(trim(p_name), p_accent, nullif(trim(coalesce(p_church, '')), ''));
  update organizations set team_only = true where id = v_org;
  insert into teams (org_id, name, category, team_type, created_by)
  values (v_org, trim(p_name), 'ministry', 'louvor', v_uid) returning id into v_team;
  insert into team_members (team_id, user_id, org_id, is_leader) values (v_team, v_uid, v_org, true);
  return jsonb_build_object('org_id', v_org, 'team_id', v_team);
end $$;
revoke execute on function public.create_louvor_team(text, text, text) from public, anon;
grant execute on function public.create_louvor_team(text, text, text) to authenticated;

-- verificação:
-- select exists (select 1 from information_schema.columns where table_name='organizations' and column_name='team_only') as coluna,
--   to_regprocedure('public.create_louvor_team(text,text,text)') is not null as funcao;
