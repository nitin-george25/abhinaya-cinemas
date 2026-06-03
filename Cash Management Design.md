# Cash Management — Design

A console-side replacement for the accountant's manual daily collection
report spreadsheet. Tracks every rupee from cashier till to bank statement,
in one place, with role-based workflows.

Read alongside the existing **DB Normalization Design.md** — this builds
on the same cinemas-as-tenant model and uses the same RLS pattern.

---

## What the accountant does today (read from RINU's CSV)

Each day, the accountant manually produces a spreadsheet with four
sections:

1. **Theatre collection report** — BO gross collection broken down into
   sources (BookMyShow, UPI-Paytm, cash). Less cash expenses paid out of
   the till. Cash deposit = expected. Cash actually deposited at bank.
   Excess/short on the day's cash.
2. **Cafe collection report** — same shape, different payment sources
   (UPI-Pine Labs, QR-Razorpay, cash).
3. **Theatre bank account ledger** — opening balance, all receipts
   (cash deposits, BMS evening transfer, intra-business transfers like
   canteen rent received from Cafe), all payments (vendor payouts,
   staff remuneration, entertainment tax), closing balance.
4. **Cafe bank account ledger** — same shape, separate account.

There are **two accounting entities** under the same cinema: Theatre and
Cafe. Each has its own bank account. They transact with each other
(canteen rent flows from Cafe to Theatre monthly).

This is the model we replicate in the console.

---

## Goals

1. Cashier (BO or F&B) can enter their till closing at end of shift —
   denominations, POS sales breakdown, cash expenses, excess/short.
2. Cashier can request petty expenses during the day; shift manager
   approves with a tap.
3. Accountant can raise larger payment requests; owner/manager approves
   before they get marked paid.
4. Bank ledger builds itself from above + manual entries (opening
   balance, intra-business transfers).
5. One daily cashflow summary that adds Theatre + Cafe, shows cash
   position, bank position, and unfunded payment requests.

## Non-goals (Phase 2+)

- Full double-entry accounting (debits/credits per account). The ledger
  here is single-entry per bank account. CA's Tally is still source of
  truth for tax filings.
- Salary payroll computation, GST returns, TDS — those stay in their
  current tools and the bank ledger just records the resulting transfer.
- Inventory tracking (F&B stock levels, wastage).
- Multi-currency.

---

## Domain model

```
Cinema (existing)
  └── OperatingUnit (new)            ← Theatre / Cafe / future "Banquet" etc.
        ├── BankAccount (new)        ← one per entity, multiple allowed
        ├── DailyCashClosing (new)   ← one per (unit, date, shift)
        ├── PettyExpense (new)       ← cashier-raised, shift-manager-approved
        ├── PaymentRequest (new)     ← accountant-raised, management-approved
        └── BankLedgerEntry (new)    ← receipts + payments, derived + manual
```

Sale data stays in its existing tables:

- `entries` (BO show-level sales) → rolls up to one cash closing's
  "POS sale" figure.
- `fb_entries` (F&B daily) → same.

The closing references the corresponding `entries`/`fb_entries` row, so a
discrepancy investigation can drill from "₹1,760 short" → "which show on
which screen has the wrong ticket count?".

---

## Roles (additions / refinements)

| Role | Daily cash duties |
|---|---|
| **Cashier** (new role) | **Raises petty expense requests only.** Has a minimal profile view (their own pending + approved expenses). No other module access. One cashier per operating unit per shift. |
| **Daily manager** (existing) | **Owns the cash closing** — counts till, types denominations + POS payment-method breakdown, submits. Also approves cashier petty-expense requests. |
| **Manager** | Same as today + can override discrepancies, mark closings as resolved. |
| **Accountant** | Raises payment requests; updates bank ledger with deposits + transfers; reconciles against bank statement; produces cashflow summary. |
| **Owner** | Approves payment requests above the configured threshold (₹5,000 default). Reviews discrepancies on cash closings. |

**Cashier scope** — deliberately tight:

- Mobile FAB has one extra action for them: "Petty expense".
- Web app: they land on `/petty-expenses/mine` and see their own list.
  No sidebar nav. No history pages, no settings, no reports.
- RLS: read own petty_expenses; write new petty_expenses only.

---

## New tables

### `operating_units` ★ essential

```sql
create table public.operating_units (
  id           uuid primary key default gen_random_uuid(),
  cinema_id    uuid not null references public.cinemas(id) on delete cascade,
  name         text not null,                   -- "Theatre", "Cafe Abhinaya"
  kind         text not null check (kind in ('box_office', 'food_beverage', 'other')),
  display_order int not null default 0,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   text,
  unique (cinema_id, name)
);
```

