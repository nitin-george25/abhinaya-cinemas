-- ============================================================================
-- payments_100 — Batch payments: many invoices, one payee, one transfer.
--
-- The motion this exists for: an employee hands in six reimbursement bills for
-- the month, or a sundry creditor's invoices pile up over a fortnight. Today the
-- console forces one approval, one OTP and one bank transfer PER INVOICE. This
-- adds a batch: N payment_requests for the SAME payee, disbursed as one payment.
--
--   payment_batches  ──1:N──▶  payment_requests.batch_id
--
-- The batch is the APPROVAL and DISBURSEMENT unit; the line is the ACCOUNTING
-- unit. Each line keeps its own type, accounting head, invoice file, Zoho push
-- and advance links — nothing about per-invoice bookkeeping is lost. What the
-- batch owns is the single owner approval, the single OTP handshake, the single
-- UTR + transaction receipt, and the single bank-book line.
--
-- Batch lifecycle mirrors the single-payment one so the console can reuse the
-- same status badge and stepper:
--   draft → awaiting_approval → approved → otp_requested → paid
--           (reject → draft;  cancel → cancelled, lines released untouched)
--
-- TWO DELIBERATE DESIGN CALLS, both agreed before building:
--
-- 1) ONE BANK-BOOK LINE PER BATCH. A batch is one real debit on the bank
--    statement, so it must be one row in bank_ledger_entries or the bank book
--    stops reconciling line-for-line. fn_payment_to_ledger is therefore taught
--    to SKIP batched rows, and a new trigger posts once at batch level with
--    source_kind='payment_batch'.
--
-- 2) LINES MAY ALREADY BE APPROVED. A batch assembled out of payments the owner
--    already approved one by one does NOT ask for approval a second time — at
--    submit it goes straight to 'approved'. A batch containing anything not yet
--    approved posts one Slack card for the whole batch.
--
-- NOTE ON A DIFFERING PAID AMOUNT: the batch total may differ from the sum of
-- the line nets (bank charges, a round-off) with a required reason, exactly as a
-- single payment may. When it does, the BATCH amount is what hits the bank book
-- (it is the true debit) and the LINES keep their own invoice-level amounts. The
-- delta is deliberate, reasoned and visible in the audit trail rather than
-- silently pro-rated across the invoices.
--
-- HOW TO RUN: npm run db:push:staging / :prod (Supabase CLI). Idempotent.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) The batch header.
--
-- Payee + bank fields are denormalised onto the batch because the batch is what
-- the owner approves and what the accountant pays: the card and the transfer
-- screen read one row, not an aggregate over the lines.
-- ----------------------------------------------------------------------------
create table if not exists public.payment_batches (
  id                       uuid primary key default gen_random_uuid(),
  operating_unit_id        uuid not null references public.operating_units(id) on delete restrict,

  -- Payee (one per batch — that is the whole point).
  payee_name               text not null,
  payee_party_id           uuid,
  payee_distributor_id     uuid,
  payee_account_last4      text,
  payee_ifsc               text,

  -- Intended disbursement (mirrors payment_requests).
  bank_account_id          uuid references public.bank_accounts(id),
  mode                     text not null default 'bank_transfer'
                             check (mode in ('bank_transfer','cheque','cash','upi')),
  note                     text,
  needed_by                date,

  status                   text not null default 'draft'
                             check (status in ('draft','awaiting_approval','approved',
                                               'otp_requested','rejected','paid','cancelled')),

  requested_by_email       text not null,
  submitted_at             timestamptz,

  approved_by_email        text,
  approved_by_slack_user   text,
  approved_at              timestamptz,
  rejected_reason          text,
  cancelled_reason         text,

  -- OTP handshake (payments_70 semantics: the code itself is never stored).
  otp_requested_at         timestamptz,
  otp_requested_by         text,
  otp_slack_ts             text,

  -- The one Slack card for the whole batch.
  slack_channel            text,
  slack_ts                 text,

  -- The one real transfer.
  paid_at                  timestamptz,
  paid_via_bank_account_id uuid references public.bank_accounts(id),
  bank_reference           text,
  paid_amount              numeric(14,2),
  paid_amount_reason       text,
  payment_receipt_url      text,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists payment_batches_unit_status_idx
  on public.payment_batches (operating_unit_id, status, created_at desc);

comment on table public.payment_batches is
  'Many invoices to one payee, disbursed as a single bank transfer. Approval + OTP + receipt live here; per-invoice accounting stays on payment_requests.batch_id.';
comment on column public.payment_batches.paid_amount is
  'The real debit. May differ from the sum of the line nets (bank charges, round-off) with a reason; this is the figure that hits bank_ledger_entries.';

-- ----------------------------------------------------------------------------
-- 2) The line link.
-- ----------------------------------------------------------------------------
alter table public.payment_requests
  add column if not exists batch_id uuid references public.payment_batches(id) on delete set null;

