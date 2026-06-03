-- ============================================================================
-- 12 — Tighten visibility on closings + petty expenses.
--
--   1. daily_cash_closings — visibility per role:
--      * owner / manager / accountant: every closing in the cinema.
--      * daily_manager: only closings they themselves created
--        (closed_by_email = own email).
--      * cashier: only closings where cashier_email = own email
--        (any status, not just 'counted' — they should also see the
--        signed history they were on the till for).
--
--   2. petty_expenses — accountants get read access for reconciliation
--      reporting. They still can't approve / reject.
--
-- Idempotent — re-runs safely.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) daily_cash_closings — drop the broad daily_manager read and replace
--    with a self-only scope.
-- ----------------------------------------------------------------------------

drop policy if exists daily_cash_closings_read_dm        on public.daily_cash_closings;
drop policy if exists daily_cash_closings_read_self_dm   on public.daily_cash_closings;

create policy daily_cash_closings_read_self_dm on public.daily_cash_closings
  for select using (
    public.cinema_access_unit(operating_unit_id)
    and exists (
      select 1 from public.authorized_users
       where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
         and role = 'daily_manager'
    )
    and lower(closed_by_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- ----------------------------------------------------------------------------
-- Cashier read — drop the status-restricted policy from migration 08
-- and replace with a status-agnostic one.
-- ----------------------------------------------------------------------------

drop policy if exists daily_cash_closings_read_cashier on public.daily_cash_closings;

create policy daily_cash_closings_read_cashier on public.daily_cash_closings
  for select using (
    public.is_cashier()
    and public.cinema_access_unit(operating_unit_id)
    and lower(coalesce(cashier_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- Note: daily_cash_closings_read (owner/manager) and
--       daily_cash_closings_read_accountant policies stay unchanged —
--       they already grant full visibility to those three roles.
-- The cashier UPDATE policy (migration 08) also stays — it's still
-- limited to status='counted' which is correct: cashier can only mutate
-- a counted closing they're tagged on.


-- ----------------------------------------------------------------------------
-- 2) petty_expenses — accountant read access.
--
-- Existing policies (from migration 04):
--   * petty_expenses_read_cashier  — cashier reads own requested rows.
--   * petty_expenses_read_approver — owner / manager / daily_manager.
--   * petty_expenses_insert_cashier, _update — unchanged.
--
-- Add a parallel read-only policy for accountants.
-- ----------------------------------------------------------------------------

drop policy if exists petty_expenses_read_accountant on public.petty_expenses;

create policy petty_expenses_read_accountant on public.petty_expenses
  for select using (
    public.cinema_access_unit(operating_unit_id)
    and exists (
      select 1 from public.authorized_users
       where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
         and role = 'accountant'
    )
  );


commit;
