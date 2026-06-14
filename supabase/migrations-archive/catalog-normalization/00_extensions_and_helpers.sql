-- ============================================================================
-- 00 — Extensions + helper functions
--
-- Enables the Postgres extensions we depend on (gen_random_uuid, btree_gist
-- for the temporal EXCLUDE constraint in 06), then defines the four helper
-- functions that RLS policies in 03 reference.
--
-- Idempotent. Safe to re-run any time.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Extensions
-- ----------------------------------------------------------------------------

create extension if not exists pgcrypto;     -- gen_random_uuid()
create extension if not exists btree_gist;   -- daterange exclusion in tax_configs


-- ----------------------------------------------------------------------------
-- 2) cinema_access(cinema_id)
--
-- True when the caller's email maps to an authorized_users row that has
-- the requested cinema_id in its cinema_ids[] array. Used by every RLS
-- policy on cinema-scoped tables.
--
-- SECURITY DEFINER so it can read authorized_users from inside an RLS
-- context. Locked-down search_path prevents shenanigans.
-- ----------------------------------------------------------------------------

-- Note: plpgsql (not sql) on purpose. plpgsql doesn't validate column
-- references at CREATE time, so this function survives being created
-- before file 02 adds `cinema_ids` to `authorized_users`. Column refs are
-- resolved at call time instead.
create or replace function public.cinema_access(cid uuid)
  returns boolean
  language plpgsql stable security definer set search_path = public
as $$
begin
  return exists (
    select 1 from public.authorized_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and cid = any(cinema_ids)
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- 3) Role checks
--
-- is_owner()             — owner role specifically.
-- is_owner_or_manager()  — owner OR manager. Catalog writes.
-- is_entry_writer()      — owner OR manager OR daily_manager. Daily ops.
--
-- These read authorized_users WITHOUT respect to cinema scope — the
-- caller-side policy combines them with cinema_access(...). This split
-- keeps the policies composable.
-- ----------------------------------------------------------------------------

create or replace function public.is_owner()
  returns boolean
  language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.authorized_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and role = 'owner'
  );
$$;

create or replace function public.is_owner_or_manager()
  returns boolean
  language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.authorized_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and role in ('owner', 'manager')
  );
$$;

create or replace function public.is_entry_writer()
  returns boolean
  language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.authorized_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and role in ('owner', 'manager', 'daily_manager')
  );
$$;


-- ----------------------------------------------------------------------------
-- 4) caller_email() — convenience for triggers / audit
-- ----------------------------------------------------------------------------

create or replace function public.caller_email()
  returns text
  language sql stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', 'system'));
$$;


-- ----------------------------------------------------------------------------
-- 5) caller_role()
-- ----------------------------------------------------------------------------

create or replace function public.caller_role()
  returns text
  language sql stable security definer set search_path = public
as $$
  select role from public.authorized_users
  where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;


commit;

-- Verify (optional, paste in a separate query):
-- select public.cinema_access('00000000-0000-0000-0000-000000000000');
-- select public.is_owner(), public.is_owner_or_manager(), public.is_entry_writer();
-- select public.caller_email(), public.caller_role();
