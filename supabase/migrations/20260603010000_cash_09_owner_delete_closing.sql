-- ============================================================================
-- 09 — Owner can delete a cash closing.
--
--   1. RLS DELETE policy on daily_cash_closings limited to owner role.
--   2. BEFORE-DELETE trigger that removes the bank_ledger_entries row that
--      was auto-inserted by fn_closing_to_ledger when the closing reached
--      'signed'. Without this trigger we'd leave an orphan ledger row.
--
-- Children (cash_closing_denominations, cash_closing_payment_methods) are
-- already ON DELETE CASCADE per migration 01. petty_expenses.reconciled_
-- closing_id is ON DELETE SET NULL, so deletes don't lose petty rows.
--
-- Idempotent.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Owner-only DELETE policy.
-- ----------------------------------------------------------------------------

drop policy if exists daily_cash_closings_delete_owner on public.daily_cash_closings;
create policy daily_cash_closings_delete_owner on public.daily_cash_closings
  for delete using (
    public.cinema_access_unit(operating_unit_id)
    and public.is_owner()
  );


-- ----------------------------------------------------------------------------
-- 2) Ledger cleanup trigger.
--
--    fn_closing_to_ledger writes a `cash_deposit` row with source_id =
--    closing.id whenever a closing transitions to 'signed'. On delete we
--    have to remove that row so the bank balance stays correct.
--
--    Defensive: we DELETE by both source_kind and source_id to avoid
--    catching any unrelated ledger entry that happens to share an id.
-- ----------------------------------------------------------------------------

create or replace function public.fn_closing_delete_cleanup()
  returns trigger
  language plpgsql
  security definer set search_path = public
as $$
begin
  delete from public.bank_ledger_entries
    where source_kind = 'cash_deposit'
      and source_id   = old.id;
  return old;
end;
$$;

drop trigger if exists trg_closing_delete_cleanup on public.daily_cash_closings;
create trigger trg_closing_delete_cleanup
  before delete on public.daily_cash_closings
  for each row execute function public.fn_closing_delete_cleanup();


commit;
