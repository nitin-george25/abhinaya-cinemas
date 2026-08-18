-- ============================================================================
-- bank_accounts_owner_manage — the owner can revise and remove bank accounts,
-- and correct the account a payment was actually paid from.
--
-- Two gaps, both of which previously ended at "fix it in Supabase Studio":
--
-- 1) BANK ACCOUNTS were add-only in the console. RLS has always let the owner
--    write (cash_04 bank_accounts_write), there was simply no UI and no safe
--    delete. Deleting is the hard part: bank_ledger_entries, cash_deposits and
--    pos_settlements all point at bank_accounts with ON DELETE RESTRICT, and
--    payment_requests / operating_units point at it with ON DELETE SET NULL —
--    so a naive delete either fails outright or silently clears a unit's
--    default pay-from account. fn_bank_account_delete resolves that honestly:
--    an account nothing has ever touched is really deleted, anything else is
--    ARCHIVED (it already disappears from every picker — listBankAccounts
--    filters archived_at) and the history stays intact. The caller is told
--    which of the two happened.
--
-- 2) THE PAID-FROM ACCOUNT was frozen once a payment was paid. That freeze is
--    right in general — payments_80 refuses to edit a paid payment because the
--    money and its ledger row are real — but it has no answer for the one
--    mistake that matters here: the accountant picked the wrong account at
--    mark-paid, so the money left account A and the bank book says B. Neither
--    account reconciles and there is no way back short of SQL.
--
--    fn_payment_correct_paid_account (and its batch twin) is a narrow,
--    owner-only fix for exactly that: it moves the paid-from account AND
--    repoints the bank-ledger row that the mark-paid trigger wrote, in one
--    transaction, with a mandatory reason on the audit trail. It changes no
--    amount, no payee and no status — this is a correction of WHERE the money
--    came from, never of what was paid. The ledger row's reconciled_at is
--    cleared, because a row that has moved accounts cannot still be matched
--    against the old account's statement.
--
-- HOW TO RUN: npm run db:push:staging / :prod (Supabase CLI). Idempotent.
-- Depends on payments_100 (payment_batches) — apply that first.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Who is holding on to this bank account?
--
-- One row per area that still references it, so the console can say "archived
-- because 42 ledger entries point at it" rather than a bare failure. Also the
-- single source of truth for the delete-vs-archive decision below — the two
-- must never drift apart, so the delete function calls this rather than
-- repeating the list.
-- ----------------------------------------------------------------------------
create or replace function public.fn_bank_account_usage(p_id uuid)
  returns table (label text, n bigint)
  language sql stable security definer set search_path = public
as $$
  select 'Bank-book entries', count(*) from public.bank_ledger_entries where bank_account_id = p_id
  union all
  select 'Cash deposits', count(*) from public.cash_deposits where bank_account_id = p_id
  union all
  select 'POS settlements', count(*) from public.pos_settlements where bank_account_id = p_id
  union all
  select 'Payments', count(*) from public.payment_requests
   where bank_account_id = p_id or paid_via_bank_account_id = p_id
  union all
  select 'Batch payments', count(*) from public.payment_batches
   where bank_account_id = p_id or paid_via_bank_account_id = p_id
  union all
  select 'Payment methods settling here', count(*) from public.payment_methods
   where receives_into_bank = p_id
  union all
  select 'Units defaulting to it', count(*) from public.operating_units
   where default_bank_account_id = p_id;
$$;

