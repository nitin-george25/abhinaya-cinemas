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

-- ----------------------------------------------------------------------------
-- Realtime — add to the supabase_realtime publication so the client's
-- postgres_changes subscription on `show_schedules` fires cross-device.
-- Guarded: adding a table already in the publication raises, so check first.
-- (entries / fb_entries were added to this publication outside the tracked
-- migrations; this keeps the new table in lockstep.)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'show_schedules'
  ) then
    alter publication supabase_realtime add table public.show_schedules;
  end if;
exception
  when undefined_object then
    -- publication doesn't exist in this environment; realtime configured elsewhere.
    raise notice 'supabase_realtime publication not found; skipping.';
end $$;

commit;
