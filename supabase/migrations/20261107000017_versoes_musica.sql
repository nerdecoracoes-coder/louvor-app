-- Versões da música por cantor (tom, BPM, duração e referências de cada um), álbum e observações gerais.
alter table public.songs add column if not exists album text;
alter table public.songs add column if not exists notes text;

create table if not exists public.song_versions (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  singer_id uuid references auth.users(id) on delete set null,
  song_key text check (song_key is null or length(song_key) <= 8),
  bpm numeric(6,2),
  duration_sec int,
  classification text,
  links jsonb not null default '[]',
  notes text,
  position int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (song_id, name)
);
create index if not exists song_versions_song_idx on public.song_versions (song_id, position);
alter table public.song_versions enable row level security;
revoke all on public.song_versions from anon;

drop policy if exists sv_select on public.song_versions;
drop policy if exists sv_insert on public.song_versions;
drop policy if exists sv_update on public.song_versions;
drop policy if exists sv_delete on public.song_versions;
create policy sv_select on public.song_versions for select to authenticated using (public.has_repertoire(org_id));
create policy sv_insert on public.song_versions for insert to authenticated
  with check (public.is_repertoire_staff(org_id) and exists (select 1 from public.songs g where g.id = song_id and g.org_id = song_versions.org_id));
create policy sv_update on public.song_versions for update to authenticated
  using (public.is_repertoire_staff(org_id)) with check (public.is_repertoire_staff(org_id));
create policy sv_delete on public.song_versions for delete to authenticated using (public.is_repertoire_staff(org_id));
