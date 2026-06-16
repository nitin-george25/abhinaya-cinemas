# Supabase migrations

`supabase/migrations/` is the **single source of truth** for all database
changes. Author every new migration here as a timestamped file — the old
`migrations/<feature>/` convention is retired (its history now lives in
`supabase/migrations-archive/`, reference-only, never applied). The Supabase
CLI tracks which files have been applied via
`supabase_migrations.schema_migrations` and only runs what's pending.

## CI — migrations apply automatically on push

`.github/workflows/db-migrations.yml` runs `supabase db push` on every push:

- push to **staging** → applied to the **staging** database
- push to **main** → applied to the **prod** database

Both are automatic (no approval gate). Because `db push` only applies files
not already in each database's history, a push with no new migration is a safe
no-op. The workflow runs the same `scripts/db-push.sh` you use locally, just
non-interactively (`ASSUME_YES=1`, `SUPABASE_DB_PASSWORD` from secrets).

Required repo secrets (Settings → Secrets and variables → Actions):
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD_STAGING`,
`SUPABASE_DB_PASSWORD_PROD`.

The `npm run db:push:*` commands below still work for manual / out-of-band runs.

## One-time setup

1. Install the CLI:

   ```bash
   brew install supabase/tap/supabase
   ```

   (Other platforms: <https://supabase.com/docs/guides/local-development/cli/getting-started>)

2. Get an access token from <https://supabase.com/dashboard/account/tokens>
   and export it from your shell rc:

   ```bash
   export SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxx
   ```

3. From the repo root, link the staging project once:

   ```bash
   supabase link --project-ref lctkvmpzijaspaytunkm
   ```

   You'll re-link when switching between staging and prod — the
   `npm run db:push:*` scripts do that automatically.

## Daily workflow

### Add a new migration

Create a file in `supabase/migrations/` named
`<YYYYMMDDHHMMSS>_<short_name>.sql`. The leading 14-digit timestamp is what
the CLI uses to order migrations.

The easiest way to get a correctly-formatted name is to let the CLI do it:

```bash
supabase migration new add_widget_table
# → creates supabase/migrations/20260603120000_add_widget_table.sql
```

Write idempotent SQL (`create table if not exists`, `drop policy if exists`)
so re-runs in development don't fail.

### Apply pending migrations

```bash
# Status — what's in the local folder vs the remote DB
npm run db:status

# Apply to staging
npm run db:push:staging

# Apply to prod (prompts for confirmation)
npm run db:push:prod
```

The script links the right project, lists what will run, and pushes.

### Generate a migration from manual DB changes

If you tweaked the schema in the Supabase dashboard and want to capture the
delta as a migration file:

```bash
npm run db:diff -- my_change_name
```

That writes a new migration with the diff. Review and commit it.

## What's in `supabase/migrations/` right now

| Timestamp | What it does |
|---|---|
| `20260101000000_step_4_add_username_auth` | Adds `authorized_users.username` + `admin-users` Edge Function support. |
| `20260501000000_cash_00_role_and_helpers` | Cashier role + RLS helpers. |
| `20260501000100_cash_01_phase1_schema` | Operating units, bank accounts, payment methods. |
| `20260501000200_cash_02_phase2_petty_expenses` | `petty_expenses` + `petty-receipts` Storage bucket. |
| `20260501000300_cash_03_phase3_payments_and_ledger` | `payment_requests` + `bank_ledger_entries` + triggers. |
| `20260501000400_cash_04_rls` | Row-level security for the cash tables. |
| `20260501000500_cash_05_seed_payment_methods` | Seed Cash/UPI/Pinelabs/etc. |
| `20260501000700_cash_07_signoff_parties_and_polish` | Dual signoff fields, `parties` table, accountant-writable bank_accounts. |
| `20260603000000_cash_08_mandatory_receipts` | `payment-receipts` bucket, receipt-or-reason CHECK on petty, cashier RLS for closings. |

## What stays out of CLI management

`supabase/migrations-archive/` holds historical SQL that was applied to prod
**before** we adopted the CLI (most importantly `catalog-normalization/00..07`,
the foundational normalized schema). It is reference-only and is **never**
read by the CLI or CI — it lives outside `supabase/migrations/` on purpose, so
re-running its backfills/ALTERs can't happen. See
`supabase/migrations-archive/README.md`.

Some companion SQL also lives at the repo root (`Abhinaya DCR Cloud - Step 3
Digest Cron.sql`, `Step 5 Daily Manager Role.sql`, the FB backfill, etc.) and
is likewise out of CLI management.

If at some point you want full audit of an already-applied change in the CLI:
copy it into `supabase/migrations/` with an appropriate timestamp, then run
`supabase migration repair --status applied <timestamp>` on **both** prod and
staging so the CLI records it as done instead of trying to re-run it.

## Verify and rollback files

Verify (`*_verify.sql`) and rollback (`*_rollback.sql`) scripts are NOT
migrations — verify files are read-only post-apply sanity checks, rollback
files are destructive teardowns. They live in `supabase/migrations-archive/`
(or `docs/`), never in `supabase/migrations/`, and are run by hand when needed:

```bash
psql "$DATABASE_URL" -f supabase/migrations-archive/cash-management/06_verify.sql
```

## Troubleshooting

**`supabase migration repair` — when to use it.** If a migration in
`supabase/migrations/` has already been applied to the remote DB outside
the CLI (you ran the SQL by hand earlier), the CLI will try to apply it
again on `db push` and fail. Tell the CLI it's already done:

```bash
supabase migration repair --status applied <14-digit-timestamp>
```

**`db push` fails midway.** Each file runs in its own transaction. A
partial failure leaves anything earlier in the file rolled back; subsequent
files haven't been attempted. Fix the SQL and re-run `db push`.

**Edge Functions.** Migrations don't touch Edge Functions. Deploy those
with `supabase functions deploy <name>` (eg. `admin-users`, `daily-digest`).

---

## Migration application (updated 2026-06-16)

Database migrations are applied by the **Supabase Dashboard GitHub integration**,
not by a CI workflow:

- Opening a PR spins up a **Preview Branch** and runs `supabase/migrations/`
  against it (this is the green/red check on the PR).
- Merging to the **production branch** applies pending migrations to that
  project's database.

The old `.github/workflows/db-migrations.yml` Action (which ran `supabase db push`
on every push) was removed to avoid double-applying. `scripts/db-push.sh` remains
as a manual CLI fallback for ad-hoc, per-project pushes.
