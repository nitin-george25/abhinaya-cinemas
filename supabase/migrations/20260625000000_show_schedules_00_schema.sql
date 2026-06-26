-- ============================================================================
-- 00 — Show schedules schema
--
-- Backs the new two-stage box-office workflow:
--   1. SCHEDULE  — owner/manager/daily_manager programme each (date, screen):
--                  an ordered list of shows, each = showtime + movie + price
--                  card. This is forward-looking; rows can exist for future
--                  dates with no side effects on the DCR engine.
--   2. ENTRIES   — box-office ticket counts are derived from the schedule and
--                  unlock per-show, 30 min after each showtime (handled in the
--                  app; this table is only the programme).
--
-- Why a separate table (not pre-created `entries` rows): the DCR engine treats
-- a show as "real" on its showtime alone (isRealShow → rep batta / fund / the
-- chronological serial roll), so phantom zero-ticket future rows in `entries`
-- would corrupt the locked math, History, the movie-status engine and the
-- dashboard. Keeping the programme in its own table leaves every `entries`
-- consumer bit-identical. An entered show links back via Show.scheduleId in the
-- entries.shows JSONB (the engine never reads it).
--
-- Idempotent. Reuses helpers cinema_access() / is_entry_writer() (defined in
-- the cash + catalog-normalization migrations); RLS lives in 01_rls.
--
-- Column note: screen_id / movie_id / price_card_id are TEXT with no FK — same
-- as public.entries — because catalog ids are TEXT and the normalized catalog
-- mirror can lag the config blob during the Phase-3 dual-write window. The app
-- validates against the catalog client-side.
-- ============================================================================

begin;

create table if not exists public.show_schedules (
  id            uuid primary key default gen_random_uuid(),
  cinema_id     uuid not null references public.cinemas(id) on delete cascade,
  schedule_date date not null,
  screen_id     text not null,
  movie_id      text not null,
  price_card_id text,
  showtime      time not null,               -- HH:MM IST wall-clock
  position      int  not null default 0,     -- display order within (date, screen)
  cancelled     boolean not null default false,
  notes         text,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_by    text,
  updated_at    timestamptz not null default now(),
  -- One show per screen per date per start time — the double-booking guard
  -- and the sync upsert's onConflict target.
  constraint show_schedules_unique unique (cinema_id, schedule_date, screen_id, showtime)
);

create index if not exists show_schedules_date_screen_idx
  on public.show_schedules (cinema_id, schedule_date, screen_id, position);

alter table public.show_schedules enable row level security;

commit;