create index if not exists payment_requests_batch_idx
  on public.payment_requests (batch_id) where batch_id is not null;

comment on column public.payment_requests.batch_id is
  'Set when this invoice is paid as part of a batch. Batched rows do NOT post their own bank-ledger line — the batch posts one combined line.';

-- ----------------------------------------------------------------------------
-- 3) The bank book learns about batches.
-- ----------------------------------------------------------------------------
alter table public.bank_ledger_entries
  drop constraint if exists bank_ledger_entries_source_kind_check;
alter table public.bank_ledger_entries
  add constraint bank_ledger_entries_source_kind_check
  check (source_kind in
    ('opening_balance','cash_deposit','payment_request','payment_batch',
     'inter_unit_transfer','pos_settlement','manual'));

-- 3a) A batched payment must NOT write its own ledger row — the batch does.
create or replace function public.fn_payment_to_ledger()
  returns trigger
  language plpgsql
  security definer set search_path = public
as $$
begin
  if new.status = 'paid' and (old.status is distinct from 'paid') then
    -- Batched lines are disbursed together; the batch posts the single combined
    -- line that matches the one debit on the statement (payments_100).
    if new.batch_id is not null then
      return new;
    end if;

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

-- 3b) The batch posts one combined line.
create or replace function public.fn_payment_batch_to_ledger()
  returns trigger
  language plpgsql
  security definer set search_path = public
as $$
declare v_lines int;
begin
  if new.status = 'paid' and (old.status is distinct from 'paid') then
    if new.paid_via_bank_account_id is null then
      raise exception 'payment_batch % marked paid without paid_via_bank_account_id', new.id;
    end if;

    select count(*) into v_lines
      from public.payment_requests where batch_id = new.id;

    delete from public.bank_ledger_entries
      where source_kind = 'payment_batch' and source_id = new.id;

    insert into public.bank_ledger_entries (
      bank_account_id, entry_date, narration,
      receipt_amount, payment_amount,
      source_kind, source_id,
      bank_reference,
      created_by
    ) values (
      new.paid_via_bank_account_id,
      coalesce(new.paid_at::date, current_date),
      new.payee_name || ' · ' || v_lines::text || ' invoice' || case when v_lines = 1 then '' else 's' end
        || coalesce(' · ' || nullif(btrim(new.note), ''), ''),
      0, new.paid_amount,
      'payment_batch', new.id,
      new.bank_reference,
      new.requested_by_email
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_payment_batch_to_ledger on public.payment_batches;
create trigger trg_payment_batch_to_ledger
  after update on public.payment_batches
  for each row execute function public.fn_payment_batch_to_ledger();

-- 3c) Freeze the figures of a line once its batch has left draft.
--
-- fn_payment_edit (payments_80) happily revises a payment the owner has already
-- approved, sending it back for re-approval with a fresh card of its own. On a
-- batched invoice that would desynchronise the batch: the owner approved a total
-- that no longer matches its parts, and two approval paths would be live for the
-- same money. Guarding at the TABLE rather than inside fn_payment_edit covers
-- every write path — the edit RPC, the legacy /cash/payments page, and anything
-- added later — without this migration having to restate that function's body.
--
-- Only the money-facing fields are frozen. The batch RPCs still move status and
-- stamp the paid columns, and removing the line from the batch (batch_id → null,
-- draft batches only) unfreezes it.
create or replace function public.fn_payment_batch_line_guard()
  returns trigger
  language plpgsql
  security definer set search_path = public
