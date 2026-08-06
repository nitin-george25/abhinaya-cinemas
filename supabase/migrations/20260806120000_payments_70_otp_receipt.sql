-- ============================================================================
-- payments_70 — Payment OTP handshake + mandatory transaction receipt.
--
-- Refines the disbursement half of the lifecycle. Until now an approved payment
-- could be marked paid straight away, with the receipt optional. The real motion
-- has one more beat: the bank's OTP for the transfer lands on the OWNER's phone,
-- so the accountant has to ask for it before the money can move.
--
--   draft → awaiting_approval → approved → otp_requested → paid → posted
--
-- • fn_payment_request_otp — accountant (or owner) asks for the OTP. The console
--   posts the ask into Slack as a REPLY on the payment's own approval card
--   (see _shared/payments.ts, kind 'payment_otp_request'), so the request, the
--   approval and the OTP all live in one thread. The owner replies with the code
--   in Slack; we deliberately do NOT store the code — it is a bank OTP, the
--   console can neither verify it nor has any business holding it. What we store
--   is the audit fact: who asked, when, and which Slack reply carries it.
-- • fn_payment_mark_paid — now requires (a) status 'otp_requested', so the OTP
--   step can't be skipped, and (b) a transaction receipt URL, so every money-out
--   row carries proof. The signature gains p_receipt_url, hence the drop+create.
--
-- HOW TO RUN: npm run db:push:staging / :prod (Supabase CLI). Idempotent.
-- NOTE FOR OPERATORS: payments already sitting in 'approved' when this ships
-- will show "Request payment OTP" instead of "Mark paid" — that is the new
-- first step, not an error.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Columns: the OTP-request audit facts + the transaction receipt.
-- ----------------------------------------------------------------------------
alter table public.payment_requests
  add column if not exists otp_requested_at    timestamptz,
  add column if not exists otp_requested_by    text,
  -- ts of the threaded Slack reply carrying the ask (for chat.update / links).
  add column if not exists otp_slack_ts        text,
  add column if not exists payment_receipt_url text;

comment on column public.payment_requests.otp_slack_ts is
  'ts of the threaded #payments reply asking the owner for the bank OTP. The OTP code itself is never stored.';
comment on column public.payment_requests.payment_receipt_url is
  'Bank transaction receipt / screenshot captured at mark-paid. Required since payments_70.';

-- ----------------------------------------------------------------------------
-- 2) Status set gains 'otp_requested'.
-- ----------------------------------------------------------------------------
alter table public.payment_requests
  drop constraint if exists payment_requests_status_check;
alter table public.payment_requests
  add constraint payment_requests_status_check
  check (status in (
    'draft','pending','quoting','quote_approved','invoiced',
    'awaiting_approval','awaiting_payment_approval',
    'approved','otp_requested','rejected','paid','posted','cancelled'
  ));

-- ----------------------------------------------------------------------------
-- 3) Request the payment OTP (accountant or owner).
--
-- Callable from 'approved' (the first ask) and from 'otp_requested' (a nudge
-- when the owner hasn't replied yet) — a re-ask posts a fresh Slack reply and
-- lands its own audit row, so chasing is visible rather than silent.
-- ----------------------------------------------------------------------------
create or replace function public.fn_payment_request_otp(p_payment_id uuid)
  returns void language plpgsql security definer set search_path = public
as $$
declare r public.payment_requests%rowtype;
        v_actor text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  if not public.is_accountant_or_owner() then
    raise exception 'Only the accountant can request a payment OTP';
  end if;
  select * into r from public.payment_requests where id = p_payment_id;
  if not found then raise exception 'Payment not found'; end if;
  if r.status not in ('approved','otp_requested') then
    raise exception 'Only an approved payment can ask for an OTP (status %)', r.status;
  end if;

  update public.payment_requests
     set status           = 'otp_requested',
         otp_requested_at = now(),
         otp_requested_by = coalesce(v_actor, otp_requested_by)
   where id = r.id;
  perform public.fn_payment_audit(
    r.id, r.status, 'otp_requested',
    case when r.status = 'otp_requested' then 'OTP re-requested' else 'OTP requested from owner' end,
    null);
end;
$$;

-- (otp_slack_ts is stamped by the Edge Function with the service-role key, the
--  same way slack_channel / slack_ts already are — no RPC needed.)

-- ----------------------------------------------------------------------------
-- 4) Mark paid — now gated on the OTP step and a transaction receipt.
--    (drop+create: the argument list changes, so `create or replace` would
--     leave the old 6-arg overload callable and the gate bypassable.)
-- ----------------------------------------------------------------------------
drop function if exists public.fn_payment_mark_paid(uuid, uuid, text, numeric, text, date);

create or replace function public.fn_payment_mark_paid(
  p_payment_id uuid, p_bank_account_id uuid, p_reference text,
  p_paid_amount numeric, p_paid_reason text, p_paid_date date,
  p_receipt_url text
) returns void language plpgsql security definer set search_path = public
as $$
declare r public.payment_requests%rowtype;
        v_actor text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
        v_amt numeric(14,2);
begin
  if not public.is_accountant_or_owner() then raise exception 'Only the accountant can mark paid'; end if;
  if p_bank_account_id is null then raise exception 'Pick a bank account'; end if;
  if coalesce(btrim(p_receipt_url), '') = '' then
    raise exception 'Attach the transaction receipt before marking this payment paid';
  end if;
  select * into r from public.payment_requests where id = p_payment_id;
  if not found then raise exception 'Payment not found'; end if;
  if r.status = 'approved' then
    raise exception 'Request the payment OTP from the owner before marking this paid';
  end if;
  if r.status <> 'otp_requested' then
    raise exception 'Only an approved payment can be marked paid (status %)', r.status; end if;

  v_amt := coalesce(p_paid_amount, r.amount);
  if v_amt <> r.amount and coalesce(btrim(p_paid_reason), '') = '' then
    raise exception 'A reason is required when the paid amount differs from the requested amount';
  end if;

  update public.payment_requests
     set status = 'paid',
         paid_at = coalesce(p_paid_date::timestamptz, now()),
         paid_via_bank_account_id = p_bank_account_id,
         bank_reference = p_reference,
         paid_amount = v_amt,
         paid_amount_reason = nullif(btrim(p_paid_reason), ''),
         payment_receipt_url = btrim(p_receipt_url)
   where id = r.id;
  perform public.fn_payment_audit(r.id, r.status, 'paid',
    'paid ' || v_amt::text || coalesce(' — ' || p_reference, ''), null);
end;
$$;

commit;

-- ============================================================================
-- VERIFY (after applying):
--   select proname, pg_get_function_arguments(oid) from pg_proc
--    where proname in ('fn_payment_request_otp','fn_payment_mark_paid');
--   -- one mark-paid overload only (7 args), and:
--   --   approved → mark paid            → 'Request the payment OTP …'
--   --   approved → request otp → paid   → succeeds, one bank_ledger_entries row
--   --   mark paid without a receipt     → 'Attach the transaction receipt …'
-- ============================================================================
