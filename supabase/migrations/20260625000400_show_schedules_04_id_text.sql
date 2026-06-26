-- ============================================================================
-- 04 — show_schedules.id must be TEXT, not uuid
--
-- THE reason schedules never persisted. The client generates row ids with
-- uid() — short base36 strings like "k3f9a2b" (the same scheme the catalog
-- tables movies/screens/classes use for their TEXT ids) — and sends that id on
-- every upsert. The column was created as uuid, so Postgres rejected every
-- insert with "invalid input syntax for type uuid" (SQLSTATE 22P02), before RLS
-- even mattered. entries / fb_entries don't hit this: they never send a client
-- id to a uuid column (entries key on the composite; fb omits id).
--
-- Switch id to text to match. Safe: the table is empty (all prior inserts
-- failed). Idempotent — re-running on a column that's already text is a no-op.
-- ============================================================================

begin;

alter table public.show_schedules alter column id drop default;
alter table public.show_schedules alter column id type text using id::text;

commit;
