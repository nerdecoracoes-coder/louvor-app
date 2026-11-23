-- =====================================================================
-- Pessoas: excluir um cadastro (24/11/2026)
--  * Só quem tem a permissão people_edit. A conta de acesso da pessoa (se tiver) NÃO é afetada: só sai da base de membresia.
--  * Por privacidade (LGPD), o histórico de alterações da pessoa também é apagado; fica apenas um registro de que a exclusão
--    aconteceu (quem, quando e a classificação), sem nome nem dados de contato.
--  * Para quem apenas deixou a igreja, prefira marcar como "Inativo": o cadastro e o histórico são mantidos.
-- =====================================================================
create or replace function public.person_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare old people;
begin
  select * into old from people where id = p_id;
  if old.id is null then raise exception 'not_found'; end if;
  if not public.has_people_perm(old.org_id, 'people_edit') then raise exception 'forbidden'; end if;
  delete from person_history where person_id = p_id;
  delete from people where id = p_id;
  perform public.person_log(old.org_id, null, 'delete', 'classification', old.classification, null,
    case when old.user_id is not null then 'tinha conta no app (conta mantida)' else null end);
end $$;
revoke execute on function public.person_delete(uuid) from public, anon;
grant execute on function public.person_delete(uuid) to authenticated;

-- verificação:  select to_regprocedure('public.person_delete(uuid)') is not null as excluir;