For Abhinaya Changanacherry: two rows, kind = `box_office` ("Theatre")
and `food_beverage` ("Cafe Abhinaya"). Existing `entries.cinema_id`
implicitly maps to the box_office unit; `fb_entries.cinema_id` implicitly
maps to the food_beverage unit. (We could make this explicit via FK —
see open question.)

### `bank_accounts` ★ essential

```sql
create table public.bank_accounts (
  id                 uuid primary key default gen_random_uuid(),
  cinema_id          uuid not null references public.cinemas(id) on delete cascade,
  operating_unit_id  uuid not null references public.operating_units(id) on delete restrict,
  name               text not null,                  -- "ICICI Current 12345"
  bank_name          text,
  account_number_last4 text,                         -- never store the full number
  opening_balance    numeric(14,2) not null default 0,
  opening_date       date not null,
  is_primary         boolean not null default false, -- the unit's main account
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  unique (operating_unit_id, name)
);
```

Two rows for Abhinaya — one bank account per operating unit. Last 4
digits only; full account number lives in Tally / your records.

### `daily_cash_closings` ★ essential

One row per (operating_unit, business_date, shift). For single-shift
operations, leave `shift = 'all_day'`.

```sql
create table public.daily_cash_closings (
  id                  uuid primary key default gen_random_uuid(),
  operating_unit_id   uuid not null references public.operating_units(id) on delete restrict,
  business_date       date not null,
  shift               text not null default 'all_day'
                          check (shift in ('morning', 'evening', 'all_day')),
  cashier_email       text not null,
  supervisor_email    text,                          -- shift manager who signed off

  pos_total_sales     numeric(14,2) not null default 0,    -- from entries/fb_entries
  pos_non_cash_total  numeric(14,2) not null default 0,    -- UPI + BMS + Razorpay etc.
  pos_cash_expected   numeric(14,2) generated always as (pos_total_sales - pos_non_cash_total) stored,

  cash_counted        numeric(14,2) not null default 0,    -- sum of denominations
  petty_expenses_paid numeric(14,2) not null default 0,    -- pulled from petty_expenses
  cash_deposited      numeric(14,2) not null default 0,
  discrepancy         numeric(14,2) generated always as
                        (cash_counted + petty_expenses_paid - pos_cash_expected) stored,

  notes               text,
  status              text not null default 'draft'
                          check (status in ('draft', 'signed', 'disputed', 'resolved')),
  signed_at           timestamptz,
  resolved_at         timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (operating_unit_id, business_date, shift)
);
```

`discrepancy = (counted + paid expenses) − POS cash expected`. Positive
= excess, negative = short. Stored as a generated column so reports don't
recompute.

### `cash_closing_denominations` ★ essential

```sql
create table public.cash_closing_denominations (
  closing_id    uuid not null references public.daily_cash_closings(id) on delete cascade,
  denomination  numeric(8,2) not null,    -- 500.00, 200.00, 100.00, …, 0.50
  count         int not null default 0,
  primary key (closing_id, denomination)
);
```

INR denominations: 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.50. Stored as
numeric to handle the 0.50 coin without rounding.

### `cash_closing_payment_methods` ★ essential

```sql
create table public.cash_closing_payment_methods (
  closing_id  uuid not null references public.daily_cash_closings(id) on delete cascade,
  method      text not null,            -- 'cash', 'upi_paytm', 'bms', 'upi_pine_labs', 'qr_razorpay', …
  amount      numeric(14,2) not null,
  primary key (closing_id, method)
);
```

The set of valid `method` values is the operating unit's accepted payment
mix. Theatre has BMS + Paytm + cash; Cafe has Pine Labs + Razorpay + cash.
Method names live in a small `payment_methods` lookup so the dropdown is
managed in Settings rather than hardcoded.

### `payment_methods` ★ essential (lookup)

```sql
create table public.payment_methods (
  id                 uuid primary key default gen_random_uuid(),
  cinema_id          uuid not null references public.cinemas(id) on delete cascade,
  code               text not null,                   -- "bms"
  display_name       text not null,                   -- "BookMyShow"
  receives_into_bank uuid references public.bank_accounts(id),
  flow_type          text not null
                       check (flow_type in ('cash', 'online_immediate', 'online_settled')),
  archived_at        timestamptz,
  unique (cinema_id, code)
);
```

`flow_type` decides whether the receipt hits the bank ledger the same
day (`online_immediate` — QR Razorpay), the next day (`online_settled`
— BMS evening transfer), or never directly (`cash` — has to be physically
deposited).

