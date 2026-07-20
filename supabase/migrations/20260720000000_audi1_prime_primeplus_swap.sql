-- =============================================================================
-- 2026-07-20  Audi 1: Prime ↔ Prime Plus corrections.
--
-- 1) SWAP — ticket counts for Prime and Prime Plus were entered interchanged
--    on 2026-07-09 .. 2026-07-13 (owner-confirmed). Swap the two class keys
--    inside entries.shows[].rows for Audi 1 (7gwkvh9) on those dates. Serial
--    ranges & money totals are DERIVED by the engine, so they self-correct on
--    next load; note Prime/Prime Plus serial ranges for entries AFTER Jul 13
--    will shift too (their cumulative predecessors changed) — that is the
--    point of the correction.
--
-- 2) ORDER — list Prime Plus BEFORE Prime everywhere (Entry page, DCR rows):
--    class display order follows config.data->classes array order, so move
--    the Prime Plus element to just before cls_prime; mirror to
--    classes.display_order.
--
-- 3) SERIAL-START COVER — the Prime Plus serial start (seed migration
--    20260713000000) is dated from the class's created_at; after the swap
--    Prime Plus has tickets from Jul 9, so pull the start back to 2026-07-09
--    if it is later, or the swapped rows would show blank serials.
--
-- Environment-safe: every step no-ops with a notice when Prime Plus doesn't
-- exist (staging). Swap is guarded by an updated_by marker so an accidental
-- re-run cannot un-swap.
-- =============================================================================

do $$
declare
  pp        text;
  n         int;
  prime_pos numeric;
begin
  -- ── Resolve the Prime Plus class id (blob first, then mirror) ──────────
  select c->>'id' into pp
  from public.config, jsonb_array_elements(data->'classes') c
  where id = 1
    and regexp_replace(lower(c->>'name'), '[^a-z0-9]', '', 'g') = 'primeplus'
  limit 1;

  if pp is null then
    select id into pp
    from public.classes
    where regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'primeplus'
      and archived_at is null
    limit 1;
  end if;

  if pp is null then
    raise notice 'Prime Plus class not found in this environment - nothing to do.';
    return;
  end if;

  -- ── 1) Swap cls_prime ↔ Prime Plus in shows[].rows, Jul 9-13, Audi 1 ──
  update public.entries e
  set shows = (
        select coalesce(jsonb_agg(
          case
            when sh ? 'rows' then jsonb_set(
              sh, '{rows}',
              ((sh->'rows') - 'cls_prime' - pp)
              || case when (sh->'rows') ? pp
                   then jsonb_build_object('cls_prime', (sh->'rows')->pp)
                   else '{}'::jsonb end
              || case when (sh->'rows') ? 'cls_prime'
                   then jsonb_build_object(pp, (sh->'rows')->'cls_prime')
                   else '{}'::jsonb end
            )
            else sh
          end
          order by ord), '[]'::jsonb)
        from jsonb_array_elements(e.shows) with ordinality t(sh, ord)
      ),
      updated_by = 'prime-primeplus-swap',
      updated_at = now()
  where e.screen_id = '7gwkvh9'
    and e.entry_date between date '2026-07-09' and date '2026-07-13'
    and e.updated_by is distinct from 'prime-primeplus-swap'   -- re-run guard
    and exists (
      select 1 from jsonb_array_elements(e.shows) s
      where (s->'rows') ? 'cls_prime' or (s->'rows') ? pp
    );
  get diagnostics n = row_count;
  raise notice 'swap: % Audi 1 entries updated (2026-07-09..13)', n;

  -- ── 2) Reorder catalog: Prime Plus immediately before Prime ───────────
  select ord into prime_pos
  from public.config, jsonb_array_elements(data->'classes') with ordinality t(c, ord)
  where id = 1 and c->>'id' = 'cls_prime';

  if prime_pos is not null then
    update public.config
    set data = jsonb_set(data, '{classes}', (
          select jsonb_agg(c order by k)
          from (
            select c,
                   case when c->>'id' = pp then prime_pos - 0.5 else ord end as k
            from public.config, jsonb_array_elements(data->'classes') with ordinality t(c, ord)
            where id = 1
          ) x
        )),
        updated_by = 'prime-primeplus-swap',
        updated_at = now()
    where id = 1;

    -- Mirror: sequential display_order following the (new) blob order.
    update public.classes cl
    set display_order = x.ord - 1
    from (
      select c->>'id' as cid, ord
      from public.config, jsonb_array_elements(data->'classes') with ordinality t(c, ord)
      where id = 1
    ) x
    where cl.id = x.cid and cl.display_order is distinct from (x.ord - 1);
    raise notice 'order: Prime Plus placed before Prime in config.data->classes';
  else
    raise notice 'order: cls_prime not in config.data->classes - skipped';
  end if;

  -- ── 3) Ensure the Prime Plus serial start covers Jul 9 ────────────────
  -- Blob: pull the pp-covering Audi 1 record's date back to 2026-07-09 if later.
  update public.config
  set data = jsonb_set(data, '{serialStarts}', (
        select jsonb_agg(
          case
            when s->>'screenId' = '7gwkvh9' and (s->'starts') ? pp
                 and (s->>'date') > '2026-07-09'
            then jsonb_set(s, '{date}', '"2026-07-09"')
            else s
          end)
        from jsonb_array_elements(data->'serialStarts') s
      )),
      updated_by = 'prime-primeplus-swap',
      updated_at = now()
  where id = 1
    and exists (
      select 1 from jsonb_array_elements(data->'serialStarts') s
      where s->>'screenId' = '7gwkvh9' and (s->'starts') ? pp
        and (s->>'date') > '2026-07-09'
    );
  get diagnostics n = row_count;

  -- Mirror follows (guarded against the (screen_id, start_date) unique key).
  if n > 0 then
    update public.serial_starts ss
    set start_date = date '2026-07-09', updated_by = 'prime-primeplus-swap'
    where ss.screen_id = '7gwkvh9'
      and ss.start_date > date '2026-07-09'
      and exists (select 1 from public.serial_start_classes sc
                  where sc.serial_start_id = ss.id and sc.class_id = pp)
      and not exists (select 1 from public.serial_starts s2
                      where s2.screen_id = '7gwkvh9'
                        and s2.start_date = date '2026-07-09');
    raise notice 'serial start: Prime Plus start pulled back to 2026-07-09';
  else
    raise notice 'serial start: already covers 2026-07-09 - unchanged';
  end if;
end $$;
