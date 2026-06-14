-- ============================================================================
-- 99 — Rollback for the operations roster tables (DESTRUCTIVE)
--
-- Drops all four tables (and their data) plus the is_roster_manager() helper.
-- Run only to fully tear the feature down.
-- ============================================================================

begin;

drop table if exists public.roster_emergency_leaves cascade;
drop table if exists public.roster_swaps           cascade;
drop table if exists public.roster_assignments     cascade;
drop table if exists public.staff_rosters          cascade;

drop function if exists public.is_roster_manager();

commit;
