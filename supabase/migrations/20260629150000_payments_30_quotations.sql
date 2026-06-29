-- ============================================================================
-- payments_30 — Asset purchase flow: quotations + two-stage approval (phase 4,
-- §6.2, D4/D5).
--
-- Asset/capex types (payment_types.is_asset) must gather quotations before any
-- payment. The owner approves a quotation (locks vendor + price), then later
-- approves the disbursement (the existing payment card). Lifecycle:
--   quoting → quote_approved → invoiced → awaiting_payment_approval
--           → approved → paid
-- Invoice subtotal must match the locked quote; only GST + freight may be added,
-- and a deviation needs a reason. An optional quote-skip floor lets trivial buys
-- below ₹X (payment_types.quote_skip_floor) skip quoting.
--
-- HOW TO RUN: npm run db:push:staging / :prod (Supabase CLI). Idempotent.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Quotations — N per payment; a quote FILE is required (mirrors
--    project_quotations).
-- ----------------------------------------------------------------------------
create table if not exists public.payment_quotations (
  id           uuid primary key default gen_random_uuid(),
  payment_id   uuid not null references public.payment_requests(id) on delete cascade,
  vendor       text not null,
  amount       numeric(14,2) not null default 0,
  file_url     text not null,
  lead_time    text,
  warranty     text,
  notes        text,
  status       text not null default 'submitted'
                 check (status in ('submitted','approved','rejected')),
  submitted_by text,
  submitted_at timestamptz not null default now()
);
create index if not exists payment_quotations_payment_idx
  on public.payment_quotations (payment_id);

alter table public.payment_quotations enable row level security;

drop policy if exists payment_quotations_read on public.payment_quotations;
drop policy if exists payment_quotations_ins  on public.payment_quotations;
create policy payment_quotations_read on public.payment_quotations
  for select using (
    exists (select 1 from public.payment_requests pr
             where pr.id = payment_quotations.payment_id
               and public.cinema_access_unit(pr.operating_unit_id))
  );
create policy payment_quotations_ins on public.payment_quotations
  for insert with check (public.can_raise_payment());
-- Status changes flow through the SECURITY DEFINER fns below.

-- ----------------------------------------------------------------------------
-- 2) Lock columns on the payment.
-- ----------------------------------------------------------------------------
alter table public.payment_requests
  add column if not exists approved_quotation_id   uuid,
  add column if not exists quote_locked_vendor     text,
  add column if not exists quote_locked_amount     numeric(14,2),
  add column if not exists quote_skip_reason       text,
  add column if not exists invoice_deviation_reason text;

-- ----------------------------------------------------------------------------
-- 3) Add a quote → raise/replace quotations; moves the payment into 'quoting'.
-- ----------------------------------------------------------------------------
create or replace function public.fn_quote_add(
  p_payment_id uuid, p_vendor text, p_amount numeric, p_file_url text,
  p_lead_time text, p_warranty text, p_notes text
) returns uuid language plpgsql security definer set search_path = public
as $$
declare r public.payment_requests%rowtype; v_is_asset boolean; v_id uuid;
        v_actor text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  if not public.can_raise_payment() then raise exception 'Not allowed'; end if;
  if coalesce(btrim(p_file_url), '') = '' then raise exception 'A quote file is required'; end if;
  select * into r from public.payment_requests where id = p_payment_id;
  if not found then raise exception 'Payment not found'; end if;
  select is_asset into v_is_asset from public.payment_types where id = r.payment_type_id;
  if not coalesce(v_is_asset, false) then raise exception 'This payment type does not use quotations'; end if;
  if r.status not in ('draft','quoting') then
    raise exception 'Quotes can only be added while quoting (status %)', r.status; end if;

  insert into public.payment_quotations (payment_id, vendor, amount, file_url, lead_time, warranty, notes, submitted_by)
  values (p_payment_id, p_vendor, coalesce(p_amount,0), p_file_url, p_lead_time, p_warranty, p_notes, v_actor)
  returning id into v_id;

  if r.status = 'draft' then
    update public.payment_requests set status = 'quoting' where id = r.id;
    perform public.fn_payment_audit(r.id, r.status, 'quoting', 'quotation added', null);
  end if;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) Owner approves ONE quote → locks vendor + price; siblings rejected.
-- ----------------------------------------------------------------------------
create or replace function public.fn_quote_approve(p_quotation_id uuid)
  returns void language plpgsql security definer set search_path = public
