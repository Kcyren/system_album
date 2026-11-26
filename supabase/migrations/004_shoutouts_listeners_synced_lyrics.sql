-- ============================================================================
-- Surgthflur - Music — update 004: shout-outs, live listeners, synced lyrics
-- Run once in Supabase → SQL Editor (safe to run again).
-- ============================================================================

-- Shout-outs: short messages from visitors. They stay hidden until approved.
create table if not exists public.shoutouts (
  id          text primary key default public.short_id(),
  track_id    text not null references public.tracks(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  message     text not null check (char_length(message) between 1 and 280),
  status      text not null default 'pending' check (status in ('pending', 'approved')),
  visitor     text,
  created_at  timestamptz not null default now()
);
create index if not exists shoutouts_track_idx on public.shoutouts (track_id, status, created_at desc);
create index if not exists shoutouts_status_idx on public.shoutouts (status, created_at desc);

-- Live listeners: one row per listener per track, refreshed while they listen.
create table if not exists public.listeners (
  visitor   text not null,
  track_id  text not null references public.tracks(id) on delete cascade,
  seen_at   timestamptz not null default now(),
  primary key (visitor, track_id)
);
create index if not exists listeners_track_seen_idx on public.listeners (track_id, seen_at desc);

-- Synced lyrics: the start time (seconds) of each lyric line. Blank lines = null.
alter table public.tracks add column if not exists lyrics_timing real[];
alter table public.tracks drop constraint if exists tracks_lyrics_timing_size;
alter table public.tracks add constraint tracks_lyrics_timing_size check (lyrics_timing is null or cardinality(lyrics_timing) <= 600);

-- Private by default: only the server (secret key) can read or write.
alter table public.shoutouts enable row level security;
alter table public.listeners enable row level security;
revoke all on public.shoutouts from anon, authenticated;
revoke all on public.listeners from anon, authenticated;
grant select, insert, update, delete on public.shoutouts to service_role;
grant select, insert, update, delete on public.listeners to service_role;
