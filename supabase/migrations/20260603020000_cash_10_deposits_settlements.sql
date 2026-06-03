-- ============================================================================
-- 10 — Cash deposits, POS settlements, EDC slips, default float.
--
-- This migration replaces the "ledger row auto-inserted when closing reaches
-- signed" shortcut with an explicit, evidence-backed flow:
--
--   * Manager records a `cash_deposits` row during the closing dialog
--     (status='pending'). When the deposit physically happens at the bank
--     they update status='completed'; a trigger writes the bank-ledger row.
--   * Accountant records a `pos_settlements` row per actual payout
--     (Pinelabs T+1, Razorpay T+2, BMS, etc.). On status='received' a
--     trigger writes the bank-ledger row with source_kind='pos_settlement'.
--   * Both flows let the operator upload an attachment (deposit slip /
--     settlement slip) — stored in the new `cash-slips` bucket.
--   * Closing-level `edc_slip_url` captures the day's POS settlement slip
--     when the manager has it in hand at closing time — separate from the
--     accountant's later settlement-record upload.
--
-- The legacy fn_closing_to_ledger trigger stays in place but defers to the
-- new flow: it only auto-inserts a cash_deposit ledger row if NO
-- cash_deposits row exists for that closing (so closings made before this
-- migration keep working).
--
-- Idempotent.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) operating_units.default_float_amount
--
--    Recommended cash to retain in the till as float for the next shift.
--    Default 0; owner sets a sensible value in Settings → Cash.
-- ----------------------------------------------------------------------------

alter table public.operating_units
  add column if not exists default_float_amount numeric(14,2) not null default 0
    check (default_float_amount >= 0);


-- ----------------------------------------------------------------------------
-- 2) daily_cash_closings.edc_slip_url
--
--    Optional URL to a POS / EDC settlement slip the manager has at closing
--    time. Pure evidence — the ledger row still comes from pos_settlements.
-- ----------------------------------------------------------------------------

alter table public.daily_cash_closings
  add column if not exists edc_slip_url text;


-- ----------------------------------------------------------------------------
-- 3) cash-slips Storage bucket.
--
--    Holds deposit slips + EDC/POS settlement slips. Same public-read /
--    role-gated-write pattern as petty-receipts and payment-receipts.
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
  values ('cash-slips', 'cash-slips', true)
  on conflict (id) do update set public = excluded.public;

drop policy if exists "cash_slips_read"   on storage.objects;
drop policy if exists "cash_slips_write"  on storage.objects;
drop policy if exists "cash_slips_update" on storage.objects;
drop policy if exists "cash_slips_delete" on storage.objects;

create policy "cash_slips_read" on storage.objects
  for select using (bucket_id = 'cash-slips');

create policy "cash_slips_write" on storage.objects
  for insert with check (
    bucket_id = 'cash-slips'
    and exists (
      select 1 from public.authorized_users
       where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
         and role in ('owner','manager','daily_manager','accountant')
    )
  );

create policy "cash_slips_update" on storage.objects
  for update using (
    bucket_id = 'cash-slips' and public.is_owner()
  );

create policy "cash_slips_delete" on storage.objects
  for delete using (
    bucket_id = 'cash-slips' and public.is_owner()
  );


-- ----------------------------------------------------------------------------
-- 4) cash_deposits table.
--
--    One row per physical deposit at the bank. Created at closing time as
--    'pending', flipped to 'completed' when the deposit is done. Children
--    of a closing in spirit but FK is nullable so standalone deposits
--    (top-ups by the owner, etc.) are also representable.
-- ----------------------------------------------------------------------------

create table if not exists public.cash_deposits (
  id                      uuid primary key default gen_random_uuid(),
  closing_id              uuid references public.daily_cash_closings(id) on delete set null,
  operating_unit_id       uuid not null references public.operating_units(id) on delete restrict,
  bank_account_id         uuid not null references public.bank_accounts(id) on delete restrict,
  deposit_date            date not null default current_date,
  deposited_amount        numeric(14,2) not null check (deposited_amount > 0),
  retained_amount         numeric(14,2) not null default 0 check (retained_amount >= 0),
  slip_url                text,
  slip_reference          text,
  deposited_by_email      text not null,
  status                  text not null default 'pending'
                            check (status in ('pending','completed','cancelled')),
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists cash_deposits_closing_idx
  on public.cash_deposits (closing_id) where closing_id is not null;
create index if not exists cash_deposits_unit_status_idx
  on public.cash_deposits (operating_unit_id, status, deposit_date desc);

alter table public.cash_deposits enable row level security;

-- RLS: read for owner/manager/daily_manager/accountant; write same; only
-- owner can delete completed rows (audit).
drop policy if exists cash_deposits_read   on public.cash_deposits;
drop policy if exists cash_deposits_write  on public.cash_deposits;
drop policy if exists cash_deposits_delete on public.cash_deposits;

create policy cash_deposits_read on public.cash_deposits
  for select using (
    public.cinema_access_unit(operating_unit_id)
    and exists (
      select 1 from public.authorized_users
       where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
         and role in ('owner','manager','daily_manager','accountant')
    )
  );

create policy cash_deposits_write on public.cash_deposits
  for all using (
    public.cinema_access_unit(operating_unit_id)
    and public.can_approve_petty_expense()
  ) with check (
    public.cinema_access_unit(operating_unit_id)
    and public.can_approve_petty_expense()
  );

create policy cash_deposits_delete on public.cash_deposits
  for delete using (
    public.cinema_access_unit(operating_unit_id) and public.is_owner()
  );


-- ----------------------------------------------------------------------------
-- 5) pos_settlements table.
--
--    One row per actual bank payout from a POS processor. expected_amount
--    is the sum of gross POS lines across the associated closings (the join
--    table below); received_amount is what the bank actually credited.
--    fee_amount = expected − received (or recorded directly).
-- ----------------------------------------------------------------------------

