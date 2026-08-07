-- ============================================================================
-- 3D glasses rental — programme flag
--
-- A 3D show charges the patron a flat glasses rental (₹30 by default, set in
-- Settings → Tax & Rep Batta). That money is CINEMA-ONLY: it is never part of
-- Gross Collection, so it never reaches Net Share and is never split with the
-- distributor. The DCR prints it as its own line BELOW the DS/ES split.
--
-- This migration adds only the programme-level flag, which seeds the glasses
-- line when a scheduled show is materialized for ticket entry. The per-show
-- quantity and the rate snapshotted at entry time live inside the existing
-- entries.shows JSONB (Show.glasses3d) and need no schema change.
--
-- The DCR engine never reads this column — same contract as Show.scheduleId.
-- The locked box-office math (breakdown → grossColl → netShare → distShare)
-- is untouched by this feature.
--
-- Idempotent.
-- ============================================================================

begin;

alter table public.show_schedules
  add column if not exists is_3d boolean not null default false;

comment on column public.show_schedules.is_3d is
  '3D show. Seeds the glasses-rental line on the entered show. The rental is cinema-only income: never in Gross Collection, never shared with the distributor.';

commit;
