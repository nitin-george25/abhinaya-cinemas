-- ============================================================================
-- 02 — Alter existing tables
--
-- Adds new columns to entries, fb_entries, fb_products, authorized_users.
-- All new columns are nullable initially so the backfill in 05 can populate
-- them. NOT NULL + FK constraints are added in 06 after backfill.
--
-- Existing columns are not modified, existing data is not touched.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) entries
--
-- + cinema_id  — for multi-cinema scoping and RLS
-- + closed_at  — once set, updates require an explicit "reopen" workflow
-- ----------------------------------------------------------------------------

alter table public.entries
  add column if not exists cinema_id  uuid references public.cinemas(id) on delete restrict,
  add column if not exists closed_at  timestamptz,
  add column if not exists closed_by  text;

create index if not exists entries_cinema_date_idx
  on public.entries (cinema_id, entry_date);


-- ----------------------------------------------------------------------------
-- 2) fb_entries
--
-- + cinema_id  — without it, multi-cinema SPH is impossible
-- + closed_at  — same close/reopen semantics as entries
--
-- We DO NOT drop the existing fb_entries_entry_date_key (the single-date
-- unique) here — 06 swaps it for a (cinema_id, entry_date) compound unique
-- after backfill has populated cinema_id.
-- ----------------------------------------------------------------------------

alter table public.fb_entries
  add column if not exists cinema_id  uuid references public.cinemas(id) on delete restrict,
  add column if not exists closed_at  timestamptz,
  add column if not exists closed_by  text;

create index if not exists fb_entries_cinema_date_idx
  on public.fb_entries (cinema_id, entry_date);


-- ----------------------------------------------------------------------------
-- 3) fb_products
--
-- + cinema_id  — per-cinema menu. Each cinema owns its own product rows.
--
-- Existing fb_products_name_key (unique on name alone) is dropped in 06
-- and replaced with (cinema_id, name) after backfill.
-- ----------------------------------------------------------------------------

alter table public.fb_products
  add column if not exists cinema_id  uuid references public.cinemas(id) on delete cascade;

create index if not exists fb_products_cinema_idx
  on public.fb_products (cinema_id);


-- ----------------------------------------------------------------------------
-- 4) authorized_users
--
-- + cinema_ids[]  — array of cinemas the user has access to.
--
-- Default '{}' so existing rows are valid; backfill in 05 populates with
-- the single-cinema id. RLS uses ANY(cinema_ids) in policies.
-- ----------------------------------------------------------------------------

alter table public.authorized_users
  add column if not exists cinema_ids uuid[] not null default '{}'::uuid[];

create index if not exists authorized_users_cinema_ids_gin
  on public.authorized_users using gin (cinema_ids);


commit;