create table if not exists public.pos_settlements (
  id                       uuid primary key default gen_random_uuid(),
  cinema_id                uuid not null references public.cinemas(id) on delete cascade,
  payment_method_id        uuid not null references public.payment_methods(id) on delete restrict,
  bank_account_id          uuid not null references public.bank_accounts(id) on delete restrict,
  settlement_date          date not null,
  expected_amount          numeric(14,2) not null default 0 check (expected_amount >= 0),
  received_amount          numeric(14,2) not null default 0 check (received_amount >= 0),
  fee_amount               numeric(14,2) not null default 0 check (fee_amount >= 0),
  bank_reference           text,
  slip_url                 text,
  notes                    text,
  status                   text not null default 'pending'
                              check (status in ('pending','received','reconciled','disputed')),
  received_by_email        text,
  received_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists pos_settlements_cinema_status_idx
  on public.pos_settlements (cinema_id, status, settlement_date desc);
create index if not exists pos_settlements_method_idx
  on public.pos_settlements (payment_method_id, settlement_date desc);

alter table public.pos_settlements enable row level security;

-- Join table: many-to-many settlement ↔ closings.
create table if not exists public.pos_settlement_closings (
  settlement_id   uuid not null references public.pos_settlements(id) on delete cascade,
  closing_id      uuid not null references public.daily_cash_closings(id) on delete cascade,
  primary key (settlement_id, closing_id)
);

alter table public.pos_settlement_closings enable row level security;

-- RLS for settlements: owner / manager / accountant read+write; cashier no.
drop policy if exists pos_settlements_read   on public.pos_settlements;
drop policy if exists pos_settlements_write  on public.pos_settlements;
drop policy if exists pos_settlements_delete on public.pos_settlements;

create policy pos_settlements_read on public.pos_settlements
  for select using (
    public.cinema_access(cinema_id)
    and exists (
      select 1 from public.authorized_users
       where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
         and role in ('owner','manager','accountant')
    )
  );

create policy pos_settlements_write on public.pos_settlements
  for all using (
    public.cinema_access(cinema_id)
    and exists (
      select 1 from public.authorized_users
       where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
         and role in ('owner','manager','accountant')
    )
  ) with check (
    public.cinema_access(cinema_id)
    and exists (
      select 1 from public.authorized_users
       where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
         and role in ('owner','manager','accountant')
    )
  );

-- Join-table policies — gate via parent settlement.
drop policy if exists pos_settlement_closings_read  on public.pos_settlement_closings;
drop policy if exists pos_settlement_closings_write on public.pos_settlement_closings;

create policy pos_settlement_closings_read on public.pos_settlement_closings
  for select using (exists (
    select 1 from public.pos_settlements s
     where s.id = settlement_id and public.cinema_access(s.cinema_id)
  ));

create policy pos_settlement_closings_write on public.pos_settlement_closings
  for all using (exists (
    select 1 from public.pos_settlements s
     where s.id = settlement_id and public.cinema_access(s.cinema_id)
  )) with check (exists (
    select 1 from public.pos_settlements s
     where s.id = settlement_id and public.cinema_access(s.cinema_id)
  ));


-- ----------------------------------------------------------------------------
-- 6) Triggers — write bank_ledger_entries on completion / receipt.
-- ----------------------------------------------------------------------------

-- 6a) cash_deposit → ledger on transition to 'completed'.
create or replace function public.fn_cash_deposit_to_ledger()
  returns trigger
  language plpgsql
  security definer set search_path = public
