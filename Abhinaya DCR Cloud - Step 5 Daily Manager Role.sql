-- ============================================================================
-- Abhinaya Cinemas — DCR Cloud
-- STEP 5: Add 'daily_manager' role.
--
-- Daily Manager = shift-level user who closes the day:
--   - WRITE: entries (Box Office), fb_entries (F&B)
--   - READ:  same (BO history, F&B history)
--   - NO:    config (settings), authorized_users (user mgmt),
--            fb_products (menu), analytics views
--
-- Effective role matrix after this runs:
--   owner          = full access (everything)
--   manager        = BO + F&B write, settings catalog (movies/screens/tax), no users
--   daily_manager  = BO + F&B write only — nothing else
--   accountant     = READ ONLY on BO + F&B history
--
-- HOW TO RUN:
--   Steps 1, 2, 3 must already be in place. Open Supabase Dashboard → SQL
--   Editor → New query → paste this file → Run.
--
-- Safe to run more than once (idempotent).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) Allow 'daily_manager' in the role check constraint
-- ---------------------------------------------------------------------------
alter table public.authorized_users
  drop constraint if exists authorized_users_role_check;

alter table public.authorized_users
  add constraint authorized_users_role_check
  check (role in ('owner','manager','daily_manager','accountant'));


-- ---------------------------------------------------------------------------
-- 2) Helper function: who can write daily entries (BO + F&B)?
--    Owner, manager, AND daily_manager all qualify.
-- ---------------------------------------------------------------------------
create or replace function public.is_entry_writer() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.authorized_users
    where email = lower(auth.jwt() ->> 'email')
      and role in ('owner','manager','daily_manager')
  );
$$;

-- is_manager_or_owner() stays unchanged — still used for settings/catalog writes
-- (movies, price cards, screens, tax, menu items). Daily managers MUST NOT
-- pass that check.


-- ---------------------------------------------------------------------------
-- 3) Repoint entries + fb_entries write policies to is_entry_writer()
-- ---------------------------------------------------------------------------

-- entries
drop policy if exists ent_write on public.entries;
create policy ent_write on public.entries
  for all using (public.is_entry_writer())
  with check     (public.is_entry_writer());

-- fb_entries
drop policy if exists fb_write on public.fb_entries;
create policy fb_write on public.fb_entries
  for all using (public.is_entry_writer())
  with check     (public.is_entry_writer());


-- ---------------------------------------------------------------------------
-- 4) Leave the following policies untouched — they correctly exclude
--    daily_manager because they gate on is_manager_or_owner() or stricter:
--      - config (owner-only write)
--      - authorized_users (owner-only write)
--      - fb_products (manager-or-owner write)
--    Daily managers can READ what is_authorized() allows; they can WRITE
--    only entries and fb_entries.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 5) (Optional) Verification queries — uncomment to confirm setup
-- ---------------------------------------------------------------------------
-- select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conname = 'authorized_users_role_check';
--
-- select polname, pg_get_expr(polqual, polrelid)
--   from pg_policy
--   where polrelid in ('public.entries'::regclass, 'public.fb_entries'::regclass)
--   order by polrelid, polname;


-- Done. Push the updated app code; owners can now create daily_manager users
-- via Settings → Users.
