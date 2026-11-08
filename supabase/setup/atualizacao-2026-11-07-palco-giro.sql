-- Giro dos instrumentos no palco (em graus).
alter table public.team_stage_slots add column if not exists rot smallint not null default 0 check (rot between 0 and 359);
