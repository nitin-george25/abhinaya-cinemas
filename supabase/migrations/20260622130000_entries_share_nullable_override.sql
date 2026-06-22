-- ============================================================================
-- Distributor share %: make the per-day override EXPLICIT (nullable).
--
-- Background: resolveShare() used to infer "this day was manually overridden"
-- from `entries.share <> movies.share_pct`. That heuristic was unreliable — a
-- day whose stored share was 0 (a cleared share field persisted 0) or merely a
-- copy of the base read as a deliberate override, so the per-run-week rate
-- (movies.week_shares) silently never applied. Symptom seen in production: a
-- DCR showing 0% distributor share even though the run week was set to 50%.
--
-- New model (app/src/lib/engine.ts resolveShare / hasShareOverride):
--   entries.share = NULL  -> no per-day override; inherit the week rate
--                            (movies.week_shares), else the base share_pct.
--   entries.share > 0     -> a deliberate per-day override that wins over the
--                            week rate.
--   0 / negative          -> never a real distributor deal; treated as "no
--                            override" (so a cleared field can never re-pin 0%).
--
-- This backfills existing rows to that model WITHOUT changing any already-filed
-- DCR's effective share:
--   * base-copy days (share == base) and stray 0 / NULL days  -> NULL.
--     These already took the week/base rate under the old code; the buggy 0%
--     days now correctly inherit it too.
--   * genuine per-day overrides (share <> base AND share > 0, e.g. 40% / 50%)
--     -> kept as-is, still honoured as overrides.
--
-- MUST ship together with the matching app code: until this runs, the new
-- engine would read every base-copy day's stored value as a per-day override.
--
-- HOW TO RUN: applied by CI on push (staging branch -> staging DB, main ->
-- prod DB). Idempotent — safe to re-run. Migrations run without a JWT, so the
-- entries_edit_lock trigger short-circuits (v_claims is null) and does not
-- block these updates.
-- ============================================================================

-- The per-day override is optional now.
alter table public.entries alter column share drop not null;

-- 1. base-copy days -> NULL (inherit the week/base rate, exactly as before).
update public.entries e
set share = null
from public.movies m
where e.movie_id = m.id
  and e.share is not null
  and e.share = m.share_pct;

-- 2. stray 0 / non-positive days -> NULL (the 0% bug; also covers any orphan
--    row whose movie is missing, which step 1's join would skip).
update public.entries
set share = null
where share is not null
  and share <= 0;
