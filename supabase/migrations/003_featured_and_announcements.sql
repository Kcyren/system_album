-- ============================================================================
-- System Album — update 003: featured track + new-release emails
-- Run once in Supabase → SQL Editor (safe to run again).
-- ============================================================================

-- The track shown in the big spinning record on the homepage.
-- Empty = show the newest upload. Cleared automatically if the track is deleted.
alter table public.profile
  add column if not exists featured_track_id text references public.tracks(id) on delete set null;

-- When followers were emailed about this track (so nobody is emailed twice).
alter table public.tracks
  add column if not exists announced_at timestamptz;
