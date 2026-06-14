# Role access — Abhinaya Cinemas console

This document is the source of truth for who-can-do-what. It mirrors
the role gates in `app/src/App.tsx`, the nav tree in `app/src/lib/nav.ts`,
and the RLS policies under `migrations/`. Re-derive when those change.

The five roles, one-line descriptions:

- **owner** — full access; the only role that can delete closings, edit
  operating units / payment methods / unit-method mapping, manage users.
- **manager** — runs day-to-day operations: BO + F&B, cash closings,
  payment approvals up to ₹5,000, reports.
- **daily_manager** — shift-level user who closes the day: BO + F&B
  entry, can initiate + sign cash closings, approves petty expenses. No
  payments, no settlements, no settings.
- **accountant** — books + reconciliation: read on BO/F&B history,
  Reports, payments, settlements, bank ledger. Manages bank accounts.
- **cashier** — at-the-till user: raises petty expense requests, confirms
  cash closings assigned to them.

## Landing pages

| Role | Lands at |
|---|---|
| owner / manager | `/dashboard` |
| daily_manager | `/box-office/entry` |
| accountant | `/box-office/history` |
| cashier | `/cash/closings` |

## Page-by-page access (from `nav.ts` + `App.tsx`)

`o` = owner, `m` = manager, `dm` = daily_manager, `a` = accountant, `c` = cashier.

| Page | o | m | dm | a | c |
|---|---|---|---|---|---|
| `/dashboard` | YES | YES | — | — | — |
| `/box-office/entry` | YES | YES | YES | — | — |
| `/box-office/history` | YES | YES | YES | YES | — |
| `/fb/entry` | YES | YES | YES | — | — |
| `/fb/history` | YES | YES | YES | — | — |
| `/fb/menu-items` | YES | — | — | — | — |
| `/reports/box-office` | YES | YES | — | YES | — |
| `/reports/fb` | YES | YES | — | YES | — |
| `/cash/closings` | YES | YES | YES | YES | YES |
| `/cash/closings/:id` | YES | YES | YES | YES | YES |
| `/cash/petty` (approval queue) | YES | YES | YES | — | — |
| `/cash/petty/mine` (raise request) | YES | YES | YES | — | YES |
| `/cash/payments` | YES | YES | — | YES | — |
| `/cash/settlements` | YES | YES | — | YES | — |
| `/cash/ledger` | YES | YES | — | YES | — |
| `/cash/reports` (cashflow) | YES | YES | — | YES | — |
| `/settings/movies` | YES | YES | — | — | — |
| `/settings/screens` | YES | YES | — | — | — |
| `/settings/tax` | YES | YES | — | — | — |
| `/settings/cash` | YES | — | — | YES | — |
| `/settings/users` | YES | — | — | — | — |
| `/activity` | YES | YES | — | — | — |
| `/backup` | YES | YES | — | — | — |

## Action-level rules (UI gates)

Higher-fidelity than the page table — these are the actual buttons or
flows that may or may not appear inside a page.

**Cash closings**

- Create new closing: owner, manager, daily_manager.
- Manager sign (draft → counted): same three roles.
- Cashier confirm (counted → signed): **anyone whose email is on the
  `cashier_email` field** of the closing — owners and managers commonly
  run the till themselves at this scale, so this is no longer
  role-gated.
- Record cash deposit / mark deposited: owner, manager, daily_manager.
- Dispute a signed closing: any role that can write closings.
- Delete a closing (including the matching bank-ledger row): **owner
  only.**
- Upload EDC slip at closing time: owner, manager, daily_manager.

**Petty expenses**

- Submit petty expense (cashier flow): owner, manager, daily_manager,
  cashier.
- Approve / reject petty expense: owner, manager, daily_manager.
- View petty queue: owner, manager, daily_manager.
- View own submitted petty: cashier (own rows only via RLS).

**Payment requests**

- Submit payment request (requires receipt upload): owner, manager,
  accountant.
- Approve under ₹5,000: owner, manager, accountant (whoever the
  threshold lets — see "approval threshold" below).
- Approve any amount: owner.
- Mark paid (with bank account + reference): owner, manager, accountant.
- Money in (manual income, requires party + bank): owner, manager,
  accountant.

**POS settlements**

- Create new settlement (link to closings): owner, manager, accountant.
- Mark received (with received amount + fee + slip): owner, manager,
  accountant.

**Settings → Cash editors**

- Operating units (add / edit name / default float): owner.
- Bank accounts (add): owner; (insert + update bookkeeping fields):
  accountant.
- Bank accounts (`is_primary`, archive): owner only.
- Payment methods (add): owner; (set settlement bank): owner +
  accountant via UI; RLS write is owner-only — accountant edits
  through a separate read-write call. *See "RLS quirks" below.*
- Methods accepted per unit: owner only.
- Parties (vendors / customers): owner, manager, accountant.

**Users**

- Create / edit / remove authorized users: owner via `/settings/users`.
- Cashier role creation is **not yet exposed in the Users UI** — has
  to be a direct SQL insert. *Recommended change.*