as $$
declare v_status text;
begin
  if new.batch_id is null then return new; end if;
  if new.amount is not distinct from old.amount
     and new.payee_name is not distinct from old.payee_name
     and new.payment_type_id is not distinct from old.payment_type_id
     and new.batch_id is not distinct from old.batch_id then
    return new;
  end if;

  select status into v_status from public.payment_batches where id = new.batch_id;
  if v_status is not null and v_status <> 'draft' then
    raise exception
      'This invoice is part of a batch that is already % — remove it from the batch first', v_status;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_payment_batch_line_guard on public.payment_requests;
create trigger trg_payment_batch_line_guard
  before update on public.payment_requests
  for each row execute function public.fn_payment_batch_line_guard();

-- ----------------------------------------------------------------------------
-- 4) RLS — same shape as payment_requests (read/insert for the money roles,
--    delete owner-only). Every state change goes through the RPCs below.
-- ----------------------------------------------------------------------------
alter table public.payment_batches enable row level security;

drop policy if exists payment_batches_read   on public.payment_batches;
drop policy if exists payment_batches_insert on public.payment_batches;
drop policy if exists payment_batches_update on public.payment_batches;
drop policy if exists payment_batches_delete on public.payment_batches;

create policy payment_batches_read on public.payment_batches
  for select using (
    public.cinema_access_unit(operating_unit_id)
    and exists (select 1 from public.authorized_users
                where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                  and role in ('owner','manager','accountant'))
  );

create policy payment_batches_insert on public.payment_batches
  for insert with check (
    public.cinema_access_unit(operating_unit_id)
    and public.can_raise_payment()
  );

create policy payment_batches_update on public.payment_batches
  for update using (
    public.cinema_access_unit(operating_unit_id) and public.can_raise_payment()
  ) with check (
    public.cinema_access_unit(operating_unit_id) and public.can_raise_payment()
  );

create policy payment_batches_delete on public.payment_batches
  for delete using (
    public.is_owner() and public.cinema_access_unit(operating_unit_id)
  );

-- ----------------------------------------------------------------------------
-- 5) Audit — batch moves land in payment_audit against every line, so a line's
--    history reads end to end even when the move happened at batch level.
-- ----------------------------------------------------------------------------
create or replace function public.fn_payment_batch_audit(
  p_batch_id uuid, p_from text, p_to text, p_note text, p_slack_user text
) returns void language plpgsql security definer set search_path = public
as $$
declare v_actor text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  insert into public.payment_audit (payment_id, from_status, to_status, actor_email, actor_slack_user, note)
  select pr.id, p_from, p_to, v_actor, p_slack_user, coalesce(p_note || ' ', '') || '(batch)'
    from public.payment_requests pr
   where pr.batch_id = p_batch_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6) Helpers.
-- ----------------------------------------------------------------------------

-- Gross, advances applied, and net across a batch's lines. One place, so the
-- mark-paid gate and the console show the same three numbers.
create or replace function public.fn_payment_batch_totals(p_batch_id uuid)
  returns table (line_count int, gross numeric, applied numeric, net numeric)
  language sql stable security definer set search_path = public
