-- ============================================================================
-- 02 — Realtime for show_schedules (best-effort, NEVER fatal)
--
-- Adds the table to the supabase_realtime publication so the client's
-- postgres_changes subscription fires cross-device. This is split out of
-- 00_schema / 01_rls on purpose: on managed Supabase the migration role may
-- not own the supabase_realtime publication, so `alter publication` can raise
-- insufficient_privilege. We catch EVERY exception here so a realtime failure
-- can never abort schema or policy migrations (a missing realtime subscription
-- only costs cross-device live refresh — schedules still persist and reload).
--
-- If this is skipped, enable realtime for `show_schedules` from the Supabase
-- dashboard (Database → Replication / Realtime) instead.
-- ============================================================================

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
  when others then
    raise notice 'Could not add show_schedules to supabase_realtime (%); enable it from the dashboard if needed.', sqlerrm;
end $$;
