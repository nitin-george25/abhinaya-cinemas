-- ============================================================================
-- scripts/glasses-3d-audit.sql
--
-- Find shows carrying a 3D glasses charge, and specifically the ones that
-- DISAGREE with the programme — the cause of a "3D" field appearing on a show
-- that is not 3D.
--
-- Read-only. Run in the Supabase SQL Editor, one STEP at a time.
--
-- Background: whether a show is 3D lives on the programme (show_schedules.
-- is_3d). Ticket entry snapshots it onto the show as entries.shows[].glasses3d,
-- and the DCR engine only ever reads that snapshot — it never reads the
-- programme. So a snapshot that drifts away from its programme row keeps
-- billing while the Schedule says 2D.
--
-- Known ways they can drift:
--   • copy-forward carries is_3d onto a new day whose film was then changed
--   • the backfill script run with the default (unbounded) date range, so a
--     film that played 3D for part of its run got stamped across all of it
--   • rows stamped before the Schedule started mirroring changes down
-- ============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 1 — Everything currently carrying a charge, newest first.
--          `pairs` is what is actually billed (auto qty = paid tickets).
-- ═══════════════════════════════════════════════════════════════════════════
select e.entry_date,
       m.name                                   as movie,
       e.screen_id,
       sh ->> 'showtime'                        as showtime,
       (sh -> 'glasses3d' ->> 'rate')::numeric  as rate,
       sh -> 'glasses3d' ->> 'qty'              as qty_override,
       (select coalesce(sum((r.value ->> 'tickets')::numeric), 0)
          from jsonb_each(coalesce(sh -> 'rows', '{}'::jsonb)) r) as tickets,
       e.updated_by
  from public.entries e
  left join public.movies m on m.id = e.movie_id
  cross join lateral jsonb_array_elements(e.shows) sh
 where sh -> 'glasses3d' is not null
 order by e.entry_date desc, showtime
 limit 200;


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 2 — THE DRIFT. Shows billing for glasses whose programme row says 2D.
--
-- These are the ones showing a 3D field on a show you consider 2D. Matching
-- mirrors showIdxForSchedule: scheduleId first, showtime as the fallback.
--
-- Rows with `sched_is_3d = false` are wrongly billing.
-- Rows with `sched_is_3d` NULL have no programme row at all (pre-Schedule
-- history, or a day whose programme was replaced) — those are not drift, the
-- snapshot is all they have.
-- ═══════════════════════════════════════════════════════════════════════════
select e.entry_date,
       m.name                       as movie,
       e.screen_id,
       sh ->> 'showtime'            as showtime,
       s.is_3d                      as sched_is_3d,
       (select coalesce(sum((r.value ->> 'tickets')::numeric), 0)
          from jsonb_each(coalesce(sh -> 'rows', '{}'::jsonb)) r) as tickets,
       (select coalesce(sum((r.value ->> 'tickets')::numeric), 0)
          from jsonb_each(coalesce(sh -> 'rows', '{}'::jsonb)) r)
         * (sh -> 'glasses3d' ->> 'rate')::numeric               as billing
  from public.entries e
  left join public.movies m on m.id = e.movie_id
  cross join lateral jsonb_array_elements(e.shows) sh
  left join public.show_schedules s
         on s.schedule_date = e.entry_date
        and s.screen_id     = e.screen_id
        and (
              s.id::text = (sh ->> 'scheduleId')
              or (sh ->> 'scheduleId') is null
                 and left(s.showtime::text, 5) = (sh ->> 'showtime')
            )
 where sh -> 'glasses3d' is not null
   and coalesce(s.is_3d, false) = false
 order by e.entry_date desc;


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 3 — THE REVERSE. Programme says 3D but the show carries no charge.
--          These under-bill: the Schedule was ticked after the show was
--          already entered, before mirroring existed.
-- ═══════════════════════════════════════════════════════════════════════════
select s.schedule_date,
       m.name            as movie,
       s.screen_id,
       left(s.showtime::text, 5) as showtime
  from public.show_schedules s
  left join public.movies m on m.id = s.movie_id
  join public.entries e
    on e.entry_date = s.schedule_date
   and e.movie_id   = s.movie_id
   and e.screen_id  = s.screen_id
 where s.is_3d
   and not exists (
         select 1
           from jsonb_array_elements(e.shows) sh
          where sh -> 'glasses3d' is not null
            and (
                  sh ->> 'scheduleId' = s.id::text
                  or sh ->> 'showtime' = left(s.showtime::text, 5)
                )
       )
 order by s.schedule_date desc;
