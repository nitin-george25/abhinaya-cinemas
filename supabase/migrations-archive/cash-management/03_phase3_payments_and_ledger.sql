-- ============================================================================
-- 03 — Phase 3: payment_requests + bank_ledger_entries + auto-insert triggers
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) payment_requests
-- ----------------------------------------------------------------------------

create table if not exists public.payment_requests (
  id                       uuid primary key default gen_random_uuid(),
  operating_unit_id        uuid not null references public.operating_units(id) on delete restrict,
  needed_by                date,                              -- "due date"

  payee_name               text not null,
  payee_account_last4      text,
  payee_ifsc               text,

  amount                   numeric(14,2) not null check (amount > 0),
  mode                     text not null
                              check (mode in ('bank_transfer','cheque','cash','upi')),
  purpose                  text not null,
  invoice_url              text,                              -- Storage path or external link

  requested_by_email       text not null,                     -- accountant
  approved_by_email        text,                              -- owner or manager (threshold-based)
  approved_at              timestamptz,
  rejected_reason          text,

  paid_at                  timestamptz,
  paid_via_bank_account_id uuid references public.bank_accounts(id),
  bank_reference           text,                              -- UTR / cheque no.

  status                   text not null default 'pending'
                              check (status in ('pending','approved','rejected','paid')),

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists payment_requests_unit_status_idx
  on public.payment_requests (operating_unit_id, status, needed_by);
create index if not exists payment_requests_pending_approval_idx
  on public.payment_requests (operating_unit_id, created_at desc)
  where status = 'pending';

alter table public.payment_requests enable row level security;


-- ----------------------------------------------------------------------------
-- 2) bank_ledger_entries
--
--    Running balance is computed at query time, not stored — avoids backfill
--    on insert/delete and keeps reconciliation logic simple.
--
--    source_kind + source_id backlink so a change to (closing | request)
--    can be traced to its ledger row(s).
-- ----------------------------------------------------------------------------

create table if not exists public.bank_ledger_entries (
  id              uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  entry_date      date not null,
  narration       text not null,
  receipt_amount  numeric(14,2) not null default 0 check (receipt_amount >= 0),
  payment_amount  numeric(14,2) not null default 0 check (payment_amount >= 0),

  source_kind     text not null
                    check (source_kind in
                      ('opening_balance','cash_deposit','payment_request',
                       'inter_unit_transfer','pos_settlement','manual')),
  source_id       uuid,

  bank_reference  text,                                      -- UTR / cheque no.
  reconciled_at   timestamptz,                               -- when matched against bank statement
  notes           text,

  created_at      timestamptz not null default now(),
  created_by      text
);

create index if not exists bank_ledger_account_date_idx
  on public.bank_ledger_entries (bank_account_id, entry_date desc, created_at desc);
create index if not exists bank_ledger_source_idx
  on public.bank_ledger_entries (source_kind, source_id) where source_id is not null;
create index if not exists bank_ledger_unreconciled_idx
  on public.bank_ledger_entries (bank_account_id, entry_date) where reconciled_at is null;

alter table public.bank_ledger_entries enable row level security;


-- ----------------------------------------------------------------------------
-- 3) Auto-insert triggers
--
--    A) When a daily_cash_closing transitions to 'signed' AND
--       cash_deposited > 0, insert a ledger row for the deposit.
--    B) When a payment_request transitions to 'paid', insert a ledger row
--       for the payment.
--
--    Triggers are idempotent: re-signing or re-marking won't double-insert
--    because we delete any prior rows that point to the same source first.
-- ----------------------------------------------------------------------------

create or replace function public.fn_closing_to_ledger()
  returns trigger
  language plpgsql
  security definer set search_path = public
as $$
declare
  v_bank uuid;
begin
  -- Only on transition to 'signed' from anything else
  if new.status = 'signed' and (old.status is distinct from 'signed') then
    -- Pick the operating unit's primary bank account
    select id into v_bank
      from public.bank_accounts
      where operating_unit_id = new.operating_unit_id
        and archived_at is null
      order by is_primary desc, created_at
      limit 1;

    if v_bank is null then
      raise notice 'closing % signed but no bank account on unit %; skipping ledger insert',
        new.id, new.operating_unit_id;
      return new;
    end if;

    -- Delete any stale row from a previous signing (defence against re-sign).
    delete from public.bank_ledger_entries
      where source_kind = 'cash_deposit' and source_id = new.id;

    if new.cash_deposited > 0 then
      insert into public.bank_ledger_entries (
        bank_account_id, entry_date, narration,
        receipt_amount, payment_amount,
        source_kind, source_id,
        created_by
      ) values (
        v_bank, new.business_date,
        'Cash deposit · ' || coalesce(new.notes, 'shift ' || new.shift),
        new.cash_deposited, 0,
        'cash_deposit', new.id,
        new.closed_by_email
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_closing_to_ledger on public.daily_cash_closings;
create trigger trg_closing_to_ledger
  after update of status on public.daily_cash_closings
  for each row execute function public.fn_closing_to_ledger();


create or replace function public.fn_payment_to_ledger()
  returns trigger
  language plpgsql
  security definer set search_path = public
as $$
begin
  if new.status = 'paid' and (old.status is distinct from 'paid') then
    if new.paid_via_bank_account_id is null then
      raise exception 'payment_request % marked paid without paid_via_bank_account_id', new.id;
    end if;

    -- Defence against re-marking
    delete from public.bank_ledger_entries
      where source_kind = 'payment_request' and source_id = new.id;

    insert into public.bank_ledger_entries (
      bank_account_id, entry_date, narration,
      receipt_amount, payment_amount,
      source_kind, source_id,
      bank_reference,
      created_by
    ) values (
      new.paid_via_bank_account_id,
      coalesce(new.paid_at::date, current_date),
      new.payee_name || ' · ' || new.purpose,
      0, new.amount,
      'payment_request', new.id,
      new.bank_reference,
      new.requested_by_email
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_payment_to_ledger on public.payment_requests;
create trigger trg_payment_to_ledger
  after update of status on public.payment_requests
  for each row execute function public.fn_payment_to_ledger();


-- ----------------------------------------------------------------------------
-- 4) Auto-recompute petty_expenses_paid on closing when an expense gets
--    approved or its reconciliation flips.
--
--    Keeps the closing's discrepancy honest without UI orchestration.
-- ----------------------------------------------------------------------------

create or replace function public.fn_recompute_closing_petty()
  returns trigger
  language plpgsql
  security definer set search_path = public
as $$
declare
  v_closing uuid;
  v_total   numeric(14,2);
begin
  -- Determine which closing to recompute (use NEW's, fall back to OLD's).
  v_closing := coalesce(new.reconciled_closing_id, old.reconciled_closing_id);
  if v_closing is null then return coalesce(new, old); end if;

  select coalesce(sum(amount), 0) into v_total
    from public.petty_expenses
    where reconciled_closing_id = v_closing
      and status = 'approved';

  update public.daily_cash_closings
    set petty_expenses_paid = v_total
    where id = v_closing;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_recompute_closing_petty on public.petty_expenses;
create trigger trg_recompute_closing_petty
  after insert or update of amount, status, reconciled_closing_id
            or delete
  on public.petty_expenses
  for each row execute function public.fn_recompute_closing_petty();


commit;
