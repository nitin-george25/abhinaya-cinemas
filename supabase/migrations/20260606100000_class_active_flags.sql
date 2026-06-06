-- ============================================================================
-- Class active flags — separate the CURRENT seat layout from historical-era
-- classes imported by the DCR historical backfill (2019-26 Excel archive).
--
-- Problem: the backfill assigns every era's classes to the screens so old
-- entries still compute. The app treats screen class assignments as the
-- active layout, so historical classes leaked into new-entry forms, DCR
-- rows, and the occupancy seat denominator.
--
-- Active layout (confirmed by Nitin, 2026-06-06):
--   Audi 1 (7gwkvh9): cls_royale (Royale), cls_lounge (Lounge), cls_prime (Prime)
--   Audi 2 (oxnv3cw): xxa50jt (Platinum), 1hliv5d (Gold), tlju8sn (Silver)
-- Every other assignment on those screens is historical → active = false.
--
-- Idempotent; safe on envs where the backfill has not run (the only
-- assignments present are the active ones, which stay active).
-- ============================================================================

-- 1) Normalized layer: screen_classes.active
do $$
begin
  if to_regclass('public.screen_classes') is null then
    return;  -- normalized layer not present on this DB
  end if;
  alter table public.screen_classes
    add column if not exists active boolean not null default true;
  update public.screen_classes sc
  set active = case
    when sc.screen_id = '7gwkvh9'
      then sc.class_id in ('cls_royale', 'cls_lounge', 'cls_prime')
    when sc.screen_id = 'oxnv3cw'
      then sc.class_id in ('xxa50jt', '1hliv5d', 'tlju8sn')
    else true
  end
  where sc.screen_id in ('7gwkvh9', 'oxnv3cw');
end $$;

-- 2) Config JSONB (fallback read path + current write source of truth)
do $$
declare
  d jsonb;
  scr jsonb;
  screens jsonb := '[]'::jsonb;
  keep text[];
begin
  if to_regclass('public.config') is null then
    return;
  end if;
  select data into d from public.config where id = 1;
  if d is null then
    return;
  end if;
  for scr in select * from jsonb_array_elements(coalesce(d->'screens', '[]'::jsonb)) loop
    keep := case scr->>'id'
      when '7gwkvh9' then array['cls_royale', 'cls_lounge', 'cls_prime']
      when 'oxnv3cw' then array['xxa50jt', '1hliv5d', 'tlju8sn']
      else null
    end;
    if keep is not null then
      scr := jsonb_set(scr, '{classes}', (
        select coalesce(jsonb_agg(
          case
            when (c->>'classId') = any(keep) then c - 'active'  -- absent = active
            else c || '{"active": false}'::jsonb
          end), '[]'::jsonb)
        from jsonb_array_elements(coalesce(scr->'classes', '[]'::jsonb)) c));
    end if;
    screens := screens || jsonb_build_array(scr);
  end loop;
  d := jsonb_set(d, '{screens}', screens);
  update public.config
  set data = d,
      updated_by = 'mig-class-active-flags',
      updated_at = now()
  where id = 1;
end $$;
