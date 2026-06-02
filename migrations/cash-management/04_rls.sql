-- ============================================================================
-- 04 — RLS policies for every cash management table
--
-- Reads are cinema-scoped via cinema_access() / cinema_access_unit().
-- Writes are gated by role + (where relevant) ownership of the row.
--
-- Idempotent — drops + recreates.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- operating_units — read any cinema member; write owner-only
-- ----------------------------------------------------------------------------

drop policy if exists operating_units_read  on public.operating_units;
drop policy if exists operating_units_write on public.operating_units;
create policy operating_units_read on public.operating_units
  for select using (public.cinema_access(cinema_id));
create policy operating_units_write on public.operating_units
  for all using (public.cinema_access(cinema_id) and public.is_owner())
         with check (public.cinema_access(cinema_id) and public.is_owner());


-- ----------------------------------------------------------------------------
-- bank_accounts — read manager+; write owner-only
-- ----------------------------------------------------------------------------

drop policy if exists bank_accounts_read  on public.bank_accounts;
drop policy if exists bank_accounts_write on public.bank_accounts;
create policy bank_accounts_read on public.bank_accounts
  for select using (public.cinema_access(cinema_id) and public.is_owner_or_manager());
create policy bank_accounts_write on public.bank_accounts
  for all using (public.cinema_access(cinema_id) and public.is_owner())
         with check (public.cinema_access(cinema_id) and public.is_owner());


-- ----------------------------------------------------------------------------
-- payment_methods — read manager+; write owner-only
-- ----------------------------------------------------------------------------

drop policy if exists payment_methods_read  on public.payment_methods;
drop policy if exists payment_methods_write on public.payment_methods;
create policy payment_methods_read on public.payment_methods
  for select using (public.cinema_access(cinema_id) and public.is_owner_or_manager());
create policy payment_methods_write on public.payment_methods
  for all using (public.cinema_access(cinema_id) and public.is_owner())
         with check (public.cinema_access(cinema_id) and public.is_owner());


-- ----------------------------------------------------------------------------
-- daily_cash_closings — read manager+; write daily_manager+
-- ----------------------------------------------------------------------------

drop policy if exists daily_cash_closings_read  on public.daily_cash_closings;
drop policy if exists daily_cash_closings_write on public.daily_cash_closings;
create policy daily_cash_closings_read on public.daily_cash_closings
  for select using (
    public.cinema_access_unit(operating_unit_id)
    and public.is_owner_or_manager()    -- accountant + daily_manager get their own policy below
  );

-- Daily managers can read closings for their cinema too (needed to fill out + sign)
drop policy if exists daily_cash_closings_read_dm on public.daily_cash_closings;
create policy daily_cash_closings_read_dm on public.daily_cash_closings
  for select using (
    public.cinema_access_unit(operating_unit_id) and public.can_approve_petty_expense()
  );

-- Accountant reads (for cashflow + reports)
drop policy if exists daily_cash_closings_read_accountant on public.daily_cash_closings;
create policy daily_cash_closings_read_accountant on public.daily_cash_closings
  for select using (
    public.cinema_access_unit(operating_unit_id)
    and exists (select 1 from public.authorized_users
                where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                  and role = 'accountant')
  );

create policy daily_cash_closings_write on public.daily_cash_closings
  for all using (public.cinema_access_unit(operating_unit_id) and public.can_approve_petty_expense())
         with check (public.cinema_access_unit(operating_unit_id) and public.can_approve_petty_expense());


-- ----------------------------------------------------------------------------
-- Children of closings — gate via parent
-- ----------------------------------------------------------------------------

drop policy if exists cash_closing_denominations_read  on public.cash_closing_denominations;
drop policy if exists cash_closing_denominations_write on public.cash_closing_denominations;
create policy cash_closing_denominations_read on public.cash_closing_denominations
  for select using (exists (
    select 1 from public.daily_cash_closings c
    where c.id = closing_id and public.cinema_access_unit(c.operating_unit_id)
  ));
create policy cash_closing_denominations_write on public.cash_closing_denominations
  for all using (
    public.can_approve_petty_expense() and exists (
      select 1 from public.daily_cash_closings c
      where c.id = closing_id and public.cinema_access_unit(c.operating_unit_id)
    )
  ) with check (
    public.can_approve_petty_expense() and exists (
      select 1 from public.daily_cash_closings c
      where c.id = closing_id and public.cinema_access_unit(c.operating_unit_id)
    )
  );

drop policy if exists cash_closing_payment_methods_read  on public.cash_closing_payment_methods;
drop policy if exists cash_closing_payment_methods_write on public.cash_closing_payment_methods;
create policy cash_closing_payment_methods_read on public.cash_closing_payment_methods
  for select using (exists (
    select 1 from public.daily_cash_closings c
    where c.id = closing_id and public.cinema_access_unit(c.operating_unit_id)
  ));
create policy cash_closing_payment_methods_write on public.cash_closing_payment_methods
  for all using (
    public.can_approve_petty_expense() and exists (
      select 1 from public.daily_cash_closings c
      where c.id = closing_id and public.cinema_access_unit(c.operating_unit_id)
    )
  ) with check (
    public.can_approve_petty_expense() and exists (
      select 1 from public.daily_cash_closings c
      where c.id = closing_id and public.cinema_access_unit(c.operating_unit_id)
    )
  );


