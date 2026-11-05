-- Opções da escala (05/11/2026): pedir confirmação dos participantes e cor da escala.
alter table public.schedules add column if not exists ask_confirmation boolean not null default true;
alter table public.schedules add column if not exists color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$');
