-- ============================================================================
-- Picture Ending — 02 — RLS for the settlement tables.
--
-- Both tables back the Reports → Picture Ending page, whose audience is
-- owner / manager / accountant (REPORT_ROLES). There is no single helper for
-- those three, so we compose: is_owner_or_manager() OR is_accountant_or_owner()
-- = owner ∪ manager ∪ accountant. Reads and writes share that gate; every
-- query is additionally cinema-scoped by cinema_access(cinema_id).
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run on BOTH
-- staging and prod. Idempotent.
-- ============================================================================

begin;

alter table public.distributor_payments      enable row level security;
alter table public.picture_ending_statements enable row level security;

-- ----------------------------------------------------------------------------
-- distributor_payments
-- ----------------------------------------------------------------------------
drop policy if exists distributor_payments_read   on public.distributor_payments;
drop policy if exists distributor_payments_write   on public.distributor_payments;

create policy distributor_payments_read on public.distributor_payments
  for select using (
    public.cinema_access(cinema_id)
    and (public.is_owner_or_manager() or public.is_accountant_or_owner())
  );

create policy distributor_payments_write on public.distributor_payments
  for all using (
    public.cinema_access(cinema_id)
    and (public.is_owner_or_manager() or public.is_accountant_or_owner())
  ) with check (
    public.cinema_access(cinema_id)
    and (public.is_owner_or_manager() or public.is_accountant_or_owner())
  );

-- ----------------------------------------------------------------------------
-- picture_ending_statements
-- ----------------------------------------------------------------------------
drop policy if exists picture_ending_statements_read  on public.picture_ending_statements;
drop policy if exists picture_ending_statements_write on public.picture_ending_statements;

create policy picture_ending_statements_read on public.picture_ending_statements
  for select using (
    public.cinema_access(cinema_id)
    and (public.is_owner_or_manager() or public.is_accountant_or_owner())
  );

create policy picture_ending_statements_write on public.picture_ending_statements
  for all using (
    public.cinema_access(cinema_id)
    and (public.is_owner_or_manager() or public.is_accountant_or_owner())
  ) with check (
    public.cinema_access(cinema_id)
    and (public.is_owner_or_manager() or public.is_accountant_or_owner())
  );

commit;