-- ----------------------------------------------------------------------------
-- petty_expenses
--
-- Cashier: insert own, read own.
-- Daily manager + manager + owner: read all in cinema; update approval fields.
-- ----------------------------------------------------------------------------

drop policy if exists petty_expenses_read_cashier   on public.petty_expenses;
drop policy if exists petty_expenses_read_approver  on public.petty_expenses;
drop policy if exists petty_expenses_insert_cashier on public.petty_expenses;
drop policy if exists petty_expenses_update         on public.petty_expenses;
drop policy if exists petty_expenses_delete         on public.petty_expenses;

create policy petty_expenses_read_cashier on public.petty_expenses
  for select using (
    public.is_cashier()
    and lower(requested_by_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and public.cinema_access_unit(operating_unit_id)
  );

create policy petty_expenses_read_approver on public.petty_expenses
  for select using (
    public.can_approve_petty_expense()
    and public.cinema_access_unit(operating_unit_id)
  );

create policy petty_expenses_insert_cashier on public.petty_expenses
  for insert with check (
    (public.is_cashier() or public.can_approve_petty_expense())
    and public.cinema_access_unit(operating_unit_id)
    and lower(requested_by_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create policy petty_expenses_update on public.petty_expenses
  for update using (
    public.can_approve_petty_expense() and public.cinema_access_unit(operating_unit_id)
  ) with check (
    public.can_approve_petty_expense() and public.cinema_access_unit(operating_unit_id)
  );

create policy petty_expenses_delete on public.petty_expenses
  for delete using (
    public.is_owner() and public.cinema_access_unit(operating_unit_id)
  );


-- ----------------------------------------------------------------------------
-- payment_requests
--
-- Read: any authorized cinema member EXCEPT cashier.
-- Insert: accountant + manager + owner.
-- Update approval: owner always; manager if amount < threshold.
-- Update paid_at/bank_reference: accountant or manager+ (whoever transferred).
-- ----------------------------------------------------------------------------

drop policy if exists payment_requests_read   on public.payment_requests;
drop policy if exists payment_requests_insert on public.payment_requests;
drop policy if exists payment_requests_update on public.payment_requests;
drop policy if exists payment_requests_delete on public.payment_requests;

create policy payment_requests_read on public.payment_requests
  for select using (
    public.cinema_access_unit(operating_unit_id)
    and exists (select 1 from public.authorized_users
                where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                  and role in ('owner','manager','accountant'))
  );

create policy payment_requests_insert on public.payment_requests
  for insert with check (
    public.cinema_access_unit(operating_unit_id)
    and exists (select 1 from public.authorized_users
                where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                  and role in ('owner','manager','accountant'))
  );

-- Update covers approve, reject, mark-paid. The trigger in 03 fires on
-- status change; here we just gate WHO can update.
create policy payment_requests_update on public.payment_requests
  for update using (
    public.cinema_access_unit(operating_unit_id)
    and exists (select 1 from public.authorized_users
                where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                  and role in ('owner','manager','accountant'))
  ) with check (
    public.cinema_access_unit(operating_unit_id)
    and exists (select 1 from public.authorized_users
                where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                  and role in ('owner','manager','accountant'))
  );

create policy payment_requests_delete on public.payment_requests
  for delete using (
    public.is_owner() and public.cinema_access_unit(operating_unit_id)
  );


-- ----------------------------------------------------------------------------
-- bank_ledger_entries
--
-- Read: manager + owner + accountant (not cashier, not daily_manager).
-- Write: accountant (manual entries), or via security-definer triggers.
-- ----------------------------------------------------------------------------

drop policy if exists bank_ledger_read   on public.bank_ledger_entries;
drop policy if exists bank_ledger_insert on public.bank_ledger_entries;
drop policy if exists bank_ledger_update on public.bank_ledger_entries;
drop policy if exists bank_ledger_delete on public.bank_ledger_entries;

create policy bank_ledger_read on public.bank_ledger_entries
  for select using (
    exists (
      select 1 from public.bank_accounts ba
      where ba.id = bank_account_id
        and public.cinema_access(ba.cinema_id)
        and exists (select 1 from public.authorized_users
                    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                      and role in ('owner','manager','accountant'))
    )
  );

create policy bank_ledger_insert on public.bank_ledger_entries
  for insert with check (
    exists (
      select 1 from public.bank_accounts ba
      where ba.id = bank_account_id
        and public.cinema_access(ba.cinema_id)
        and exists (select 1 from public.authorized_users
                    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                      and role in ('owner','manager','accountant'))
    )
  );

create policy bank_ledger_update on public.bank_ledger_entries
  for update using (
    exists (
      select 1 from public.bank_accounts ba
      where ba.id = bank_account_id
        and public.cinema_access(ba.cinema_id)
        and exists (select 1 from public.authorized_users
                    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                      and role in ('owner','manager','accountant'))
    )
  ) with check (
    exists (
      select 1 from public.bank_accounts ba
      where ba.id = bank_account_id
        and public.cinema_access(ba.cinema_id)
        and exists (select 1 from public.authorized_users
                    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                      and role in ('owner','manager','accountant'))
    )
  );

create policy bank_ledger_delete on public.bank_ledger_entries
  for delete using (
    public.is_owner()
    and exists (select 1 from public.bank_accounts ba
                where ba.id = bank_account_id and public.cinema_access(ba.cinema_id))
  );


commit;
