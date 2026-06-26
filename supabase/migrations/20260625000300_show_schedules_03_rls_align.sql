-- ============================================================================
-- 03 — Re-align show_schedules RLS to match public.entries (is_entry_writer)
--
-- The first cut of 01_rls gated writes on `cinema_access(cinema_id) AND
-- is_entry_writer()`. cinema_access() only passes when the user's
-- authorized_users.cinema_ids array contains the row's cinema_id — but the
-- entries table (the direct analog) gates on is_entry_writer() ALONE. Where the
-- cinema_ids array didn't contain the resolved cinema id, schedule writes were
-- silently denied (entries kept working). This drops the cinema_access
-- requirement so schedules persist exactly like entries.
--
-- Idempotent: safe to run whether the DB still has the old policies or the
-- corrected 01_rls. Run order-independent.
-- ============================================================================

begin;

drop policy if exists show_schedules_read   on public.show_schedules;
drop policy if exists show_schedules_insert on public.show_schedules;
drop policy if exists show_schedules_update on public.show_schedules;
drop policy if exists show_schedules_delete on public.show_schedules;

create policy show_schedules_read on public.show_schedules
  for select using (public.is_entry_writer());

create policy show_schedules_insert on public.show_schedules
  for insert with check (public.is_entry_writer());

create policy show_schedules_update on public.show_schedules
  for update using (public.is_entry_writer())
        with check (public.is_entry_writer());

create policy show_schedules_delete on public.show_schedules
  for delete using (public.is_entry_writer());

commit;
