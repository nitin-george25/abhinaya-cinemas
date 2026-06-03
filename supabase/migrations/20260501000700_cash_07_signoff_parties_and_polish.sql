-- ============================================================================
-- 07 — Polish round: rename Card-on-POS → Pinelabs, dual signoff on cash
--      closings, parties (vendors/customers) table, accountant-writable
--      bank_accounts, manual income source on the bank ledger.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Rename seed: Card on POS → Pinelabs.
-- ----------------------------------------------------------------------------

update public.payment_methods
   set code = 'pinelabs', display_name = 'Pinelabs'
 where code = 'card_pos';


-- ----------------------------------------------------------------------------
-- 2) Dual signoff on daily_cash_closings.
--    Workflow now: draft → counted (cashier signs) → signed (manager signs).
--    Disputed/resolved unchanged.
-- ----------------------------------------------------------------------------

alter table public.daily_cash_closings
  add column if not exists cashier_signed_at        timestamptz,
  add column if not exists cashier_signed_by_email  text,
  add column if not exists manager_signed_by_email  text;

-- Backfill manager_signed_by_email from closed_by_email on already-signed rows
update public.daily_cash_closings
   set manager_signed_by_email = closed_by_email
 where manager_signed_by_email is null and status = 'signed';

-- Extend the status CHECK to allow 'counted'
alter table public.daily_cash_closings
  drop constraint if exists daily_cash_closings_status_check;
alter table public.daily_cash_closings
  add constraint daily_cash_closings_status_check
  check (status in ('draft','counted','signed','disputed','resolved'));


-- ----------------------------------------------------------------------------
-- 3) Parties — vendors / customers / employees the cinema does business with.
--    Picked from a dropdown in payment_requests and (manual) bank_ledger
--    entries so accountants don't retype "Distributor XYZ" 200 times.
-- ----------------------------------------------------------------------------

create table if not exists public.parties (
  id           uuid primary key default gen_random_uuid(),
  cinema_id    uuid not null references public.cinemas(id) on delete cascade,
  name         text not null,
  party_type   text not null
                  check (party_type in ('vendor','customer','employee','other')),
  -- Free-form classification ("distributor", "landlord", "f&b supplier", …)
  category     text,
  contact_name text,
  phone        text,
  email        text,
  gstin        text,
  pan          text,
  account_last4 text,
  ifsc          text,
  notes         text,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    text,
  constraint parties_cinema_name_uk unique (cinema_id, name)
);
create index if not exists parties_cinema_type_idx
  on public.parties (cinema_id, party_type) where archived_at is null;

alter table public.parties enable row level security;

drop policy if exists parties_read  on public.parties;
drop policy if exists parties_write on public.parties;
create policy parties_read on public.parties
  for select using (public.cinema_access(cinema_id));
create policy parties_write on public.parties
  for all using (
    public.cinema_access(cinema_id)
    and exists (select 1 from public.authorized_users
                where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                  and role in ('owner','manager','accountant'))
  ) with check (
    public.cinema_access(cinema_id)
    and exists (select 1 from public.authorized_users
                where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                  and role in ('owner','manager','accountant'))
  );


-- ----------------------------------------------------------------------------
-- 4) Link parties to payment_requests + bank_ledger_entries.
-- ----------------------------------------------------------------------------

alter table public.payment_requests
  add column if not exists party_id uuid references public.parties(id) on delete set null;

alter table public.bank_ledger_entries
  add column if not exists party_id uuid references public.parties(id) on delete set null;

create index if not exists payment_requests_party_idx
  on public.payment_requests (party_id) where party_id is not null;
create index if not exists bank_ledger_party_idx
  on public.bank_ledger_entries (party_id) where party_id is not null;


-- ----------------------------------------------------------------------------
-- 5) Manual-income source on the bank ledger.
--    Lets accountants record cash IN that isn't a daily closing — refunds,
--    franchise income, deposits returned, owner top-ups.
-- ----------------------------------------------------------------------------

alter table public.bank_ledger_entries
  drop constraint if exists bank_ledger_entries_source_kind_check;
alter table public.bank_ledger_entries
  add constraint bank_ledger_entries_source_kind_check
  check (source_kind in (
    'opening_balance','cash_deposit','payment_request',
    'inter_unit_transfer','pos_settlement','manual',
    'manual_income','manual_expense'
  ));


-- ----------------------------------------------------------------------------
-- 6) Open bank_accounts to accountant writes.
--    Owner still controls archived_at + is_primary (the high-trust ops);
--    accountant can insert new accounts and update bookkeeping fields.
-- ----------------------------------------------------------------------------

drop policy if exists bank_accounts_write           on public.bank_accounts;
drop policy if exists bank_accounts_write_owner     on public.bank_accounts;
drop policy if exists bank_accounts_write_accountant on public.bank_accounts;

create policy bank_accounts_write_owner on public.bank_accounts
  for all using (public.cinema_access(cinema_id) and public.is_owner())
         with check (public.cinema_access(cinema_id) and public.is_owner());

-- Accountant: insert + update everything except deletions.
create policy bank_accounts_insert_accountant on public.bank_accounts
  for insert with check (
    public.cinema_access(cinema_id)
    and exists (select 1 from public.authorized_users
                where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                  and role = 'accountant')
  );
create policy bank_accounts_update_accountant on public.bank_accounts
  for update using (
    public.cinema_access(cinema_id)
    and exists (select 1 from public.authorized_users
                where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                  and role = 'accountant')
  ) with check (
    public.cinema_access(cinema_id)
    and exists (select 1 from public.authorized_users
                where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                  and role = 'accountant')
  );


commit;
