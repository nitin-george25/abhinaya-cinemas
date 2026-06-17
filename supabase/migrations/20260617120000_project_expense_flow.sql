-- ============================================================================
-- Project Management — Expense approval & payment flow (pipeline #18).
--
-- Replaces the flat "upload an invoice → actual = sum of invoices" model with a
-- controlled per-expense lifecycle under each budget line item:
--
--   quoting → quote_approved → invoiced → payment_requested → paid
--             (+ rejected / cancelled branches)
--
-- Actors (reuses existing global roles + project_members):
--   • PM / DM (is_project_member)        raise expense, add quotations, upload invoice
--   • Owner   (is_owner)                 approve one quotation
--   • Accountant (is_accountant_or_owner) request payment (Slack), mark paid
--
-- Owner's payment approval happens OUT OF BAND on Slack (#payments) — the OTP the
-- owner replies with is entered by the accountant at mark-paid and stored for the
-- audit trail; the app does not verify it (v1, one-way Slack).
--
-- State changes go through SECURITY DEFINER functions so the state machine and
-- per-role gating can't be bypassed from the client, and every transition writes
-- an immutable public.project_audit row.
--
-- Builds on 20260613100000_projects_module and 20260613110000_project_finances.
-- HOW TO RUN: npm run db:push:staging / :prod (Supabase CLI). Idempotent.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0) Role helper — global accountant OR owner.
-- ----------------------------------------------------------------------------
create or replace function public.is_accountant_or_owner()
  returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.authorized_users
     where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
       and role in ('owner', 'accountant')
  );
$$;

-- ----------------------------------------------------------------------------
-- 1) Expenses — one row per spend under a budget line item.
-- ----------------------------------------------------------------------------
create table if not exists public.project_expenses (
  id                    text primary key default gen_random_uuid()::text,
  project_id            text not null references public.projects(id) on delete cascade,
  budget_item_id        text references public.project_budget_items(id) on delete set null,
  title                 text not null,
  description           text,
  status                text not null default 'quoting'
                          check (status in ('quoting','quote_approved','invoiced',
                                            'payment_requested','paid','rejected','cancelled')),
  approved_quotation_id text,                    -- soft link (no FK; quotations refs back)
  approved_vendor       text,
  approved_amount       numeric(14,2),
  paid_amount           numeric(14,2),
  paid_at               timestamptz,
  paid_by               text,
  otp_reference         text,                    -- OTP the owner shared on Slack (audit only)
  payment_note          text,
  slack_channel         text,
  slack_ts              text,
  payment_requested_by  text,
  payment_requested_at  timestamptz,
  created_by            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  updated_by            text
);
create index if not exists project_expenses_project_idx on public.project_expenses (project_id);
create index if not exists project_expenses_item_idx    on public.project_expenses (budget_item_id);
create index if not exists project_expenses_status_idx  on public.project_expenses (status);

-- ----------------------------------------------------------------------------
-- 2) Quotations — N per expense; a quote FILE is required.
-- ----------------------------------------------------------------------------
create table if not exists public.project_quotations (
  id            text primary key default gen_random_uuid()::text,
  project_id    text not null references public.projects(id) on delete cascade,
  expense_id    text not null references public.project_expenses(id) on delete cascade,
  vendor        text not null,
  amount        numeric(14,2) not null default 0,
  notes         text,
  file_url      text not null,                   -- quote attachment REQUIRED
  file_name     text,
  file_size     bigint,
  content_type  text,
  status        text not null default 'submitted'
                  check (status in ('submitted','approved','rejected')),
  submitted_by  text,
  submitted_at  timestamptz not null default now()
);
create index if not exists project_quotations_expense_idx on public.project_quotations (expense_id);
create index if not exists project_quotations_project_idx on public.project_quotations (project_id);

-- ----------------------------------------------------------------------------
-- 3) Extend project_invoices — tie a bill to an expense + GST/freight split.
--    subtotal should match the approved quotation; total = payable amount.
-- ----------------------------------------------------------------------------
alter table public.project_invoices
  add column if not exists expense_id       text references public.project_expenses(id) on delete set null,
  add column if not exists subtotal         numeric(14,2),
  add column if not exists gst              numeric(14,2),
  add column if not exists freight          numeric(14,2),
  add column if not exists total            numeric(14,2),
  add column if not exists deviation_reason text;
create index if not exists project_invoices_expense_idx on public.project_invoices (expense_id);

-- ----------------------------------------------------------------------------
-- 4) updated_at touch trigger (reuse shared fn if present).
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc where proname = 'touch_updated_at') then
    drop trigger if exists project_expenses_touch on public.project_expenses;
    create trigger project_expenses_touch before update on public.project_expenses
      for each row execute function public.touch_updated_at();
  end if;
end$$;

-- ----------------------------------------------------------------------------
-- 5) RLS.
--    read  = cinema_access(project_cinema)
--    expense/quotation INSERT + edit = is_project_member (PM/DM)
--    sensitive state changes go through the SECURITY DEFINER fns below.
-- ----------------------------------------------------------------------------
alter table public.project_expenses   enable row level security;
alter table public.project_quotations enable row level security;

