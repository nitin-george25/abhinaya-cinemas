# Abhinaya Cinemas — DB Architecture (v2)

A full database design for the way the app needs to work in the next 5
years, not just a port of the current JSONB blob. Written to be honest:
some decisions are essential, others are nice-to-have. Each is marked.

This document supersedes the earlier "DB Normalization Design" file.

---

## Principles

1. **Multi-tenant from row zero.** Every operational table carries
   `cinema_id`. Single-cinema today is just `count = 1`. Multi-cinema
   later is `count > 1` with zero schema migration.
2. **Compliance-grade integrity.** Foreign keys with explicit
   CASCADE / RESTRICT rules. No silent orphan IDs. DCRs are legal
   documents; the DB enforces that the data referenced by them can't
   vanish underneath them.
3. **Temporal correctness.** Tax rates and price cards change over
   time. Historical entries must keep computing against the rates that
   were in effect when they were recorded, never against today's
   rates. Modeled with `valid_from` / `valid_to` columns.
4. **Per-row audit.** Every catalog change records who, what, when.
   Implemented with a generic `audit_log` table and an `AFTER` trigger
   per catalog table. Satisfies the "show me every change to movies
   in the last 30 days" question a CA might ask.
5. **Money is `numeric(14,2)`.** Never floats. Paise are first-class.
6. **Time is IST.** All `date` columns mean IST business days. All
   `timestamptz` columns store UTC + render IST in the app — the
   well-worn rule the legacy already lives by.
7. **Catalog vs operational vs analytical.** Three layers, three
   write patterns, three RLS profiles. Don't mix them.
8. **Soft delete by default.** Use `archived_at timestamptz null` for
   catalog rows. `is_active` is implicit (`archived_at is null`).
   Hard delete is reserved for "this was created in error and has
   never been referenced".
9. **Realtime stays one channel per logical area.** Sidecar a
   `realtime_version` table so the client gets one notification per
   catalog edit, not N for the underlying tables.

---

## Layers

### Catalog (low-write, high-read)
**Cinemas, screens, classes, price cards, movies, tax configs, serial
starts, openings.** Edited a few times a month. Loaded on app boot.
Every entry computation references it. Demands referential integrity
and temporal correctness above all else.

### Operational (high-write, append-mostly)
**Entries (BO), fb_entries (F&B), shows, order rows.** One row per
business event. Heaviest read load is "give me the last 30 days for
the dashboard." Demands fast date-range scans and concurrent-write
safety.

### Analytical (read-only, derived)
**Materialized views and computed aggregates.** Daily P&L, monthly
summaries, per-movie revenue. Refreshed on a schedule. Lets the
dashboard query against pre-aggregated data instead of recomputing
from the operational tables every render.

### Audit (append-only)
**audit_log, login_history.** Truth of what changed and by whom.
Never updated, only inserted.

---

## Domain model

```
Brand ──> Cinema ──> Screen ──> ScreenClass ──> Class
                              \
                               > PriceCard ──> PriceCardPrice ──> Class
                              /
                              > SerialStart ──> SerialStartClass ──> Class
                              > Movie
                              > Opening (Movie × Screen × date)

Cinema ──> Entry (date × Movie × Screen)
       ──> FbEntry (date)              ← cinema_id now
       ──> FbOrder ──> FbOrderLine     ← future, see §6

User ──> AuthorizedUser (role × cinema_id)

TaxConfig (cinema_id × valid_from × valid_to)   ← temporal
PriceCard.prices                                ← snapshot-on-entry
```

The two new arrows (cinema → fb_entry, temporal tax_config) are the
biggest changes from v1.

---

## Tables

For each table: purpose, columns, write semantics, why it's like that.

### `brands` ★ nice-to-have

Single row today (`Abhinaya Cinemas`). Lets you have multiple cinemas
under multiple brands later — e.g. if Abhinaya runs a co-branded
location with another chain.

```sql
create table public.brands (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  logo_url    text,
  created_at  timestamptz not null default now()
);
```

Could skip in Phase 1. Stick `brand` text on `cinemas` directly. Easy
to extract later if needed.

### `cinemas` ★ essential

