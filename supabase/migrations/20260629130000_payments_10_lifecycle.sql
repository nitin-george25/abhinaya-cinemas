-- ============================================================================
-- payments_10 — Unified payment lifecycle + transition RPCs (phase 2).
--
-- Turns payment_requests into the shared money-out engine behind the unified
-- inbox. The routine state machine (§6.1):
--   draft → awaiting_approval → approved → paid → posted
--           (reject → draft;  cancel → cancelled)
--
-- Transitions go through SECURITY DEFINER functions (one per transition, each
-- writing an immutable public.payment_audit row) so steps can't be skipped and
-- amounts can't be changed post-approval (§11). Role gating:
--   • submit / cancel  — accountant + manager + owner (the raisers)
--   • approve / reject  — OWNER ONLY (in phase 3 these are driven from Slack;
--                         here they're also callable from the console as the
--                         interim approval path)
--   • mark paid         — accountant + owner
--
-- Legacy 'pending' rows are kept valid (not remapped) so the old /cash/payments
-- page keeps working; the inbox treats pending ≈ awaiting_approval.
--
-- HOW TO RUN: npm run db:push:staging / :prod (Supabase CLI). Idempotent.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) New columns: actual paid amount (may differ from the requested amount,
--    with a reason) + submission timestamp.
-- ----------------------------------------------------------------------------
alter table public.payment_requests
  add column if not exists paid_amount            numeric(14,2),
  add column if not exists paid_amount_reason     text,
  add column if not exists submitted_at           timestamptz,
  add column if not exists cancelled_reason       text,
  -- Slack approver id (the Slack flow in phase 3 stamps this; the console
  -- approval path leaves it null). Added here because the approve/reject RPCs
  -- below write it.
  add column if not exists approved_by_slack_user text;

-- ----------------------------------------------------------------------------
-- 2) Full §6 status set (additive — keeps 'pending' for the legacy page).
-- ----------------------------------------------------------------------------
alter table public.payment_requests
  drop constraint if exists payment_requests_status_check;
alter table public.payment_requests
  add constraint payment_requests_status_check
  check (status in (
    'draft','pending','quoting','quote_approved','invoiced',
    'awaiting_approval','awaiting_payment_approval',
    'approved','rejected','paid','posted','cancelled'
  ));

-- ----------------------------------------------------------------------------
-- 3) Audit log — one immutable row per transition.
-- ----------------------------------------------------------------------------
create table if not exists public.payment_audit (
  id               uuid primary key default gen_random_uuid(),
  payment_id       uuid not null references public.payment_requests(id) on delete cascade,
  from_status      text,
  to_status        text,
  actor_email      text,
  actor_slack_user text,
  note             text,
  created_at       timestamptz not null default now()
);
create index if not exists payment_audit_payment_idx
  on public.payment_audit (payment_id, created_at);

alter table public.payment_audit enable row level security;

drop policy if exists payment_audit_read on public.payment_audit;
create policy payment_audit_read on public.payment_audit
  for select using (
    exists (
      select 1 from public.payment_requests pr
       where pr.id = payment_audit.payment_id
         and public.cinema_access_unit(pr.operating_unit_id)
    )
  );
-- Writes only happen inside the SECURITY DEFINER transition fns below.

-- ----------------------------------------------------------------------------
-- 4) Teach the existing payment→ledger trigger to honour an edited paid amount.
-- ----------------------------------------------------------------------------
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
      0, coalesce(new.paid_amount, new.amount),
      'payment_request', new.id,
      new.bank_reference,
      new.requested_by_email
    );
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5) Helpers + audit writer.
-- ----------------------------------------------------------------------------
create or replace function public.can_raise_payment()
  returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.authorized_users
     where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
       and role in ('owner','manager','accountant')
  );
$$;

create or replace function public.fn_payment_audit(
  p_payment_id uuid, p_from text, p_to text, p_note text, p_slack_user text
) returns void language plpgsql security definer set search_path = public
as $$
declare v_actor text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  insert into public.payment_audit (payment_id, from_status, to_status, actor_email, actor_slack_user, note)
  values (p_payment_id, p_from, p_to, v_actor, p_slack_user, p_note);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6) Transition functions.
-- ----------------------------------------------------------------------------

-- 6a) Submit a draft → awaiting_approval. Enforces the type's invoice rule.
create or replace function public.fn_payment_submit(p_payment_id uuid)
  returns void language plpgsql security definer set search_path = public
