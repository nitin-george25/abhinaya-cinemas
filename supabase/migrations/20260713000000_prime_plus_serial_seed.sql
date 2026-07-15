-- =============================================================================
-- 2026-07-13  Seed ticket-serial start for the new "Prime Plus" class (Audi 1).
--
-- Symptom: Prime Plus rows show blank serial ranges. computeSerials only rolls
-- a counter for a class once a SerialStart record covers it on that screen;
-- the Audi 1 record (e4ujqqp, 2026-04-30) predates Prime Plus, and nothing
-- seeds a start when a class is added in Settings (fixed in app code alongside
-- this migration).
--
-- Fix: append a SerialStart {starts: {<prime-plus-id>: 1}} for Audi 1 to
-- config.data->serialStarts (the authoritative read path), dated the day the
-- class was created, and mirror it into serial_starts/serial_start_classes.
-- Fully idempotent; aborts with a clear error if Prime Plus can't be found.
-- =============================================================================

do $$
declare
  cid   text;
  ssid  text;
  added date;
  ss    jsonb;
begin
  -- Prime Plus class id, from the authoritative config blob.
  select c->>'id' into cid
  from public.config, jsonb_array_elements(data->'classes') c
  where id = 1 and lower(trim(c->>'name')) = 'prime plus';

  if cid is null then
    raise exception 'Prime Plus class not found in config.data->classes';
  end if;

  -- Already covered by some Audi 1 serial start? Then nothing to do.
  select data->'serialStarts' into ss from public.config where id = 1;
  if exists (
    select 1 from jsonb_array_elements(coalesce(ss, '[]'::jsonb)) s
    where s->>'screenId' = '7gwkvh9' and (s->'starts') ? cid
  ) then
    raise notice 'Prime Plus serial start already present for Audi 1 - skipping';
    return;
  end if;

  -- Effective date: when the class was created (normalized mirror keeps
  -- created_at from the Settings insert); fall back to today.
  select coalesce(min(created_at)::date, current_date) into added
  from public.classes where id = cid;

  -- 1) Normalized mirror first, so the blob reuses the SAME id. Unique
  --    (screen_id, start_date): if a row for Audi 1 on that date already
  --    exists, attach the class to it instead of violating the constraint.
  insert into public.serial_starts (id, screen_id, start_date, updated_by)
  values ('ppa1ss1', '7gwkvh9', added, 'prime-plus-serial-seed')
  on conflict (screen_id, start_date) do nothing;

  select id into ssid from public.serial_starts
  where screen_id = '7gwkvh9' and start_date = added;

  insert into public.serial_start_classes (serial_start_id, class_id, starting_number)
  values (ssid, cid, 1)
  on conflict (serial_start_id, class_id) do nothing;

  -- 2) Authoritative blob (what the app actually reads).
  update public.config
  set data = jsonb_set(
        data, '{serialStarts}',
        coalesce(ss, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'id',       ssid,
          'screenId', '7gwkvh9',
          'date',     to_char(added, 'YYYY-MM-DD'),
          'starts',   jsonb_build_object(cid, 1)
        ))
      ),
      updated_by = 'prime-plus-serial-seed',
      updated_at = now()
  where id = 1;

  -- Guard: the blob must now cover Prime Plus for Audi 1.
  if not exists (
    select 1
    from public.config, jsonb_array_elements(data->'serialStarts') s
    where id = 1 and s->>'screenId' = '7gwkvh9' and (s->'starts') ? cid
  ) then
    raise exception 'seed did not apply to config.data->serialStarts';
  end if;
end $$;
