-- ============================================================================
-- 06 — Sanity check queries. Run after 00-05; every block should return a row.
-- ============================================================================

-- 1. Role constraint includes 'cashier'.
select pg_get_constraintdef(c.oid) as role_check
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
 where t.relname = 'authorized_users' and c.conname = 'authorized_users_role_check';

-- 2. New helper functions exist.
select proname
  from pg_proc
 where proname in (
   'is_cashier', 'can_approve_petty_expense',
   'can_approve_payment_request', 'cinema_access_unit'
 )
 order by proname;

-- 3. payment_approval_threshold default = 5000.
select id, brand_name, location, payment_approval_threshold from public.cinemas;

-- 4. Operating units + bank accounts + payment methods seeded.
select 'units' as section, count(*) as n from public.operating_units
union all select 'banks',     count(*) from public.bank_accounts
union all select 'methods',   count(*) from public.payment_methods;

-- 5. Generated columns on closings work.
--    Inserts a draft closing, reads back pos_cash_expected + discrepancy,
--    then deletes it. Wrap in a savepoint so verify never leaves data.
do $$
declare
  v_unit uuid;
  v_id   uuid;
  v_exp  numeric;
  v_disc numeric;
begin
  select id into v_unit from public.operating_units
    where name = 'Theatre' limit 1;
  if v_unit is null then
    raise notice 'no Theatre unit yet — skip generated-column check';
    return;
  end if;

  insert into public.daily_cash_closings (
    operating_unit_id, business_date, shift, closed_by_email,
    pos_total_sales, pos_non_cash_total, cash_counted, petty_expenses_paid
  ) values (
    v_unit, current_date, 'all_day', 'verify@abhinayacinemas.com',
    10000, 4000, 5950, 50
  ) returning id, pos_cash_expected, discrepancy
    into v_id, v_exp, v_disc;

  raise notice 'closing % expected=% discrepancy=%', v_id, v_exp, v_disc;
  -- Expected: 6000, discrepancy: 0 (5950 + 50 - 6000).
  delete from public.daily_cash_closings where id = v_id;
end $$;

-- 6. RLS is enabled on every new table.
select tablename, rowsecurity
  from pg_tables
 where schemaname = 'public'
   and tablename in (
     'operating_units','bank_accounts','payment_methods',
     'daily_cash_closings','cash_closing_denominations',
     'cash_closing_payment_methods','petty_expenses',
     'payment_requests','bank_ledger_entries'
   )
 order by tablename;

-- 7. Storage bucket exists.
select id, name, public from storage.buckets where id = 'petty-receipts';

-- 8. Triggers wired.
select tgname, tgrelid::regclass::text as on_table
  from pg_trigger
 where tgname in (
   'trg_closing_to_ledger','trg_payment_to_ledger','trg_recompute_closing_petty'
 )
 order by tgname;
