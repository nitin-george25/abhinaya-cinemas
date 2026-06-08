-- ============================================================================
-- cash_20 — one cash deposit covers many closings.
--
-- Real process at Abhinaya: two POS shifts → two closings per day; the
-- combined cash is deposited the NEXT day as ONE physical bank deposit.
-- cash_10 modeled deposits with a single nullable closing_id, forcing
-- one-deposit-per-closing — the manager would have to split one bank slip
-- across two shift closings artificially.
--
-- This migration mirrors the pos_settlements pattern:
--
--   cash_deposit_closings — join table, PK on closing_id so a closing can
--   belong to AT MOST ONE deposit while a deposit covers many closings.
--
-- Deposit math (owner decision 2026-06-08): deposited + retained must equal
-- the covered closings' cash_counted sum. Retained = till float, recorded
-- once per deposit (the float belongs to the till, not a shift). Enforced
-- app-side, not by constraint — the join rows land after the parent insert.
--
-- cash_deposits.closing_id stays for legacy rows but is deprecated; the
-- backfill copies it into the join table. fn_closing_to_ledger's deferral
-- check now looks at the join table too. Cancelling a deposit frees its
-- closings (trigger deletes the join rows).
--
-- Idempotent.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Join table.
-- ----------------------------------------------------------------------------

create table if not exists public.cash_deposit_closings (
  closing_id  uuid primary key references public.daily_cash_closings(id) on delete cascade,
  deposit_id  uuid not null references public.cash_deposits(id) on delete cascade
);

create index if not exists cash_deposit_closings_deposit_idx
  on public.cash_deposit_closings (deposit_id);

comment on table public.cash_deposit_closings is
  'm:1 closings → deposit. PK on closing_id: a closing is covered by at '
  'most one deposit; a deposit covers many closings (two shifts deposited '
  'together the next day). cash_20.';

alter table public.cash_deposit_closings enable row level security;

-- RLS — gate via the parent deposit, mirroring pos_settlement_closings.
drop policy if exists cash_deposit_closings_read  on public.cash_deposit_closings;
drop policy if exists cash_deposit_closings_write on public.cash_deposit_closings;

create policy cash_deposit_closings_read on public.cash_deposit_closings
  for select using (exists (
    select 1 from public.cash_deposits d
     where d.id = deposit_id and public.cinema_access_unit(d.operating_unit_id)
  ));

create policy cash_deposit_closings_write on public.cash_deposit_closings
  for all using (exists (
    select 1 from public.cash_deposits d
     where d.id = deposit_id
       and public.cinema_access_unit(d.operating_unit_id)
       and public.can_approve_petty_expense()
  )) with check (exists (
    select 1 from public.cash_deposits d
     where d.id = deposit_id
       and public.cinema_access_unit(d.operating_unit_id)
       and public.can_approve_petty_expense()
  ));

-- ----------------------------------------------------------------------------
-- 2) Backfill legacy single-closing links. Cancelled deposits don't hold
--    their closing. on conflict: if two deposits claimed the same closing,
--    the earlier one wins (deterministic via created_at ordering).
-- ----------------------------------------------------------------------------

insert into public.cash_deposit_closings (closing_id, deposit_id)
select d.closing_id, d.id
  from public.cash_deposits d
 where d.closing_id is not null
   and d.status <> 'cancelled'
 order by d.created_at
on conflict (closing_id) do nothing;

comment on column public.cash_deposits.closing_id is
  'DEPRECATED since cash_20 — use cash_deposit_closings. Kept for legacy '
  'rows; new deposits leave it null.';

-- ----------------------------------------------------------------------------
-- 3) Cancelling a deposit frees its closings.
-- ----------------------------------------------------------------------------

create or replace function public.fn_cash_deposit_cancel_frees_closings()
  returns trigger
  language plpgsql
  security definer set search_path = public
as $$
begin
  if new.status = 'cancelled' and (old.status is distinct from 'cancelled') then
    delete from public.cash_deposit_closings where deposit_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cash_deposit_cancel_frees_closings on public.cash_deposits;
create trigger trg_cash_deposit_cancel_frees_closings
  after update of status on public.cash_deposits
  for each row execute function public.fn_cash_deposit_cancel_frees_closings();

-- ----------------------------------------------------------------------------
-- 4) fn_closing_to_ledger — deferral now also checks the join table.
--    (Body otherwise identical to cash_10's version.)
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
    -- Deferral: if any deposit covers this closing — via the legacy
    -- closing_id OR the cash_20 join table — the explicit deposit flow
    -- owns the ledger write. Skip.
    select exists(
      select 1 from public.cash_deposits where closing_id = new.id
      union all
      select 1 from public.cash_deposit_closings where closing_id = new.id
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

-- verify:
--   select count(*) from public.cash_deposit_closings;            -- = legacy linked deposits
--   select d.id, d.status, count(j.closing_id) covered
--     from public.cash_deposits d
--     left join public.cash_deposit_closings j on j.deposit_id = d.id
--    group by d.id, d.status order by max(d.created_at) desc limit 10;