as $$
begin
  if new.status = 'completed' and (old.status is distinct from 'completed') then
    -- Defence against re-completion: drop any stale row first.
    delete from public.bank_ledger_entries
      where source_kind = 'cash_deposit' and source_id = new.id;
    insert into public.bank_ledger_entries (
      bank_account_id, entry_date, narration,
      receipt_amount, payment_amount,
      source_kind, source_id, bank_reference,
      created_by
    ) values (
      new.bank_account_id, new.deposit_date,
      coalesce(
        'Cash deposit · slip ' || nullif(new.slip_reference, ''),
        'Cash deposit'
      ),
      new.deposited_amount, 0,
      'cash_deposit', new.id, new.slip_reference,
      new.deposited_by_email
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cash_deposit_to_ledger on public.cash_deposits;
create trigger trg_cash_deposit_to_ledger
  after update of status on public.cash_deposits
  for each row execute function public.fn_cash_deposit_to_ledger();

-- Also fire when a row is inserted directly in 'completed' state.
create or replace function public.fn_cash_deposit_to_ledger_insert()
  returns trigger
  language plpgsql
  security definer set search_path = public
as $$
begin
  if new.status = 'completed' then
    insert into public.bank_ledger_entries (
      bank_account_id, entry_date, narration,
      receipt_amount, payment_amount,
      source_kind, source_id, bank_reference,
      created_by
    ) values (
      new.bank_account_id, new.deposit_date,
      coalesce(
        'Cash deposit · slip ' || nullif(new.slip_reference, ''),
        'Cash deposit'
      ),
      new.deposited_amount, 0,
      'cash_deposit', new.id, new.slip_reference,
      new.deposited_by_email
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cash_deposit_to_ledger_insert on public.cash_deposits;
create trigger trg_cash_deposit_to_ledger_insert
  after insert on public.cash_deposits
  for each row execute function public.fn_cash_deposit_to_ledger_insert();

-- Cleanup on cash_deposit delete — pull the matching ledger row.
create or replace function public.fn_cash_deposit_delete_cleanup()
  returns trigger
  language plpgsql
  security definer set search_path = public
as $$
begin
  delete from public.bank_ledger_entries
    where source_kind = 'cash_deposit' and source_id = old.id;
  return old;
end;
$$;
drop trigger if exists trg_cash_deposit_delete_cleanup on public.cash_deposits;
create trigger trg_cash_deposit_delete_cleanup
  before delete on public.cash_deposits
  for each row execute function public.fn_cash_deposit_delete_cleanup();

-- 6b) pos_settlement → ledger on transition to 'received'.
create or replace function public.fn_pos_settlement_to_ledger()
  returns trigger
  language plpgsql
  security definer set search_path = public
as $$
begin
  if new.status = 'received' and (old.status is distinct from 'received') then
    delete from public.bank_ledger_entries
      where source_kind = 'pos_settlement' and source_id = new.id;
    insert into public.bank_ledger_entries (
      bank_account_id, entry_date, narration,
      receipt_amount, payment_amount,
      source_kind, source_id, bank_reference,
      created_by
    ) values (
      new.bank_account_id, new.settlement_date,
      'POS settlement · ' || coalesce(
        (select display_name from public.payment_methods where id = new.payment_method_id),
        'unknown method'
      ),
      new.received_amount, 0,
      'pos_settlement', new.id, new.bank_reference,
      new.received_by_email
    );
  end if;
  return new;
end;
$$;
drop trigger if exists trg_pos_settlement_to_ledger on public.pos_settlements;
create trigger trg_pos_settlement_to_ledger
  after update of status on public.pos_settlements
  for each row execute function public.fn_pos_settlement_to_ledger();

-- Cleanup on settlement delete.
create or replace function public.fn_pos_settlement_delete_cleanup()
  returns trigger
  language plpgsql
  security definer set search_path = public
as $$
begin
  delete from public.bank_ledger_entries
    where source_kind = 'pos_settlement' and source_id = old.id;
  return old;
end;
$$;
drop trigger if exists trg_pos_settlement_delete_cleanup on public.pos_settlements;
create trigger trg_pos_settlement_delete_cleanup
  before delete on public.pos_settlements
  for each row execute function public.fn_pos_settlement_delete_cleanup();


-- ----------------------------------------------------------------------------
-- 7) Modify fn_closing_to_ledger — defer to cash_deposits when present.
--
--    Backward compat: closings made before this migration still get their
--    auto-insert. New closings: as soon as a cash_deposits row exists, the
--    closing trigger backs off and the deposit trigger does the work.
-- ----------------------------------------------------------------------------

create or replace function public.fn_closing_to_ledger()
  returns trigger
  language plpgsql
  security definer set search_path = public
as $$
declare
  v_bank uuid;
  v_has_deposit boolean;
begin
  if new.status = 'signed' and (old.status is distinct from 'signed') then
    -- Phase 10 deferral: if any cash_deposit row exists for this closing,
    -- the explicit deposit flow owns the ledger write. Skip.
    select exists(
      select 1 from public.cash_deposits where closing_id = new.id
    ) into v_has_deposit;
    if v_has_deposit then
      return new;
    end if;

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


commit;
