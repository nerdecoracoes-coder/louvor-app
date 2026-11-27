-- Lideranca da igreja em ordem hierarquica (1 = lider principal, 2 = o seguinte...). Aditivo: nao altera nem apaga nada.
-- Quem pode gravar continua sendo so o administrador (politica om_update ja existente).
alter table public.org_members add column if not exists church_rank int;

-- Verificacao (deve retornar true):
select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'org_members' and column_name = 'church_rank') as lideranca_ordem_ok;
