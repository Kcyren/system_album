-- ============================================================================
-- System Album — Supabase schema
-- Run this once in your Supabase project: Dashboard → SQL Editor → New query →
-- paste this whole file → Run. It is safe to run again (it won't delete data).
-- ============================================================================

-- Short, URL-friendly ids like "k3j9x0a1bq" (used in links such as /track/k3j9x0a1bq)
create or replace function public.short_id() returns text
language sql volatile as $$
  select substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)
$$;

-- ---------------------------------------------------------------- categories
create table if not exists public.categories (
  id          bigint generated always as identity primary key,
  name        text not null unique check (char_length(name) between 1 and 40),
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);

insert into public.categories (name, position)
values ('Freestyle', 1), ('Mix', 2), ('Video', 3)
on conflict (name) do nothing;

-- -------------------------------------------------------------------- albums
create table if not exists public.albums (
  id            text primary key default public.short_id(),
  title         text not null check (char_length(title) between 1 and 120),
  description   text check (char_length(description) <= 2000),
  cover_path    text,
  release_date  date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- -------------------------------------------------------------------- tracks
create table if not exists public.tracks (
  id                text primary key default public.short_id(),
  title             text not null check (char_length(title) between 1 and 120),
  category_id       bigint not null references public.categories(id) on delete restrict,
  media_path        text not null,
  media_type        text not null check (media_type in ('audio', 'video')),
  cover_path        text,
  description       text check (char_length(description) <= 2000),
  how_made          text check (char_length(how_made) <= 2000),
  progress_note     text check (char_length(progress_note) <= 1000),
  recorded_date     date,
  recorded_time     time,
  album_id          text references public.albums(id) on delete set null,
  album_position    int,
  duration_seconds  real,
  status            text not null default 'draft' check (status in ('draft', 'published')),
  plays             bigint not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  published_at      timestamptz
);

create index if not exists tracks_status_published_idx on public.tracks (status, published_at desc);
create index if not exists tracks_album_idx on public.tracks (album_id, album_position);

-- ---------------------------------------------------------------- milestones
-- Only milestones Surgthflur writes himself live here. Automatic ones
-- (first upload, 10th track, first mix…) are calculated from real tracks.
create table if not exists public.milestones (
  id           text primary key default public.short_id(),
  title        text not null check (char_length(title) between 1 and 120),
  note         text check (char_length(note) <= 1000),
  happened_on  date,
  track_id     text references public.tracks(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------------------- profile
-- Exactly one row (id = 1). Everything is optional.
create table if not exists public.profile (
  id                 int primary key default 1 check (id = 1),
  artist_name        text not null default 'Surgthflur',
  tagline            text,
  bio                text,
  site_intro         text,
  photo_path         text,
  tiktok_url         text,
  youtube_url        text,
  facebook_url       text,
  compare_early_id   text references public.tracks(id) on delete set null,
  compare_recent_id  text references public.tracks(id) on delete set null,
  updated_at         timestamptz not null default now()
);

insert into public.profile (id) values (1) on conflict (id) do nothing;

-- --------------------------------------------------------------- subscribers
create table if not exists public.subscribers (
  id                 bigint generated always as identity primary key,
  email              text not null unique,
  unsubscribe_token  text not null default replace(gen_random_uuid()::text, '-', ''),
  created_at         timestamptz not null default now()
);

-- ----------------------------------------------------------------- reactions
create table if not exists public.reactions (
  track_id    text not null references public.tracks(id) on delete cascade,
  kind        text not null check (kind in ('fire', 'heart')),
  visitor     text not null,
  created_at  timestamptz not null default now(),
  primary key (track_id, kind, visitor)
);

-- ------------------------------------------------------------------ security
-- Row Level Security is ON with NO policies, so the public "anon" key cannot
-- read or write anything directly. All access goes through the Node server,
-- which uses the secret key and checks who is signed in.
alter table public.categories  enable row level security;
alter table public.albums      enable row level security;
alter table public.tracks      enable row level security;
alter table public.milestones  enable row level security;
alter table public.profile     enable row level security;
alter table public.subscribers enable row level security;
alter table public.reactions   enable row level security;

-- Belt and braces: the public roles get no table access at all, and the
-- server role gets exactly what it needs (newer Supabase projects don't
-- grant table access automatically).
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ----------------------------------------------------------------- functions
-- Adds one real play to a published track (atomic, no race conditions).
create or replace function public.increment_plays(p_track_id text)
returns bigint
language sql
security definer
set search_path = public
as $$
  update public.tracks
     set plays = plays + 1
   where id = p_track_id and status = 'published'
  returning plays;
$$;

-- Reaction totals per track, e.g. ('abc123', 'fire', 4)
create or replace function public.reaction_counts()
returns table (track_id text, kind text, total bigint)
language sql
stable
security definer
set search_path = public
as $$
  select track_id, kind, count(*) from public.reactions group by track_id, kind;
$$;

revoke execute on function public.increment_plays(text) from public, anon, authenticated;
revoke execute on function public.reaction_counts()     from public, anon, authenticated;
grant  execute on function public.increment_plays(text) to service_role;
grant  execute on function public.reaction_counts()     to service_role;

-- ------------------------------------------------------------------- storage
-- One public bucket for audio, video and images. Files can be *read* by anyone
-- with the link (needed for playback), but only the server can create upload
-- links, so only the signed-in creator can add files.
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;
