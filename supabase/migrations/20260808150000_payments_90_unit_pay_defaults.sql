-- ============================================================================
-- payments_90 — Per-unit payment defaults (pay-from account + mode).
--
-- "Make a Payment" defaulted the paid-from account to the cinema's primary bank
-- account, so an accountant raising an F&B payment had to re-pick the F&B
-- account every single time. Bank accounts already belong to a unit
-- (bank_accounts.operating_unit_id), so the default belongs there too: each unit
-- names the account it normally pays from, and the form follows the unit
-- selection. It is a DEFAULT, not a rule — the picker stays editable.
--
-- Set in Settings → Cash → Operating units, next to the default float, which is
-- the same idea (a per-unit starting value the operator can override).
--
-- Also threads `mode` (bank transfer / cheque / cash / UPI) through the edit
-- path so the form's mode picker round-trips. fn_payment_edit gains a 19th
-- argument, hence the drop+create — a bare `create or replace` would leave the
-- 18-arg overload in place and the calls would be ambiguous.
--
-- HOW TO RUN: npm run db:push:staging / :prod (Supabase CLI). Idempotent.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) The defaults themselves.
--
-- on delete set null: deleting a bank account must not take the unit with it —
-- the unit simply loses its default and falls back to the cinema primary. The
-- account is only constrained to exist, not to belong to this unit's cinema; the
-- picker in Settings only offers this cinema's accounts, and RLS keeps other
-- cinemas' rows unreadable anyway.
-- ----------------------------------------------------------------------------
alter table public.operating_units
  add column if not exists default_bank_account_id uuid
    references public.bank_accounts(id) on delete set null,
  add column if not exists default_payment_mode text;

alter table public.operating_units
  drop constraint if exists operating_units_default_payment_mode_check;
alter table public.operating_units
  add constraint operating_units_default_payment_mode_check
  check (default_payment_mode is null
         or default_payment_mode in ('bank_transfer','cheque','cash','upi'));

comment on column public.operating_units.default_bank_account_id is
  'Bank account "Make a Payment" pre-selects when this unit is chosen. A default, not a restriction.';
comment on column public.operating_units.default_payment_mode is
  'Payment mode "Make a Payment" pre-selects for this unit. A default, not a restriction.';

-- ----------------------------------------------------------------------------
-- 2) fn_payment_edit + p_mode. Body is payments_80's, unchanged except for the
--    mode column and the extra argument.
-- ----------------------------------------------------------------------------
drop function if exists public.fn_payment_edit(
  uuid, uuid, uuid, uuid, text, uuid, text, text, text, numeric, date, text,
  text, boolean, text, uuid, uuid, text);

create or replace function public.fn_payment_edit(
  p_payment_id           uuid,
  p_operating_unit_id    uuid,
  p_payment_type_id      uuid,
  p_bank_account_id      uuid,
  p_payee_name           text,
  p_payee_party_id       uuid,
  p_payee_distributor_id text,
  p_payee_account_last4  text,
  p_payee_ifsc           text,
  p_amount               numeric,
  p_needed_by            date,
  p_purpose              text,
  p_invoice_url          text,
  p_is_advance           boolean,
  p_advance_movie_id     text,
  p_advance_proforma_id  uuid,
  p_advance_party_id     uuid,
  p_proforma_url         text,
  p_mode                 text
) returns text language plpgsql security definer set search_path = public
as $$
declare r public.payment_requests%rowtype;
        v_actor    text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
        v_role     text;
        v_note     text := 'Edited';
        v_outcome  text;
        v_reapprove boolean := false;
