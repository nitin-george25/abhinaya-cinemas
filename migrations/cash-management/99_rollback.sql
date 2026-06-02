-- ============================================================================
-- 99 — Full teardown of the cash management module.
--
-- Run only in dev / staging. In prod use targeted DROPs after a backup.
-- ============================================================================

begin;

-- 1) Triggers + helper functions specific to cash management.
drop trigger if exists trg_closing_to_ledger        on public.daily_cash_closings;
drop trigger if exists trg_payment_to_ledger        on public.payment_requests;
drop trigger if exists trg_recompute_closing_petty  on public.petty_expenses;

drop function if exists public.fn_closing_to_ledger();
drop function if exists public.fn_payment_to_ledger();
drop function if exists public.fn_recompute_closing_petty();

-- 2) Tables — order matters because of FKs.
drop table if exists public.bank_ledger_entries           cascade;
drop table if exists public.payment_requests              cascade;
drop table if exists public.petty_expenses                cascade;
drop table if exists public.cash_closing_payment_methods  cascade;
drop table if exists public.cash_closing_denominations    cascade;
drop table if exists public.daily_cash_closings           cascade;
drop table if exists public.payment_methods               cascade;
drop table if exists public.bank_accounts                 cascade;
drop table if exists public.operating_units               cascade;

-- 3) Remove payment_approval_threshold column from cinemas.
alter table public.cinemas
  drop column if exists payment_approval_threshold;

-- 4) Storage bucket + policies.
drop policy if exists "petty_receipts_read"   on storage.objects;
drop policy if exists "petty_receipts_write"  on storage.objects;
drop policy if exists "petty_receipts_update" on storage.objects;
drop policy if exists "petty_receipts_delete" on storage.objects;
delete from storage.buckets where id = 'petty-receipts';

-- 5) Helper functions.
drop function if exists public.cinema_access_unit(uuid);
drop function if exists public.can_approve_payment_request(uuid, numeric);
drop function if exists public.can_approve_petty_expense();
drop function if exists public.is_cashier();

-- 6) Restore role CHECK without 'cashier'.
alter table public.authorized_users
  drop constraint if exists authorized_users_role_check;
alter table public.authorized_users
  add constraint authorized_users_role_check
  check (role in ('owner','manager','daily_manager','accountant'));

commit;
