-- ============================================================================
-- cash_17 — per-mode actual settlement amounts on closing payment rows.
--
-- The closing form's payment grid records what the POS *reported* per mode
-- (`amount`). Some cashiers run the EDC machine manually (sale never keyed
-- into the POS), so the machine/UPI-app total can differ from the POS figure.
--
-- `actual_amount` records what the mode actually settled. The closing form
-- autofills it from the POS figure and materializes it on save, so:
--
--     per-mode discrepancy = actual_amount - amount
--
-- Null = not recorded (rows saved before cash_17). No RLS change needed —
-- the column rides the existing row-level policies on this table.
-- ============================================================================

begin;

alter table public.cash_closing_payment_methods
  add column if not exists actual_amount numeric(14,2);

comment on column public.cash_closing_payment_methods.actual_amount is
  'Actual settled amount for this mode (EDC machine / UPI app total). '
  'Autofilled from the POS-reported figure (amount) by the closing form; '
  'edited when they differ. Null = recorded before cash_17.';

commit;

-- verify:
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name   = 'cash_closing_payment_methods'
--    order by ordinal_position;
-- expect: closing_id, payment_method_id, amount, actual_amount (numeric, YES)