as $$
declare q public.payment_quotations%rowtype; r public.payment_requests%rowtype;
begin
  if not public.is_owner() then raise exception 'Only the owner can approve a quotation'; end if;
  select * into q from public.payment_quotations where id = p_quotation_id;
  if not found then raise exception 'Quotation not found'; end if;
  select * into r from public.payment_requests where id = q.payment_id;
  if r.status <> 'quoting' then raise exception 'Payment is not awaiting quote approval (status %)', r.status; end if;

  update public.payment_quotations set status = 'approved' where id = q.id;
  update public.payment_quotations set status = 'rejected'
    where payment_id = q.payment_id and id <> q.id and status = 'submitted';
  update public.payment_requests
     set status = 'quote_approved', approved_quotation_id = q.id,
         quote_locked_vendor = q.vendor, quote_locked_amount = q.amount
   where id = r.id;
  perform public.fn_payment_audit(r.id, r.status, 'quote_approved',
    'vendor ' || q.vendor || ' @ ' || q.amount::text, null);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5) Skip quotation (owner always; raiser only at/below the type's floor).
-- ----------------------------------------------------------------------------
create or replace function public.fn_quote_skip(p_payment_id uuid, p_reason text)
  returns void language plpgsql security definer set search_path = public
as $$
declare r public.payment_requests%rowtype; v_floor numeric;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required to skip quotation'; end if;
  select * into r from public.payment_requests where id = p_payment_id;
  if not found then raise exception 'Payment not found'; end if;
  if r.status not in ('draft','quoting') then raise exception 'Cannot skip now (status %)', r.status; end if;
  select quote_skip_floor into v_floor from public.payment_types where id = r.payment_type_id;
  if not public.is_owner() then
    if not public.can_raise_payment() then raise exception 'Not allowed'; end if;
    if r.amount > coalesce(v_floor, 0) then
      raise exception 'Only the owner can skip quotation above the floor';
    end if;
  end if;
  update public.payment_requests
     set status = 'quote_approved', quote_skip_reason = p_reason
   where id = r.id;
  perform public.fn_payment_audit(r.id, r.status, 'quote_approved', 'quotation skipped — ' || p_reason, null);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6) Attach the tax invoice → 'invoiced'. Subtotal must match the locked quote
--    (GST + freight may be added) unless a deviation reason is given.
-- ----------------------------------------------------------------------------
create or replace function public.fn_payment_attach_invoice(
  p_payment_id uuid, p_subtotal numeric, p_gst numeric, p_freight numeric,
  p_file_url text, p_deviation_reason text
) returns void language plpgsql security definer set search_path = public
as $$
declare r public.payment_requests%rowtype; v_total numeric(14,2);
begin
  if not public.can_raise_payment() then raise exception 'Not allowed'; end if;
  select * into r from public.payment_requests where id = p_payment_id;
  if not found then raise exception 'Payment not found'; end if;
  if r.status <> 'quote_approved' then raise exception 'Payment is not awaiting an invoice (status %)', r.status; end if;
  if coalesce(btrim(p_file_url), '') = '' then raise exception 'Attach the tax invoice'; end if;

  if r.quote_locked_amount is not null
     and coalesce(p_subtotal, 0) <> r.quote_locked_amount
     and coalesce(btrim(p_deviation_reason), '') = '' then
    raise exception 'Invoice subtotal must match the approved quote, or give a deviation reason';
  end if;

  v_total := coalesce(p_subtotal,0) + coalesce(p_gst,0) + coalesce(p_freight,0);
  update public.payment_requests
     set status = 'invoiced', subtotal = p_subtotal, gst = p_gst, freight = p_freight,
         total = v_total, amount = v_total, invoice_url = p_file_url,
         invoice_deviation_reason = nullif(btrim(p_deviation_reason), '')
   where id = r.id;
  perform public.fn_payment_audit(r.id, r.status, 'invoiced',
    'invoice ' || v_total::text || coalesce(' — ' || p_deviation_reason, ''), null);
end;
$$;

-- ----------------------------------------------------------------------------
-- 7) Teach fn_payment_submit to also push an invoiced asset to payment approval.
-- ----------------------------------------------------------------------------
create or replace function public.fn_payment_submit(p_payment_id uuid)
  returns void language plpgsql security definer set search_path = public
as $$
declare r public.payment_requests%rowtype; v_rule text;
begin
  if not public.can_raise_payment() then raise exception 'Not allowed to submit payments'; end if;
  select * into r from public.payment_requests where id = p_payment_id;
  if not found then raise exception 'Payment not found'; end if;

  if r.status = 'invoiced' then
    update public.payment_requests set status = 'awaiting_payment_approval', submitted_at = now() where id = r.id;
    perform public.fn_payment_audit(r.id, r.status, 'awaiting_payment_approval', null, null);
    return;
  end if;

  if r.status not in ('draft','rejected') then
    raise exception 'Only a draft can be submitted (status %)', r.status; end if;
  select invoice_rule into v_rule from public.payment_types where id = r.payment_type_id;
  if v_rule = 'required' and coalesce(btrim(r.invoice_url), '') = '' then
    raise exception 'Attach the invoice before submitting this payment';
  end if;
  update public.payment_requests set status = 'awaiting_approval', submitted_at = now() where id = r.id;
  perform public.fn_payment_audit(r.id, r.status, 'awaiting_approval', null, null);
end;
$$;

commit;

-- ============================================================================
-- VERIFY (after applying):
--   select to_regclass('public.payment_quotations');
--   select proname from pg_proc where proname in
--     ('fn_quote_add','fn_quote_approve','fn_quote_skip','fn_payment_attach_invoice');
-- ============================================================================