```sql
create table public.cinemas (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid references public.brands(id),
  brand_name      text not null default 'Abhinaya Cinemas',  -- denorm for ease
  location        text not null,                              -- Perunna, etc

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

  unique (brand_name, location)
);
```

Why `timezone` even though it's IST everywhere today: the moment a
cinema in a different state opens (or in a different country), you
need it to compute business-day boundaries correctly. Cheap insurance.

### `tax_configs` ★ essential, **temporal**

This is the biggest correctness fix vs v1. Tax rates change. GST
slabs are revised. Currently changing a rate retroactively breaks
every historical DCR — illegal.

```sql
create table public.tax_configs (
  id               uuid primary key default gen_random_uuid(),
  cinema_id        uuid not null references public.cinemas(id) on delete cascade,
  valid_from       date not null,
  valid_to         date,                          -- null = currently in effect

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
  updated_by       text,

  exclude using gist (cinema_id with =, daterange(valid_from, valid_to, '[]') with &&)
);
```

The `exclude` constraint stops two tax configs from being effective
on overlapping dates for the same cinema. When the operator edits the
rate, the app:

1. Closes the current row (`valid_to = today - 1`).
2. Inserts a new row (`valid_from = today`, `valid_to = null`).

The engine reads the row where `entry_date between valid_from and
coalesce(valid_to, '9999-12-31')`. A 2024 entry stays computed
against 2024's rates forever, even after 2025's rates take effect.

### `classes` ★ essential

```sql
create table public.classes (
  id             uuid primary key default gen_random_uuid(),
  cinema_id      uuid not null references public.cinemas(id) on delete cascade,
  name           text not null,
  gst_pct        numeric(6,3) not null default 0,
  display_order  int not null default 0,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     text,
  unique (cinema_id, name)
);
```

### `screens` ★ essential

```sql
create table public.screens (
  id             uuid primary key default gen_random_uuid(),
  cinema_id      uuid not null references public.cinemas(id) on delete cascade,
  name           text not null,
  display_order  int not null default 0,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     text,
  unique (cinema_id, name)
);
```

### `screen_classes`, `price_cards`, `price_card_prices`, `serial_starts`, `serial_start_classes`

Unchanged from v1. M:N join tables with composite PKs. See the
previous document; details haven't shifted. The only change is they
inherit `cinema_id` transitively through `screens` — RLS uses that
chain.

### `movies` ★ essential, **cinema-scoped**

```sql
create table public.movies (
  id             uuid primary key default gen_random_uuid(),
  cinema_id      uuid not null references public.cinemas(id) on delete restrict,
  name           text not null,
  distributor    text,
  release_date   date,
  share_pct      numeric(6,3) not null default 0,
  language       text,                            -- Malayalam, Hindi, English…
  genre          text,                            -- for future analytics
  certification  text,                            -- U / UA / A — for tax computation later
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     text
);
```

`language`, `genre`, `certification` are new — cheap to add now,
unlock future cohort analytics ("which Malayalam films perform best
on Tuesdays") and matter for tax computation in some states (U-rated
films have different tax slabs in Kerala historically).

One movie row per (cinema, film). If the same film plays at Perunna
and Karunagappalli, you have two rows because the distributor share %
is negotiated per-location. Trade-off accepted: slightly more typing
when programming a film into a second location, dramatically simpler
share-settlement math.

### `entries` ★ essential, **gains FKs + cinema_id**

```sql
alter table public.entries
  add column cinema_id uuid references public.cinemas(id) on delete restrict;

-- Backfill cinema_id from screens during migration.

alter table public.entries
  alter column cinema_id set not null;

alter table public.entries
  add constraint entries_movie_id_fkey
    foreign key (movie_id) references public.movies(id) on delete restrict,
  add constraint entries_screen_id_fkey
    foreign key (screen_id) references public.screens(id) on delete restrict,
  add constraint entries_cinema_movie_check
    check (cinema_id = (select cinema_id from movies where id = movie_id)),
  add constraint entries_cinema_screen_check
    check (cinema_id = (select cinema_id from screens where id = screen_id));
```

