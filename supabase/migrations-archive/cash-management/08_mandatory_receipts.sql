-- ============================================================================
-- 08 — Mandatory receipts.
--
--   1. New Storage bucket `payment-receipts` for payment_requests invoice
--      uploads. (We already have `petty-receipts` for petty expense uploads.)
--   2. New column `petty_expenses.no_receipt_reason` so a cashier who lacks
--      a paper bill can record *why* — the form requires either a receipt
--      OR a reason, never both empty.
--   3. CHECK constraint on petty_expenses enforcing the same rule
--      server-side so the UI invariant survives bulk inserts / API misuse.
--   4. NOT-NULL-ish CHECK on payment_requests.invoice_url for newly-created
--      rows: every request must have a supporting document going forward.
--      Existing rows are grandfathered.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) payment-receipts Storage bucket.
--
--    Public-read (same as petty-receipts) so approvers can open the receipt
--    inline. Write is gated to the roles who can create payment_requests
--    (accountant, manager, owner). Update / delete confined to owner so
--    history isn't tampered with.
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
  values ('payment-receipts', 'payment-receipts', true)
  on conflict (id) do update set public = excluded.public;

drop policy if exists "payment_receipts_read"   on storage.objects;
drop policy if exists "payment_receipts_write"  on storage.objects;
drop policy if exists "payment_receipts_update" on storage.objects;
drop policy if exists "payment_receipts_delete" on storage.objects;

create policy "payment_receipts_read" on storage.objects
  for select using (bucket_id = 'payment-receipts');

create policy "payment_receipts_write" on storage.objects
  for insert with check (
    bucket_id = 'payment-receipts'
    and exists (
      select 1 from public.authorized_users
       where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
         and role in ('owner','manager','accountant')
    )
  );

create policy "payment_receipts_update" on storage.objects
  for update using (
    bucket_id = 'payment-receipts' and public.is_owner()
  );

create policy "payment_receipts_delete" on storage.objects
  for delete using (
    bucket_id = 'payment-receipts' and public.is_owner()
  );


-- ----------------------------------------------------------------------------
-- 2) petty_expenses.no_receipt_reason
--
--    Cashier raising a request without a paper bill must record why
--    (cash tip, vendor refused to print, ad-hoc purchase). This stays on
--    the row forever so audits can see the explanation alongside the
--    approval decision.
-- ----------------------------------------------------------------------------

alter table public.petty_expenses
  add column if not exists no_receipt_reason text;


-- ----------------------------------------------------------------------------
-- 3) Petty: enforce receipt OR reason at the DB layer.
--
--    Existing rows: a NULL receipt_url and NULL reason was previously
--    allowed. Backfill with a placeholder so the new constraint can be
--    added without rejecting historical data.
-- ----------------------------------------------------------------------------

update public.petty_expenses
   set no_receipt_reason = 'Backfilled — pre-policy entry'
 where receipt_url is null
   and (no_receipt_reason is null or no_receipt_reason = '');

alter table public.petty_expenses
  drop constraint if exists petty_expenses_receipt_or_reason_chk;
alter table public.petty_expenses
  add constraint petty_expenses_receipt_or_reason_chk
  check (
    (receipt_url is not null and length(trim(receipt_url)) > 0)
    or
    (no_receipt_reason is not null and length(trim(no_receipt_reason)) > 0)
  );


-- ----------------------------------------------------------------------------
-- 4) Payment requests: receipt/invoice required for new rows.
--
--    Existing rows without an invoice_url get a placeholder backfill so the
--    constraint can land. Going forward, the form will block submit without
--    a successful upload.
-- ----------------------------------------------------------------------------

update public.payment_requests
   set invoice_url = 'pre-policy://no-attachment'
 where invoice_url is null or length(trim(invoice_url)) = 0;

alter table public.payment_requests
  drop constraint if exists payment_requests_invoice_required_chk;
alter table public.payment_requests
  add constraint payment_requests_invoice_required_chk
  check (invoice_url is not null and length(trim(invoice_url)) > 0);


-- ----------------------------------------------------------------------------
-- 5) Cashier RLS for daily_cash_closings.
--
--    The dual-signoff flow needs cashiers to read closings tied to them
--    (so they can find ones awaiting confirmation) and to update only the
--    cashier-sign fields (so they can confirm). Read is scoped to the
--    cashier's own cashier_email so they can't browse other tills.
--
--    Note: we don't constrain which columns the cashier may update at
--    the policy layer (PostgreSQL RLS doesn't support column-level USING
--    on UPDATE). The application-layer cashierSignClosing only touches
--    the three cashier_* fields plus status. If we later need to harden
--    this we'll add a SECURITY DEFINER function and revoke direct UPDATE.
-- ----------------------------------------------------------------------------

drop policy if exists daily_cash_closings_read_cashier   on public.daily_cash_closings;
drop policy if exists daily_cash_closings_update_cashier on public.daily_cash_closings;

create policy daily_cash_closings_read_cashier on public.daily_cash_closings
  for select using (
    public.is_cashier()
    and public.cinema_access_unit(operating_unit_id)
    and lower(coalesce(cashier_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create policy daily_cash_closings_update_cashier on public.daily_cash_closings
  for update using (
    public.is_cashier()
    and public.cinema_access_unit(operating_unit_id)
    and lower(coalesce(cashier_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and status = 'counted'                  -- only when manager has already signed
  ) with check (
    public.is_cashier()
    and public.cinema_access_unit(operating_unit_id)
    and lower(coalesce(cashier_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
    -- After update, the only valid terminal status the cashier can set
    -- is 'signed'. (Approving 'disputed' / 'resolved' is owner+manager.)
    and status in ('counted','signed')
  );


commit;
