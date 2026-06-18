-- ============================================================================
-- Project Management — quotation-skip side-step (#18 follow-up).
--
-- Lets the PROJECT MANAGER or OWNER skip the quotation stage for an expense
-- with a reason (e.g. "known vendor"), jumping quoting → quote_approved
-- directly while recording the approved vendor + amount and the skip reason.
-- Any already-submitted quotations are marked rejected.
--
-- Adds project_expenses.quote_skip_reason (non-null ⇒ this expense skipped quotes).
-- New migration (base 20260617120000 already applied) — additive + idempotent.
-- ============================================================================

begin;

alter table public.project_expenses
  add column if not exists quote_skip_reason text;

create or replace function public.fn_project_expense_skip_quotation(
  p_expense_id text, p_vendor text, p_amount numeric, p_reason text
) returns void language plpgsql security definer set search_path = public
as $$
declare e public.project_expenses%rowtype;
        v_actor text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required to skip quotations'; end if;
  if coalesce(btrim(p_vendor), '') = '' then raise exception 'Vendor is required'; end if;
  if p_amount is null then raise exception 'Amount is required'; end if;
  select * into e from public.project_expenses where id = p_expense_id;
  if not found then raise exception 'Expense not found'; end if;
  if not public.is_project_manager_or_owner(e.project_id) then
    raise exception 'Only the project manager or owner can skip quotations'; end if;
  if e.status <> 'quoting' then raise exception 'Expense is not in quoting (status %)', e.status; end if;

  -- reject any submitted quotes — a vendor/amount was chosen directly
  update public.project_quotations set status = 'rejected'
    where expense_id = p_expense_id and status = 'submitted';

  update public.project_expenses
     set status = 'quote_approved',
         approved_quotation_id = null,
         approved_vendor = p_vendor,
         approved_amount = p_amount,
         quote_skip_reason = p_reason,
         updated_by = v_actor
   where id = p_expense_id;

  perform public.fn_project_expense_audit(
    e.project_id, e.id, 'quote_skipped',
    jsonb_build_object('vendor', p_vendor, 'amount', p_amount, 'reason', p_reason));
end;
$$;

commit;

-- ============================================================================
-- VERIFY: select proname from pg_proc where proname = 'fn_project_expense_skip_quotation';
-- ============================================================================
