-- ============================================================================
-- entries — owner-only delete + deletion audit log (pipeline item 7).
--
-- Until now `ent_write` was FOR ALL, so owner / manager / daily_manager
-- could all delete BO entries. DCR data has legal status: deletion becomes
-- an owner-only action, and every delete leaves a row in `deletion_log`
-- (the Activity feed reads it) since a hard delete would otherwise vanish
-- without trace.
--
--   • ent_write (FOR ALL) → ent_insert + ent_update (same is_entry_writer
--     gate as before) + ent_delete (is_owner only).
--   • deletion_log: generic (table_name, record_key jsonb) so other tables
--     can reuse it later. Written by a SECURITY DEFINER trigger — there is
--     deliberately no INSERT policy; clients can't forge log rows.
--   • Read access: manager-or-owner (the Activity page audience).
--
-- Note: SQL-editor / service-role deletes (e.g. backfill repairs) also log,
-- with deleted_by = 'service' when no JWT email is present.
-- ============================================================================

begin;

-- 1) Split the FOR ALL policy; deletes become owner-only.
drop policy if exists ent_write on public.entries;

create policy ent_insert on public.entries
  for insert with check (public.is_entry_writer());

create policy ent_update on public.entries
  for update using (public.is_entry_writer())
        with check (public.is_entry_writer());

create policy ent_delete on public.entries
  for delete using (public.is_owner());

-- 2) Deletion audit log.
create table if not exists public.deletion_log (
  id          uuid primary key default gen_random_uuid(),
  table_name  text not null,
  record_key  jsonb not null,
  deleted_by  text not null,
  deleted_at  timestamptz not null default now()
);
alter table public.deletion_log enable row level security;

drop policy if exists deletion_log_read on public.deletion_log;
create policy deletion_log_read on public.deletion_log
  for select using (public.is_manager_or_owner());
-- No INSERT/UPDATE/DELETE policies on purpose — only the trigger writes.

-- 3) AFTER DELETE trigger on entries.
create or replace function public.fn_log_entry_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.deletion_log (table_name, record_key, deleted_by)
  values (
    'entries',
    jsonb_build_object(
      'entry_date', old.entry_date,
      'movie_id',   old.movie_id,
      'screen_id',  old.screen_id
    ),
    coalesce(nullif(lower(auth.jwt() ->> 'email'), ''), 'service')
  );
  return old;
end;
$$;

drop trigger if exists entries_log_delete on public.entries;
create trigger entries_log_delete
  after delete on public.entries
  for each row execute function public.fn_log_entry_delete();

commit;

-- verify:
--   select polname, polcmd from pg_policy
--    where polrelid = 'public.entries'::regclass;
--   -- expect: ent_read (existing), ent_insert (a), ent_update (w), ent_delete (d)
--   select tgname from pg_trigger
--    where tgrelid = 'public.entries'::regclass and not tgisinternal;
--   -- expect: entries_log_delete (+ entries_refresh_movie_status from cash_16)
--   -- as non-owner: delete from public.entries where false; -- allowed (no rows)
--   -- as manager, deleting a real row must affect 0 rows.
