-- ============================================================================
-- payments_60 — Edit a saved draft (unified Payments).
--
-- The lifecycle (payments_10) let a raiser create, submit, cancel and pay, but
-- there was no way back INTO a parked draft: once saved, the row could only be
-- submitted or cancelled. A rejected payment is sent back to 'draft' precisely
-- so it can be revised, which made the gap worse — the reason was recorded but
-- nothing could be corrected.
--
-- This adds fn_payment_update_draft: a SECURITY DEFINER edit that is only ever
-- allowed while the row is a draft, so §11 still holds (an approved payment's
-- amount can never be changed). Every edit writes a payment_audit row, keeping
-- the trail complete: draft → edited → awaiting_approval.
--
-- HOW TO RUN: npm run db:push:staging / :prod (Supabase CLI). Idempotent.
-- ============================================================================

begin;

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
declare r public.payment_requests%rowtype;
begin
  if not public.can_raise_payment() then
    raise exception 'Not allowed to edit payments';
  end if;

  select * into r from public.payment_requests where id = p_payment_id;
  if not found then raise exception 'Payment not found'; end if;

  -- Only a parked draft is editable. Everything past submission is immutable
  -- here and must go through the lifecycle transitions instead. (A rejected
  -- payment is already back at 'draft', so revise-and-resubmit works.)
  if r.status <> 'draft' then
    raise exception 'Only a draft can be edited (status %)', r.status;
  end if;

  -- Access is checked on BOTH the current unit and the target unit, so a draft
  -- can't be moved out of (or into) a unit the editor can't see.
  if not public.cinema_access_unit(r.operating_unit_id)
     or not public.cinema_access_unit(coalesce(p_operating_unit_id, r.operating_unit_id)) then
    raise exception 'No access to that operating unit';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter a positive amount';
  end if;
  if coalesce(btrim(p_payee_name), '') = '' then
    raise exception 'Enter a payee';
  end if;

  update public.payment_requests
     set operating_unit_id    = coalesce(p_operating_unit_id, operating_unit_id),
         -- Never blank the type: the invoice CHECK relies on it being present
         -- for typed rows, and the form always sends one.
         payment_type_id      = coalesce(p_payment_type_id, payment_type_id),
         bank_account_id      = p_bank_account_id,
         payee_name           = p_payee_name,
         payee_party_id       = p_payee_party_id,
         payee_distributor_id = p_payee_distributor_id,
         payee_account_last4  = p_payee_account_last4,
         payee_ifsc           = p_payee_ifsc,
         amount               = p_amount,
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
         -- The draft is being revised, so a previous rejection no longer applies.
         rejected_reason      = null,
         updated_at           = now()
   where id = r.id;

  perform public.fn_payment_audit(r.id, 'draft', 'draft', 'Draft edited', null);
end;
$$;

commit;

-- ============================================================================
-- VERIFY (after applying):
--   select proname from pg_proc where proname = 'fn_payment_update_draft';
--   -- editing a draft succeeds and leaves an audit row:
--   --   select fn_payment_update_draft('<draft id>', ...);
--   --   select to_status, note from payment_audit where payment_id = '<draft id>';
--   -- editing anything else raises:
--   --   select fn_payment_update_draft('<approved id>', ...);  -- ERROR
-- ============================================================================
