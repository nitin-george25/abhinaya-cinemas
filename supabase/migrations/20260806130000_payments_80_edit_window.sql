-- ============================================================================
-- payments_80 — Edit a payment after it leaves 'draft' (bounded, audited).
--
-- payments_60 let a raiser fix a parked draft and nothing else, which is too
-- tight in practice: a wrong account number or a transposed amount is usually
-- spotted after submission, and the only remedy was cancel-and-re-raise, which
-- loses the thread and the history. The rule now:
--
--   • draft                      — the raiser edits it, exactly as before.
--   • past draft, before paid    — OWNER any time; ACCOUNTANT within 24h of the
--                                  payment's last move (submitted / approved /
--                                  OTP asked). Managers stay raise-only.
--   • paid / posted / cancelled  — frozen. The money and its bank-ledger row are
--                                  real; a wrong paid payment is corrected with
--                                  an offsetting entry, never by rewriting it.
--   • quoting / quote_approved / invoiced — untouched here; asset payments are
--                                  revised through the quotation flow.
--
-- Changing the AMOUNT or the PAYEE of an already-approved payment invalidates
-- what the owner approved, so it drops back to 'awaiting_approval' and the
-- console posts a fresh Slack card. Everything else (purpose, needed-by,
-- invoice, A/c details) edits in place. Either way an audit row records the
-- before → after, so the trail survives the edit.
--
-- fn_payment_edit returns what the caller should do about Slack:
--   'draft' | 'in_place' | 'refresh' (card still pending — update it)
--   | 'reapproval' (post a new card)
--
-- HOW TO RUN: npm run db:push:staging / :prod (Supabase CLI). Idempotent.
-- ============================================================================

begin;

alter table public.payment_requests
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by text;

-- ----------------------------------------------------------------------------
-- 1) When did this payment last move? The audit log is the source of truth
--    (one row per transition); a row with no transitions falls back to its
--    creation. This is what the accountant's 24h window is measured against —
--    not created_at, so a payment approved on day 3 is still fixable on day 3.
-- ----------------------------------------------------------------------------
create or replace function public.fn_payment_last_move(p_payment_id uuid)
  returns timestamptz language sql stable security definer set search_path = public
as $$
  select greatest(
    coalesce((select max(created_at) from public.payment_audit where payment_id = p_payment_id),
             '-infinity'::timestamptz),
    coalesce((select created_at from public.payment_requests where id = p_payment_id),
             '-infinity'::timestamptz)
  );
$$;

-- ----------------------------------------------------------------------------
-- 2) May the current user edit this payment right now? Exposed (not just
--    inlined) so the console can show or hide the Edit action without
--    reimplementing the rule and drifting from it.
-- ----------------------------------------------------------------------------
create or replace function public.fn_payment_can_edit(p_payment_id uuid)
  returns boolean language plpgsql stable security definer set search_path = public
as $$
declare v_status text; v_role text;
begin
  select status into v_status from public.payment_requests where id = p_payment_id;
  if v_status is null then return false; end if;
  if v_status not in ('draft','pending','awaiting_approval','awaiting_payment_approval',
                      'approved','otp_requested') then
    return false;                      -- paid / posted / cancelled / asset stages
  end if;

  select role into v_role from public.authorized_users
   where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''));
  if v_role is null then return false; end if;

  if v_status = 'draft' then
    return v_role in ('owner','manager','accountant');
  end if;
  if v_role = 'owner' then return true; end if;
  if v_role = 'accountant' then
    return public.fn_payment_last_move(p_payment_id) > now() - interval '24 hours';
  end if;
  return false;                        -- manager: raise-only past draft
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) The edit itself.
-- ----------------------------------------------------------------------------
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
  p_proforma_url         text
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
         status               = case when v_reapprove then 'awaiting_approval' else status end,
         submitted_at         = case when v_reapprove then now() else submitted_at end,
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

-- ----------------------------------------------------------------------------
-- 4) Keep the payments_60 entry point working — it is the same edit, just the
--    draft-only slice of it. Anything still calling it gets the new rules.
-- ----------------------------------------------------------------------------
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
    p_advance_movie_id, p_advance_proforma_id, p_advance_party_id, p_proforma_url);
end;
$$;

commit;

-- ============================================================================
-- VERIFY (after applying):
--   select proname from pg_proc
--    where proname in ('fn_payment_edit','fn_payment_can_edit','fn_payment_last_move');
--   -- as the accountant:
--   --   select fn_payment_can_edit('<approved, moved today>');    -- true
--   --   select fn_payment_can_edit('<approved, moved 2 days ago>');-- false
--   --   select fn_payment_can_edit('<paid>');                      -- false
--   -- editing an approved payment's amount returns 'reapproval' and the row
--   -- reads awaiting_approval with approved_at / otp_* cleared:
--   --   select fn_payment_edit('<approved id>', …, p_amount => <new>, …);
-- ============================================================================
