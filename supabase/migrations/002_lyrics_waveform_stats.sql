-- ============================================================================
-- System Album — update 002: lyrics, waveforms and weekly play stats
-- Run once in Supabase → SQL Editor (safe to run again).
-- ============================================================================

-- Lyrics / bars for a track (optional)
alter table public.tracks add column if not exists lyrics text;
alter table public.tracks drop constraint if exists tracks_lyrics_length;
alter table public.tracks add constraint tracks_lyrics_length check (char_length(lyrics) <= 10000);

-- Waveform: up to 400 bar heights from 0 to 100, calculated in the Studio
alter table public.tracks add column if not exists waveform smallint[];
alter table public.tracks drop constraint if exists tracks_waveform_size;
alter table public.tracks add constraint tracks_waveform_size check (waveform is null or cardinality(waveform) <= 400);

-- Plays per track per day (UTC), used for the weekly chart in the Studio.
-- History starts from the day this update is installed.
create table if not exists public.play_daily (
  track_id  text not null references public.tracks(id) on delete cascade,
  day       date not null,
  plays     int  not null default 0,
  primary key (track_id, day)
);
create index if not exists play_daily_day_idx on public.play_daily (day);

alter table public.play_daily enable row level security;
revoke all on public.play_daily from anon, authenticated;
grant select, insert, update, delete on public.play_daily to service_role;

-- Counting a play now also records it for the day.
create or replace function public.increment_plays(p_track_id text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  total bigint;
begin
  update public.tracks
     set plays = plays + 1
   where id = p_track_id and status = 'published'
  returning plays into total;

  if total is not null then
    insert into public.play_daily (track_id, day, plays)
    values (p_track_id, (now() at time zone 'utc')::date, 1)
    on conflict (track_id, day) do update set plays = public.play_daily.plays + 1;
  end if;

  return total;
end;
$$;

revoke execute on function public.increment_plays(text) from public, anon, authenticated;
grant  execute on function public.increment_plays(text) to service_role;
