-- ============================================================================
-- 01 — RLS for the F&B checklist tables
--
-- Mirrors the cash-management policy style: combine cinema_access(cinema_id)
-- with a role helper. Checklist users are the floor + shift managers
-- (owner / manager / daily_manager) = is_entry_writer(). Deletes are
-- owner-only. Idempotent (drop + recreate).
-- ============================================================================

begin;

-- ── fb_checklist_runs ───────────────────────────────────────────────────────
drop policy if exists fb_checklist_runs_read   on public.fb_checklist_runs;
drop policy if exists fb_checklist_runs_insert on public.fb_checklist_runs;
drop policy if exists fb_checklist_runs_update on public.fb_checklist_runs;
drop policy if exists fb_checklist_runs_delete on public.fb_checklist_runs;

create policy fb_checklist_runs_read on public.fb_checklist_runs
  for select using (
    public.cinema_access(cinema_id) and public.is_entry_writer()
  );

create policy fb_checklist_runs_insert on public.fb_checklist_runs
  for insert with check (
    public.cinema_access(cinema_id) and public.is_entry_writer()
  );

create policy fb_checklist_runs_update on public.fb_checklist_runs
  for update using (
    public.cinema_access(cinema_id) and public.is_entry_writer()
  ) with check (
    public.cinema_access(cinema_id) and public.is_entry_writer()
  );

create policy fb_checklist_runs_delete on public.fb_checklist_runs
  for delete using (
    public.cinema_access(cinema_id) and public.is_owner()
  );

-- ── fb_checklist_items (scoped via the parent run) ──────────────────────────
drop policy if exists fb_checklist_items_read   on public.fb_checklist_items;
drop policy if exists fb_checklist_items_insert on public.fb_checklist_items;
drop policy if exists fb_checklist_items_update on public.fb_checklist_items;
drop policy if exists fb_checklist_items_delete on public.fb_checklist_items;

create policy fb_checklist_items_read on public.fb_checklist_items
  for select using (
    exists (
      select 1 from public.fb_checklist_runs r
      where r.id = run_id
        and public.cinema_access(r.cinema_id)
        and public.is_entry_writer()
    )
  );

create policy fb_checklist_items_insert on public.fb_checklist_items
  for insert with check (
    exists (
      select 1 from public.fb_checklist_runs r
      where r.id = run_id
        and public.cinema_access(r.cinema_id)
        and public.is_entry_writer()
    )
  );

create policy fb_checklist_items_update on public.fb_checklist_items
  for update using (
    exists (
      select 1 from public.fb_checklist_runs r
      where r.id = run_id
        and public.cinema_access(r.cinema_id)
        and public.is_entry_writer()
    )
  ) with check (
    exists (
      select 1 from public.fb_checklist_runs r
      where r.id = run_id
        and public.cinema_access(r.cinema_id)
        and public.is_entry_writer()
    )
  );

create policy fb_checklist_items_delete on public.fb_checklist_items
  for delete using (
    exists (
      select 1 from public.fb_checklist_runs r
      where r.id = run_id
        and public.cinema_access(r.cinema_id)
        and public.is_entry_writer()
    )
  );

commit;