-- ----------------------------------------------------------------------------
-- 2) Revise an account.
--
-- Goes through an RPC rather than a bare UPDATE so the primary flag stays
-- exclusive: exactly one primary per cinema, enforced here because there is no
-- constraint that can express it (a partial unique index would block the moment
-- two cinemas share the table).
--
-- opening_balance is editable on purpose. It is a plain column that seeds the
-- running balance on the bank-book page — nothing materialises it as a ledger
-- row — so correcting it is immediate and complete.
-- ----------------------------------------------------------------------------
create or replace function public.fn_bank_account_save(
  p_id              uuid,
  p_name            text,
  p_bank_name       text,
  p_last4           text,
  p_opening_balance numeric,
  p_opening_date    date,
  p_is_primary      boolean
) returns void language plpgsql security definer set search_path = public
as $$
declare a public.bank_accounts%rowtype;
        v_actor text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  if not public.is_owner() then raise exception 'Only the owner can edit a bank account'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'The account needs a name'; end if;

  select * into a from public.bank_accounts where id = p_id;
  if not found then raise exception 'Bank account not found'; end if;
  if not public.cinema_access(a.cinema_id) then raise exception 'Bank account not found'; end if;

  update public.bank_accounts
     set name                 = btrim(p_name),
         bank_name            = nullif(btrim(p_bank_name), ''),
         account_number_last4 = nullif(btrim(p_last4), ''),
         opening_balance      = coalesce(p_opening_balance, opening_balance),
         opening_date         = coalesce(p_opening_date, opening_date),
         is_primary           = coalesce(p_is_primary, is_primary),
         updated_at           = now(),
         updated_by           = coalesce(v_actor, updated_by)
   where id = a.id;

  -- Promoting this one demotes the rest of the cinema.
  if coalesce(p_is_primary, a.is_primary) then
    update public.bank_accounts
       set is_primary = false, updated_at = now()
     where cinema_id = a.cinema_id and id <> a.id and is_primary;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) Remove an account — really delete it if it is untouched, archive it if not.
--
-- Returns 'deleted' or 'archived' so the console can tell the owner which
-- happened and why, instead of a button whose meaning depends on invisible
-- state. Two refusals worth calling out: the last active account in a cinema
-- cannot go (every payment picker would be empty), and a primary account hands
-- the flag to the next survivor on its way out.
-- ----------------------------------------------------------------------------
create or replace function public.fn_bank_account_delete(p_id uuid)
  returns text language plpgsql security definer set search_path = public
as $$
declare a public.bank_accounts%rowtype;
        v_used numeric;          -- sum() over bigint counts comes back numeric
        v_left int;
begin
  if not public.is_owner() then raise exception 'Only the owner can remove a bank account'; end if;

  select * into a from public.bank_accounts where id = p_id;
  if not found then raise exception 'Bank account not found'; end if;
  if not public.cinema_access(a.cinema_id) then raise exception 'Bank account not found'; end if;
  if a.archived_at is not null then return 'archived'; end if;

  select count(*) into v_left
    from public.bank_accounts
   where cinema_id = a.cinema_id and archived_at is null and id <> a.id;
  if v_left = 0 then
    raise exception 'This is the only active bank account — add another before removing it';
  end if;

  select coalesce(sum(n), 0) into v_used from public.fn_bank_account_usage(a.id);

  -- Hand the primary flag on before this row stops being selectable.
  if a.is_primary then
    update public.bank_accounts
       set is_primary = true, updated_at = now()
     where id = (
       select id from public.bank_accounts
        where cinema_id = a.cinema_id and archived_at is null and id <> a.id
        order by created_at
        limit 1
     );
  end if;

  if v_used = 0 then
    delete from public.bank_accounts where id = a.id;
    return 'deleted';
  end if;

  update public.bank_accounts
     set archived_at = now(), is_primary = false, updated_at = now()
   where id = a.id;
  return 'archived';
end;
$$;

-- Bringing one back, for an archive done in error.
create or replace function public.fn_bank_account_restore(p_id uuid)
  returns void language plpgsql security definer set search_path = public
as $$
declare a public.bank_accounts%rowtype;
begin
  if not public.is_owner() then raise exception 'Only the owner can restore a bank account'; end if;
  select * into a from public.bank_accounts where id = p_id;
  if not found then raise exception 'Bank account not found'; end if;
  if not public.cinema_access(a.cinema_id) then raise exception 'Bank account not found'; end if;
  update public.bank_accounts set archived_at = null, updated_at = now() where id = a.id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) Correct the paid-from account on a payment that is already paid.