### `petty_expenses` ★ essential

```sql
create table public.petty_expenses (
  id                  uuid primary key default gen_random_uuid(),
  operating_unit_id   uuid not null references public.operating_units(id) on delete restrict,
  expense_date        date not null,
  amount              numeric(14,2) not null check (amount > 0),
  category            text,                          -- "Food", "Stationery", "Travel"
  description         text not null,                 -- "Milk for coffee 5L"
  paid_to             text,                          -- "Local dairy"

  requested_by_email  text not null,                 -- cashier
  approved_by_email   text,                          -- shift manager
  approved_at         timestamptz,
  rejected_reason     text,

  receipt_url         text,                          -- Supabase Storage url
  status              text not null default 'pending'
                       check (status in ('pending', 'approved', 'rejected')),

  -- Filled when reconciled into a closing
  reconciled_closing_id uuid references public.daily_cash_closings(id),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
```

Approved expenses get summed and stored on the closing's
`petty_expenses_paid` field so the discrepancy math stays simple.
Receipts photographed via the phone camera, uploaded to a new
`receipts` Storage bucket.

### `payment_requests` ★ essential

```sql
create table public.payment_requests (
  id                  uuid primary key default gen_random_uuid(),
  operating_unit_id   uuid not null references public.operating_units(id) on delete restrict,
  needed_by           date,                          -- "due date"

  payee_name          text not null,
  payee_account_last4 text,
  payee_ifsc          text,

  amount              numeric(14,2) not null check (amount > 0),
  mode                text not null
                       check (mode in ('bank_transfer', 'cheque', 'cash', 'upi')),
  purpose             text not null,                 -- "Staff uniform - Q1"
  invoice_url         text,

  requested_by_email  text not null,                 -- accountant
  approved_by_email   text,                          -- owner / manager
  approved_at         timestamptz,
  rejected_reason     text,

  paid_at             timestamptz,
  paid_via_bank_account_id uuid references public.bank_accounts(id),
  bank_reference      text,                          -- UTR / cheque no.

  status              text not null default 'pending'
                       check (status in ('pending','approved','rejected','paid')),

  created_at          timestamptz not null default now()
);
```

**Approval threshold: ₹5,000 default.** Configurable per cinema in
Settings → Cash Management. Requests at or above the threshold need
owner approval; below, manager is enough. The threshold lives on the
cinema row (new column `payment_approval_threshold numeric(14,2)
default 5000`) so we don't need a separate settings table.

### `bank_ledger_entries` ★ essential

```sql
create table public.bank_ledger_entries (
  id                  uuid primary key default gen_random_uuid(),
  bank_account_id     uuid not null references public.bank_accounts(id) on delete restrict,
  entry_date          date not null,
  narration           text not null,
  receipt_amount      numeric(14,2) not null default 0,
  payment_amount      numeric(14,2) not null default 0,

  -- Backlink to whatever caused this ledger row.
  source_kind         text not null
                       check (source_kind in
                         ('opening_balance', 'cash_deposit', 'payment_request',
                          'inter_unit_transfer', 'pos_settlement', 'manual')),
  source_id           uuid,                          -- closing_id / payment_request_id / etc.

  bank_reference      text,                          -- UTR / Cheque
  reconciled_at       timestamptz,                   -- when matched against bank statement
  notes               text,

  created_at          timestamptz not null default now(),
  created_by          text
);

create index on public.bank_ledger_entries (bank_account_id, entry_date desc);
```

The ledger is the single audit trail. Each row knows its parent
(cash_closing, payment_request, etc.), so changes propagate. Running
balance is computed at query time:

```sql
sum(receipt_amount - payment_amount) over (
  partition by bank_account_id
  order by entry_date, created_at
)
```

No `balance_after` column — let the query compute it so we never have to
backfill on insert/delete.

---

## Workflows

### A. Day-end cash closing (daily manager)

1. End of shift, the daily manager opens **Cash Management → Cash Closing**.
2. Picks operating unit + business date (defaulted to today) + shift.
3. Console pre-fills `pos_total_sales` from `entries`/`fb_entries`
   for that date.
4. Daily manager types the **payment-method breakdown** by reading
   from the POS report (BMS sales / UPI-Paytm / UPI-Pine / Razorpay /
   Cash). The breakdown rows live in `cash_closing_payment_methods`.
5. Daily manager enters denominations — UI is a 10-row grid
   (500 / 200 / … / 0.50) with a number input per row. Sum updates
   live.
6. `discrepancy` shows live as they type:
   `(cash_counted + petty_expenses_paid) − pos_cash_expected`.
   `pos_cash_expected` = pos_total_sales − sum(non-cash methods).
