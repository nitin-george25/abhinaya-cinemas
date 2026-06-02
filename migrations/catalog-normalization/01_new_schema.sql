-- ============================================================================
-- 01 — New schema
--
-- Creates every new table. Additive only: nothing existing is dropped or
-- altered. Foreign keys reference tables that exist by the end of this file
-- (or pre-existing public.authorized_users where needed).
--
-- Constraints that need data to be populated first (NOT NULL, FK to
-- entries/fb_entries, EXCLUDE on tax_configs) are deferred to 06.
--
-- Idempotent via `if not exists`. Safe to re-run.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) brands — single row today (Abhinaya Cinemas). Multi-row when a partner
--    brand opens.
-- ----------------------------------------------------------------------------

create table if not exists public.brands (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  logo_url    text,
  created_at  timestamptz not null default now()
);


-- ----------------------------------------------------------------------------
-- 2) cinemas — the central tenant entity. Every operational + catalog row
--    references one of these.
-- ----------------------------------------------------------------------------

create table if not exists public.cinemas (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid references public.brands(id),
  brand_name      text not null default 'Abhinaya Cinemas',
  location        text not null,                       -- Perunna, Karunagappalli, etc

  gstin           text,
  pan             text,

  address_line1   text,
  address_line2   text,
  city            text,
  state           text,
  pincode         text,
  country         text not null default 'India',
  currency_code   text not null default 'INR',
  timezone        text not null default 'Asia/Kolkata',

  phone           text,
  email           text,

  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      text,

  constraint cinemas_brand_location_uk unique (brand_name, location)
);


-- ----------------------------------------------------------------------------
-- 3) tax_configs — temporal. Multiple rows per cinema, each effective for a
--    date range. The EXCLUDE constraint preventing overlapping ranges is
--    added in 06 (needs btree_gist + backfilled data).
-- ----------------------------------------------------------------------------

create table if not exists public.tax_configs (
  id               uuid primary key default gen_random_uuid(),
  cinema_id        uuid not null references public.cinemas(id) on delete cascade,
  valid_from       date not null,
  valid_to         date,                                -- null = currently in effect

  threshold        numeric(14,2) not null,
  above_etax_pct   numeric(6,3) not null,
  above_gst_pct    numeric(6,3) not null,
  below_etax_pct   numeric(6,3) not null,
  below_gst_pct    numeric(6,3) not null,
  tmc              numeric(14,2) not null,
  cess             numeric(14,2) not null,
  rep_day          numeric(14,2) not null,
  rep_night        numeric(14,2) not null,
  rep_1            numeric(14,2) not null,
  rep_2            numeric(14,2) not null,
  rep_5            numeric(14,2) not null,

  created_at       timestamptz not null default now(),
  updated_by       text
);

create index if not exists tax_configs_cinema_validity_idx
  on public.tax_configs (cinema_id, valid_from, valid_to);


-- ----------------------------------------------------------------------------
-- 4) classes — seat classes. Soft-deleted via archived_at.
-- ----------------------------------------------------------------------------

-- Note: id is text (not uuid) so legacy IDs like "cls_royale" survive the
-- backfill. New rows default to gen_random_uuid()::text. Same pattern on
-- screens, price_cards, movies, serial_starts, openings below — every
-- catalog table whose id is referenced from legacy JSONB data.
create table if not exists public.classes (
  id             text primary key default gen_random_uuid()::text,
  cinema_id      uuid not null references public.cinemas(id) on delete cascade,
  name           text not null,
  gst_pct        numeric(6,3) not null default 0,
  display_order  int not null default 0,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     text,
  constraint classes_cinema_name_uk unique (cinema_id, name)
);


-- ----------------------------------------------------------------------------
-- 5) screens
-- ----------------------------------------------------------------------------

create table if not exists public.screens (
  id             text primary key default gen_random_uuid()::text,
  cinema_id      uuid not null references public.cinemas(id) on delete cascade,
  name           text not null,
  display_order  int not null default 0,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     text,
  constraint screens_cinema_name_uk unique (cinema_id, name)
);


-- ----------------------------------------------------------------------------
-- 6) screen_classes — M:N screens × classes, with seat count per pairing
-- ----------------------------------------------------------------------------

create table if not exists public.screen_classes (
  screen_id  text not null references public.screens(id) on delete cascade,
  class_id   text not null references public.classes(id) on delete restrict,
  seats      int  not null default 0,
  primary key (screen_id, class_id)
);


-- ----------------------------------------------------------------------------
-- 7) price_cards
-- ----------------------------------------------------------------------------

create table if not exists public.price_cards (
  id             text primary key default gen_random_uuid()::text,
  screen_id      text not null references public.screens(id) on delete cascade,
  name           text not null,
  display_order  int not null default 0,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     text,
  constraint price_cards_screen_name_uk unique (screen_id, name)
);


