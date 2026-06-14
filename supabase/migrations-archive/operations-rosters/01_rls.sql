-- ============================================================================
-- 01 — RLS for the operations roster tables
--
-- Visibility: everyone who can run a shift (owner / manager / daily_manager =
-- is_entry_writer()) can READ rosters, assignments, swaps and leaves.
--
-- Authorship:
--   • staff_rosters + roster_assignments — written by owner/manager only
--     (is_roster_manager()). Daily managers never edit the grid directly.
--   • roster_swaps — INSERT by any entry-writer (a daily manager raises the
--     request); decisions (UPDATE) + cleanup (DELETE) are manager-only.
--   • roster_emergency_leaves — INSERT by any entry-writer (a daily manager
--     flags their own leave); cover + approval (UPDATE) + DELETE are
--     manager-only.
--
-- Idempotent (drop + recreate).
-- ============================================================================

begin;

-- ── staff_rosters ───────────────────────────────────────────────────────────
drop policy if exists staff_rosters_read   on public.staff_rosters;
drop policy if exists staff_rosters_insert on public.staff_rosters;
drop policy if exists staff_rosters_update on public.staff_rosters;
drop policy if exists staff_rosters_delete on public.staff_rosters;

create policy staff_rosters_read on public.staff_rosters
  for select using (
    public.cinema_access(cinema_id) and public.is_entry_writer()
  );

create policy staff_rosters_insert on public.staff_rosters
  for insert with check (
    public.cinema_access(cinema_id) and public.is_roster_manager()
  );

create policy staff_rosters_update on public.staff_rosters
  for update using (
    public.cinema_access(cinema_id) and public.is_roster_manager()
  ) with check (
    public.cinema_access(cinema_id) and public.is_roster_manager()
  );

create policy staff_rosters_delete on public.staff_rosters
  for delete using (
    public.cinema_access(cinema_id) and public.is_roster_manager()
  );

-- ── roster_assignments (scoped via the parent roster) ───────────────────────
drop policy if exists roster_assignments_read   on public.roster_assignments;
drop policy if exists roster_assignments_insert on public.roster_assignments;
drop policy if exists roster_assignments_update on public.roster_assignments;
drop policy if exists roster_assignments_delete on public.roster_assignments;

create policy roster_assignments_read on public.roster_assignments
  for select using (
    exists (
      select 1 from public.staff_rosters r
      where r.id = roster_id
        and public.cinema_access(r.cinema_id)
        and public.is_entry_writer()
    )
  );

create policy roster_assignments_insert on public.roster_assignments
  for insert with check (
    exists (
      select 1 from public.staff_rosters r
      where r.id = roster_id
        and public.cinema_access(r.cinema_id)
        and public.is_roster_manager()
    )
  );

create policy roster_assignments_update on public.roster_assignments
  for update using (
    exists (
      select 1 from public.staff_rosters r
      where r.id = roster_id
        and public.cinema_access(r.cinema_id)
        and public.is_roster_manager()
    )
  ) with check (
    exists (
      select 1 from public.staff_rosters r
      where r.id = roster_id
        and public.cinema_access(r.cinema_id)
        and public.is_roster_manager()
    )
  );

create policy roster_assignments_delete on public.roster_assignments
  for delete using (
    exists (
      select 1 from public.staff_rosters r
      where r.id = roster_id
        and public.cinema_access(r.cinema_id)
        and public.is_roster_manager()
    )
  );

-- ── roster_swaps (read: entry-writer; insert: entry-writer; decide/delete: mgr)
drop policy if exists roster_swaps_read   on public.roster_swaps;
drop policy if exists roster_swaps_insert on public.roster_swaps;
drop policy if exists roster_swaps_update on public.roster_swaps;
drop policy if exists roster_swaps_delete on public.roster_swaps;

create policy roster_swaps_read on public.roster_swaps
  for select using (
    exists (
      select 1 from public.staff_rosters r
      where r.id = roster_id
        and public.cinema_access(r.cinema_id)
        and public.is_entry_writer()
    )
  );

create policy roster_swaps_insert on public.roster_swaps
  for insert with check (
    exists (
      select 1 from public.staff_rosters r
      where r.id = roster_id
        and public.cinema_access(r.cinema_id)
        and public.is_entry_writer()
    )
  );

create policy roster_swaps_update on public.roster_swaps
  for update using (
    exists (
      select 1 from public.staff_rosters r
      where r.id = roster_id
        and public.cinema_access(r.cinema_id)
        and public.is_roster_manager()
    )
  ) with check (
    exists (
      select 1 from public.staff_rosters r
      where r.id = roster_id
        and public.cinema_access(r.cinema_id)
        and public.is_roster_manager()
    )
  );

create policy roster_swaps_delete on public.roster_swaps
  for delete using (
    exists (
      select 1 from public.staff_rosters r
      where r.id = roster_id
        and public.cinema_access(r.cinema_id)
        and public.is_roster_manager()
    )
  );

-- ── roster_emergency_leaves (read+insert: entry-writer; decide/delete: mgr) ──
drop policy if exists roster_emergency_leaves_read   on public.roster_emergency_leaves;
drop policy if exists roster_emergency_leaves_insert on public.roster_emergency_leaves;
drop policy if exists roster_emergency_leaves_update on public.roster_emergency_leaves;
drop policy if exists roster_emergency_leaves_delete on public.roster_emergency_leaves;

create policy roster_emergency_leaves_read on public.roster_emergency_leaves
  for select using (
    exists (
      select 1 from public.staff_rosters r
      where r.id = roster_id
        and public.cinema_access(r.cinema_id)
        and public.is_entry_writer()
    )
  );

create policy roster_emergency_leaves_insert on public.roster_emergency_leaves
  for insert with check (
    exists (
      select 1 from public.staff_rosters r
      where r.id = roster_id
        and public.cinema_access(r.cinema_id)
        and public.is_entry_writer()
    )
  );

create policy roster_emergency_leaves_update on public.roster_emergency_leaves
  for update using (
    exists (
      select 1 from public.staff_rosters r
      where r.id = roster_id
        and public.cinema_access(r.cinema_id)
        and public.is_roster_manager()
    )
  ) with check (
    exists (
      select 1 from public.staff_rosters r
      where r.id = roster_id
        and public.cinema_access(r.cinema_id)
        and public.is_roster_manager()
    )
  );

create policy roster_emergency_leaves_delete on public.roster_emergency_leaves
  for delete using (
    exists (
      select 1 from public.staff_rosters r
      where r.id = roster_id
        and public.cinema_access(r.cinema_id)
        and public.is_roster_manager()
    )
  );

commit;
