-- ============================================================================
-- 01 — RLS for show_schedules
--
-- Visibility + authorship: everyone who can run a shift (owner / manager /
-- daily_manager = is_entry_writer()) can READ and WRITE the schedule. Building
-- the programme is part of running the day, so the same set that enters box
-- office may also programme it (product decision).
--
-- No 2-day post-date restriction here (unlike entries): schedule rows are
-- forward-looking and harmless once past — the +30-min unlock + the entries
-- edit-lock already govern when ticket data can be written.
--
-- Idempotent (drop + recreate). Reuses cinema_access() / is_entry_writer().
-- ============================================================================

begin;

drop policy if exists show_schedules_read   on public.show_schedules;
drop policy if exists show_schedules_insert on public.show_schedules;
drop policy if exists show_schedules_update on public.show_schedules;
drop policy if exists show_schedules_delete on public.show_schedules;

create policy show_schedules_read on public.show_schedules
  for select using (
    public.cinema_access(cinema_id) and public.is_entry_writer()
  );

create policy show_schedules_insert on public.show_schedules
  for insert with check (
    public.cinema_access(cinema_id) and public.is_entry_writer()
  );

create policy show_schedules_update on public.show_schedules
  for update using (
    public.cinema_access(cinema_id) and public.is_entry_writer()
  ) with check (
    public.cinema_access(cinema_id) and public.is_entry_writer()
  );

create policy show_schedules_delete on public.show_schedules
  for delete using (
    public.cinema_access(cinema_id) and public.is_entry_writer()
  );

commit;

-- NOTE: realtime publication membership is handled in a SEPARATE migration
-- (02_realtime). It must NOT live in this transaction: altering the
-- supabase_realtime publication can fail with insufficient_privilege on
-- managed Supabase, and bundling it here would roll back the policy creation
-- above — leaving the table with RLS enabled but no policies (every write
-- silently denied). Keeping policies in their own committed transaction
-- guarantees they land regardless of realtime.
