-- ============================================================================
-- 04 — Audit triggers + realtime_version
--
-- One generic trigger function (audit_row_change) writes a row to audit_log
-- for every INSERT / UPDATE / DELETE on attached tables.
--
-- A second generic function (bump_realtime_version) advances the catalog or
-- operational version sidecar, giving the client one notification channel
-- per logical layer instead of one per table.
--
-- Idempotent. Re-running drops + recreates triggers cleanly.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) audit_row_change()
--
-- Resolves cinema_id heuristically:
--   - If the row has a cinema_id column, use it.
--   - Else look for a screen_id column and resolve through screens.
--   - Else look for a movie_id column and resolve through movies.
--   - Else null (e.g., brands, realtime_version — not cinema-scoped).
--
-- Stores a `diff` jsonb that contains only the keys whose values changed
-- on UPDATE — easier to grep than the full before/after blobs.
-- ----------------------------------------------------------------------------

create or replace function public.audit_row_change()
  returns trigger
  language plpgsql
  security definer set search_path = public
as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_diff   jsonb;
  v_cinema uuid;
  v_row_id text;
begin
  -- Build before/after JSONB
  if tg_op = 'DELETE' then
    v_before := to_jsonb(old);
    v_after  := null;
  elsif tg_op = 'INSERT' then
    v_before := null;
    v_after  := to_jsonb(new);
  else  -- UPDATE
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
  end if;

  -- Diff: keys whose value changed (only set for UPDATE)
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(k, jsonb_build_object('before', v_before->k, 'after', v_after->k))
      into v_diff
    from jsonb_object_keys(v_after) k
    where (v_before->k) is distinct from (v_after->k);
  end if;

  -- Resolve cinema_id
  -- Try direct column first.
  begin
    if v_after is not null and v_after ? 'cinema_id' and (v_after->>'cinema_id') is not null then
      v_cinema := (v_after->>'cinema_id')::uuid;
    elsif v_before is not null and v_before ? 'cinema_id' and (v_before->>'cinema_id') is not null then
      v_cinema := (v_before->>'cinema_id')::uuid;
    -- Via screen_id (screen_classes, price_cards, serial_starts, openings, …)
    -- screen_id is text now (legacy IDs like "scr_screen1"), so no ::uuid cast.
    elsif v_after is not null and v_after ? 'screen_id' then
      select cinema_id into v_cinema from public.screens where id = (v_after->>'screen_id');
    elsif v_before is not null and v_before ? 'screen_id' then
      select cinema_id into v_cinema from public.screens where id = (v_before->>'screen_id');
    -- Via movie_id (openings has both; fallback if screen wasn't resolved)
    elsif v_after is not null and v_after ? 'movie_id' then
      select cinema_id into v_cinema from public.movies where id = (v_after->>'movie_id');
    elsif v_before is not null and v_before ? 'movie_id' then
      select cinema_id into v_cinema from public.movies where id = (v_before->>'movie_id');
    else
      v_cinema := null;
    end if;
  exception when others then
    v_cinema := null;
  end;

  -- Build a stable row_id. Most tables have a uuid `id`; M:N join tables
  -- (screen_classes, price_card_prices, serial_start_classes) have composite
  -- PKs — we serialize a deterministic key.
  v_row_id := coalesce(
    (v_after  -> 'id')::text,
    (v_before -> 'id')::text,
    -- Composite-key tables: concatenate known PK columns
    coalesce(v_after->>'screen_id', v_before->>'screen_id', '')
      || ':' || coalesce(v_after->>'class_id', v_before->>'class_id', '')
      || coalesce(v_after->>'price_card_id', v_before->>'price_card_id', '')
      || coalesce(v_after->>'serial_start_id', v_before->>'serial_start_id', '')
  );

  insert into public.audit_log (
    actor_email, actor_role, cinema_id, table_name, row_id, action,
    before_val, after_val, diff
  ) values (
    public.caller_email(),
    public.caller_role(),
    v_cinema,
    tg_table_name,
    v_row_id,
    lower(tg_op),
    v_before,
    v_after,
    v_diff
  );

  return coalesce(new, old);
end;
$$;


-- ----------------------------------------------------------------------------
-- 2) bump_realtime_version()
--
-- Attached to catalog tables (catalog layer) and entries/fb_entries
-- (operational layer). Each fire bumps the relevant row in
-- realtime_version, which the client subscribes to via postgres_changes.
-- ----------------------------------------------------------------------------

create or replace function public.bump_realtime_version()
  returns trigger
  language plpgsql
as $$
begin
  update public.realtime_version
     set version = version + 1, updated_at = now()
   where layer = tg_argv[0];
  return coalesce(new, old);
end;
$$;


-- ----------------------------------------------------------------------------
-- 3) Attach triggers
--
-- Drop + recreate so this file stays idempotent.
-- ----------------------------------------------------------------------------

-- Helper macro: drop and create both triggers for a given table+layer.
-- (Plain SQL since DDL is per-statement.)

-- brands — non-cinema-scoped catalog
drop trigger if exists trg_audit_brands         on public.brands;
drop trigger if exists trg_rt_brands            on public.brands;
create trigger trg_audit_brands after insert or update or delete on public.brands
  for each row execute function public.audit_row_change();
create trigger trg_rt_brands after insert or update or delete on public.brands
  for each statement execute function public.bump_realtime_version('catalog');

-- cinemas
drop trigger if exists trg_audit_cinemas on public.cinemas;
drop trigger if exists trg_rt_cinemas    on public.cinemas;
create trigger trg_audit_cinemas after insert or update or delete on public.cinemas
  for each row execute function public.audit_row_change();
