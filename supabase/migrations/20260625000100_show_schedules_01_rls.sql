-- ============================================================================
-- 01 — RLS for show_schedules
--
-- Visibility + authorship: everyone who can run a shift (owner / manager /
-- daily_manager = is_entry_writer()) can READ and WRITE the schedule. Building
-- the programme is part of running the day, so the same set that enters box
-- office may also programme it (product decision).
--
-- Gated on is_entry_writer() ONLY — deliberately matching public.entries
-- (ent_insert / ent_update use is_entry_writer() with no cinema_access check).
-- An earlier version ANDed cinema_access(cinema_id), but that denied every
-- write whenever the user's authorized_users.cinema_ids didn't contain the
-- resolved cinema id — so entries persisted while schedules silently didn't.
-- Schedules are less sensitive than entries (just programming), so matching the
-- entries gate is consistent, not a regression. (See 02b align migration.)
--
-- No 2-day post-date restriction here (unlike entries): schedule rows are
-- forward-looking and harmless once past — the +30-min unlock + the entries
-- edit-lock already govern when ticket data can be written.
--
-- Idempotent (drop + recreate).
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

-- NOTE: realtime publication membership is handled in a SEPARATE migration
-- (02_realtime). It must NOT live in this transaction: altering the
-- supabase_realtime publication can fail with insufficient_privilege on
-- managed Supabase, and bundling it here would roll back the policy creation
-- above — leaving the table with RLS enabled but no policies (every write
-- silently denied). Keeping policies in their own committed transaction
-- guarantees they land regardless of realtime.
