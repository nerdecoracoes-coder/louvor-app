-- Cadastro de quem entra no Louvor por convite: o convite informa o tipo do time, lista as funções disponíveis
-- e, depois de aceitar, a pessoa grava as próprias funções (pelo menos uma no Louvor).
create or replace function public.get_invite(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'valid', i.revoked_at is null and i.expires_at > now(),
    'expired', i.expires_at <= now(), 'revoked', i.revoked_at is not null,
    'team', case when t.id is null then null else jsonb_build_object('id', t.id, 'name', t.name, 'logo_url', t.logo_url, 'accent_color', t.accent_color,
              'category', t.category, 'team_type', t.team_type, 'members', (select count(*) from team_members where team_id = t.id)) end,
    'org', jsonb_build_object('id', o.id, 'name', o.name, 'logo_url', o.logo_url, 'accent_color', o.accent_color,
              'members', (select count(*) from org_members where org_id = o.id and role <> 'guest')),
    'is_church_member', exists (select 1 from org_members where org_id = o.id and user_id = auth.uid() and role <> 'guest'),
    'already_member', case when t.id is null then exists (select 1 from org_members where org_id = o.id and user_id = auth.uid() and role <> 'guest')
                           else exists (select 1 from team_members where team_id = t.id and user_id = auth.uid()) end)
  from invites i left join teams t on t.id = i.team_id join organizations o on o.id = i.org_id
  where i.token = p_token
$$;
grant execute on function public.get_invite(text) to anon, authenticated;

-- funções que a pessoa pode escolher ao aceitar o convite (só com convite válido)
create or replace function public.invite_roles(p_token text) returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select r.id, r.name from invites i
  join teams t on t.id = i.team_id
  join music_roles r on r.org_id = i.org_id and (r.team_type is null or r.team_type = t.team_type)
  where i.token = p_token and i.revoked_at is null and i.expires_at > now()
  order by r.sort, r.name
$$;
revoke execute on function public.invite_roles(text) from public, anon;
grant execute on function public.invite_roles(text) to authenticated;

-- a própria pessoa grava as funções dela no time (e no Louvor precisa ter pelo menos uma)
create or replace function public.finish_registration(p_team uuid, p_roles uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := team_org(p_team); v_type text := (select team_type from teams where id = p_team); v_n int;
begin
  if auth.uid() is null or not exists (select 1 from team_members where team_id = p_team and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  select count(*) into v_n from music_roles r where r.id = any(p_roles) and r.org_id = v_org and (r.team_type is null or r.team_type = v_type);
  if v_type = 'louvor' and v_n = 0 then raise exception 'roles_required'; end if;
  delete from team_member_roles where team_id = p_team and user_id = auth.uid() and not (role_id = any(p_roles));
  insert into team_member_roles (team_id, user_id, role_id, org_id)
  select p_team, auth.uid(), r.id, v_org from music_roles r
  where r.id = any(p_roles) and r.org_id = v_org and (r.team_type is null or r.team_type = v_type)
  on conflict do nothing;
end $$;
revoke execute on function public.finish_registration(uuid, uuid[]) from public, anon;
grant execute on function public.finish_registration(uuid, uuid[]) to authenticated;