--
-- Deliberately NOT part of fn_payment_edit: that function's whole rule is that
-- a paid payment is frozen, and it should stay frozen for amount, payee and
-- status. This is a different operation — the money is right, the record of
-- which account it left is wrong — so it gets its own narrow, owner-only door
-- and moves the ledger row with it.
-- ----------------------------------------------------------------------------
create or replace function public.fn_payment_correct_paid_account(
  p_payment_id uuid, p_bank_account_id uuid, p_reason text
) returns void language plpgsql security definer set search_path = public
as $$
declare r public.payment_requests%rowtype;
        v_old uuid;
        v_from text;
        v_to text;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can correct the paid-from account'; end if;
  if p_bank_account_id is null then raise exception 'Pick a bank account'; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required to correct the paid-from account'; end if;

  select * into r from public.payment_requests where id = p_payment_id;
  if not found then raise exception 'Payment not found'; end if;
  if r.status not in ('paid','posted') then
    raise exception 'Only a paid payment needs its paid-from account corrected (status %)', r.status;
  end if;
  if r.batch_id is not null then
    raise exception 'This invoice was paid in a batch — correct the batch instead';
  end if;

  v_old := r.paid_via_bank_account_id;
  if v_old is not distinct from p_bank_account_id then return; end if;

  -- Both accounts must belong to a cinema this owner can see.
  select name into v_to from public.bank_accounts
   where id = p_bank_account_id and public.cinema_access(cinema_id);
  if v_to is null then raise exception 'That bank account is not available'; end if;
  select name into v_from from public.bank_accounts where id = v_old;

  update public.payment_requests
     set paid_via_bank_account_id = p_bank_account_id
   where id = r.id;

  -- Move the money on the bank book too, or the correction is cosmetic. The row
  -- can no longer be reconciled against the account it just left.
  update public.bank_ledger_entries
     set bank_account_id = p_bank_account_id,
         reconciled_at   = null
   where source_kind = 'payment_request' and source_id = r.id;

  perform public.fn_payment_audit(r.id, r.status, r.status,
    'paid-from corrected: ' || coalesce(v_from, '—') || ' → ' || v_to || ' — ' || btrim(p_reason),
    null);
end;
$$;

create or replace function public.fn_payment_batch_correct_paid_account(
  p_batch_id uuid, p_bank_account_id uuid, p_reason text
) returns void language plpgsql security definer set search_path = public
as $$
declare b public.payment_batches%rowtype;
        v_old uuid;
        v_from text;
        v_to text;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can correct the paid-from account'; end if;
  if p_bank_account_id is null then raise exception 'Pick a bank account'; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required to correct the paid-from account'; end if;

  select * into b from public.payment_batches where id = p_batch_id;
  if not found then raise exception 'Batch not found'; end if;
  if b.status <> 'paid' then
    raise exception 'Only a paid batch needs its paid-from account corrected (status %)', b.status;
  end if;

  v_old := b.paid_via_bank_account_id;
  if v_old is not distinct from p_bank_account_id then return; end if;

  select name into v_to from public.bank_accounts
   where id = p_bank_account_id and public.cinema_access(cinema_id);
  if v_to is null then raise exception 'That bank account is not available'; end if;
  select name into v_from from public.bank_accounts where id = v_old;

  update public.payment_batches
     set paid_via_bank_account_id = p_bank_account_id
   where id = b.id;

  -- The lines carry the same stamp, but only the BATCH owns a ledger row.
  update public.payment_requests
     set paid_via_bank_account_id = p_bank_account_id
   where batch_id = b.id;

  update public.bank_ledger_entries
     set bank_account_id = p_bank_account_id,
         reconciled_at   = null
   where source_kind = 'payment_batch' and source_id = b.id;

  perform public.fn_payment_batch_audit(b.id, b.status, b.status,
    'paid-from corrected: ' || coalesce(v_from, '—') || ' → ' || v_to || ' — ' || btrim(p_reason),
    null);
end;
$$;

commit;

-- ============================================================================
-- VERIFY (after applying):
--   select proname from pg_proc where proname like 'fn_bank_account%'
--                                  or proname like '%correct_paid_account';
--
--   -- Delete vs archive, as an owner:
--   --   a brand-new unused account   → fn_bank_account_delete ⇒ 'deleted', row gone
--   --   an account with ledger rows  → fn_bank_account_delete ⇒ 'archived', row kept
--   --   the last active account      → raises 'only active bank account'
--   select * from public.fn_bank_account_usage('<id>');   -- what is holding it
--
--   -- Correcting a paid payment moves BOTH sides:
--   select pr.paid_via_bank_account_id, ble.bank_account_id, ble.reconciled_at
--     from public.payment_requests pr
--     join public.bank_ledger_entries ble
--       on ble.source_kind = 'payment_request' and ble.source_id = pr.id
--    where pr.id = '<paid payment>';
--   -- the two account ids must always match, and reconciled_at is null after a move.
--
--   -- Non-owners must be refused by all five functions.
-- ============================================================================
