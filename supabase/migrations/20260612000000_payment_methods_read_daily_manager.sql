-- 20260612000000_payment_methods_read_daily_manager.sql
--
-- Fix: daily managers saw no payment-method inputs (and no Actual
-- Settlements section) in the cash closing form — only the computed ₹0
-- summary cards.
--
-- Root cause: the payment_methods read policy (cash_04) gated SELECT on
-- is_owner_or_manager(), which resolves to role in ('owner','manager')
-- and excludes daily_manager. With zero readable methods the closing
-- form's method grid and non-cash settlement rows rendered empty.
--
-- payment_methods is non-sensitive reference data that anyone able to
-- create a closing (owner / manager / daily_manager) must read. Gate the
-- read on cinema_access alone — matching the operating_unit_payment_methods
-- read policy from cash_11. Write stays owner-only, unchanged.

drop policy if exists payment_methods_read on public.payment_methods;
create policy payment_methods_read on public.payment_methods
  for select using (public.cinema_access(cinema_id));