`entries.shows` stays JSONB. Per the v1 decision: not normalizing.

`closed_at timestamptz null` — once a day is closed (DCR generated,
distributor signed off), updates are blocked at the DB level. Forces
corrections to go through a "reopen" workflow, which is itself
audited.

### `fb_entries` ★ essential, **now has cinema_id**

This is the change you flagged. Without it, multi-cinema SPH is
impossible.

```sql
alter table public.fb_entries
  add column cinema_id uuid references public.cinemas(id) on delete restrict;

-- Backfill cinema_id = single cinema's id during migration.

alter table public.fb_entries
  alter column cinema_id set not null,
  drop constraint fb_entries_entry_date_key,                  -- was unique on date alone
  add constraint fb_entries_cinema_date_uk unique (cinema_id, entry_date);
```

Now SPH = `sum(fb.summary->>'grossSales') / sum(bo.audience)` joined
on `(cinema_id, entry_date)`. Reports can group by cinema cleanly.

`closed_at timestamptz null` — same as entries.

### `fb_products` ★ essential, **now per-cinema**

The menu, the pricing, the GST treatment — every F&B catalog field is
per-cinema. A Coke at Perunna and a Coke at Karunagappalli are
modeled as **two separate rows**, not one shared product with two
prices. Reasons:

- Match the rest of the schema's pattern (one movie row per cinema).
- Each cinema's POS is its own system with its own internal item IDs,
  GST rates, and category names. A shared product would force
  reconciliation work on every edit.
- Future combos / regional menu items (e.g. Karunagappalli might
  serve Tapioca Chips that Perunna doesn't) are first-class.

```sql
alter table public.fb_products
  add column cinema_id uuid references public.cinemas(id) on delete cascade;

-- Backfill: cinema_id = the single cinema's id during migration.

alter table public.fb_products
  alter column cinema_id set not null,
  drop constraint if exists fb_products_name_key,
  add constraint fb_products_cinema_name_uk unique (cinema_id, name);
```

For Phase 1 the menu structure on `fb_products` stays as-is —
`name`, `category`, `default_rate`, `default_gst_pct`,
`pos_item_number`, `is_active`. The only addition is `cinema_id`.

**Where pricing belongs.** F&B doesn't use price cards (those are BO-
only). The `default_rate` on the product is the day-to-day price.
That's per-row, so per-cinema by construction. If you later need
time-varying menu prices (e.g. festival surcharges), the right
extension is a `fb_product_prices` table with `valid_from` /
`valid_to`, mirroring the temporal pattern used for `tax_configs`.
Not in Phase 1.

**For future `fb_orders` / `fb_order_lines`** (Phase 2): `cinema_id`
is on `fb_orders`. `fb_order_lines` inherits via `order_id`. Same
RLS shape as everything else.

### `fb_orders` and `fb_order_lines` ☆ nice-to-have, **Phase 2**

If you ever want hourly demand patterns, basket analysis, or
order-time-vs-showtime correlation, model the POS at transaction
granularity:

```sql
create table public.fb_orders (
  id           uuid primary key default gen_random_uuid(),
  cinema_id    uuid not null references public.cinemas(id),
  ordered_at   timestamptz not null,
  bill_no      text,
  total        numeric(14,2) not null,
  tax          numeric(14,2) not null,
  source       text,                                 -- pos, app, online
  created_at   timestamptz not null default now()
);
create table public.fb_order_lines (
  order_id     uuid not null references public.fb_orders(id) on delete cascade,
  product_id   uuid references public.fb_products(id),  -- cinema-scoped via product
  product_name text not null,                            -- snapshot of name-at-time
  qty          numeric(12,3) not null,
  unit_price   numeric(14,2) not null,                   -- snapshot of price-at-time
  net_amount   numeric(14,2) not null,
  category     text
);
```

Today's `fb_entries` becomes a materialized daily roll-up over these.
Defer until the POS supports per-transaction export. Mention now so
the schema doesn't paint us into a corner.

`fb_orders.cinema_id` is mandatory. `fb_order_lines` inherits cinema
via the order — no duplication. The `product_name` and `unit_price`
on the line are **snapshots at sale time** so renaming a product or
changing its rate doesn't retroactively rewrite history.