as $$
  select
    count(*)::int,
    coalesce(sum(pr.amount), 0)::numeric,
    coalesce((
      select sum(l.amount_applied)
        from public.payment_advance_links l
       where l.final_payment_id in (select id from public.payment_requests where batch_id = p_batch_id)
    ), 0)::numeric,
    (coalesce(sum(pr.amount), 0) - coalesce((
      select sum(l.amount_applied)
        from public.payment_advance_links l
       where l.final_payment_id in (select id from public.payment_requests where batch_id = p_batch_id)
    ), 0))::numeric
  from public.payment_requests pr
  where pr.batch_id = p_batch_id;
$$;

-- Does this payment belong to the same payee as the batch? Party/distributor id
-- wins when both carry one; otherwise fall back to a normalised name match.
create or replace function public.fn_payment_batch_payee_matches(
  p_batch public.payment_batches, p_pay public.payment_requests
) returns boolean language sql immutable
as $$
  select case
    when p_batch.payee_distributor_id is not null or p_pay.payee_distributor_id is not null
      then p_batch.payee_distributor_id is not distinct from p_pay.payee_distributor_id
    when p_batch.payee_party_id is not null or p_pay.payee_party_id is not null
      then p_batch.payee_party_id is not distinct from p_pay.payee_party_id
    else lower(btrim(p_batch.payee_name)) = lower(btrim(p_pay.payee_name))
  end;
$$;

-- ----------------------------------------------------------------------------
-- 7) Build the batch.
-- ----------------------------------------------------------------------------

create or replace function public.fn_payment_batch_create(
  p_operating_unit_id    uuid,
  p_payee_name           text,
  p_payee_party_id       uuid    default null,
  p_payee_distributor_id uuid    default null,
  p_payee_account_last4  text    default null,
  p_payee_ifsc           text    default null,
  p_bank_account_id      uuid    default null,
  p_mode                 text    default 'bank_transfer',
  p_note                 text    default null,
  p_needed_by            date    default null
) returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
        v_actor text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  if not public.can_raise_payment() then raise exception 'Not allowed to raise payments'; end if;
  if coalesce(btrim(p_payee_name), '') = '' then raise exception 'Pick or enter a payee'; end if;

  insert into public.payment_batches (
    operating_unit_id, payee_name, payee_party_id, payee_distributor_id,
    payee_account_last4, payee_ifsc, bank_account_id, mode, note, needed_by,
    requested_by_email
  ) values (
    p_operating_unit_id, btrim(p_payee_name), p_payee_party_id, p_payee_distributor_id,
    p_payee_account_last4, p_payee_ifsc, p_bank_account_id,
    coalesce(p_mode, 'bank_transfer'), nullif(btrim(p_note), ''), p_needed_by,
    coalesce(v_actor, 'unknown')
  ) returning id into v_id;

  return v_id;
end;
$$;

-- Add an existing payment as a line. Refuses anything that would make the batch
-- dishonest: a different payee, a different unit, a payment already batched, or
-- one past the point of no return.
create or replace function public.fn_payment_batch_add(p_batch_id uuid, p_payment_id uuid)
  returns void language plpgsql security definer set search_path = public
as $$
declare b public.payment_batches%rowtype;
        r public.payment_requests%rowtype;
        v_rule text;