## Database RLS summary

Sourced from `supabase/migrations-archive/cash-management/04_rls.sql` (and
updates in migrations 07 / 08 / 09 / 10 / 11).

| Table | Read | Write | Notes |
|---|---|---|---|
| `entries` (BO) | all signed-in | o, m, dm | via `is_entry_writer()` |
| `fb_entries` | all signed-in | o, m, dm | same |
| `config` (catalog) | all signed-in | o, m | |
| `authorized_users` | self + manager-tier (o/m/dm via `can_pick_cashier()`) | o | post phase 11 |
| `operating_units` | cinema members | o | |
| `bank_accounts` | o, m | o (all), a (insert + non-primary update) | post phase 7 |
| `payment_methods` | o, m | o | |
| `operating_unit_payment_methods` | cinema members | o | post phase 11 |
| `daily_cash_closings` | o, m (full), dm (own cinema), a (read for reports), c (own assigned only when `status='counted'`) | o, m, dm (full); c (own rows, `counted` only, sets `signed`); o (delete) | post phase 8 + 9 |
| `cash_closing_denominations` | parent gate | parent gate | |
| `cash_closing_payment_methods` | parent gate | parent gate | |
| `petty_expenses` | o, m, dm (all); c (own) | c (insert own); o, m, dm (update / approve) | |
| `payment_requests` | o, m, a | o, m, a (insert + update); o (delete) | |
| `bank_ledger_entries` | o, m, a | a (manual entries); triggers write rest | |
| `parties` | cinema members | o, m, a | post phase 7 |
| `cash_deposits` | o, m, dm, a | o, m, dm (create + complete); o (delete) | post phase 10 |
| `pos_settlements` | o, m, a | o, m, a (create + mark received) | post phase 10 |
| Storage `petty-receipts` | public read | c, dm+ insert | |
| Storage `payment-receipts` | public read | o, m, a insert | |
| Storage `cash-slips` | public read | o, m, dm, a insert | post phase 10 |

## Approval threshold

`payment_approval_threshold` defaults to **₹5,000** (UI constant in
`pages/cash/Payments.tsx`). Manager can approve *under* threshold;
owner can approve any amount. Accountant raises but cannot approve.

Threshold is currently a code constant — moving it to a `config.cinema`
column would let the owner edit it from settings without a code change.
*Recommended later.*

## Assessment — places to consider changing

Things I noticed while compiling that may or may not be intentional:

1. **Cashier role can't be created from Settings → Users.** Today only
   the `authorized_users` table accepts a `cashier` role; the Users UI
   shows owner / manager / daily_manager / accountant. Until the UI
   exposes it, you have to seed via SQL. Worth fixing before prod
   cutover or you'll be SQL-editing every time a new till operator joins.

2. **Daily manager can't see settlements / cashflow / payments.**
   Probably intentional — the daily manager is shift-level, not
   accounting-level — but if they ever need to see "how much cash hit
   the bank yesterday" for shift handoff, the only path today is via
   the cash closing detail. Worth confirming.

3. **Accountant can read petty expenses via RLS but the UI doesn't
   show them a queue.** They might want a read-only `/cash/petty`
   view for reconciliation. Add a read-only mode if so.

4. **Accountant has bank-account insert via RLS but the UI is locked
   under `/settings/cash` which is owner+accountant.** That works for
   bank accounts but the *page also exposes operating units and
   payment-method mapping editors*, which the accountant shouldn't
   be able to touch (the inline `updateOperatingUnitFloat` /
   `setOperatingUnitMethods` calls will silently fail under owner-only
   RLS). Either restrict the page to owner-only and give accountants
   a separate `/settings/bank-accounts` page, or split the editors
   so each section is gated independently.

5. **Approval threshold is a UI constant.** Move to `config` so the
   owner can change ₹5,000 → ₹10,000 without a code change.

6. **Daily manager can create *and* sign a cash closing without anyone
   else seeing the numbers** until the cashier confirms. That's the
   intended dual-signoff flow, but if the cashier is also the daily
   manager (small team), the same user holds both keys. Worth a
   policy decision: should the cashier on the till be required to be
   a different person than the manager who signed? Today we don't
   enforce it.

7. **Cashier confirm gate is email-only, no role check.** If the owner
   is the assigned cashier on a closing, they confirm — that's
   correct. But this means a cashier-role user *also* needs the
   ability to update closings where they're the assigned cashier,
   which migration 08's RLS gives them. Worth confirming the RLS
   still matches the loosened UI gate when this lands on prod.

8. **`/cash/closings` is accessible to every role, but the visible
   content differs sharply.** Cashier sees only their assigned rows
   (RLS-filtered); accountant sees all rows for reporting; the rest
   see all rows for their unit. The page handles this via
   `if (isCashier) listClosings({})` vs unit-filtered. Confirm this
   matches expectations — easy to misread the table as "everyone sees
   the same thing".

If you agree with any of these, I can ship the changes. If not, leave
them and we have this doc to refer to.
