-- ============================================================================
-- 05 — Backfill from public.config.data
--
-- Reads the singleton public.config row (id=1) and populates the new tables.
-- Preserves UUIDs from the JSON wherever they exist so existing references
-- (e.g., entries.movie_id) continue to resolve cleanly.
--
-- After this file runs:
--   • One row in brands  (Abhinaya Cinemas).
--   • One row in cinemas (Changanacherry).
--   • All movies / screens / classes / price_cards / serial_starts / openings
--     populated with their original UUIDs.
--   • entries.cinema_id, fb_entries.cinema_id, fb_products.cinema_id set.
--   • authorized_users.cinema_ids = [the cinema's id].
--   • One tax_configs row valid from 2000-01-01 to indefinite (the current
--     legacy rate).
--
-- Idempotent — re-running is a no-op (uses ON CONFLICT DO NOTHING).
--
-- Adjust the CINEMA_LOCATION value below if your cinema's location is
-- something other than "Changanacherry".
-- ============================================================================

begin;

do $$
declare
  v_brand_id     uuid;
  v_cinema_id    uuid;
  v_cfg          jsonb;
  v_cinema_cfg   jsonb;
  v_tax_cfg      jsonb;

  -- HARDCODED LOCATION — change for other cinemas before running.
  c_brand_name   text := 'Abhinaya Cinemas';
  c_location     text := 'Changanacherry';
begin

  ----------------------------------------------------------------------------
  -- Read the config blob once
  ----------------------------------------------------------------------------
  select data into v_cfg from public.config where id = 1;
  if v_cfg is null then
    raise notice 'No public.config row found (id=1). Skipping backfill.';
    return;
  end if;
  v_cinema_cfg := coalesce(v_cfg -> 'cinema', '{}'::jsonb);
  v_tax_cfg    := coalesce(v_cfg -> 'tax',    '{}'::jsonb);

  ----------------------------------------------------------------------------
  -- 1) brands — one row
  ----------------------------------------------------------------------------
  insert into public.brands (name)
  values (c_brand_name)
  on conflict (name) do nothing;

  select id into v_brand_id from public.brands where name = c_brand_name;

  ----------------------------------------------------------------------------
  -- 2) cinemas — one row
  ----------------------------------------------------------------------------
  insert into public.cinemas (
    brand_id, brand_name, location, gstin,
    updated_by
  ) values (
    v_brand_id,
    c_brand_name,
    c_location,
    coalesce(v_cinema_cfg ->> 'gstin', null),
    'historical-import'
  )
  on conflict (brand_name, location) do nothing;

  select id into v_cinema_id from public.cinemas
   where brand_name = c_brand_name and location = c_location;

  raise notice 'Cinema id resolved: %', v_cinema_id;

  ----------------------------------------------------------------------------
  -- 3) tax_configs — one row, indefinitely valid
  ----------------------------------------------------------------------------
  insert into public.tax_configs (
    cinema_id, valid_from, valid_to,
    threshold,
    above_etax_pct, above_gst_pct,
    below_etax_pct, below_gst_pct,
    tmc, cess,
    rep_day, rep_night, rep_1, rep_2, rep_5,
    updated_by
  ) select
    v_cinema_id,
    '2000-01-01'::date,                                    -- effective from epoch-ish
    null,                                                  -- still in effect
    coalesce((v_tax_cfg ->> 'threshold')::numeric, 0),
    coalesce((v_tax_cfg -> 'above' ->> 'etaxPct')::numeric, 0),
    coalesce((v_tax_cfg -> 'above' ->> 'gstPct')::numeric, 0),
    coalesce((v_tax_cfg -> 'below' ->> 'etaxPct')::numeric, 0),
    coalesce((v_tax_cfg -> 'below' ->> 'gstPct')::numeric, 0),
    coalesce((v_tax_cfg ->> 'tmc')::numeric, 0),
    coalesce((v_tax_cfg ->> 'cess')::numeric, 0),
    coalesce((v_tax_cfg ->> 'repDay')::numeric, 0),
    coalesce((v_tax_cfg ->> 'repNight')::numeric, 0),
    coalesce((v_tax_cfg ->> 'rep1')::numeric, 0),
    coalesce((v_tax_cfg ->> 'rep2')::numeric, 0),
    coalesce((v_tax_cfg ->> 'rep5')::numeric, 0),
    'historical-import'
  where not exists (
    select 1 from public.tax_configs
    where cinema_id = v_cinema_id and valid_from = '2000-01-01'::date
  );

  ----------------------------------------------------------------------------
  -- 4) classes — preserve original UUIDs from config.data.classes
  ----------------------------------------------------------------------------
  insert into public.classes (id, cinema_id, name, gst_pct, updated_by)
  select
    c ->> 'id',
    v_cinema_id,
    c ->> 'name',
    coalesce((c ->> 'gstPct')::numeric, 0),
    'historical-import'
  from jsonb_array_elements(coalesce(v_cfg -> 'classes', '[]'::jsonb)) c
  on conflict (id) do nothing;

  ----------------------------------------------------------------------------
  -- 5) screens — preserve UUIDs
  ----------------------------------------------------------------------------
  insert into public.screens (id, cinema_id, name, updated_by)
  select
    s ->> 'id',
    v_cinema_id,
    s ->> 'name',
    'historical-import'
  from jsonb_array_elements(coalesce(v_cfg -> 'screens', '[]'::jsonb)) s
  on conflict (id) do nothing;

  ----------------------------------------------------------------------------
  -- 6) screen_classes — from screens[].classes
  ----------------------------------------------------------------------------
  insert into public.screen_classes (screen_id, class_id, seats)
  select
    s ->> 'id',
    sc ->> 'classId',
    coalesce((sc ->> 'seats')::int, 0)
  from jsonb_array_elements(coalesce(v_cfg -> 'screens', '[]'::jsonb)) s,
       jsonb_array_elements(coalesce(s -> 'classes', '[]'::jsonb)) sc
  on conflict (screen_id, class_id) do nothing;

  ----------------------------------------------------------------------------
  -- 7) price_cards — preserve UUIDs (referenced by entries.shows[].priceCardId)
  ----------------------------------------------------------------------------
  insert into public.price_cards (id, screen_id, name, updated_by)
  select
    pc ->> 'id',
    s ->> 'id',
    pc ->> 'name',
    'historical-import'
  from jsonb_array_elements(coalesce(v_cfg -> 'screens', '[]'::jsonb)) s,
       jsonb_array_elements(coalesce(s -> 'priceCards', '[]'::jsonb)) pc
  on conflict (id) do nothing;

  ----------------------------------------------------------------------------
  -- 8) price_card_prices — pivot {classId -> price}
  ----------------------------------------------------------------------------
  insert into public.price_card_prices (price_card_id, class_id, price)
  select
    pc ->> 'id',
    pp.key,
    pp.value::text::numeric
  from jsonb_array_elements(coalesce(v_cfg -> 'screens', '[]'::jsonb)) s,
       jsonb_array_elements(coalesce(s -> 'priceCards', '[]'::jsonb)) pc,
       jsonb_each(coalesce(pc -> 'prices', '{}'::jsonb)) pp
  on conflict (price_card_id, class_id) do nothing;

  ----------------------------------------------------------------------------
  -- 9) movies — preserve UUIDs (entries.movie_id references)
  ----------------------------------------------------------------------------
  insert into public.movies (
    id, cinema_id, name, distributor, release_date, share_pct, updated_by
  )
  select
    m ->> 'id',
    v_cinema_id,
    m ->> 'name',
    m ->> 'distributor',
    case when (m ->> 'release') ~ '^\d{4}-\d{2}-\d{2}$'
         then (m ->> 'release')::date
         else null end,
    coalesce((m ->> 'share')::numeric, 0),
    'historical-import'
  from jsonb_array_elements(coalesce(v_cfg -> 'movies', '[]'::jsonb)) m
  on conflict (id) do nothing;

  ----------------------------------------------------------------------------
  -- 10) serial_starts + serial_start_classes
  ----------------------------------------------------------------------------
  insert into public.serial_starts (id, screen_id, start_date, updated_by)
  select
    ss ->> 'id',
    ss ->> 'screenId',
    (ss ->> 'date')::date,
    'historical-import'
  from jsonb_array_elements(coalesce(v_cfg -> 'serialStarts', '[]'::jsonb)) ss
  where (ss ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$'
  on conflict (id) do nothing;

  insert into public.serial_start_classes (serial_start_id, class_id, starting_number)
  select
    ss ->> 'id',
    sk.key,
    (sk.value::text)::int
  from jsonb_array_elements(coalesce(v_cfg -> 'serialStarts', '[]'::jsonb)) ss,
       jsonb_each(coalesce(ss -> 'starts', '{}'::jsonb)) sk
  on conflict (serial_start_id, class_id) do nothing;

  ----------------------------------------------------------------------------
  -- 11) openings — preserve UUIDs; vals stays as JSONB
  ----------------------------------------------------------------------------
  insert into public.openings (id, movie_id, screen_id, open_date, vals, updated_by)
  select
    o ->> 'id',
    o ->> 'movieId',
    o ->> 'screenId',
    (o ->> 'date')::date,
    coalesce(o -> 'vals', '{}'::jsonb),
    'historical-import'
  from jsonb_array_elements(coalesce(v_cfg -> 'openings', '[]'::jsonb)) o
  where (o ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$'
  on conflict (id) do nothing;

  ----------------------------------------------------------------------------
  -- 12) Set cinema_id on the existing entries / fb_entries / fb_products
  ----------------------------------------------------------------------------
  update public.entries
     set cinema_id = v_cinema_id
   where cinema_id is null;

  update public.fb_entries
     set cinema_id = v_cinema_id
   where cinema_id is null;

  update public.fb_products
     set cinema_id = v_cinema_id
   where cinema_id is null;

  ----------------------------------------------------------------------------
  -- 13) Grant every existing authorized user access to this cinema
  ----------------------------------------------------------------------------
  update public.authorized_users
     set cinema_ids = (
       select array_agg(distinct x)
       from unnest(cinema_ids || array[v_cinema_id]) x
     )
   where not (v_cinema_id = any(cinema_ids));

  raise notice 'Backfill complete for cinema: %', v_cinema_id;
end $$;

commit;