begin
  if not public.can_raise_payment() then raise exception 'Not allowed to change a payment batch'; end if;

  select * into b from public.payment_batches where id = p_batch_id;
  if not found then raise exception 'Batch not found'; end if;
  if b.status <> 'draft' then
    raise exception 'Only a draft batch can take new invoices (status %)', b.status; end if;

  select * into r from public.payment_requests where id = p_payment_id;
  if not found then raise exception 'Payment not found'; end if;

  if r.batch_id is not null and r.batch_id <> p_batch_id then
    raise exception 'That payment is already in another batch'; end if;
  if r.operating_unit_id <> b.operating_unit_id then
    raise exception 'That payment belongs to a different operating unit'; end if;
  if not public.fn_payment_batch_payee_matches(b, r) then
    raise exception 'A batch pays one payee — % does not match %', r.payee_name, b.payee_name; end if;
  -- Deliberately NOT batchable while awaiting a decision: that payment already
  -- has a live Slack card whose buttons move it, and a batch card would be a
  -- second live path to the same money. Let the owner decide it first (approved
  -- rows batch fine and skip re-approval), or send it back to draft.
  if r.status in ('awaiting_approval','awaiting_payment_approval','pending') then
    raise exception 'That payment is already awaiting the owner — decide it first, then batch it';
  end if;
  if r.status not in ('draft','rejected','invoiced','approved') then
    raise exception 'A payment in % cannot be batched', r.status; end if;

  select invoice_rule into v_rule from public.payment_types where id = r.payment_type_id;
  if v_rule = 'settlement' then
    raise exception 'Distributor share remittance is settled from the box office, not a batch';
  end if;

  update public.payment_requests set batch_id = p_batch_id where id = r.id;
end;
$$;

create or replace function public.fn_payment_batch_remove(p_batch_id uuid, p_payment_id uuid)
  returns void language plpgsql security definer set search_path = public
as $$
declare b public.payment_batches%rowtype;
begin
  if not public.can_raise_payment() then raise exception 'Not allowed to change a payment batch'; end if;
  select * into b from public.payment_batches where id = p_batch_id;
  if not found then raise exception 'Batch not found'; end if;
  if b.status not in ('draft','rejected') then
    raise exception 'Only a draft batch can drop invoices (status %)', b.status; end if;

  update public.payment_requests set batch_id = null
   where id = p_payment_id and batch_id = p_batch_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 8) Submit — one card for the batch, unless every line is already approved.
-- ----------------------------------------------------------------------------
create or replace function public.fn_payment_batch_submit(p_batch_id uuid)
  returns text language plpgsql security definer set search_path = public
as $$
declare b public.payment_batches%rowtype;
        v_count int; v_unapproved int; v_missing text;
begin
  if not public.can_raise_payment() then raise exception 'Not allowed to submit payments'; end if;
  select * into b from public.payment_batches where id = p_batch_id;
  if not found then raise exception 'Batch not found'; end if;
  if b.status not in ('draft','rejected') then
    raise exception 'Only a draft batch can be submitted (status %)', b.status; end if;

  select count(*) into v_count from public.payment_requests where batch_id = b.id;
  if v_count < 2 then
    raise exception 'A batch needs at least two invoices — pay a single invoice on its own';
  end if;

  -- Every line still owes its type's invoice rule.
  select string_agg(pr.purpose, ', ') into v_missing
    from public.payment_requests pr
    join public.payment_types pt on pt.id = pr.payment_type_id
   where pr.batch_id = b.id
     and pt.invoice_rule = 'required'
     and coalesce(btrim(pr.invoice_url), '') = '';
  if v_missing is not null then
    raise exception 'Attach the invoice for: %', v_missing;
  end if;

  select count(*) into v_unapproved
    from public.payment_requests where batch_id = b.id and status <> 'approved';

  if v_unapproved = 0 then
    -- Everything here already carries the owner's approval — batching is purely
    -- a disbursement convenience, so don't ask twice.
    -- approved_by_email stays null: nobody approved the BATCH, the owner
    -- approved each invoice in it. The audit note below is the honest record.
    update public.payment_batches
       set status = 'approved', submitted_at = now(), approved_at = now()
     where id = b.id;
    perform public.fn_payment_batch_audit(b.id, b.status, 'approved',
      'batched for one transfer — lines already approved', null);
    return 'approved';
  end if;

  update public.payment_requests
     set status = 'awaiting_approval', submitted_at = coalesce(submitted_at, now())
   where batch_id = b.id and status <> 'approved';

  update public.payment_batches
     set status = 'awaiting_approval', submitted_at = now()
   where id = b.id;
  perform public.fn_payment_batch_audit(b.id, b.status, 'awaiting_approval', null, null);
  return 'awaiting_approval';