7. Manager hits **Submit**. Status → `signed`.
   (No counter-signature step in v1 — the daily manager IS the shift
   sign-off. Manager + owner can review and dispute later.)
8. On submit, a `bank_ledger_entries` row is created for the cash
   deposit (source_kind = 'cash_deposit', amount = `cash_deposited`).

### B. Petty expense during the day (cashier + daily manager)

1. Cashier taps "+" on mobile → **Petty expense**.
2. Form: amount, category dropdown (managed list), description,
   paid_to, **optional receipt photo upload** (phone-camera snap of
   the vendor's paper bill — kept as audit proof for the CA).
3. Status = `pending`.
4. Daily manager gets it in **Cash Management → Approvals**. One-tap
   approve or reject with reason.
5. On approve, the expense is held against the cashier's current
   running closing. When the closing is signed, all approved expenses
   for that (unit, date, shift) get `reconciled_closing_id` set.

### C. Larger payment request (accountant + owner/manager)

1. Accountant opens **Cash Management → Payment Requests → New**.
2. Form: payee details, amount, mode, purpose, invoice upload.
3. Status = `pending`.
4. Owner (or manager, if below threshold) opens it in **Approvals →
   Payment Requests**. Approve or reject.
5. On approve, accountant gets a "Ready to pay" entry. After actually
   transferring via netbanking, they hit **Mark paid** and enter
   bank_reference (UTR).
6. On "Mark paid", a `bank_ledger_entries` row is created (source_kind
   = 'payment_request', payment_amount = the amount).

### D. Inter-unit transfer (accountant)

For "Cafe pays Theatre ₹2.16L canteen rent":

1. Accountant: **Bank ledger → New transfer**.
2. Form: from unit, to unit, amount, narration, date.
3. Two rows are inserted atomically:
   - Theatre bank: receipt = ₹2.16L, source_kind = 'inter_unit_transfer'
   - Cafe bank: payment = ₹2.16L, source_kind = 'inter_unit_transfer'
4. Both rows share a `source_id` UUID so they cross-reference.

### E. Bank ledger reconciliation (accountant, weekly)

1. **Cash Management → Bank Ledger → ICICI Theatre**.
2. Table with running balance.
3. Accountant pastes bank statement (CSV or manual line entry) → console
   matches by date + amount → highlights matches → user confirms or
   rejects each.
4. Matched rows get `reconciled_at = now()`.
5. Unreconciled rows older than 7 days surface as warnings.

### F. Daily cashflow summary (owner / accountant)

A single page that adds Theatre + Cafe for any chosen date:

```
            THEATRE         CAFE          TOTAL
GROSS       425,955.00      146,140.00    572,095.00
  Cash       43,835.00       51,180.00     95,015.00
  BMS       369,700.00            0.00    369,700.00
  UPI Paytm  12,420.00            0.00     12,420.00
  UPI Pine        0.00       91,600.00     91,600.00
  Razorpay        0.00        3,360.00      3,360.00
EXPENSES        456.00        1,450.00      1,906.00
CASH DEPOSIT 43,400.00       47,970.00     91,370.00
EXCESS/SHORT     21.00       (1,760.00)   (1,739.00)

UNPAID PAYMENT REQUESTS
  Theatre: 50,000.00 (Meera George remuneration, pending owner approval)
  Cafe:    20,532.00 (Infinite Inventory Mgmt)

BANK BALANCES (post day-end)
  Theatre ICICI:    1,15,30,534.34
  Cafe ICICI:         22,11,065.29
  TOTAL:           1,37,41,599.63
```

Numbers match the manual CSV.

---

## RLS

Reads:

- `operating_units`, `bank_accounts`, `payment_methods`: any
  `cinema_access(cinema_id)`.
- `daily_cash_closings`, `cash_closing_*`, `petty_expenses`: any
  authorized user in the cinema (owners need to see, managers need to
  approve).
- `payment_requests`: same — visibility is broad, mutability is gated.
- `bank_ledger_entries`: accountant, owner, manager (not cashiers).

Writes:

- `operating_units`, `bank_accounts`, `payment_methods`: owner.
- `daily_cash_closings`: cashier inserts (own rows), shift manager
  updates `signed_at` / `status` only.
- `cash_closing_*`: cashier inserts on draft closing; lock when status
  = 'signed'.
- `petty_expenses`: cashier inserts (own rows), shift manager updates
  approval fields.
- `payment_requests`: accountant inserts, owner/manager updates approval
  fields, accountant updates paid_at + bank_reference after payment.
- `bank_ledger_entries`: accountant + auto-inserts from triggers on
  approved cash closings / paid payment requests / inter-unit
  transfers.

---

## UI surface

New top-level nav group **Cash** with sub-pages:

- **Today** — landing page with the cashflow summary above + per-unit
  status (closings done, expenses pending, payments pending).
- **Cash closings** — list by date, search by cashier, status filter.
- **Petty expenses** — full table, owner sees all units, cashier sees
  own + pending.
- **Payment requests** — table + new request button.
- **Bank ledger** — one tab per bank account, infinite scroll.
- **Reports** — month-end summary, year-to-date cashflow.
- **Settings → Cash** — operating units, bank accounts, payment
  methods, approval thresholds.

Mobile FAB adds:

- **Petty expense** (cashier, daily_manager) — opens the petty form.
- **Close cash** (cashier) — opens the closing form for today.

---

## Phasing

### Phase 1 — Foundations (week 1)
- SQL migration: `operating_units`, `bank_accounts`, `payment_methods`,
  `daily_cash_closings`, `cash_closing_denominations`,
  `cash_closing_payment_methods`.
- Settings: Operating Units + Bank Accounts + Payment Methods CRUD.
- Cash closing form (cashier-only role gating; daily_manager doubles up
  until cashier role is added).
- Today summary panel (per-unit collection breakdown).

### Phase 2 — Petty + Approvals (week 2)
- `petty_expenses` table + receipts Storage bucket.
- Mobile FAB "Petty expense" entry.
- Shift manager approvals queue.
- Reconciliation of approved expenses into the day's closing.

### Phase 3 — Payment requests + bank ledger (week 3)
- `payment_requests` + `bank_ledger_entries` tables.
- Accountant new-request form + invoice upload.
- Owner/manager approval queue.
- Bank ledger view per account.
- Inter-unit transfer composer.

### Phase 4 — Reconciliation + Reports (week 4)
- Bank statement reconciliation flow.
- Month-end summary report.
- YTD cashflow + cash-vs-bank trend chart.

### Phase 5 — Polish + audit (week 5+)
- Email digest for owner: pending approvals each morning.
- Excel export matching the legacy spreadsheet format (so
  accountant can pause the manual sheet without losing format).
- Audit log surfaced in UI (who approved what, when).

---

## Decisions locked in (2026-06-02)

1. ✅ **Cashier role added** — petty expense raising + own profile view
   only. No other module access. Cash closing stays with daily_manager.
2. ✅ **POS payment-method breakdown is typed by the daily manager**
   from the POS reports during cash closing. Pos_total_sales still
   auto-pulls from `entries` / `fb_entries`; only the breakdown row
   entries are manual.
3. ✅ **Receipt photo on petty expenses = optional** in v1. Useful
   for audit trail (the CA appreciates one-click proof for ₹400 water
   payments). If you want it required at scale, we add a per-cinema
   threshold later: "required for amounts > ₹X".
4. ✅ **Approval threshold for payment requests = ₹5,000 default.**
   Configurable per cinema in Settings.
5. ✅ **Invoice upload on payment requests** = always allowed,
   recommended. The CA will ask for these for tax filing.

## Still open (non-blocking)

A. **Operating unit FK on `entries` / `fb_entries`?** Today's
   implicit mapping (entries→box_office, fb_entries→food_beverage)
   works fine for a single cinema. Make it explicit only when a
   second BO till opens. Deferred.

B. **Cash drawer per cashier.** Today's CSV is single-cashier per
   shift, which is what we model. If two cashiers share a shift,
   either:
     - one of them is responsible for the till and closes it (the
       other doesn't close), or
     - we add `cashier_email[]` to the closing.
   Pick if/when it happens.

C. **Daily manager approving their own petty expense.** Probably fine
   to allow with a warning. Block strictly only if your CA insists on
   separation of duties.

D. **Statutory tax dates** (entertainment tax, GST). Phase 4+. Surface
   on Today as a "due in N days" chip.

E. **Excel export matching the legacy spreadsheet exactly** — Phase 5.
   Lets the accountant pause the manual sheet without losing the format
   they're used to.

---

## What we'd ship in week 1

A working **Today** page that shows for each operating unit:

- Today's POS sale (auto from existing entries/fb_entries)
- Today's payment method breakdown (auto when payment_methods is
  configured)
- A "close cash" CTA per unit that opens the closing form
- Once closed, the bank-deposit line and excess/short are visible

That alone replaces the top half of the manual CSV. Everything below
that is Phase 2-4.

---

End of design. Mark the open questions and we'll iterate.
