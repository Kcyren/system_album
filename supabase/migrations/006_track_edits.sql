-- ============================================================================
-- Surgthflur - Music — update 006: trim & cut (non-destructive editing)
-- Run once in Supabase → SQL Editor (safe to run again).
--
-- The original recording is never changed. "edit" stores what to play:
--   { "start": 3.2, "end": 140.5, "cuts": [[60.1, 64.8]], "fadeIn": 1, "fadeOut": 2 }
-- (seconds). The site skips the cut parts and applies the fades while playing.
-- ============================================================================

alter table public.tracks add column if not exists edit jsonb;
alter table public.tracks drop constraint if exists tracks_edit_is_object;
alter table public.tracks add constraint tracks_edit_is_object check (edit is null or jsonb_typeof(edit) = 'object');
