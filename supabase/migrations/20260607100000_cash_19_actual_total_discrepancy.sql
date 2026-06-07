-- ============================================================================
-- cash_19 — headline discrepancy compares ACTUAL collections vs POS total.
--
-- cash_17 added per-mode actual settlements (actual_amount on
-- cash_closing_payment_methods), but the closing's headline discrepancy was
-- still the cash-only formula from cash_01:
--
--     cash_counted + petty_expenses_paid - (pos_total_sales - pos_non_cash_total)
--
-- That ignores actuals entirely, so a manual EDC swipe that never went
-- through the POS (the exact case cash_17 exists for) doesn't move the
-- headline number.
--
-- New definitions:
--
--     non_cash_actual_total  plain column, materialized by the closing form
--                            = sum of actual settlements across non-cash modes
--     actual_total           generated = cash_counted + petty_expenses_paid
--                                        + non_cash_actual_total
--     discrepancy            generated = actual_total - pos_total_sales
--
-- Petty expenses count toward the actual side because the till is counted
-- after petty payouts; excluding them would show a false shortage.
--
-- Generated columns can't aggregate child rows, hence the materialized
-- non_cash_actual_total (same pattern as pos_non_cash_total). Existing rows
-- are backfilled from coalesce(actual_amount, amount) of their non-cash
-- payment rows, so historical discrepancies recompute immediately —
-- including rows saved before cash_17.
-- ============================================================================

begin;

-- 1) Materialized non-cash actual total ------------------------------------

alter table public.daily_cash_closings
  add column if not exists non_cash_actual_total numeric(14,2) not null default 0;

comment on column public.daily_cash_closings.non_cash_actual_total is
  'Sum of actual settled amounts across non-cash modes '
  '(cash_closing_payment_methods.actual_amount, falling back to the '
  'POS-reported amount when no actual was recorded). Materialized by the '
  'closing form on save; backfilled by cash_19.';

update public.daily_cash_closings c
   set non_cash_actual_total = coalesce(t.total, 0)
  from (
    select pm.closing_id,
           sum(coalesce(pm.actual_amount, pm.amount)) as total
      from public.cash_closing_payment_methods pm
      join public.payment_methods m on m.id = pm.payment_method_id
     where m.flow_type <> 'cash'
     group by pm.closing_id
  ) t
 where t.closing_id = c.id;

-- 2) Redefine the generated columns -----------------------------------------
--    Postgres can't alter a generated expression in place: drop + re-add.

alter table public.daily_cash_closings drop column if exists discrepancy;

alter table public.daily_cash_closings
  add column actual_total numeric(14,2) generated always as
    (cash_counted + petty_expenses_paid + non_cash_actual_total) stored;

comment on column public.daily_cash_closings.actual_total is
  'What the day actually produced: cash counted + petty paid from the till '
  '+ non-cash actual settlements.';

alter table public.daily_cash_closings
  add column discrepancy numeric(14,2) generated always as
    (cash_counted + petty_expenses_paid + non_cash_actual_total
     - pos_total_sales) stored;

comment on column public.daily_cash_closings.discrepancy is
  'actual_total - pos_total_sales. Positive = excess; negative = short. '
  'Redefined in cash_19 (was cash-only vs cash-expected).';

commit;

-- verify:
--   select id, business_date, pos_total_sales, cash_counted,
--          petty_expenses_paid, non_cash_actual_total, actual_total,
--          discrepancy
--     from public.daily_cash_closings
--    order by business_date desc
--    limit 5;
-- spot-check e1c9acf3-a7cb-4eee-bd3c-56b5d22ef217:
--   select actual_total, discrepancy from public.daily_cash_closings
--    where id = 'e1c9acf3-a7cb-4eee-bd3c-56b5d22ef217';
