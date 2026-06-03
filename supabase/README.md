# Supabase migrations

This directory is the **source of truth** for new database changes. The
Supabase CLI tracks which files have been applied via
`supabase_migrations.schema_migrations` and only runs what's pending.

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

The following SQL lives in `migrations/` (the older folder) and was applied
manually to prod before we adopted the CLI. They're left alone:

- `migrations/catalog-normalization/00..07` — catalog normalization phase.
- Root-level `Abhinaya DCR Cloud - Step 3 Digest Cron.sql`,
  `Step 5 Daily Manager Role.sql`,
  `FB Historical Backfill v2 (Item Report).sql`,
  `WhatsApp Setup Runbook.md` companion SQL.

If at some point you want full audit of every change in CLI: copy each one
into `supabase/migrations/` with a timestamp earlier than the cash ones,
then run `supabase migration repair --status applied <timestamp>` for each
on prod (and staging) so the CLI knows they're already in place.

## Verify and rollback files

`migrations/cash-management/06_verify.sql` and `99_rollback.sql` are NOT
migrations — `06` is read-only assertions for post-apply sanity checks,
`99` is a destructive teardown for dev. Run them manually when needed:

```bash
psql "$DATABASE_URL" -f migrations/cash-management/06_verify.sql
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