as $$
declare r public.payment_requests%rowtype; v_rule text;
        v_actor text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  if not public.can_raise_payment() then raise exception 'Not allowed to submit payments'; end if;
  select * into r from public.payment_requests where id = p_payment_id;
  if not found then raise exception 'Payment not found'; end if;
  if r.status not in ('draft','rejected') then
    raise exception 'Only a draft can be submitted (status %)', r.status; end if;

  select invoice_rule into v_rule from public.payment_types where id = r.payment_type_id;
  if v_rule = 'required' and coalesce(btrim(r.invoice_url), '') = '' then
    raise exception 'Attach the invoice before submitting this payment';
  end if;

  update public.payment_requests
     set status = 'awaiting_approval', submitted_at = now()
   where id = r.id;
  perform public.fn_payment_audit(r.id, r.status, 'awaiting_approval', null, null);
end;
$$;

-- 6b) Owner approves → approved. (Phase 3 calls this from Slack with the
--     approver's slack user id; the console path passes null.)
create or replace function public.fn_payment_approve(
  p_payment_id uuid, p_slack_user text default null
) returns void language plpgsql security definer set search_path = public
as $$
declare r public.payment_requests%rowtype;
        v_actor text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  if not public.is_owner() then raise exception 'Only the owner can approve a payment'; end if;
  select * into r from public.payment_requests where id = p_payment_id;
  if not found then raise exception 'Payment not found'; end if;
  if r.status not in ('pending','awaiting_approval','awaiting_payment_approval') then
    raise exception 'Payment is not awaiting approval (status %)', r.status; end if;

  update public.payment_requests
     set status = 'approved',
         approved_by_email = coalesce(v_actor, approved_by_email),
         approved_by_slack_user = p_slack_user,
         approved_at = now()
   where id = r.id;
  perform public.fn_payment_audit(r.id, r.status, 'approved', null, p_slack_user);
end;
$$;

-- 6c) Owner rejects (+ reason) → back to draft to revise & resubmit.
create or replace function public.fn_payment_reject(
  p_payment_id uuid, p_reason text, p_slack_user text default null
) returns void language plpgsql security definer set search_path = public
as $$
declare r public.payment_requests%rowtype;
begin
  if not public.is_owner() then raise exception 'Only the owner can reject a payment'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required to reject'; end if;
  select * into r from public.payment_requests where id = p_payment_id;
  if not found then raise exception 'Payment not found'; end if;
  if r.status not in ('pending','awaiting_approval','awaiting_payment_approval') then
    raise exception 'Payment is not awaiting approval (status %)', r.status; end if;

  update public.payment_requests
     set status = 'draft', rejected_reason = p_reason, approved_by_slack_user = p_slack_user
   where id = r.id;
  perform public.fn_payment_audit(r.id, r.status, 'rejected', p_reason, p_slack_user);
end;
$$;

-- 6d) Accountant/owner marks an approved payment paid → paid (trigger writes
--     the bank-ledger row). Paid amount may differ from the requested amount
--     with a reason.
create or replace function public.fn_payment_mark_paid(
  p_payment_id uuid, p_bank_account_id uuid, p_reference text,
  p_paid_amount numeric, p_paid_reason text, p_paid_date date
) returns void language plpgsql security definer set search_path = public
as $$
declare r public.payment_requests%rowtype;
        v_actor text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
        v_amt numeric(14,2);
begin
  if not public.is_accountant_or_owner() then raise exception 'Only the accountant can mark paid'; end if;
  if p_bank_account_id is null then raise exception 'Pick a bank account'; end if;
  select * into r from public.payment_requests where id = p_payment_id;
  if not found then raise exception 'Payment not found'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved payment can be marked paid (status %)', r.status; end if;

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
         paid_amount_reason = nullif(btrim(p_paid_reason), '')
   where id = r.id;
  perform public.fn_payment_audit(r.id, r.status, 'paid',
    'paid ' || v_amt::text || coalesce(' — ' || p_reference, ''), null);
end;
$$;

-- 6e) Cancel a payment that hasn't been paid (raiser or owner).
create or replace function public.fn_payment_cancel(p_payment_id uuid, p_reason text)
  returns void language plpgsql security definer set search_path = public
as $$
declare r public.payment_requests%rowtype;
begin
  if not public.can_raise_payment() then raise exception 'Not allowed to cancel payments'; end if;
  select * into r from public.payment_requests where id = p_payment_id;
  if not found then raise exception 'Payment not found'; end if;
  if r.status = 'paid' then raise exception 'A paid payment cannot be cancelled'; end if;
  update public.payment_requests
     set status = 'cancelled', cancelled_reason = p_reason
   where id = r.id;
  perform public.fn_payment_audit(r.id, r.status, 'cancelled', p_reason, null);
end;
$$;

commit;

-- ============================================================================
-- VERIFY (after applying):
--   select to_regclass('public.payment_audit');
--   select proname from pg_proc where proname like 'fn_payment_%';
--   -- draft → submit → approve → mark paid should write one bank_ledger_entries
--   -- row with source_kind='payment_request'.
-- ============================================================================
