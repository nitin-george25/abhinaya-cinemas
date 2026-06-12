-- 20260612000100_fnb_razorpay_qr_method_map.sql
--
-- Add the existing "Razorpay QR" payment method (seeded in cash_05:
-- code 'razorpay_qr', flow_type 'online_immediate') to the F&B operating
-- unit, so a QR sales input appears in the F&B cash closing form.
--
-- Mirrors the unit->method seeding pattern from cash_11. F&B order:
-- cash (10), pinelabs (20), razorpay_qr (30). Idempotent — safe to re-run.

with seed(unit_name, code, ord) as (values
  ('F&B', 'razorpay_qr', 30)
)
insert into public.operating_unit_payment_methods (operating_unit_id, payment_method_id, display_order)
  select u.id, m.id, s.ord
    from seed s
    join public.operating_units u on u.name = s.unit_name
    join public.payment_methods m on m.cinema_id = u.cinema_id and m.code = s.code
on conflict (operating_unit_id, payment_method_id) do nothing;
