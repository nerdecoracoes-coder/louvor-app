-- Letras criadas pela própria Multimídia (sem depender do repertório do Louvor).
create table if not exists public.media_lyrics (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  artist text check (char_length(artist) <= 160),
  blocks jsonb,
  style jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists media_lyrics_team on public.media_lyrics (team_id, title);
alter table public.media_lyrics enable row level security;
revoke all on public.media_lyrics from anon;
drop policy if exists ml_select on public.media_lyrics; drop policy if exists ml_write on public.media_lyrics;
create policy ml_select on public.media_lyrics for select to authenticated
  using (public.is_team_member(team_id) or public.can_manage_team(team_id) or public.is_org_admin(org_id));
create policy ml_write on public.media_lyrics for all to authenticated
  using (public.is_team_member(team_id) or public.can_manage_team(team_id))
  with check ((public.is_team_member(team_id) or public.can_manage_team(team_id)) and public.team_org(team_id) = org_id and public.team_has_feature(team_id, 'letras'));
