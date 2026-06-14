-- ============================================================================
-- 99 — Rollback
--
-- Tears down everything from this migration:
--   • All triggers from 04
--   • All new tables from 01
--   • All added columns from 02
--   • All helper functions from 00
--   • All trigger functions
--   • Constraints added in 06 (auto-dropped with the columns they reference)
--
-- Only run if:
--   (a) Phases 1–6 ran cleanly but you've decided not to proceed.
--   (b) Phase 3 code cutover has NOT shipped yet — otherwise the legacy
--       config.data path is still live and rollback is safe.
--
-- After rollback the database is back to its pre-migration state and the
-- app keeps reading/writing public.config.data as before.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Drop triggers on existing tables (audit + realtime + consistency)
-- ----------------------------------------------------------------------------

drop trigger if exists trg_audit_entries           on public.entries;
drop trigger if exists trg_rt_entries              on public.entries;
drop trigger if exists trg_entries_cinema_consistency on public.entries;

drop trigger if exists trg_audit_fb_entries        on public.fb_entries;
drop trigger if exists trg_rt_fb_entries           on public.fb_entries;

drop trigger if exists trg_audit_fb_products       on public.fb_products;
drop trigger if exists trg_rt_fb_products          on public.fb_products;

drop trigger if exists trg_audit_authorized_users  on public.authorized_users;

-- ----------------------------------------------------------------------------
-- 2) Drop constraints we added in 06 on existing tables.
--
-- The (cinema_id, entry_date) unique on fb_entries is dropped; we restore
-- the original single-date unique afterward (since the legacy code path
-- relies on it).
-- ----------------------------------------------------------------------------

alter table public.entries     drop constraint if exists entries_movie_id_fkey;
alter table public.entries     drop constraint if exists entries_screen_id_fkey;

alter table public.fb_entries  drop constraint if exists fb_entries_cinema_date_uk;
alter table public.fb_products drop constraint if exists fb_products_cinema_name_uk;

-- Restore the original single-date unique constraint on fb_entries
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fb_entries_entry_date_key'
  ) then
    alter table public.fb_entries
      add constraint fb_entries_entry_date_key unique (entry_date);
  end if;
end $$;

-- Restore the original unique constraint on fb_products
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fb_products_name_key'
  ) then
    alter table public.fb_products
      add constraint fb_products_name_key unique (name);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3) Drop added columns from existing tables
-- ----------------------------------------------------------------------------

alter table public.entries
  drop column if exists cinema_id,
  drop column if exists closed_at,
  drop column if exists closed_by;

alter table public.fb_entries
  drop column if exists cinema_id,
  drop column if exists closed_at,
  drop column if exists closed_by;

alter table public.fb_products
  drop column if exists cinema_id;

alter table public.authorized_users
  drop column if exists cinema_ids;

-- ----------------------------------------------------------------------------
-- 4) Drop new tables — order matters for FK reasons; cascade for safety
-- ----------------------------------------------------------------------------

drop table if exists public.audit_log               cascade;
drop table if exists public.realtime_version        cascade;
drop table if exists public.openings                cascade;
drop table if exists public.serial_start_classes    cascade;
drop table if exists public.serial_starts           cascade;
drop table if exists public.price_card_prices       cascade;
drop table if exists public.price_cards             cascade;
drop table if exists public.screen_classes          cascade;
drop table if exists public.movies                  cascade;
drop table if exists public.screens                 cascade;
drop table if exists public.classes                 cascade;
drop table if exists public.tax_configs             cascade;
drop table if exists public.cinemas                 cascade;
drop table if exists public.brands                  cascade;

-- ----------------------------------------------------------------------------
-- 5) Drop trigger functions
-- ----------------------------------------------------------------------------

drop function if exists public.audit_row_change() cascade;
drop function if exists public.bump_realtime_version() cascade;
drop function if exists public.entries_cinema_consistency() cascade;

-- ----------------------------------------------------------------------------
-- 6) Drop helper functions
-- ----------------------------------------------------------------------------

drop function if exists public.cinema_access(uuid)   cascade;
drop function if exists public.is_owner()            cascade;
drop function if exists public.is_owner_or_manager() cascade;
drop function if exists public.is_entry_writer()     cascade;
drop function if exists public.caller_email()        cascade;
drop function if exists public.caller_role()         cascade;

-- Note: btree_gist + pgcrypto extensions are NOT dropped — they may be in
-- use by other things in the database.

commit;
