# Cash Management Migration

End-to-end migration that adds the daily cashflow module. See
`../../Cash Management Design.md` for the full design + workflow notes.

## Run order

| # | File | Purpose | Reversible? |
|---|---|---|---|
| 00 | `00_role_and_helpers.sql` | Adds `cashier` role to the CHECK constraint + new RLS helper `cinema_access_unit()`. Idempotent. | Yes (rollback file resets to pre-cashier roles) |
| 01 | `01_phase1_schema.sql` | Tables: `operating_units`, `bank_accounts`, `payment_methods`, `daily_cash_closings`, `cash_closing_denominations`, `cash_closing_payment_methods`. Adds `payment_approval_threshold` to `cinemas`. | Yes |
| 02 | `02_phase2_petty_expenses.sql` | Table: `petty_expenses` + receipts Storage bucket + RLS policies for bucket. | Yes |
| 03 | `03_phase3_payments_and_ledger.sql` | Tables: `payment_requests`, `bank_ledger_entries`. Triggers that auto-insert ledger rows on signed closing / paid request / inter-unit transfer. | Yes |
| 04 | `04_rls.sql` | RLS policies on every new table — read scoped to `cinema_access(cinema_id)`, write role-gated. | Yes (drop policies) |
| 05 | `05_seed_payment_methods.sql` | Seeds the operator's known payment methods (BMS, UPI-Paytm, etc.) for the existing cinema. | Yes (delete by code) |
| 06 | `06_verify.sql` | Sanity-check queries — no writes. | n/a |
| 99 | `99_rollback.sql` | Full teardown. | n/a |

Files 00–05 must run in order. 06 is informational. 99 only runs to bail.

## After running

App-side code under `app/src/lib/cash/`, `app/src/pages/cash/` plus
nav updates ships in the same `cash-management` branch — deploy
together via the standard merge to `main`.
