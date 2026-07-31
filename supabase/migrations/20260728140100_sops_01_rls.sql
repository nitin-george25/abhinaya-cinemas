-- ============================================================================
-- 01 — RLS for the sops table
--
-- Visibility: an SOP is the standard the floor works to, so every authorized
-- user of the cinema can READ it (cinema_access() alone — no role gate). A
-- cashier needs BO-01 as much as the owner does.
--
-- Authorship: the library is centrally owned (master plan §B3), so writes are
-- owner/manager only (is_owner_or_manager()).
--
-- Idempotent (drop + recreate). Mirrors guides_01_rls.
-- ============================================================================

begin;

drop policy if exists sops_read   on public.sops;
drop policy if exists sops_insert on public.sops;
drop policy if exists sops_update on public.sops;
drop policy if exists sops_delete on public.sops;

create policy sops_read on public.sops
  for select using (
    public.cinema_access(cinema_id)
  );

create policy sops_insert on public.sops
  for insert with check (
    public.cinema_access(cinema_id) and public.is_owner_or_manager()
  );

create policy sops_update on public.sops
  for update using (
    public.cinema_access(cinema_id) and public.is_owner_or_manager()
  ) with check (
    public.cinema_access(cinema_id) and public.is_owner_or_manager()
  );

create policy sops_delete on public.sops
  for delete using (
    public.cinema_access(cinema_id) and public.is_owner_or_manager()
  );

commit;
