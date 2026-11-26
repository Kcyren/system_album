-- ============================================================================
-- Surgthflur - Music — update 007: when each lyric line ENDS
-- Run once in Supabase → SQL Editor (safe to run again).
--
-- Auto-sync now saves when each line finishes, so the lyric on the cover
-- disappears during intros, beat breaks and outros instead of lingering.
-- ============================================================================

alter table public.tracks add column if not exists lyrics_ends real[];
alter table public.tracks drop constraint if exists tracks_lyrics_ends_size;
alter table public.tracks add constraint tracks_lyrics_ends_size check (lyrics_ends is null or cardinality(lyrics_ends) <= 600);