end;
$$;

-- ----------------------------------------------------------------------------
-- 9) Owner decides — for the batch and every line in it.
-- ----------------------------------------------------------------------------
create or replace function public.fn_payment_batch_approve(
  p_batch_id uuid, p_slack_user text default null
) returns void language plpgsql security definer set search_path = public
as $$
declare b public.payment_batches%rowtype;
        v_actor text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  if not public.is_owner() then raise exception 'Only the owner can approve a payment batch'; end if;
  select * into b from public.payment_batches where id = p_batch_id;
  if not found then raise exception 'Batch not found'; end if;
  if b.status <> 'awaiting_approval' then
    raise exception 'Batch is not awaiting approval (status %)', b.status; end if;

  update public.payment_requests
     set status = 'approved',
         approved_by_email = coalesce(v_actor, approved_by_email),
         approved_by_slack_user = p_slack_user,
         approved_at = now()
   where batch_id = b.id and status <> 'approved';

  update public.payment_batches
     set status = 'approved',
         approved_by_email = coalesce(v_actor, approved_by_email),
         approved_by_slack_user = p_slack_user,
         approved_at = now()
   where id = b.id;
  perform public.fn_payment_batch_audit(b.id, 'awaiting_approval', 'approved', null, p_slack_user);
end;
$$;

create or replace function public.fn_payment_batch_reject(
  p_batch_id uuid, p_reason text, p_slack_user text default null
) returns void language plpgsql security definer set search_path = public
as $$
declare b public.payment_batches%rowtype;
begin
  if not public.is_owner() then raise exception 'Only the owner can reject a payment batch'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required to reject'; end if;
  select * into b from public.payment_batches where id = p_batch_id;
  if not found then raise exception 'Batch not found'; end if;
  if b.status <> 'awaiting_approval' then
    raise exception 'Batch is not awaiting approval (status %)', b.status; end if;

  update public.payment_requests
     set status = 'draft', rejected_reason = p_reason
   where batch_id = b.id and status <> 'approved';

  update public.payment_batches
     set status = 'draft', rejected_reason = p_reason, approved_by_slack_user = p_slack_user
   where id = b.id;
  perform public.fn_payment_batch_audit(b.id, 'awaiting_approval', 'rejected', p_reason, p_slack_user);
end;
$$;

-- ----------------------------------------------------------------------------
-- 10) OTP for the batch — one ask for one transfer (payments_70 semantics).
-- ----------------------------------------------------------------------------
create or replace function public.fn_payment_batch_request_otp(p_batch_id uuid)
  returns void language plpgsql security definer set search_path = public
as $$
declare b public.payment_batches%rowtype;
        v_actor text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  if not public.is_accountant_or_owner() then
    raise exception 'Only the accountant can request a payment OTP'; end if;
  select * into b from public.payment_batches where id = p_batch_id;
  if not found then raise exception 'Batch not found'; end if;
  if b.status not in ('approved','otp_requested') then
    raise exception 'Only an approved batch can ask for an OTP (status %)', b.status; end if;

  update public.payment_batches
     set status           = 'otp_requested',
         otp_requested_at = now(),
         otp_requested_by = coalesce(v_actor, otp_requested_by)
   where id = b.id;
  perform public.fn_payment_batch_audit(b.id, b.status, 'otp_requested',
    case when b.status = 'otp_requested' then 'OTP re-requested' else 'OTP requested from owner' end,
    null);
end;
$$;

