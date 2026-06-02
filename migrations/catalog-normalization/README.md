# Catalog Normalization Migration

End-to-end migration that moves the catalog (movies, screens, classes,
price cards, tax config, serial starts, openings) from the
`public.config.data` JSONB blob into proper relational tables.

Implements the design in `../../DB Normalization Design.md`.

---

## Run order

Run files in numerical order. Each is idempotent (safe to re-run) and
wrapped in a transaction so a mid-file failure rolls back cleanly.

| # | File | What it does | Reversible? |
|---|---|---|---|
| 00 | `00_extensions_and_helpers.sql` | Enable `pgcrypto`, `btree_gist`. Define helper functions `cinema_access()`, `is_owner()`, `is_owner_or_manager()`, `is_entry_writer()`. | Yes |
| 01 | `01_new_schema.sql` | Create all new tables — `brands`, `cinemas`, `classes`, `screens`, `screen_classes`, `price_cards`, `price_card_prices`, `movies`, `serial_starts`, `serial_start_classes`, `openings`, `tax_configs`, `audit_log`, `realtime_version`. | Yes (drop) |
| 02 | `02_alter_existing.sql` | Add `cinema_id` (nullable) to `entries`, `fb_entries`, `fb_products`. Add `closed_at` to `entries`, `fb_entries`. Add `cinema_ids` to `authorized_users`. | Yes (drop column) |
| 03 | `03_rls_policies.sql` | RLS on all new + altered tables, scoped to `cinema_access()`. | Yes (drop policies) |
| 04 | `04_audit_and_realtime.sql` | Generic audit trigger function + attachments. `realtime_version` triggers. | Yes |
| 05 | `05_backfill.sql` | Read `public.config.data` JSONB and populate new tables. Set `cinema_id` on existing `entries`, `fb_entries`, `fb_products`. Set `cinema_ids` on `authorized_users`. | Yes (data only, drop & re-run) |
| 05b | `05b_orphan_stubs.sql` | Insert `archived_at` stub rows for any orphan movie/screen IDs referenced by historical `entries` but missing from the live catalog. The legacy app rendered these as "—"; the FK in 06 forbids them, so we materialise stubs that satisfy the constraint while staying hidden from the UI. | Yes (rows tagged `updated_by = 'orphan-stub'` — delete to undo) |
| 06 | `06_post_backfill_constraints.sql` | After data is in place: `cinema_id NOT NULL`, FK constraints on `entries.movie_id` / `entries.screen_id`, `EXCLUDE` on `tax_configs`, unique constraint changes on `fb_entries`. | Yes (drop constraints) |
| 07 | `07_verify.sql` | Count parity + integrity checks. No writes, only `select`. | n/a |
| 99 | `99_rollback.sql` | Tear down everything. Drops new tables, removes added columns, drops helper functions. Returns DB to its pre-migration state. | n/a |

Files 00–06 must run in order. 07 is informational. 99 only runs if you
want to bail out.

---

## Pre-flight

Before running anything:

```sql
-- Confirm config.data has the data we expect to backfill
select
  jsonb_array_length(data->'movies')      as movies,
  jsonb_array_length(data->'screens')     as screens,
  jsonb_array_length(data->'classes')     as classes,
  jsonb_array_length(data->'serialStarts') as serial_starts,
  jsonb_array_length(data->'openings')    as openings
from public.config where id = 1;
```

Note these numbers. After step 05 (backfill) they should match the
corresponding `count(*)` on the new tables.

---

## Running on staging

1. Supabase Dashboard → **staging** project → SQL Editor.
2. New query → paste contents of `00_extensions_and_helpers.sql` → **Run**.
3. Repeat for `01` … `06`.
4. Paste `07_verify.sql` → **Run** → confirm all parity rows return
   `OK` (or zero discrepancies).
5. Smoke-test the app at the staging URL. Sign in, view dashboard,
   open an existing day, save an edit, generate a DCR. Everything
   should behave identically to today.
6. Let it run on staging for 7 days. Watch the Supabase logs for any
   errors referencing the new tables.

Only after that → run the same files in the same order on **prod**.

---

## Rollback

If anything breaks before code-side changes ship:

```sql
-- Run the rollback file in the SQL editor
\i 99_rollback.sql
```

The old `public.config.data` JSONB is untouched throughout the
migration — the app keeps working against it because Phase 3 (code
cutover) hasn't shipped yet. The rollback simply removes the new
tables and columns, leaving the legacy data path intact.

After code cutover (Phase 3+), rollback also needs a code revert.
That's outside the scope of these SQL files — see the design doc's
"Migration plan" section.

---

## Code-side changes

These SQL files are Phase 1–2 of the design's 5-phase plan. After
they run cleanly on prod, the code-side cutover follows:

- Phase 3: `useSupabaseSync.ts` reads from new tables (writes still
  go to `config.data` for safety).
- Phase 4: writes also move to new tables. Add the FKs on
  `entries.movie_id` / `entries.screen_id`.
- Phase 5: `drop table public.config;`.

That work lives in the app repo, not in these SQL files.

---

## Conventions

- All money columns are `numeric(14,2)`.
- All business-day columns are `date` (IST).
- All timestamps are `timestamptz`, stored UTC.
- Soft delete is `archived_at timestamptz null`. No `is_active`.
- PKs are `uuid` via `gen_random_uuid()`.
- Snake-case everywhere.
