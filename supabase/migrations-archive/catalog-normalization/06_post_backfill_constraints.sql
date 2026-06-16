-- ============================================================================
-- 06 — Post-backfill constraints
--
-- Now that data is in place:
--   • entries.cinema_id, fb_entries.cinema_id, fb_products.cinema_id → NOT NULL
--   • entries.movie_id, entries.screen_id → FK to movies/screens (RESTRICT)
--   • entries.cinema_id → consistency check vs the row's movie/screen cinema
--   • tax_configs → EXCLUDE constraint preventing overlapping validity ranges
--   • fb_entries → swap the (entry_date) unique for (cinema_id, entry_date)
--   • fb_products → swap (name) unique for (cinema_id, name)
--
-- Skip this file if 05 reported errors. The constraints will fail to apply
-- against partially-populated data.
--
-- Idempotent. Re-running is a no-op.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Required: cinema_id is set on every row in entries / fb_entries / fb_products
-- ----------------------------------------------------------------------------

alter table public.entries     alter column cinema_id set not null;
alter table public.fb_entries  alter column cinema_id set not null;
alter table public.fb_products alter column cinema_id set not null;


-- ----------------------------------------------------------------------------
-- 2) FKs on entries.movie_id and entries.screen_id
--
-- Skip if they already exist (Postgres won't let you create duplicates).
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'entries_movie_id_fkey'
  ) then
    alter table public.entries
      add constraint entries_movie_id_fkey
      foreign key (movie_id) references public.movies(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'entries_screen_id_fkey'
  ) then
    alter table public.entries
      add constraint entries_screen_id_fkey
      foreign key (screen_id) references public.screens(id) on delete restrict;
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 3) Consistency checks: entries.cinema_id matches the cinema of its
--    referenced movie + screen.
--
-- Implemented as plain CHECK constraints via subqueries — Postgres doesn't
-- support cross-row CHECKs natively but we wrap as a trigger.
-- ----------------------------------------------------------------------------

create or replace function public.entries_cinema_consistency()
  returns trigger
  language plpgsql
as $$
declare
  v_movie_cinema  uuid;
  v_screen_cinema uuid;
begin
  select cinema_id into v_movie_cinema  from public.movies  where id = new.movie_id;
  select cinema_id into v_screen_cinema from public.screens where id = new.screen_id;

  if v_movie_cinema is null then
    raise exception 'movie % not found', new.movie_id;
  end if;
  if v_screen_cinema is null then
    raise exception 'screen % not found', new.screen_id;
  end if;
  if new.cinema_id is distinct from v_movie_cinema then
    raise exception 'cinema_id % does not match movie cinema %', new.cinema_id, v_movie_cinema;
  end if;
  if new.cinema_id is distinct from v_screen_cinema then
    raise exception 'cinema_id % does not match screen cinema %', new.cinema_id, v_screen_cinema;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_entries_cinema_consistency on public.entries;
create trigger trg_entries_cinema_consistency
  before insert or update of cinema_id, movie_id, screen_id
  on public.entries
  for each row execute function public.entries_cinema_consistency();


-- ----------------------------------------------------------------------------
-- 4) tax_configs — EXCLUDE constraint on overlapping (cinema_id, daterange)
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tax_configs_no_overlap'
  ) then
    alter table public.tax_configs
      add constraint tax_configs_no_overlap
      exclude using gist (
        cinema_id with =,
        daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[]') with &&
      );
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 5) fb_entries — swap unique on (entry_date) for (cinema_id, entry_date)
-- ----------------------------------------------------------------------------

alter table public.fb_entries
  drop constraint if exists fb_entries_entry_date_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fb_entries_cinema_date_uk'
  ) then
    alter table public.fb_entries
      add constraint fb_entries_cinema_date_uk unique (cinema_id, entry_date);
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 6) fb_products — swap unique on (name) for (cinema_id, name)
-- ----------------------------------------------------------------------------

alter table public.fb_products
  drop constraint if exists fb_products_name_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fb_products_cinema_name_uk'
  ) then
    alter table public.fb_products
      add constraint fb_products_cinema_name_uk unique (cinema_id, name);
  end if;
end $$;


commit;
