-- ============================================================================
-- 07 — Verification queries
--
-- No writes — only SELECTs. Run after 06 to confirm the backfill
-- populated everything correctly. Each section returns a single row
-- with a 'check' column you can scan for "OK" or a discrepancy count.
--
-- Run in Supabase SQL Editor; results appear inline.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Top-level sanity: one cinema, one tax_config, brands populated
-- ----------------------------------------------------------------------------

select
  (select count(*) from public.brands)            as brands,
  (select count(*) from public.cinemas)           as cinemas,
  (select count(*) from public.tax_configs)       as tax_configs;


-- ----------------------------------------------------------------------------
-- 2) Catalog count parity vs config.data.*
-- ----------------------------------------------------------------------------

with cfg as (select data as d from public.config where id = 1)
select
  jsonb_array_length(d->'movies')        as cfg_movies,
  (select count(*) from public.movies)   as db_movies,
  case when jsonb_array_length(d->'movies') = (select count(*) from public.movies)
       then 'OK' else 'MISMATCH' end     as movies_check,

  jsonb_array_length(d->'screens')       as cfg_screens,
  (select count(*) from public.screens)  as db_screens,
  case when jsonb_array_length(d->'screens') = (select count(*) from public.screens)
       then 'OK' else 'MISMATCH' end     as screens_check,

  jsonb_array_length(d->'classes')       as cfg_classes,
  (select count(*) from public.classes)  as db_classes,
  case when jsonb_array_length(d->'classes') = (select count(*) from public.classes)
       then 'OK' else 'MISMATCH' end     as classes_check,

  jsonb_array_length(d->'serialStarts')              as cfg_serial_starts,
  (select count(*) from public.serial_starts)        as db_serial_starts,
  case when jsonb_array_length(d->'serialStarts') = (select count(*) from public.serial_starts)
       then 'OK' else 'MISMATCH' end                 as serial_starts_check,

  jsonb_array_length(d->'openings')              as cfg_openings,
  (select count(*) from public.openings)         as db_openings,
  case when jsonb_array_length(d->'openings') = (select count(*) from public.openings)
       then 'OK' else 'MISMATCH' end             as openings_check
from cfg;


-- ----------------------------------------------------------------------------
-- 3) No null cinema_id on operational + product rows
-- ----------------------------------------------------------------------------

select
  (select count(*) from public.entries     where cinema_id is null) as entries_null_cinema,
  (select count(*) from public.fb_entries  where cinema_id is null) as fb_entries_null_cinema,
  (select count(*) from public.fb_products where cinema_id is null) as fb_products_null_cinema,
  case when (select count(*) from public.entries     where cinema_id is null) = 0
        and (select count(*) from public.fb_entries  where cinema_id is null) = 0
        and (select count(*) from public.fb_products where cinema_id is null) = 0
       then 'OK' else 'MISSING' end as null_check;


-- ----------------------------------------------------------------------------
-- 4) FK integrity — every entry's movie_id and screen_id resolve
-- ----------------------------------------------------------------------------

select
  (select count(*) from public.entries e
     where not exists (select 1 from public.movies m where m.id = e.movie_id))
   as orphan_movie_refs,
  (select count(*) from public.entries e
     where not exists (select 1 from public.screens s where s.id = e.screen_id))
   as orphan_screen_refs,
  case when (select count(*) from public.entries e
                where not exists (select 1 from public.movies m where m.id = e.movie_id)) = 0
        and (select count(*) from public.entries e
                where not exists (select 1 from public.screens s where s.id = e.screen_id)) = 0
       then 'OK' else 'BROKEN' end as fk_check;


-- ----------------------------------------------------------------------------
-- 5) cinema_id consistency — entries.cinema_id == movies.cinema_id == screens.cinema_id
-- ----------------------------------------------------------------------------

select count(*) as entries_with_mismatched_cinema
from public.entries e
join public.movies  m on m.id = e.movie_id
join public.screens s on s.id = e.screen_id
where e.cinema_id <> m.cinema_id
   or e.cinema_id <> s.cinema_id;


-- ----------------------------------------------------------------------------
-- 6) authorized_users — everyone has at least one cinema
-- ----------------------------------------------------------------------------

select count(*) as users_without_cinema
from public.authorized_users
where cardinality(cinema_ids) = 0;


-- ----------------------------------------------------------------------------
-- 7) Audit log — confirm triggers are firing (should grow with each edit)
-- ----------------------------------------------------------------------------

select count(*) as audit_log_rows,
       min(occurred_at) as first_audit,
       max(occurred_at) as last_audit
from public.audit_log;


-- ----------------------------------------------------------------------------
-- 8) Realtime version — sidecar exists and has both layers
-- ----------------------------------------------------------------------------

select layer, version, updated_at from public.realtime_version order by layer;


-- ----------------------------------------------------------------------------
-- 9) Per-cinema catalog summary (useful sanity glance)
-- ----------------------------------------------------------------------------

select
  c.brand_name || ': ' || c.location               as cinema,
  (select count(*) from public.movies   where cinema_id = c.id) as movies,
  (select count(*) from public.screens  where cinema_id = c.id) as screens,
  (select count(*) from public.classes  where cinema_id = c.id) as classes,
  (select count(*) from public.fb_products where cinema_id = c.id) as fb_products,
  (select count(*) from public.entries    where cinema_id = c.id) as bo_entries,
  (select count(*) from public.fb_entries where cinema_id = c.id) as fb_days
from public.cinemas c
order by cinema;
