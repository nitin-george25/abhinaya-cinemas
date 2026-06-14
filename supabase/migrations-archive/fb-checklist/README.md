# F&B SOP checklist — migration

Persists the daily F&B SOP checklists (opening / mid-shift / closing) that staff
complete in the console, with photo evidence and manager sign-off. The bilingual
step wording lives in the app (`src/lib/fbChecklist.ts`), keyed by SOP code; the
DB stores only which steps were done and the evidence.

Reuses helpers from earlier migrations — run those first:
`cinema_access()`, `is_entry_writer()`, `is_owner()`
(from `catalog-normalization/00`) and the storage pattern from
`cash-management/02`.

## Run order

| # | File | Purpose | Reversible? |
|---|---|---|---|
| 00 | `00_schema.sql` | `fb_checklist_runs` + `fb_checklist_items` tables. | Yes |
| 01 | `01_rls.sql` | RLS policies (checklist users = `is_entry_writer()`). | Yes |
| 02 | `02_storage.sql` | `fb-checklist-photos` bucket + policies. | Yes |
| 99 | `99_rollback.sql` | Full teardown (destroys checklist data). | n/a |

Files 00–02 must run in order, in the Supabase SQL editor (or via the deploy
pipeline alongside the app code).

## Data model

- **fb_checklist_runs** — one row per `(cinema_id, run_date, checklist_type, shift)`.
  `checklist_type` ∈ `opening | midshift | closing`. `extra` (jsonb) carries the
  closing cash reconciliation (`pos_total`, `cash_counted`, `upi_total`,
  `variance`). Sign-off is `manager_signoff_email` + `manager_signed_at`.
- **fb_checklist_items** — one row per SOP step (`sop_code`, `checked`, `initial`,
  `done_at`, `photo_url`).

## Access

Read/insert/update gated to `cinema_access(cinema_id) AND is_entry_writer()`
(owner / manager / daily_manager). Delete is owner-only.
