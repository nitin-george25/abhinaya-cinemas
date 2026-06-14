-- ============================================================================
-- 03b — Relax config.data RLS so managers can write the catalog
--
-- Pre-existing bug from the legacy code path: Settings → Movies / Price
-- Cards / Screens lets managers edit, but the row-level policy on
-- public.config is owner-only, so the edit silently fails to persist.
--
-- The new catalog tables (movies, screens, classes, …) already grant write
-- to is_owner_or_manager() via 03_rls_policies.sql. This file brings the
-- legacy config table in line so dual-write succeeds for managers too.
--
-- Idempotent.
-- ============================================================================

begin;

-- Drop legacy policies that gate config writes on is_owner() (or any
-- variant that excludes managers). We restate them as is_owner_or_manager.

drop policy if exists config_write     on public.config;
drop policy if exists cfg_write        on public.config;
drop policy if exists "config_write"   on public.config;

create policy config_write on public.config
  for all using (public.is_owner_or_manager())
         with check (public.is_owner_or_manager());

-- Read policy stays as it was — every authorized user reads config.
-- If a legacy read policy is missing, recreate it defensively.

drop policy if exists config_read on public.config;
create policy config_read on public.config
  for select using (
    exists (select 1 from public.authorized_users
            where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  );

commit;
