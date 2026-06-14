# Operations — staff rosters migration

Backs **Operations → Rosters → Daily Manager Roster** in the console: weekly
(Thursday → Wednesday) rosters of the daily manager on duty, with
manager-approved day swaps and emergency-leave handling.

Built for daily managers first (`staff_type = 'daily_manager'`) but the
`staff_type` column keeps the same tables reusable for other staff rosters
later.

Reuses helpers from earlier migrations — run those first:
`cinema_access()` (catalog-normalization), `is_owner()`, `is_entry_writer()`.
Adds one new helper, `is_roster_manager()` (owner | manager).

## Run order

| #  | File             | Purpose                                                             | Reversible? |
|----|------------------|---------------------------------------------------------------------|-------------|
| 00 | `00_schema.sql`  | `staff_rosters`, `roster_assignments`, `roster_swaps`, `roster_emergency_leaves` + `is_roster_manager()`. | Yes |
| 01 | `01_rls.sql`     | RLS policies.                                                        | Yes |
| 99 | `99_rollback.sql`| Full teardown (destroys roster data).                               | n/a |

Files 00–01 must run in order, in the Supabase SQL editor (or via the deploy
pipeline alongside the app code). The same files are mirrored verbatim into
`supabase/migrations/` as timestamped migrations:

- `20260614010000_operations_rosters_00_schema.sql`
- `20260614010100_operations_rosters_01_rls.sql`

## Data model

- **staff_rosters** — one row per `(cinema_id, staff_type, week_start)`.
  `week_start` is the **Thursday** that opens the Thu→Wed week (enforced by a
  CHECK on `extract(dow …) = 4`). `status` ∈ `draft | published`.
- **roster_assignments** — one row per day (`day_offset` 0..6 = Thu..Wed),
  naming `assignee_email` (the daily manager on duty). The shift is a fixed 24h
  window from `15:00` (3:00 PM) to 3:00 PM the next day (`shift_label`).
- **roster_swaps** — `from_date` ⇄ `to_date`, mandatory `reason`, `status`
  ∈ `pending | approved | rejected`. On approval the app swaps the two
  assignments' `assignee_email`.
- **roster_emergency_leaves** — a `work_date` flagged by `staff_email`,
  mandatory `reason`, `status` ∈ `pending | approved | rejected`, plus a
  manager-set `cover_email`.

## Access

| Table                     | Read                | Insert              | Update / Delete       |
|---------------------------|---------------------|---------------------|-----------------------|
| staff_rosters             | `is_entry_writer()` | `is_roster_manager()` | `is_roster_manager()` |
| roster_assignments        | `is_entry_writer()` | `is_roster_manager()` | `is_roster_manager()` |
| roster_swaps              | `is_entry_writer()` | `is_entry_writer()` | `is_roster_manager()` |
| roster_emergency_leaves   | `is_entry_writer()` | `is_entry_writer()` | `is_roster_manager()` |

All gated by `cinema_access()` on the owning roster's `cinema_id`.
Daily managers (`is_entry_writer()` but not `is_roster_manager()`) can read the
roster and raise swap/leave requests; only owner/manager build the grid and
decide requests.
