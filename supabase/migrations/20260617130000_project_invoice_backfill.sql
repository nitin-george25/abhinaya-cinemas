-- ============================================================================
-- Project Management — backfill legacy invoices into the expense flow (#18).
--
-- The new model derives a budget line's "Paid" from PAID EXPENSES, not from
-- raw invoices. Invoices added under the OLD flat model have no expense, so
-- without this they would stop counting and a line's spend would drop to ₹0.
--
-- This converts each pre-existing invoice (expense_id IS NULL) into a completed
-- 'paid' expense and links the invoice to it, so every line's total is
-- UNCHANGED after deploy. Legacy items carry no quotation/OTP and are tagged
-- in payment_note as imported.
--
-- Decision (2026-06-17): mark legacy invoices as Paid to preserve totals.
-- Idempotent: only touches invoices that aren't linked yet; ON CONFLICT guards
-- the deterministic 'imp-<invoice id>' expense ids so re-runs are no-ops.
--
-- Runs AFTER 20260617120000_project_expense_flow (schema). HOW TO RUN: applied
-- via the migration workflow / npm run db:push:staging|:prod.
-- ============================================================================

begin;

-- 1) Create one paid expense per un-linked invoice (deterministic id).
insert into public.project_expenses (
  id, project_id, budget_item_id, title, description, status,
  approved_vendor, approved_amount, paid_amount, paid_at, paid_by,
  payment_note, created_by, created_at, updated_at
)
select
  'imp-' || i.id,
  i.project_id,
  i.budget_item_id,
  coalesce(
    nullif(btrim(coalesce(i.vendor, '') || ' ' || coalesce(i.invoice_no, '')), ''),
    'Imported invoice'
  ),
  i.notes,
  'paid',
  i.vendor,
  coalesce(i.total, i.amount),
  coalesce(i.total, i.amount),
  coalesce(i.invoice_date::timestamptz, i.uploaded_at, now()),
  i.uploaded_by,
  'Imported from legacy invoice (pre-expense-flow)',
  i.uploaded_by,
  coalesce(i.uploaded_at, now()),
  now()
from public.project_invoices i
where i.expense_id is null
on conflict (id) do nothing;

-- 2) Link each invoice to its new expense + normalise the amount split so the
--    expense card shows total = amount (no GST/freight breakdown for legacy).
update public.project_invoices i
set expense_id = 'imp-' || i.id,
    total      = coalesce(i.total, i.amount),
    subtotal   = coalesce(i.subtotal, i.total, i.amount)
where i.expense_id is null;

commit;

-- ============================================================================
-- VERIFY (after applying):
--   -- every invoice now linked to an expense:
--   select count(*) from public.project_invoices where expense_id is null;   -- 0
--   -- line totals match the old invoice sums:
--   select bi.name, sum(e.paid_amount) paid
--     from public.project_expenses e
--     join public.project_budget_items bi on bi.id = e.budget_item_id
--    where e.status = 'paid' group by bi.name;
-- ============================================================================