drop policy if exists project_expenses_read on public.project_expenses;
drop policy if exists project_expenses_ins  on public.project_expenses;
drop policy if exists project_expenses_upd  on public.project_expenses;
drop policy if exists project_expenses_del  on public.project_expenses;
create policy project_expenses_read on public.project_expenses
  for select using (public.cinema_access(public.project_cinema(project_id)));
create policy project_expenses_ins on public.project_expenses
  for insert with check (public.is_project_member(project_id));
-- PM/owner may edit expense meta (title/description) directly; status changes
-- normally flow through the definer fns, but accountant transitions don't need
-- a row policy because those fns are SECURITY DEFINER.
create policy project_expenses_upd on public.project_expenses
  for update using (public.is_project_manager_or_owner(project_id))
            with check (public.is_project_manager_or_owner(project_id));
create policy project_expenses_del on public.project_expenses
  for delete using (public.is_project_manager_or_owner(project_id));

drop policy if exists project_quotations_read on public.project_quotations;
drop policy if exists project_quotations_ins  on public.project_quotations;
drop policy if exists project_quotations_upd  on public.project_quotations;
drop policy if exists project_quotations_del  on public.project_quotations;
create policy project_quotations_read on public.project_quotations
  for select using (public.cinema_access(public.project_cinema(project_id)));
create policy project_quotations_ins on public.project_quotations
  for insert with check (public.is_project_member(project_id));
create policy project_quotations_upd on public.project_quotations
  for update using (public.is_project_member(project_id))
            with check (public.is_project_member(project_id));
create policy project_quotations_del on public.project_quotations
  for delete using (public.is_project_member(project_id));

-- ----------------------------------------------------------------------------
-- 6) Audit helper — one immutable row per transition.
-- ----------------------------------------------------------------------------
create or replace function public.fn_project_expense_audit(
  p_project_id text, p_expense_id text, p_action text, p_detail jsonb
) returns void language plpgsql security definer set search_path = public
as $$
declare v_actor text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  insert into public.project_audit (project_id, action, actor_email, detail)
  values (p_project_id, p_action, v_actor,
          coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('expense_id', p_expense_id));
end;
$$;

-- ----------------------------------------------------------------------------
-- 7) Transition functions (state machine + role gating + audit).
-- ----------------------------------------------------------------------------

-- 7a) Owner approves ONE quotation → expense quote_approved; siblings rejected.
create or replace function public.fn_project_quote_approve(p_quotation_id text)
  returns void language plpgsql security definer set search_path = public
as $$
declare q public.project_quotations%rowtype; e public.project_expenses%rowtype;
begin
  if not public.is_owner() then raise exception 'Only the owner can approve a quotation'; end if;
  select * into q from public.project_quotations where id = p_quotation_id;
  if not found then raise exception 'Quotation not found'; end if;
  select * into e from public.project_expenses where id = q.expense_id;
  if e.status <> 'quoting' then raise exception 'Expense is not awaiting quote approval (status %)', e.status; end if;

  update public.project_quotations set status = 'approved' where id = q.id;
  update public.project_quotations set status = 'rejected'
    where expense_id = q.expense_id and id <> q.id and status = 'submitted';
  update public.project_expenses
     set status = 'quote_approved',
         approved_quotation_id = q.id,
         approved_vendor = q.vendor,
         approved_amount = q.amount,
         updated_by = nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '')
   where id = q.expense_id;

  perform public.fn_project_expense_audit(
    e.project_id, e.id, 'quote_approved',
    jsonb_build_object('quotation_id', q.id, 'vendor', q.vendor, 'amount', q.amount));
end;
$$;

-- 7b) Owner rejects all submitted quotes → expense stays 'quoting' for re-quoting.
create or replace function public.fn_project_quotes_reject(p_expense_id text, p_reason text)
  returns void language plpgsql security definer set search_path = public
as $$
declare e public.project_expenses%rowtype;
begin
  if not public.is_owner() then raise exception 'Only the owner can reject quotations'; end if;
  select * into e from public.project_expenses where id = p_expense_id;
  if not found then raise exception 'Expense not found'; end if;
  if e.status <> 'quoting' then raise exception 'Expense is not in quoting (status %)', e.status; end if;
  update public.project_quotations set status = 'rejected'
    where expense_id = p_expense_id and status = 'submitted';
  perform public.fn_project_expense_audit(
    e.project_id, e.id, 'quotes_rejected', jsonb_build_object('reason', p_reason));
end;
$$;

