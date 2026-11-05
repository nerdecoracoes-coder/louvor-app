-- Opções da escala (05/11/2026): pedir confirmação dos participantes e paletas de cores das vestimentas.
alter table public.schedules add column if not exists ask_confirmation boolean not null default true;
alter table public.schedules add column if not exists palettes jsonb not null default '[]'::jsonb;
