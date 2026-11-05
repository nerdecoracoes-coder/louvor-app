-- =====================================================================
-- Ambientes dos times Diáconos e Ministério Infantil (05/11/2026):
-- recursos e funções padrão por tipo de time (como o Louvor e a Multimídia).
-- =====================================================================

create or replace function public.team_feature_preset(p_type text) returns text[]
language sql immutable as $$
  select case p_type
    when 'louvor' then array['repertorio']::text[]
    when 'multimidia' then array['checklist','pedidos','roteiro']::text[]
    when 'diaconal' then array['checklist','roteiro']::text[]
    when 'infantil' then array['checklist']::text[]
    else '{}'::text[] end
$$;

-- times desses tipos que ainda estavam sem recursos recebem os do tipo
update public.teams set features = public.team_feature_preset(team_type)
 where team_type in ('diaconal','infantil') and coalesce(features, '{}') = '{}';

create or replace function public.ensure_type_roles(p_org uuid, p_type text) returns void
language plpgsql security definer set search_path = public as $$
declare names text[];
begin
  names := case p_type
    when 'multimidia' then array['Direção','Projeção','Transmissão/Corte','Câmera 2','Câmera 3','Iluminação']
    when 'diaconal' then array['Coordenação','Porta / Recepção','Estacionamento','Segurança','Santa Ceia','Oferta','Apoio ao altar','Visitantes']
    when 'infantil' then array['Coordenação','Professor(a)','Auxiliar','Recepção / Check-in','Berçário','Louvor infantil']
    else null end;
  if names is null or exists (select 1 from music_roles where org_id = p_org and team_type = p_type) then return; end if;
  insert into music_roles (org_id, name, sort, team_type)
  select p_org, n, i, p_type from unnest(names) with ordinality as t(n, i)
  on conflict do nothing;
end $$;
revoke execute on function public.ensure_type_roles(uuid, text) from public, anon, authenticated;

do $$ begin perform public.ensure_type_roles(org_id, team_type) from (select distinct org_id, team_type from public.teams where team_type in ('diaconal','infantil')) t; end $$;