begin
  select * into r from public.payment_requests where id = p_payment_id;
  if not found then raise exception 'Payment not found'; end if;

  select role into v_role from public.authorized_users
   where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''));

  -- Refuse with the reason, not a flat "not allowed" — the three ways an edit
  -- can be blocked need three different responses from the user.
  if r.status in ('paid','posted') then
    raise exception 'A paid payment cannot be edited — raise a correcting entry instead';
  end if;
  if r.status = 'cancelled' then
    raise exception 'A cancelled payment cannot be edited';
  end if;
  if r.status in ('quoting','quote_approved','invoiced') then
    raise exception 'Asset payments are revised through the quotation flow (status %)', r.status;
  end if;
  if not public.fn_payment_can_edit(p_payment_id) then
    if v_role = 'accountant' then
      raise exception 'The 24-hour window to edit this payment has passed — ask the owner';
    end if;
    raise exception 'Not allowed to edit this payment';
  end if;

  -- Access is checked on BOTH the current unit and the target unit, so a payment
  -- can't be moved out of (or into) a unit the editor can't see.
  if not public.cinema_access_unit(r.operating_unit_id)
     or not public.cinema_access_unit(coalesce(p_operating_unit_id, r.operating_unit_id)) then
    raise exception 'No access to that operating unit';
  end if;

  if p_amount is null or p_amount <= 0 then raise exception 'Enter a positive amount'; end if;
  if coalesce(btrim(p_payee_name), '') = '' then raise exception 'Enter a payee'; end if;

  -- What actually changed — recorded in the audit note so the trail reads as a
  -- history, not just "edited".
  if p_amount is distinct from r.amount then
    v_note := v_note || format(' · amount %s → %s', r.amount, p_amount);
  end if;
  if btrim(p_payee_name) is distinct from r.payee_name then
    v_note := v_note || format(' · payee %s → %s', r.payee_name, btrim(p_payee_name));
  end if;
  if p_bank_account_id is distinct from r.bank_account_id then
    v_note := v_note || ' · paying account';
  end if;
  if p_payee_account_last4 is distinct from r.payee_account_last4 then
    v_note := v_note || ' · payee A/c';
  end if;
  if p_mode is not null and p_mode is distinct from r.mode then
    v_note := v_note || format(' · mode %s → %s', r.mode, p_mode);
  end if;

  -- An approved payment whose amount or payee moved is no longer the payment the
  -- owner approved.
  v_reapprove := r.status in ('approved','otp_requested')
    and (p_amount is distinct from r.amount
         or btrim(p_payee_name) is distinct from r.payee_name);

  update public.payment_requests
     set operating_unit_id    = coalesce(p_operating_unit_id, operating_unit_id),
         -- Never blank the type: the invoice CHECK relies on it being present
         -- for typed rows, and the form always sends one.
         payment_type_id      = coalesce(p_payment_type_id, payment_type_id),
         bank_account_id      = p_bank_account_id,
         payee_name           = btrim(p_payee_name),
         payee_party_id       = p_payee_party_id,
         payee_distributor_id = p_payee_distributor_id,
         payee_account_last4  = p_payee_account_last4,
         payee_ifsc           = p_payee_ifsc,
         amount               = p_amount,
         mode                 = coalesce(p_mode, mode),
         needed_by            = p_needed_by,
         purpose              = coalesce(nullif(btrim(p_purpose), ''), purpose),
         -- A newly uploaded file replaces the old one; passing null keeps what
         -- is already attached (the form doesn't re-upload an unchanged file).
         invoice_url          = coalesce(p_invoice_url, invoice_url),
         is_advance           = coalesce(p_is_advance, false),
         advance_movie_id     = p_advance_movie_id,
         advance_proforma_id  = coalesce(p_advance_proforma_id, advance_proforma_id),
         advance_party_id     = p_advance_party_id,
         proforma_url         = coalesce(p_proforma_url, proforma_url),
         -- The payment is being revised, so a previous rejection no longer applies.
         rejected_reason      = null,
         edited_at            = now(),
         edited_by            = coalesce(v_actor, edited_by),
         updated_at           = now(),
         -- Re-approval wipes the approval and any OTP ask that hung off it.
         status                 = case when v_reapprove then 'awaiting_approval' else status end,
         submitted_at           = case when v_reapprove then now() else submitted_at end,
         approved_at            = case when v_reapprove then null else approved_at end,
         approved_by_email      = case when v_reapprove then null else approved_by_email end,
         approved_by_slack_user = case when v_reapprove then null else approved_by_slack_user end,
         otp_requested_at       = case when v_reapprove then null else otp_requested_at end,
         otp_requested_by       = case when v_reapprove then null else otp_requested_by end,
         otp_slack_ts           = case when v_reapprove then null else otp_slack_ts end
   where id = r.id;

  if v_reapprove then
    v_note   := v_note || ' — sent back for re-approval';
    v_outcome := 'reapproval';
  elsif r.status = 'draft' then
    v_outcome := 'draft';
  elsif r.status in ('pending','awaiting_approval','awaiting_payment_approval') then
    v_outcome := 'refresh';            -- the pending Slack card is now stale
  else
    v_outcome := 'in_place';
  end if;

  perform public.fn_payment_audit(
    r.id, r.status, case when v_reapprove then 'awaiting_approval' else r.status end,
    v_note, null);

  return v_outcome;
end;
$$;

-- The payments_60 entry point keeps working; it just never changes the mode.
create or replace function public.fn_payment_update_draft(
  p_payment_id           uuid,
  p_operating_unit_id    uuid,
  p_payment_type_id      uuid,
  p_bank_account_id      uuid,
  p_payee_name           text,
  p_payee_party_id       uuid,
  p_payee_distributor_id text,
  p_payee_account_last4  text,
  p_payee_ifsc           text,
  p_amount               numeric,
  p_needed_by            date,
  p_purpose              text,
  p_invoice_url          text,
  p_is_advance           boolean,
  p_advance_movie_id     text,
  p_advance_proforma_id  uuid,
  p_advance_party_id     uuid,
  p_proforma_url         text
) returns void language plpgsql security definer set search_path = public
as $$
begin
  perform public.fn_payment_edit(
    p_payment_id, p_operating_unit_id, p_payment_type_id, p_bank_account_id,
    p_payee_name, p_payee_party_id, p_payee_distributor_id, p_payee_account_last4,
    p_payee_ifsc, p_amount, p_needed_by, p_purpose, p_invoice_url, p_is_advance,
    p_advance_movie_id, p_advance_proforma_id, p_advance_party_id, p_proforma_url,
    null);
end;
$$;

commit;

-- ============================================================================
-- VERIFY (after applying):
--   select name, default_bank_account_id, default_payment_mode
--     from public.operating_units order by display_order;
--   -- exactly one fn_payment_edit, with 19 arguments:
--   select pg_get_function_arguments(oid) from pg_proc where proname = 'fn_payment_edit';
--   -- set a unit's default from Settings → Cash → Operating units, then open
--   -- /payments/create: picking that unit pre-selects the account and mode.
-- ============================================================================
