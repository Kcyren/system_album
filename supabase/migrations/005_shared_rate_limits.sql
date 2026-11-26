-- ============================================================================
-- Surgthflur - Music — update 005: spam protection that works on every server
-- Run once in Supabase → SQL Editor (safe to run again).
--
-- Vercel runs several copies of the site at once, so limits kept in memory
-- (e.g. "5 shout-outs per hour") could be dodged. This keeps the counts in
-- the database instead. Keys contain a scrambled (hashed) IP, never the real IP.
-- ============================================================================

create table if not exists public.rate_limits (
  key       text primary key,
  count     int not null default 0,
  reset_at  timestamptz not null
);

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;
grant select, insert, update, delete on public.rate_limits to service_role;

-- Counts one hit for p_key. Returns true if still within p_max hits per window.
create or replace function public.hit_rate_limit(p_key text, p_window_seconds int, p_max int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  hits int;
begin
  insert into public.rate_limits as r (key, count, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (key) do update set
    count    = case when r.reset_at < now() then 1 else r.count + 1 end,
    reset_at = case when r.reset_at < now() then now() + make_interval(secs => p_window_seconds) else r.reset_at end
  returning count into hits;

  -- Now and then, clear out expired entries.
  if random() < 0.02 then
    delete from public.rate_limits where reset_at < now() - interval '1 hour';
  end if;

  return hits <= p_max;
end;
$$;

revoke execute on function public.hit_rate_limit(text, int, int) from public, anon, authenticated;
grant  execute on function public.hit_rate_limit(text, int, int) to service_role;
