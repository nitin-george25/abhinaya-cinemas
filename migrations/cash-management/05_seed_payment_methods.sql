-- ============================================================================
-- 05 — Seed operating units, a bank account, and payment methods for the
--      existing Abhinaya Cinemas cinema.
--
-- Re-runnable: uses on conflict do nothing on the natural unique keys.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Operating units — Theatre (box office) + Cafe (F&B).
-- ----------------------------------------------------------------------------

insert into public.operating_units (cinema_id, name, kind, display_order, updated_by)
  select c.id, 'Theatre', 'box_office', 1, 'seed-05'
    from public.cinemas c
    where c.brand_name = 'Abhinaya Cinemas'
  on conflict (cinema_id, name) do nothing;

insert into public.operating_units (cinema_id, name, kind, display_order, updated_by)
  select c.id, 'Cafe', 'food_beverage', 2, 'seed-05'
    from public.cinemas c
    where c.brand_name = 'Abhinaya Cinemas'
  on conflict (cinema_id, name) do nothing;


-- ----------------------------------------------------------------------------
-- 2) Bank account — one primary account on the Theatre unit.
--    Real values (bank name, last4, opening balance) are filled later via UI.
-- ----------------------------------------------------------------------------

insert into public.bank_accounts (
  cinema_id, operating_unit_id, name, bank_name, opening_balance, opening_date,
  is_primary, updated_by
)
select c.id, u.id, 'Primary Current Account', null, 0, current_date, true, 'seed-05'
  from public.cinemas c
  join public.operating_units u on u.cinema_id = c.id and u.name = 'Theatre'
 where c.brand_name = 'Abhinaya Cinemas'
on conflict (operating_unit_id, name) do nothing;


-- ----------------------------------------------------------------------------
-- 3) Payment methods — cash + the most common online methods.
--    receives_into_bank stays null for now; the owner sets it from Settings.
--
--    One INSERT per row (instead of values+cross join) so the Supabase
--    Studio linter doesn't false-flag the derived table alias as a
--    `create table` without RLS.
-- ----------------------------------------------------------------------------

insert into public.payment_methods (cinema_id, code, display_name, flow_type, display_order)
  select id, 'cash',        'Cash',          'cash',             10 from public.cinemas where brand_name = 'Abhinaya Cinemas'
on conflict (cinema_id, code) do nothing;

insert into public.payment_methods (cinema_id, code, display_name, flow_type, display_order)
  select id, 'bms',         'BookMyShow',    'online_settled',   20 from public.cinemas where brand_name = 'Abhinaya Cinemas'
on conflict (cinema_id, code) do nothing;

insert into public.payment_methods (cinema_id, code, display_name, flow_type, display_order)
  select id, 'paytm',       'Paytm / UPI',   'online_immediate', 30 from public.cinemas where brand_name = 'Abhinaya Cinemas'
on conflict (cinema_id, code) do nothing;

insert into public.payment_methods (cinema_id, code, display_name, flow_type, display_order)
  select id, 'phonepe',     'PhonePe',       'online_immediate', 40 from public.cinemas where brand_name = 'Abhinaya Cinemas'
on conflict (cinema_id, code) do nothing;

insert into public.payment_methods (cinema_id, code, display_name, flow_type, display_order)
  select id, 'razorpay_qr', 'Razorpay QR',   'online_immediate', 50 from public.cinemas where brand_name = 'Abhinaya Cinemas'
on conflict (cinema_id, code) do nothing;

insert into public.payment_methods (cinema_id, code, display_name, flow_type, display_order)
  select id, 'card_pos',    'Card on POS',   'online_settled',   60 from public.cinemas where brand_name = 'Abhinaya Cinemas'
on conflict (cinema_id, code) do nothing;

insert into public.payment_methods (cinema_id, code, display_name, flow_type, display_order)
  select id, 'credit',      'Credit / Tab',  'cash',             70 from public.cinemas where brand_name = 'Abhinaya Cinemas'
on conflict (cinema_id, code) do nothing;


commit;
