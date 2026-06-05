-- ============================================================================
-- 01 — Phase 1 schema: operating units, bank accounts, payment methods,
--      cash closings + denominations + payment-method breakdown.
--
-- All idempotent via `if not exists`.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Add payment_approval_threshold to cinemas. Default ₹5,000.
-- ----------------------------------------------------------------------------

alter table public.cinemas
  add column if not exists payment_approval_threshold numeric(14,2) not null default 5000;


-- ----------------------------------------------------------------------------
-- 2) operating_units — Theatre / Cafe / future "Banquet"
-- ----------------------------------------------------------------------------

create table if not exists public.operating_units (
  id            uuid primary key default gen_random_uuid(),
  cinema_id     uuid not null references public.cinemas(id) on delete cascade,
  name          text not null,
  kind          text not null check (kind in ('box_office','food_beverage','other')),
  display_order int not null default 0,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    text,
  constraint operating_units_cinema_name_uk unique (cinema_id, name)
);

create index if not exists operating_units_cinema_idx on public.operating_units (cinema_id);
alter table public.operating_units enable row level security;


-- ----------------------------------------------------------------------------
-- 3) bank_accounts — one per unit, multiple allowed
-- ----------------------------------------------------------------------------

create table if not exists public.bank_accounts (
  id                    uuid primary key default gen_random_uuid(),
  cinema_id             uuid not null references public.cinemas(id) on delete cascade,
  operating_unit_id     uuid not null references public.operating_units(id) on delete restrict,
  name                  text not null,                        -- "ICICI Current 12345"
  bank_name             text,
  account_number_last4  text,                                 -- never the full account no.
  opening_balance       numeric(14,2) not null default 0,
  opening_date          date not null default current_date,
  is_primary            boolean not null default false,
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  updated_by            text,
  constraint bank_accounts_unit_name_uk unique (operating_unit_id, name)
);

create index if not exists bank_accounts_unit_idx on public.bank_accounts (operating_unit_id);
alter table public.bank_accounts enable row level security;


-- ----------------------------------------------------------------------------
-- 4) payment_methods lookup
--    flow_type drives bank-ledger handling:
--      cash             — never flows to bank automatically; needs deposit
--      online_immediate — same-day bank credit (QR Razorpay style)
--      online_settled   — next-day or batched (BookMyShow style)
-- ----------------------------------------------------------------------------

create table if not exists public.payment_methods (
  id                  uuid primary key default gen_random_uuid(),
  cinema_id           uuid not null references public.cinemas(id) on delete cascade,
  code                text not null,                          -- "bms", "upi_paytm", "cash"
  display_name        text not null,                          -- "BookMyShow", …
  flow_type           text not null check (flow_type in ('cash','online_immediate','online_settled')),
  receives_into_bank  uuid references public.bank_accounts(id),
  display_order       int not null default 0,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  constraint payment_methods_cinema_code_uk unique (cinema_id, code)
);
alter table public.payment_methods enable row level security;


-- ----------------------------------------------------------------------------
-- 5) daily_cash_closings — one row per (unit, business_date, shift)
--
--    pos_cash_expected and discrepancy are generated columns so reports
--    don't have to recompute. Positive discrepancy = excess; negative = short.
-- ----------------------------------------------------------------------------

create table if not exists public.daily_cash_closings (
  id                   uuid primary key default gen_random_uuid(),
  operating_unit_id    uuid not null references public.operating_units(id) on delete restrict,
  business_date        date not null,
  shift                text not null default 'all_day'
                          check (shift in ('morning','evening','all_day')),
  cashier_email        text,                                  -- if a cashier was assigned to till
  closed_by_email      text not null,                         -- daily manager who closes (required)

  pos_total_sales      numeric(14,2) not null default 0,      -- auto-pulled from entries/fb_entries
  pos_non_cash_total   numeric(14,2) not null default 0,      -- sum of non-cash method amounts
  pos_cash_expected    numeric(14,2) generated always as
                         (pos_total_sales - pos_non_cash_total) stored,

  cash_counted         numeric(14,2) not null default 0,      -- sum of denominations
  petty_expenses_paid  numeric(14,2) not null default 0,      -- pulled from petty_expenses
  cash_deposited       numeric(14,2) not null default 0,

  discrepancy          numeric(14,2) generated always as
                         (cash_counted + petty_expenses_paid - (pos_total_sales - pos_non_cash_total)) stored,

  notes                text,
  status               text not null default 'draft'
                          check (status in ('draft','signed','disputed','resolved')),
  signed_at            timestamptz,
  resolved_at          timestamptz,
  resolved_by_email    text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint daily_cash_closings_unit_date_shift_uk unique (operating_unit_id, business_date, shift)
);

create index if not exists daily_cash_closings_unit_date_idx
  on public.daily_cash_closings (operating_unit_id, business_date desc);
create index if not exists daily_cash_closings_status_idx
  on public.daily_cash_closings (status) where status <> 'signed';
alter table public.daily_cash_closings enable row level security;


-- ----------------------------------------------------------------------------
-- 6) cash_closing_denominations — child of closings
--
--    denomination stored as numeric(8,2) to handle the 50-paise coin without
--    rounding. INR denominations: 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.50.
-- ----------------------------------------------------------------------------

create table if not exists public.cash_closing_denominations (
  closing_id    uuid not null references public.daily_cash_closings(id) on delete cascade,
  denomination  numeric(8,2) not null,
  count         int not null default 0 check (count >= 0),
  primary key (closing_id, denomination)
);
alter table public.cash_closing_denominations enable row level security;


-- ----------------------------------------------------------------------------
-- 7) cash_closing_payment_methods — child of closings
--
--    One row per payment method used that day with the actual amount the
--    daily manager typed in from the POS report.
-- ----------------------------------------------------------------------------

create table if not exists public.cash_closing_payment_methods (
  closing_id        uuid not null references public.daily_cash_closings(id) on delete cascade,
  payment_method_id uuid not null references public.payment_methods(id) on delete restrict,
  amount            numeric(14,2) not null default 0,
  primary key (closing_id, payment_method_id)
);
alter table public.cash_closing_payment_methods enable row level security;


commit;
