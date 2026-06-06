-- ============================================================================
-- Repair: Audi 2 stale class IDs (flags + config damage)
--
-- The class-flags migration (20260606100000) and the original backfill
-- deliverable were generated against STALE Audi 2 class IDs
-- (xxa50jt/1hliv5d/tlju8sn) from an outdated legacy export. The real
-- current Audi 2 classes on BOTH envs are:
--   1u1lpa4 = Platinum, lp9hi7s = Gold, bsl9hd8 = Silver
--
-- Damage repaired here (idempotent, safe on both envs):
--   1. Flags marked the REAL Audi 2 classes inactive → re-activate.
--   2. A manual run of the old catalog deliverable (staging only) left
--      config Audi 2 assigned to stale-ID classes → reset assignments to
--      the real current layout. (The corrected backfill catalog that runs
--      after this replaces it with the full era-tagged list.)
--   3. Same manual run left historical price cards in config keyed by the
--      stale IDs → rename those price keys in place.
-- ============================================================================

-- 1) Normalized: re-activate the real Audi 2 layout
do $$
begin
  if to_regclass('public.screen_classes') is null then
    return;
  end if;
  update public.screen_classes
     set active = true
   where screen_id = 'oxnv3cw'
     and class_id in ('1u1lpa4', 'lp9hi7s', 'bsl9hd8');
end $$;

-- 2 + 3) Config JSONB: reset Audi 2 assignments; fix stale price-card keys
do $$
declare
  d jsonb;
  scr jsonb;
  screens jsonb := '[]'::jsonb;
begin
  if to_regclass('public.config') is null then
    return;
  end if;
  select data into d from public.config where id = 1;
  if d is null then
    return;
  end if;
  for scr in select * from jsonb_array_elements(coalesce(d->'screens', '[]'::jsonb)) loop
    -- reset Audi 2 class assignments to the real current layout
    if scr->>'id' = 'oxnv3cw' then
      scr := jsonb_set(scr, '{classes}',
        '[{"classId": "1u1lpa4", "seats": 90}, {"classId": "lp9hi7s", "seats": 180}, {"classId": "bsl9hd8", "seats": 20}]'::jsonb);
    end if;
    -- rename stale class-id keys inside every price card's prices object
    scr := jsonb_set(scr, '{priceCards}', (
      select coalesce(jsonb_agg(
        jsonb_set(card, '{prices}', (
          select coalesce(jsonb_object_agg(
            case e.key
              when 'xxa50jt' then '1u1lpa4'
              when '1hliv5d' then 'lp9hi7s'
              when 'tlju8sn' then 'bsl9hd8'
              else e.key
            end, e.value), '{}'::jsonb)
          from jsonb_each(coalesce(card->'prices', '{}'::jsonb)) e
        ))), '[]'::jsonb)
      from jsonb_array_elements(coalesce(scr->'priceCards', '[]'::jsonb)) card));
    screens := screens || jsonb_build_array(scr);
  end loop;
  d := jsonb_set(d, '{screens}', screens);
  update public.config
  set data = d,
      updated_by = 'mig-audi2-id-repair',
      updated_at = now()
  where id = 1;
end $$;