-- ----------------------------------------------------------------------------
-- 11) Mark the batch paid — one transfer, one receipt, N invoices settled.
--
-- Order matters: the lines flip first (each fires the Zoho enqueue trigger and
-- skips the ledger because batch_id is set), then the batch flips and posts the
-- single combined bank-book line.
-- ----------------------------------------------------------------------------
create or replace function public.fn_payment_batch_mark_paid(
  p_batch_id uuid, p_bank_account_id uuid, p_reference text,
  p_paid_amount numeric, p_paid_reason text, p_paid_date date,
  p_receipt_url text
) returns void language plpgsql security definer set search_path = public
as $$
declare b public.payment_batches%rowtype;
        t record;
        v_amt numeric(14,2);
begin
  if not public.is_accountant_or_owner() then raise exception 'Only the accountant can mark paid'; end if;
  if p_bank_account_id is null then raise exception 'Pick a bank account'; end if;
  if coalesce(btrim(p_receipt_url), '') = '' then
    raise exception 'Attach the transaction receipt before marking this batch paid';
  end if;

  select * into b from public.payment_batches where id = p_batch_id;
  if not found then raise exception 'Batch not found'; end if;
  if b.status = 'approved' then
    raise exception 'Request the payment OTP from the owner before marking this paid'; end if;
  if b.status <> 'otp_requested' then
    raise exception 'Only an approved batch can be marked paid (status %)', b.status; end if;

  select * into t from public.fn_payment_batch_totals(b.id);
  if t.line_count = 0 then raise exception 'This batch has no invoices'; end if;

  v_amt := coalesce(p_paid_amount, t.net);
  if v_amt <> t.net and coalesce(btrim(p_paid_reason), '') = '' then
    raise exception 'A reason is required when the transfer differs from the batch net of %', t.net;
  end if;

  -- Each line settles at its own invoice value net of the advances applied to
  -- it. The batch carries the real debit; any difference is the reasoned delta.
  update public.payment_requests pr
     set status = 'paid',
         paid_at = coalesce(p_paid_date::timestamptz, now()),
         paid_via_bank_account_id = p_bank_account_id,
         bank_reference = p_reference,
         payment_receipt_url = btrim(p_receipt_url),
         paid_amount = greatest(pr.amount - coalesce((
           select sum(l.amount_applied) from public.payment_advance_links l
            where l.final_payment_id = pr.id), 0), 0)
   where pr.batch_id = b.id
     and pr.status not in ('paid','posted','cancelled');

  update public.payment_batches
     set status = 'paid',
         paid_at = coalesce(p_paid_date::timestamptz, now()),
         paid_via_bank_account_id = p_bank_account_id,
         bank_reference = p_reference,
         paid_amount = v_amt,
         paid_amount_reason = nullif(btrim(p_paid_reason), ''),
         payment_receipt_url = btrim(p_receipt_url)
   where id = b.id;

  perform public.fn_payment_batch_audit(b.id, 'otp_requested', 'paid',
    'paid ' || v_amt::text || coalesce(' — ' || p_reference, ''), null);
end;
$$;

-- ----------------------------------------------------------------------------
-- 12) Cancel — releases the lines untouched so they can be paid singly.
-- ----------------------------------------------------------------------------
create or replace function public.fn_payment_batch_cancel(p_batch_id uuid, p_reason text)
  returns void language plpgsql security definer set search_path = public
as $$
declare b public.payment_batches%rowtype;
begin
  if not public.can_raise_payment() then raise exception 'Not allowed to cancel payment batches'; end if;
  select * into b from public.payment_batches where id = p_batch_id;
  if not found then raise exception 'Batch not found'; end if;
  if b.status = 'paid' then raise exception 'A paid batch cannot be cancelled'; end if;

  perform public.fn_payment_batch_audit(b.id, b.status, 'cancelled', p_reason, null);

  -- Release first (the audit above still names every line), then close.
  update public.payment_requests set batch_id = null where batch_id = b.id;
  update public.payment_batches
     set status = 'cancelled', cancelled_reason = p_reason
   where id = b.id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 13) Slack-driven approve/reject for a batch — the mirror of