-- ----------------------------------------------------------------------------
-- 8) price_card_prices — M:N price_cards × classes, with price per pairing
-- ----------------------------------------------------------------------------

create table if not exists public.price_card_prices (
  price_card_id  text not null references public.price_cards(id) on delete cascade,
  class_id       text not null references public.classes(id)     on delete restrict,
  price          numeric(14,2) not null,
  primary key (price_card_id, class_id)
);


-- ----------------------------------------------------------------------------
-- 9) movies
-- ----------------------------------------------------------------------------

create table if not exists public.movies (
  id             text primary key default gen_random_uuid()::text,
  cinema_id      uuid not null references public.cinemas(id) on delete restrict,
  name           text not null,
  distributor    text,
  release_date   date,
  share_pct      numeric(6,3) not null default 0,
  language       text,
  genre          text,
  certification  text,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     text
);

create index if not exists movies_cinema_idx on public.movies (cinema_id);


-- ----------------------------------------------------------------------------
-- 10) serial_starts — per (screen, date) ticket-serial bookkeeping
-- ----------------------------------------------------------------------------

create table if not exists public.serial_starts (
  id          text primary key default gen_random_uuid()::text,
  screen_id   text not null references public.screens(id) on delete cascade,
  start_date  date not null,
  created_at  timestamptz not null default now(),
  updated_by  text,
  constraint serial_starts_screen_date_uk unique (screen_id, start_date)
);


-- ----------------------------------------------------------------------------
-- 11) serial_start_classes — per-class starting number on that date
-- ----------------------------------------------------------------------------

create table if not exists public.serial_start_classes (
  serial_start_id  text not null references public.serial_starts(id) on delete cascade,
  class_id         text not null references public.classes(id)       on delete restrict,
  starting_number  int  not null,
  primary key (serial_start_id, class_id)
);


-- ----------------------------------------------------------------------------
-- 12) openings — pre-tool opening balances (movie × screen × date).
--      `vals` stays JSONB (Partial<CumulativeRow>) — engine consumes the
--      whole shape opaquely.
-- ----------------------------------------------------------------------------

create table if not exists public.openings (
  id          text primary key default gen_random_uuid()::text,
  movie_id    text not null references public.movies(id)  on delete restrict,
  screen_id   text not null references public.screens(id) on delete restrict,
  open_date   date not null,
  vals        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_by  text,
  constraint openings_movie_screen_date_uk unique (movie_id, screen_id, open_date)
);


-- ----------------------------------------------------------------------------
-- 13) audit_log — generic append-only audit. Populated by triggers in 04.
-- ----------------------------------------------------------------------------

create table if not exists public.audit_log (
  id           bigserial primary key,
  occurred_at  timestamptz not null default now(),
  actor_email  text,
  actor_role   text,
  cinema_id    uuid,
  table_name   text not null,
  row_id       text not null,
  action       text not null,             -- 'insert' | 'update' | 'delete' | 'reopen'
  before_val   jsonb,
  after_val    jsonb,
  diff         jsonb
);

create index if not exists audit_log_cinema_time_idx
  on public.audit_log (cinema_id, occurred_at desc);
create index if not exists audit_log_table_row_idx
  on public.audit_log (table_name, row_id);


-- ----------------------------------------------------------------------------
-- 14) realtime_version — sidecar table whose row updates the client
--      subscribes to. Avoids N realtime channels for N catalog tables.
-- ----------------------------------------------------------------------------

create table if not exists public.realtime_version (
  layer        text primary key,                       -- 'catalog' | 'operational'
  version      bigint not null default 0,
  updated_at   timestamptz not null default now()
);

insert into public.realtime_version (layer, version) values ('catalog', 0)
  on conflict (layer) do nothing;
insert into public.realtime_version (layer, version) values ('operational', 0)
  on conflict (layer) do nothing;


-- ----------------------------------------------------------------------------
-- Enable RLS on all new tables. Policies are defined in 03.
-- (Tables with no policies + RLS enabled = no rows visible, which is the
-- safe default.)
-- ----------------------------------------------------------------------------

alter table public.brands              enable row level security;
alter table public.cinemas             enable row level security;
alter table public.tax_configs         enable row level security;
alter table public.classes             enable row level security;
alter table public.screens             enable row level security;
alter table public.screen_classes      enable row level security;
alter table public.price_cards         enable row level security;
alter table public.price_card_prices   enable row level security;
alter table public.movies              enable row level security;
alter table public.serial_starts       enable row level security;
alter table public.serial_start_classes enable row level security;
alter table public.openings            enable row level security;
alter table public.audit_log           enable row level security;
alter table public.realtime_version    enable row level security;


commit;
