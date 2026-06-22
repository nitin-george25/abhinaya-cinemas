-- ============================================================================
-- 01 — RLS for the guides table
--
-- Visibility: the /guides page is available to every role, so any authorized
-- user of the cinema can READ guides (cinema_access() alone — no role gate).
--
-- Authorship: guides are content, maintained by owner/manager only
-- (is_owner_or_manager()). Daily managers, accountants and cashiers read but
-- never edit.
--
-- Idempotent (drop + recreate).
-- ============================================================================

begin;

drop policy if exists guides_read   on public.guides;
drop policy if exists guides_insert on public.guides;
drop policy if exists guides_update on public.guides;
drop policy if exists guides_delete on public.guides;

create policy guides_read on public.guides
  for select using (
    public.cinema_access(cinema_id)
  );

create policy guides_insert on public.guides
  for insert with check (
    public.cinema_access(cinema_id) and public.is_owner_or_manager()
  );

create policy guides_update on public.guides
  for update using (
    public.cinema_access(cinema_id) and public.is_owner_or_manager()
  ) with check (
    public.cinema_access(cinema_id) and public.is_owner_or_manager()
  );

create policy guides_delete on public.guides
  for delete using (
    public.cinema_access(cinema_id) and public.is_owner_or_manager()
  );

commit;
