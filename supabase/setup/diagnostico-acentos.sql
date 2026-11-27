-- Diagnostico: lista funcoes e textos do banco com acentuacao corrompida (ex.: "PregaÃ§Ãµes"). Deve voltar vazio.
select 'funcao' as tipo, p.proname::text as nome
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosrc ~ '[ÃÂ][\u0080-¿]'
order by 2;