create trigger trg_rt_cinemas after insert or update or delete on public.cinemas
  for each statement execute function public.bump_realtime_version('catalog');

-- tax_configs
drop trigger if exists trg_audit_tax_configs on public.tax_configs;
drop trigger if exists trg_rt_tax_configs    on public.tax_configs;
create trigger trg_audit_tax_configs after insert or update or delete on public.tax_configs
  for each row execute function public.audit_row_change();
create trigger trg_rt_tax_configs after insert or update or delete on public.tax_configs
  for each statement execute function public.bump_realtime_version('catalog');

-- classes
drop trigger if exists trg_audit_classes on public.classes;
drop trigger if exists trg_rt_classes    on public.classes;
create trigger trg_audit_classes after insert or update or delete on public.classes
  for each row execute function public.audit_row_change();
create trigger trg_rt_classes after insert or update or delete on public.classes
  for each statement execute function public.bump_realtime_version('catalog');

-- screens
drop trigger if exists trg_audit_screens on public.screens;
drop trigger if exists trg_rt_screens    on public.screens;
create trigger trg_audit_screens after insert or update or delete on public.screens
  for each row execute function public.audit_row_change();
create trigger trg_rt_screens after insert or update or delete on public.screens
  for each statement execute function public.bump_realtime_version('catalog');

-- screen_classes
drop trigger if exists trg_audit_screen_classes on public.screen_classes;
drop trigger if exists trg_rt_screen_classes    on public.screen_classes;
create trigger trg_audit_screen_classes after insert or update or delete on public.screen_classes
  for each row execute function public.audit_row_change();
create trigger trg_rt_screen_classes after insert or update or delete on public.screen_classes
  for each statement execute function public.bump_realtime_version('catalog');

-- price_cards
drop trigger if exists trg_audit_price_cards on public.price_cards;
drop trigger if exists trg_rt_price_cards    on public.price_cards;
create trigger trg_audit_price_cards after insert or update or delete on public.price_cards
  for each row execute function public.audit_row_change();
create trigger trg_rt_price_cards after insert or update or delete on public.price_cards
  for each statement execute function public.bump_realtime_version('catalog');

-- price_card_prices
drop trigger if exists trg_audit_price_card_prices on public.price_card_prices;
drop trigger if exists trg_rt_price_card_prices    on public.price_card_prices;
create trigger trg_audit_price_card_prices after insert or update or delete on public.price_card_prices
  for each row execute function public.audit_row_change();
create trigger trg_rt_price_card_prices after insert or update or delete on public.price_card_prices
  for each statement execute function public.bump_realtime_version('catalog');

-- movies
drop trigger if exists trg_audit_movies on public.movies;
drop trigger if exists trg_rt_movies    on public.movies;
create trigger trg_audit_movies after insert or update or delete on public.movies
  for each row execute function public.audit_row_change();
create trigger trg_rt_movies after insert or update or delete on public.movies
  for each statement execute function public.bump_realtime_version('catalog');

-- serial_starts
drop trigger if exists trg_audit_serial_starts on public.serial_starts;
drop trigger if exists trg_rt_serial_starts    on public.serial_starts;
create trigger trg_audit_serial_starts after insert or update or delete on public.serial_starts
  for each row execute function public.audit_row_change();
create trigger trg_rt_serial_starts after insert or update or delete on public.serial_starts
  for each statement execute function public.bump_realtime_version('catalog');

-- serial_start_classes
drop trigger if exists trg_audit_serial_start_classes on public.serial_start_classes;
drop trigger if exists trg_rt_serial_start_classes    on public.serial_start_classes;
create trigger trg_audit_serial_start_classes after insert or update or delete on public.serial_start_classes
  for each row execute function public.audit_row_change();
create trigger trg_rt_serial_start_classes after insert or update or delete on public.serial_start_classes
  for each statement execute function public.bump_realtime_version('catalog');

-- openings
drop trigger if exists trg_audit_openings on public.openings;
drop trigger if exists trg_rt_openings    on public.openings;
create trigger trg_audit_openings after insert or update or delete on public.openings
  for each row execute function public.audit_row_change();
create trigger trg_rt_openings after insert or update or delete on public.openings
  for each statement execute function public.bump_realtime_version('catalog');

-- entries — operational layer
drop trigger if exists trg_audit_entries on public.entries;
drop trigger if exists trg_rt_entries    on public.entries;
create trigger trg_audit_entries after insert or update or delete on public.entries
  for each row execute function public.audit_row_change();
create trigger trg_rt_entries after insert or update or delete on public.entries
  for each statement execute function public.bump_realtime_version('operational');

-- fb_entries — operational layer
drop trigger if exists trg_audit_fb_entries on public.fb_entries;
drop trigger if exists trg_rt_fb_entries    on public.fb_entries;
create trigger trg_audit_fb_entries after insert or update or delete on public.fb_entries
  for each row execute function public.audit_row_change();
create trigger trg_rt_fb_entries after insert or update or delete on public.fb_entries
  for each statement execute function public.bump_realtime_version('operational');

-- fb_products — catalog layer
drop trigger if exists trg_audit_fb_products on public.fb_products;
drop trigger if exists trg_rt_fb_products    on public.fb_products;
create trigger trg_audit_fb_products after insert or update or delete on public.fb_products
  for each row execute function public.audit_row_change();
create trigger trg_rt_fb_products after insert or update or delete on public.fb_products
  for each statement execute function public.bump_realtime_version('catalog');

-- authorized_users — administrative, audit only (no realtime bump needed)
drop trigger if exists trg_audit_authorized_users on public.authorized_users;
create trigger trg_audit_authorized_users after insert or update or delete on public.authorized_users
  for each row execute function public.audit_row_change();


commit;
