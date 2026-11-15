-- Modo desenvolvedor: a pessoa marcada enxerga o app completo (igreja, outros ministérios, telas em construção),
-- mesmo dentro de uma equipe "somente time". A marca só pode ser colocada pelo SQL Editor (nunca pelo próprio usuário).
alter table public.profiles add column if not exists is_developer boolean not null default false;

create or replace function public.profiles_guard_developer() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then new.is_developer := false;
    else new.is_developer := old.is_developer; end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_developer on public.profiles;
create trigger profiles_guard_developer before insert or update on public.profiles
  for each row execute function public.profiles_guard_developer();

-- para ligar no SEU login (troque o e-mail, se precisar):
-- update public.profiles set is_developer = true where id = (select id from auth.users where email = 'SEU_EMAIL');
-- verificação:
-- select p.full_name, u.email, p.is_developer from public.profiles p join auth.users u on u.id = p.id where p.is_developer;