--     fn_slack_payment_decide (payments_20). Called ONLY by the edge function
--     with the service-role key; it re-derives the owner from the clicking Slack
--     user, so the owner check lives in SQL too.
-- ----------------------------------------------------------------------------
create or replace function public.fn_slack_payment_batch_decide(
  p_batch_id uuid, p_slack_user_id text, p_decision text, p_reason text
) returns text language plpgsql security definer set search_path = public
as $$
declare b public.payment_batches%rowtype; v_email text; v_role text;
begin
  select email, role into v_email, v_role
    from public.authorized_users
   where slack_user_id = p_slack_user_id
   limit 1;
  if v_email is null then raise exception 'SLACK_USER_UNMAPPED'; end if;
  if v_role <> 'owner' then raise exception 'NOT_OWNER'; end if;

  select * into b from public.payment_batches where id = p_batch_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if b.status <> 'awaiting_approval' then raise exception 'NOT_AWAITING:%', b.status; end if;

  if p_decision = 'approve' then
    update public.payment_requests
       set status = 'approved', approved_by_email = v_email,
           approved_by_slack_user = p_slack_user_id, approved_at = now()
     where batch_id = b.id and status <> 'approved';
    update public.payment_batches
       set status = 'approved', approved_by_email = v_email,
           approved_by_slack_user = p_slack_user_id, approved_at = now()
     where id = b.id;
    insert into public.payment_audit (payment_id, from_status, to_status, actor_email, actor_slack_user, note)
    select pr.id, 'awaiting_approval', 'approved', v_email, p_slack_user_id, 'Batch approved in Slack'
      from public.payment_requests pr where pr.batch_id = b.id;

  elsif p_decision = 'reject' then
    if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
    update public.payment_requests
       set status = 'draft', rejected_reason = p_reason
     where batch_id = b.id and status <> 'approved';
    update public.payment_batches
       set status = 'draft', rejected_reason = p_reason, approved_by_slack_user = p_slack_user_id
     where id = b.id;
    insert into public.payment_audit (payment_id, from_status, to_status, actor_email, actor_slack_user, note)
    select pr.id, 'awaiting_approval', 'rejected', v_email, p_slack_user_id, p_reason || ' (batch)'
      from public.payment_requests pr where pr.batch_id = b.id;
  else
    raise exception 'BAD_DECISION';
  end if;

  return v_email;
end;
$$;

revoke execute on function public.fn_slack_payment_batch_decide(uuid, text, text, text) from anon, authenticated;
grant  execute on function public.fn_slack_payment_batch_decide(uuid, text, text, text) to service_role;

commit;

-- ============================================================================
-- VERIFY (after applying):
--   select to_regclass('public.payment_batches');
--   select proname from pg_proc where proname like 'fn_payment_batch%';
--
--   -- End to end, two invoices for one vendor:
--   --   create → add ×2 → submit  → 'awaiting_approval'
--   --   approve → request_otp → mark_paid(receipt)
--   -- then expect EXACTLY ONE ledger row for the batch and NONE for the lines:
--   select source_kind, count(*), sum(payment_amount)
--     from public.bank_ledger_entries
--    where source_id in (select id from public.payment_batches order by created_at desc limit 1)
--       or source_id in (select id from public.payment_requests where batch_id is not null)
--    group by source_kind;
--
--   -- A batch of already-approved lines must skip re-approval:
--   --   create → add (approved lines) → submit  ⇒ returns 'approved'
--
--   -- The guards, each of which must RAISE:
--   --   add a payment for a different payee      → 'A batch pays one payee …'
--   --   add one sitting in awaiting_approval     → 'already awaiting the owner …'
--   --   submit a batch of one                    → 'needs at least two invoices'
--   --   mark paid straight from 'approved'       → 'Request the payment OTP …'
--   --   edit a line's amount once submitted      → 'part of a batch that is …'
-- ============================================================================
