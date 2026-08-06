-- ============================================================================
-- bank_accounts_read_accountant — grant the accountant SELECT on bank_accounts.
--
-- cash_07 opened bank_accounts to accountant INSERT + UPDATE ("Open
-- bank_accounts to accountant writes") but never added a matching SELECT
-- policy, so the base read (bank_accounts_read = is_owner_or_manager) still
-- excluded the accountant. Effect: an accountant could insert/update bank
-- accounts but SELECT returned zero rows — the bank-account list rendered
-- empty, blocking them from choosing a paying bank account when marking a
-- payment paid. It also cascaded: bank_ledger_read permits the accountant but
-- its USING clause sub-selects bank_accounts under RLS, so with no read on
-- bank_accounts the accountant couldn't see the bank ledger either.
--
-- This adds the missing SELECT, scoped to the accountant's cinema access,
-- mirroring the cash_07 accountant write policies. Additive + idempotent.
-- Read stays role-restricted (owner/manager/accountant) — account numbers are
-- NOT opened to daily_manager/cashier.
--
-- HOW TO RUN: npm run db:push:staging / :prod (Supabase CLI).
-- ============================================================================

begin;

drop policy if exists bank_accounts_read_accountant on public.bank_accounts;
create policy bank_accounts_read_accountant on public.bank_accounts
  for select using (
    public.cinema_access(cinema_id)
    and exists (
      select 1 from public.authorized_users
       where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
         and role = 'accountant'
    )
  );

commit;

-- VERIFY (in an accountant session):
--   select count(*) from public.bank_accounts;   -- should be > 0
