-- ============================================================================
-- Per-movie WEEKLY distributor share % overrides.
--
-- Adds movies.week_shares (jsonb): a map of 1-based run week -> share %, e.g.
--   { "1": 60, "2": 55, "5": 50 }
-- keyed by the film's run week (week 1 = release_date .. release_date+6).
--
-- The DCR engine resolves an entry's share at compute time: a week with an
-- override here applies to EVERY DCR whose date falls in that run week
-- (resolveShare in app/src/lib/engine.ts), overriding the entry's stored
-- share. Weeks with no override fall back to the entry's own share (which
-- defaults from movies.share_pct), so existing DCRs are unchanged until a week
-- is set. Editable anytime in Settings -> Movies, independent of the 2-day DCR
-- edit lock (it lives on the catalog, not on entries).
--
-- RLS: inherited from public.movies (owner/manager write, read as already
-- configured) -- no new policy needed.
--
-- HOW TO RUN: applied by CI on push (staging branch -> staging DB, main ->
-- prod DB). Safe to re-run (idempotent); default '{}' backfills every row.
-- ============================================================================

alter table public.movies
  add column if not exists week_shares jsonb not null default '{}'::jsonb;