### `authorized_users` ★ scoped to cinemas

```sql
alter table public.authorized_users
  add column cinema_ids uuid[] not null default '{}'::uuid[];
```

A user can be granted access to one cinema (today's reality) or many
(a regional manager later). The role still determines what they can
do; the array determines where. RLS becomes:

```sql
auth.uid() in (
  select au.user_id from authorized_users au
  where row.cinema_id = any(au.cinema_ids)
)
```

For single-cinema today: `cinema_ids = ARRAY[<the_cinema_id>]`.

### `audit_log` ★ essential

```sql
create table public.audit_log (
  id           bigserial primary key,
  occurred_at  timestamptz not null default now(),
  actor_email  text,
  actor_role   text,
  cinema_id    uuid,
  table_name   text not null,
  row_id       text not null,
  action       text not null,                         -- insert | update | delete | reopen
  before_val   jsonb,
  after_val    jsonb,
  diff         jsonb
);
create index on audit_log (cinema_id, occurred_at desc);
create index on audit_log (table_name, row_id);
```

One row per change to any catalog or operational table. Generic
trigger writes to it (no per-table boilerplate). Lets you answer
"what changed to this movie's distributor share in the last 6
months?" with a single query.

### `realtime_version` ★ essential (lightweight)

```sql
create table public.realtime_version (
  layer        text primary key,                     -- 'catalog' | 'operational'
  version      bigint not null default 0,
  updated_at   timestamptz not null default now()
);
```

Triggers on catalog tables bump `version`. Client subscribes to
`realtime_version` (one channel) and refetches the catalog when it
changes. Avoids N realtime subscriptions for N tables.

### Materialized views ☆ nice-to-have, Phase 2

```sql
create materialized view public.mv_daily_pl as
  select
    e.cinema_id,
    e.entry_date,
    sum(...) as bo_gross,
    sum(...) as bo_net,
    f.food_sales,
    f.beverages_sales,
    f.total_with_tax as fb_total,
    sum(e.audience) as audience,
    case when sum(e.audience) > 0
         then (f.food_sales + f.beverages_sales) / sum(e.audience)
         else null
    end as sph
  from entries e
    left join fb_entries f on f.cinema_id = e.cinema_id
                          and f.entry_date = e.entry_date
  group by e.cinema_id, e.entry_date, f.food_sales, f.beverages_sales,
           f.total_with_tax;

create unique index on mv_daily_pl (cinema_id, entry_date);
```

Refreshed nightly via `pg_cron`. Dashboard reads from this instead of
recomputing — query latency drops from 200 ms+ to <10 ms even at
year-5 scale.

---

## Cross-cutting concerns

### Foreign key cascade matrix

| Parent table | Child | On parent delete | Why |
|---|---|---|---|
| cinemas | tax_configs, classes, screens | CASCADE | parent's footprint gone |
| cinemas | movies | RESTRICT | RESTRICT for the safety net during operator-error deletes |
| cinemas | entries, fb_entries | RESTRICT | historical data is sacred |
| screens | screen_classes, price_cards, serial_starts | CASCADE | screen retirement takes its assignments |
| screens, movies | entries | RESTRICT | history-protecting |
| classes | screen_classes, price_card_prices, serial_start_classes | RESTRICT | operator must detach first |
| price_cards | price_card_prices | CASCADE | prices belong to the card |
| serial_starts | serial_start_classes | CASCADE | starts belong to the (screen, date) row |

`archived_at` is the day-to-day soft-retire mechanism. Hard delete
is reserved for "never had entries against it; this was a typo".

### RLS — pattern

Three helper functions, then policies are one-liners:

```sql
create function public.cinema_access(cid uuid) returns boolean as $$
  select cid = any((
    select cinema_ids from authorized_users
    where lower(email) = lower(auth.jwt() ->> 'email')
  ));
$$ language sql stable security definer;

create function public.is_owner() returns boolean as $$
  select role = 'owner' from authorized_users
  where lower(email) = lower(auth.jwt() ->> 'email');
$$ language sql stable security definer;

create function public.is_entry_writer() returns boolean as $$
  select role in ('owner','manager','daily_manager')
  from authorized_users
  where lower(email) = lower(auth.jwt() ->> 'email');
$$ language sql stable security definer;
```

Then for, say, `movies`:

```sql
create policy movies_read on movies
  for select using (public.cinema_access(cinema_id));

create policy movies_write on movies
  for all using (public.cinema_access(cinema_id) and public.is_owner_or_manager())
         with check (public.cinema_access(cinema_id) and public.is_owner_or_manager());
```

Reading is gated to cinemas you have access to. Writing additionally
needs the right role. Multi-cinema future: just add cinema IDs to the
user's array.

### Money

All ₹ amounts: `numeric(14,2)`. That's enough for ₹9,99,99,99,999.99
per row (a billion crore) — safely beyond any single-day collection.
Never use `double precision` or `real` for money.

### Time

- `date` columns: business days in IST. No time, no timezone.
- `timestamptz` columns: stored UTC, rendered IST via `at time zone
  cinema.timezone` in app code.
- `created_at`, `updated_at` everywhere on catalog tables — let
  audit work without joining.

### Naming conventions

- `id` PKs, UUID v4.
- `created_at`, `updated_at`, `updated_by`, `archived_at`.
- `is_<adjective>` for booleans only when the negation is meaningful
  (`is_active` is dropped in favor of `archived_at` since the latter
  carries more information).
- Plural table names (`movies`, `screens`).
- Snake case (`movie_id`, not `movieId`).

---

## Migration plan

### Phase 0 — Sign-off (we're here)

Read this doc. Mark anything that should change. Lock the design.

### Phase 1 — Additive schema

Create all new tables + add new columns to `entries`, `fb_entries`,
`authorized_users`. No drops. Existing app keeps working.

### Phase 2 — Backfill

A SQL script that reads `public.config.data` and existing
`entries`/`fb_entries`, populates the new tables. Idempotent.
Verifications:

```sql
select count(*) from movies;
-- should equal jsonb_array_length(config.data->'movies')

select count(*) from entries where cinema_id is null;
-- should be 0 after backfill
```

### Phase 3 — Switch reads

Update `app/src/lib/hooks/useSupabaseSync.ts`:

- `pullAll()` reads from the new tables and composes `AppState`
- `pushDeltas()` still writes to `config.data` for safety

Deploy. Run for 1 week. Confirm dashboard, reports, entry, history,
F&B, settings all behave.

### Phase 4 — Switch writes

`pushDeltas()` now writes to the new tables. Add `entries.movie_id`
and `entries.screen_id` FK constraints. Add the temporal
`exclude` constraint on `tax_configs`. Add the audit triggers.

### Phase 5 — Drop `config`

After 2 weeks of stability:

```sql
drop table public.config;
```

### Rollback

Phase 1, 2 are additive — drop the new tables.
Phase 3, 4 need a code revert. `config.data` is still present until
Phase 5, so the legacy code path can be restored.

---

## Code architecture impact

| Layer | Change |
|---|---|
| `app/src/lib/engine.ts` | None. Still consumes `AppState`. |
| `app/src/lib/types.ts` | Add `Cinema.address*`, `Cinema.timezone`, `FbEntry.cinemaId`. Tax-rate reads gain a "valid_for_date" lookup helper. |
| `app/src/lib/db-types.ts` | One interface per new table. |
| `app/src/lib/mappers.ts` | Row→AppState + delta→upserts mappers. Single biggest file change. |
| `app/src/lib/hooks/useSupabaseSync.ts` | New pull logic (parallel queries + compose), new push logic (delta per table), realtime subscribes to `realtime_version`. |
| `app/src/lib/pdf.ts` | DCR header reads address + contact. Tax lookup uses entry_date to pick the right tax_configs row. |
| `app/src/pages/settings/*` | Forms unchanged in shape; persistence absorbs cinema_id automatically. Add cinema info form (Settings → Cinema). |
| `app/src/pages/reports/*` | Reports can group by cinema_id once present. Per-cinema SPH becomes a 5-line SQL query. |
| Edge Functions | `daily-digest`, `weekly-digest` read cinema name + address from `cinemas`. `admin-users` adds `cinema_ids` array to the user payload. |

The engine math doesn't change. That's the contract that protects
DCR legal correctness through this whole migration.

---

## What essential / nice-to-have buys you

| Decision | Essential? | Without it… |
|---|---|---|
| `cinema_id` on every operational table | ★ essential | Can't ever go multi-cinema. SPH per location impossible. |
| `cinema_id` on `fb_products` | ★ essential | Per-cinema menu, pricing, and GST handling. Without it the menu is shared globally — every operator edits everyone's catalog. |
| FKs on `entries.movie_id` / `screen_id` | ★ essential | Silent orphan IDs in legal documents. |
| Temporal `tax_configs` | ★ essential | Changing a rate breaks every old DCR. Legally fraught. |
| `closed_at` on entries / fb_entries | ★ essential | Operators can edit signed-off DCRs without leaving a trace. |
| `audit_log` table + triggers | ★ essential | Can't pass a tax audit. "When was this share changed?" → ¯\\_(ツ)_/¯ |
| `archived_at` soft-delete | ★ essential | Hard-delete of a movie blows up history. |
| `realtime_version` sidecar | ★ essential | N realtime channels = sync storms during catalog edits. |
| Multi-cinema `authorized_users.cinema_ids` | ★ essential | Owner-of-cinema-1 sees cinema-2 data. |
| `brands` table | ☆ nice | Single string on cinemas works fine until you have 3+ brands. |
| `fb_orders` / `fb_order_lines` | ☆ nice | Hourly demand patterns, basket analysis are off-limits. |
| Materialized views | ☆ nice | Reports recompute client-side. Fine at year-1 scale, gets sluggish year 3+. |
| `movies.language` / `genre` / `certification` | ☆ nice | Cohort analytics blocked. Cheap to add later. |
| `cinemas.currency_code`, `timezone` | ☆ nice | Hard-coded assumptions. Cheap to add now. |

---

## Open questions

1. **Do we want `brands` as its own table now, or as a string on
   `cinemas`?** I'd say string today, extract later.

2. **`audit_log` retention.** Keep forever, or roll off after N years?
   Tax law in India requires 6 years. Plan: keep forever; archive to
   cold storage after 6 if it ever gets large.

3. **`closed_at` workflow.** When does an entry become "closed"?
   Options:
     a. Manual click ("Close day") in the UI by owner/manager.
     b. Auto-close N days after `entry_date`.
     c. Auto-close on first DCR PDF generation.
   I lean (a) with (c) as an optional override.

4. **Should `entries.shows` become a real table?** Decision still
   No, per v1. Worth one more sanity-check now that we're thinking
   architecturally: do you ever want "which class sold the most
   tickets across all shows on Saturday nights" in SQL? If yes, do it.

5. **`fb_orders` / `fb_order_lines` — Phase 1 or Phase 2?** Phase 2.
   Today's POS exports are daily summaries, not per-transaction.
   Adding the tables now without data to fill them is over-engineering.

6. **Materialized view refresh cadence.** Nightly via pg_cron is
   simple. Real-time refresh on insert is too much. Hourly is a fine
   middle ground if dashboard latency matters.

7. **Backups.** The JSONB-backed app had trivial backup (export the
   blob). Normalized = N tables to export. Use `pg_dump` for cold
   backups; Supabase already does this. Add a "backup zip" download
   in the app: query each table → bundle as JSON files. Same UX as
   today.

---

## What we're explicitly NOT building

- Booking / ticketing tables. Abhinaya doesn't sell tickets through
  this app; BMS handles that. If you ever bring ticketing in-house,
  add `bookings` + `booking_seats` + a payment integration.
- Customer / membership tables. No loyalty program today. Trivial
  to add later (`customers`, `customer_visits`).
- Shift / staffing tables. Daily managers are users, not shifts. If
  you ever want labor cost integration, add `shifts` + payroll.
- Inventory tables (F&B stock levels, wastage). POS-side concern.

---

End of v2 design. Read it, mark up the open questions, and we'll write
Phase 1 SQL.