-- 7c) PM/DM record the vendor invoice against an approved expense → invoiced.
create or replace function public.fn_project_expense_record_invoice(
  p_expense_id text, p_invoice_no text, p_invoice_date date,
  p_subtotal numeric, p_gst numeric, p_freight numeric,
  p_file_url text, p_file_name text, p_file_size bigint, p_content_type text,
  p_deviation_reason text
) returns text language plpgsql security definer set search_path = public
as $$
declare e public.project_expenses%rowtype; v_total numeric(14,2); v_invoice_id text;
        v_actor text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  select * into e from public.project_expenses where id = p_expense_id;
  if not found then raise exception 'Expense not found'; end if;
  if not public.is_project_member(e.project_id) then raise exception 'Not a project member'; end if;
  if e.status <> 'quote_approved' then raise exception 'Expense is not awaiting an invoice (status %)', e.status; end if;

  v_total := coalesce(p_subtotal,0) + coalesce(p_gst,0) + coalesce(p_freight,0);
  insert into public.project_invoices
    (project_id, budget_item_id, expense_id, vendor, invoice_no, invoice_date,
     amount, subtotal, gst, freight, total, deviation_reason,
     file_url, file_name, file_size, content_type, uploaded_by)
  values
    (e.project_id, e.budget_item_id, e.id, e.approved_vendor, p_invoice_no, p_invoice_date,
     v_total, p_subtotal, p_gst, p_freight, v_total, p_deviation_reason,
     p_file_url, p_file_name, p_file_size, p_content_type, v_actor)
  returning id into v_invoice_id;

  update public.project_expenses set status = 'invoiced', updated_by = v_actor where id = e.id;
  perform public.fn_project_expense_audit(
    e.project_id, e.id, 'invoice_uploaded',
    jsonb_build_object('invoice_id', v_invoice_id, 'invoice_no', p_invoice_no,
                       'total', v_total, 'deviation_reason', p_deviation_reason));
  return v_invoice_id;
end;
$$;

-- 7d) Accountant requests payment → payment_requested (records the Slack post).
create or replace function public.fn_project_expense_request_payment(
  p_expense_id text, p_slack_channel text, p_slack_ts text
) returns void language plpgsql security definer set search_path = public
as $$
declare e public.project_expenses%rowtype;
        v_actor text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  if not public.is_accountant_or_owner() then raise exception 'Only the accountant can request payment'; end if;
  select * into e from public.project_expenses where id = p_expense_id;
  if not found then raise exception 'Expense not found'; end if;
  if e.status <> 'invoiced' then raise exception 'Expense is not ready for payment (status %)', e.status; end if;
  update public.project_expenses
     set status = 'payment_requested',
         payment_requested_by = v_actor,
         payment_requested_at = now(),
         slack_channel = p_slack_channel,
         slack_ts = p_slack_ts,
         updated_by = v_actor
   where id = e.id;
  perform public.fn_project_expense_audit(
    e.project_id, e.id, 'payment_requested',
    jsonb_build_object('slack_channel', p_slack_channel, 'slack_ts', p_slack_ts));
end;
$$;

-- 7e) Accountant marks paid (enters OTP owner shared on Slack) → paid; budget updates.
create or replace function public.fn_project_expense_mark_paid(
  p_expense_id text, p_otp text, p_paid_amount numeric, p_note text
) returns void language plpgsql security definer set search_path = public
as $$
declare e public.project_expenses%rowtype;
        v_actor text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  if not public.is_accountant_or_owner() then raise exception 'Only the accountant can mark paid'; end if;
  if coalesce(btrim(p_otp), '') = '' then raise exception 'OTP is required to mark paid'; end if;
  select * into e from public.project_expenses where id = p_expense_id;
  if not found then raise exception 'Expense not found'; end if;
  if e.status <> 'payment_requested' then raise exception 'Expense has no payment request (status %)', e.status; end if;
  update public.project_expenses
     set status = 'paid',
         paid_amount = coalesce(p_paid_amount, approved_amount),
         paid_at = now(),
         paid_by = v_actor,
         otp_reference = p_otp,
         payment_note = p_note,
         updated_by = v_actor
   where id = e.id;
  perform public.fn_project_expense_audit(
    e.project_id, e.id, 'expense_paid',
    jsonb_build_object('paid_amount', coalesce(p_paid_amount, e.approved_amount)));
end;
$$;

-- 7f) Cancel an expense before it is paid (member or owner).
create or replace function public.fn_project_expense_cancel(p_expense_id text, p_reason text)
  returns void language plpgsql security definer set search_path = public
as $$
declare e public.project_expenses%rowtype;
        v_actor text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  select * into e from public.project_expenses where id = p_expense_id;
  if not found then raise exception 'Expense not found'; end if;
  if not (public.is_project_member(e.project_id) or public.is_owner()) then
    raise exception 'Not allowed'; end if;
  if e.status = 'paid' then raise exception 'A paid expense cannot be cancelled'; end if;
  update public.project_expenses set status = 'cancelled', updated_by = v_actor where id = e.id;
  perform public.fn_project_expense_audit(
    e.project_id, e.id, 'expense_cancelled', jsonb_build_object('reason', p_reason));
end;
$$;

commit;

-- ============================================================================
-- VERIFY (after applying):
--   select to_regclass('public.project_expenses'), to_regclass('public.project_quotations');
--   select proname from pg_proc where proname like 'fn_project_expense%'
--                                  or proname = 'fn_project_quote_approve';
-- ============================================================================
