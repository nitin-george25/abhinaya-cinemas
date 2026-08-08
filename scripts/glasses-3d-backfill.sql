-- ============================================================================
-- scripts/glasses-3d-backfill.sql
--
-- Add the 3D glasses rental line to shows that were ALREADY ENTERED before the
-- feature existed.
--
-- This is NOT a migration — it lives in scripts/ on purpose. `supabase db push`
-- applies every file in supabase/migrations/ exactly once, which is wrong for a
-- script you edit and re-run per film. Run this by hand instead:
--
--   Supabase dashboard → SQL Editor → paste → run one STEP at a time
--   or:  psql "$DATABASE_URL" -f scripts/glasses-3d-backfill.sql
--
-- Run against STAGING first. Open one backfilled DCR and check the figures
-- before touching prod.
--
-- ── WHAT IT WRITES ─────────────────────────────────────────────────────────
-- Each matching show in entries.shows gains:
--     "glasses3d": { "rate": 30, "gstPct": 18 }
--
-- `qty` is deliberately ABSENT. The engine reads that as "auto" and resolves
-- the charge to the show's paid ticket count at render time — so backfilled
-- shows need no quantity, stay correct if a ticket count is later corrected,
-- and bill nothing on a zero-ticket show. Free passes are never charged.
--
-- ── WHAT IT CANNOT AFFECT ──────────────────────────────────────────────────
-- Gross Collection, Net Share, DS and ES. The glasses lane is computed in
-- parallel to the box office and feeds none of them, so backfilling cannot
-- change any figure a distributor was ever settled against. Picture Ending
-- Statements already filed are likewise untouched.
--
-- ── THE 2-DAY EDIT LOCK ────────────────────────────────────────────────────
-- trg_entries_edit_lock freezes entries.shows past 2 days for every role but
-- owner. A service-role / direct-DB connection bypasses it by design (see
-- 20260620100000_entries_share_editable_after_lock.sql), so this script works
-- on any date. The SQL Editor runs as service role.
--
-- ── IDEMPOTENT ─────────────────────────────────────────────────────────────
-- A show that already carries glasses3d is skipped untouched, so re-running
-- never double-charges and never overwrites a hand-set quantity.
-- ============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 1 — Find the film. Which runs are candidates?
-- ═══════════════════════════════════════════════════════════════════════════
select e.movie_id,
       m.name,
       min(e.entry_date)                      as first_day,
       max(e.entry_date)                      as last_day,
       count(*)                               as dcr_days,
       sum(jsonb_array_length(e.shows))       as shows,
       count(*) filter (
         where exists (select 1 from jsonb_array_elements(e.shows) s
                        where s -> 'glasses3d' is not null)
       )                                      as days_already_3d
  from public.entries e
  left join public.movies m on m.id = e.movie_id
 where e.shows is not null
   and jsonb_typeof(e.shows) = 'array'
 group by e.movie_id, m.name
 order by first_day desc
 limit 60;


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 2 — PREVIEW. Edit the three ►► lines, then run.
--
-- Nothing is written. Check `pairs_to_bill` and `total_to_add` against what
-- you remember collecting before going on to STEP 3.
--
-- Date bounds are optional — the defaults cover a film's whole run. Narrow
-- them if only part of the run played 3D (e.g. a film that moved to 2D prints
-- after opening week).
-- ═══════════════════════════════════════════════════════════════════════════
with target as (
  select e.*
    from public.entries e
   where e.movie_id in ('PUT-MOVIE-ID-HERE')        -- ►► from STEP 1
     and e.entry_date >= '1900-01-01'::date         -- ►► optional run start
     and e.entry_date <= '2999-12-31'::date         -- ►► optional run end
     and e.shows is not null
     and jsonb_typeof(e.shows) = 'array'
),
per_show as (
  select t.entry_date,
         t.movie_id,
         t.screen_id,
         sh -> 'glasses3d' is not null as already_3d,
         (select coalesce(sum((r.value ->> 'tickets')::numeric), 0)
            from jsonb_each(coalesce(sh -> 'rows', '{}'::jsonb)) r) as tickets
    from target t
    cross join lateral jsonb_array_elements(t.shows) sh
)
select count(distinct (entry_date, movie_id, screen_id))         as dcr_days,
       count(*) filter (where not already_3d)                    as shows_to_backfill,
       count(*) filter (where already_3d)                        as shows_skipped,
       coalesce(sum(tickets) filter (where not already_3d), 0)    as pairs_to_bill,
       coalesce(sum(tickets) filter (where not already_3d), 0) * 30 as total_to_add
  from per_show;


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 3 — WRITE. Same movie_id / dates as STEP 2, and the rate the shows
--          actually played at (30 unless you changed it since).
--
-- The rate is snapshotted onto each show exactly as a live entry would do, so
-- these DCRs keep printing this rate even if Settings changes later.
-- ═══════════════════════════════════════════════════════════════════════════
update public.entries e
   set shows = (
         select jsonb_agg(
                  case
                    when sh -> 'glasses3d' is null
                      then sh || jsonb_build_object(
                             'glasses3d',
                             jsonb_build_object('rate', 30, 'gstPct', 18))  -- ►► rate
                    else sh
                  end
                  order by ord
                )
           from jsonb_array_elements(e.shows) with ordinality x(sh, ord)
       ),
       updated_by = 'glasses-3d-backfill',
       updated_at = now()
 where e.movie_id in ('PUT-MOVIE-ID-HERE')          -- ►► same as STEP 2
   and e.entry_date >= '1900-01-01'::date            -- ►► same as STEP 2
   and e.entry_date <= '2999-12-31'::date            -- ►► same as STEP 2
   and e.shows is not null
   and jsonb_typeof(e.shows) = 'array'
   and exists (select 1 from jsonb_array_elements(e.shows) s
                where s -> 'glasses3d' is null);


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 4 — VERIFY. Per-day pairs and rupees now on the books.
-- ═══════════════════════════════════════════════════════════════════════════
select e.entry_date,
       m.name,
       e.screen_id,
       count(*)                                  as shows_3d,
       sum((select coalesce(sum((r.value ->> 'tickets')::numeric), 0)
              from jsonb_each(coalesce(sh -> 'rows', '{}'::jsonb)) r)) as pairs,
       sum((select coalesce(sum((r.value ->> 'tickets')::numeric), 0)
              from jsonb_each(coalesce(sh -> 'rows', '{}'::jsonb)) r)
           * (sh -> 'glasses3d' ->> 'rate')::numeric)                  as amount
  from public.entries e
  left join public.movies m on m.id = e.movie_id
  cross join lateral jsonb_array_elements(e.shows) sh
 where e.movie_id in ('PUT-MOVIE-ID-HERE')          -- ►► same as STEP 2
   and sh -> 'glasses3d' is not null
 group by e.entry_date, m.name, e.screen_id
 order by e.entry_date;


-- ═══════════════════════════════════════════════════════════════════════════
-- UNDO — removes the glasses line from the targeted run. Use only if a
--        backfill hit the wrong film. This also erases hand-set quantities.
-- ═══════════════════════════════════════════════════════════════════════════
-- update public.entries e
--    set shows = (
--          select jsonb_agg(sh - 'glasses3d' order by ord)
--            from jsonb_array_elements(e.shows) with ordinality x(sh, ord)
--        ),
--        updated_by = 'glasses-3d-backfill-undo',
--        updated_at = now()
--  where e.movie_id in ('PUT-MOVIE-ID-HERE')
--    and e.shows is not null
--    and jsonb_typeof(e.shows) = 'array';
