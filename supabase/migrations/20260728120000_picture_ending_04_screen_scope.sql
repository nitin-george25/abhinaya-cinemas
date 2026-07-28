-- ============================================================================
-- Picture Ending — 04 — statements are scoped to one SCREEN × MOVIE.
--
-- WHY THIS EXISTS
-- ---------------
-- A Picture Ending Statement used to settle a film across the whole cinema:
-- every DCR entry for the movie, whichever audi it played in, rolled into one
-- weekly table. That only held while a film lived on a single screen.
--
-- A full house is a property of the SCREEN, so the hold-over date (the
-- publicity cutoff — the first day the best 3 shows take less than one full
-- house) is a per-screen signal. Pooling two screens meant the weaker one's
-- hold-over truncated the stronger one's publicity base, and the run span on
-- the printed statement covered days the distributor's copy could not be
-- reconciled against.
--
-- From here a film that played two screens is settled with two statements, one
-- per screen, each with its own run weeks, hold-over date and publicity base.
--
-- WHAT THIS DOES
-- --------------
--   a) picture_ending_statements.screen_id / screen_name — which screen the
--      statement settles, with the name denormalized like movie_name /
--      distributor_name so a filed document still renders if a screen is
--      later renamed. TEXT with no FK, matching show_schedules and the other
--      config-mirroring tables.
--   b) Backfills both on existing statements, but ONLY where the film played
--      exactly one screen — which is every statement filed so far, and is
--      unambiguous. Anything genuinely multi-screen is left null rather than
--      guessed at; the app renders those as "—".
--
-- Advances (distributor_payments) deliberately stay per FILM: money is paid to
-- the distributor for the picture, not for an audi. Each statement now ticks
-- which advances it deducts, which is what stops the same advance being
-- withheld twice across a two-screen film. No schema change needed for that —
-- the ticked subset is already snapshotted into the statement's `advances`
-- JSON column.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run on BOTH
-- staging and prod. Idempotent.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) The columns. Nullable — a pre-existing statement whose film played more
--    than one screen has no single right answer.
-- ----------------------------------------------------------------------------
alter table public.picture_ending_statements
  add column if not exists screen_id   text,
  add column if not exists screen_name text;

create index if not exists picture_ending_statements_screen_idx
  on public.picture_ending_statements (screen_id);

-- ----------------------------------------------------------------------------
-- 2) Backfill the unambiguous ones: statements for a film that only ever ran
--    on one screen. `having count(distinct ...) = 1` is the whole safety net.
-- ----------------------------------------------------------------------------
with single_screen as (
  select e.movie_id, min(e.screen_id) as screen_id
    from public.entries e
   where e.movie_id is not null
     and e.screen_id is not null
   group by e.movie_id
  having count(distinct e.screen_id) = 1
)
update public.picture_ending_statements p
   set screen_id   = ss.screen_id,
       screen_name = s.name
  from single_screen ss
  left join public.screens s on s.id = ss.screen_id
 where p.movie_id = ss.movie_id
   and p.screen_id is null;

commit;

-- ============================================================================
-- VERIFY (run after applying):
--
--   -- Columns present.
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='picture_ending_statements'
--      and column_name in ('screen_id','screen_name');        -- expect 2 rows
--
--   -- What got backfilled, and what was left for a human.
--   select screen_name, count(*)
--     from public.picture_ending_statements
--    group by 1 order by 2 desc;
--
--   -- Any statement still unscoped is a film that played several screens —
--   -- re-issue it per screen from Reports -> Picture Ending if it matters.
--   select statement_no, movie_name, statement_date
--     from public.picture_ending_statements
--    where screen_id is null
--    order by statement_no;
-- ============================================================================
