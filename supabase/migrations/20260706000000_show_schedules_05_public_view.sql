-- ============================================================================
-- 05 — Public read view for the landing page programme.
--
-- The marketing site (abhinaya-landing) reads the daily programme so the
-- "Now Showing" cards can list each film's real showtimes instead of the
-- hard-coded STANDARD_SHOWTIMES placeholder. It talks to Supabase with the
-- ANON key, but show_schedules RLS (01_rls) gates SELECT on is_entry_writer()
-- — anon has no email/role, so anon sees zero rows. We do NOT want to widen
-- the base-table policy: show_schedules also carries staff-only fields
-- (price_card_id, screen_id, notes) and forward-dated programming.
--
-- Instead expose a NARROW, definer-rights view of just what the public needs:
--   (cinema_id, schedule_date, movie_id, showtime)
-- for non-cancelled shows dated today-or-earlier in IST. Future programming
-- stays private; the landing derives "today's schedule, else the most recent
-- prior day" by taking the max schedule_date this view returns.
--
-- security_invoker = false (the default, stated explicitly): the view runs
-- with the owner's rights and therefore bypasses the base-table RLS, which is
-- exactly why anon can read the curated columns. The view itself is the
-- security boundary — it can only ever surface these four columns.
--
-- Idempotent (create or replace + idempotent grants).
-- ============================================================================

begin;

create or replace view public.public_show_schedule
  with (security_invoker = false) as
  select
    cinema_id,
    schedule_date,
    movie_id,
    showtime
  from public.show_schedules
  where cancelled = false
    and schedule_date <= (now() at time zone 'Asia/Kolkata')::date;

-- Curated read surface for the public landing page. authenticated staff can
-- read it too (harmless — they already see the full table via RLS).
grant select on public.public_show_schedule to anon, authenticated;

commit;

-- ============================================================================
-- VERIFY (run after applying):
--
--   -- As anon: should return today's (or the most recent prior day's) shows.
--   set role anon;
--   select schedule_date, movie_id, showtime
--     from public.public_show_schedule
--     order by schedule_date desc, showtime;
--   reset role;
--
--   -- Future-dated rows must NOT appear:
--   --   insert a row with schedule_date = tomorrow, confirm it is absent above.
-- ============================================================================
