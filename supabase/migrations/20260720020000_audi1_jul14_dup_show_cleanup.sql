-- =============================================================================
-- 2026-07-20  Audi 1 / 2026-07-14: drop the duplicate 14:00 show.
--
-- The day's programme was replaced after entry (pre-showtime-fallback build),
-- orphaning the original shows' scheduleId links; the 14:00 slot was then
-- re-entered against the new programme, leaving TWO 14:00 shows in the entry
-- (DCR counted 5 shows / Entry page rendered 4). Owner-confirmed keeper:
-- the re-entered show (scheduleId gc4xlly, PP 30 / Prime 9 / Lounge 21).
-- Deletes exactly the stale one (scheduleId izvtidd); idempotent, guarded.
-- =============================================================================

do $$
declare
  n_before int;
  n_after  int;
begin
  select jsonb_array_length(shows) into n_before
  from public.entries
  where screen_id = '7gwkvh9' and entry_date = date '2026-07-14'
    and movie_id = 'gsrnmps';

  if n_before is null then
    raise notice 'entry not found in this environment - nothing to do';
    return;
  end if;

  update public.entries e
  set shows = (
        select jsonb_agg(sh order by ord)
        from jsonb_array_elements(e.shows) with ordinality t(sh, ord)
        where sh->>'scheduleId' is distinct from 'izvtidd'
      ),
      updated_by = 'jul14-dup-show-cleanup',
      updated_at = now()
  where e.screen_id = '7gwkvh9' and e.entry_date = date '2026-07-14'
    and e.movie_id = 'gsrnmps'
    and exists (
      select 1 from jsonb_array_elements(e.shows) s
      where s->>'scheduleId' = 'izvtidd'
    );

  select jsonb_array_length(shows) into n_after
  from public.entries
  where screen_id = '7gwkvh9' and entry_date = date '2026-07-14'
    and movie_id = 'gsrnmps';

  raise notice 'shows: % -> %', n_before, n_after;

  -- Guard: exactly one 14:00 show must remain, linked to the live row.
  if (select count(*) from public.entries,
        jsonb_array_elements(shows) s
      where screen_id = '7gwkvh9' and entry_date = date '2026-07-14'
        and movie_id = 'gsrnmps' and s->>'showtime' = '14:00') <> 1 then
    raise exception 'cleanup left <> 1 show at 14:00 - aborting';
  end if;
end $$;
