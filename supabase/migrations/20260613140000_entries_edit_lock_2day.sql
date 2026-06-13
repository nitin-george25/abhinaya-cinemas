-- =============================================================================
-- 2026-06-13  DCR edit lock — entries older than 2 days are read-only for
-- everyone EXCEPT the owner.
--
-- Editable window: an entry dated D may be inserted/updated on D, D+1, D+2
-- (IST); it locks from D+3 onward. Owner (public.is_owner()) is always exempt
-- so back-dated corrections remain possible.
--
-- Enforced with RESTRICTIVE policies so they AND with the existing permissive
-- write policies. Scoped to UPDATE and INSERT only:
--   • SELECT is untouched  → old DCRs stay fully readable by every role.
--   • DELETE is untouched  → owner-only delete (migration 20260606150000) stands.
-- The matching UI gate lives in app/src/pages/Entry.tsx (editLocked).
--
-- Idempotent (drop + recreate). Apply to STAGING first, then prod.
-- =============================================================================
begin;

alter table public.entries enable row level security;

-- An existing row may only be edited while its entry_date is within the
-- 2-day window (or the caller is the owner). The WITH CHECK clause also stops
-- a non-owner from back-dating a recent entry into the locked zone.
drop policy if exists entries_edit_lock_update on public.entries;
create policy entries_edit_lock_update on public.entries
  as restrictive for update
  using (
    public.is_owner()
    or entry_date >= ((now() at time zone 'Asia/Kolkata')::date - 2)
  )
  with check (
    public.is_owner()
    or entry_date >= ((now() at time zone 'Asia/Kolkata')::date - 2)
  );

-- A non-owner cannot create a brand-new entry for a date older than the
-- window either (otherwise the lock would be trivially bypassable on insert).
drop policy if exists entries_edit_lock_insert on public.entries;
create policy entries_edit_lock_insert on public.entries
  as restrictive for insert
  with check (
    public.is_owner()
    or entry_date >= ((now() at time zone 'Asia/Kolkata')::date - 2)
  );

commit;
