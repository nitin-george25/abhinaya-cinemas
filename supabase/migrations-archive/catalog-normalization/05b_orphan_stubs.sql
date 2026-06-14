-- ============================================================================
-- 05b — Create archived stubs for orphan movie / screen IDs in entries
--
-- The legacy catalog was edit-with-impunity — deleting a movie from
-- config.data.movies left orphan references in entries.movie_id intact.
-- The UI rendered them as "—" and moved on. The normalized schema's FK in
-- 06 (entries_movie_id_fkey, entries_screen_id_fkey) forbids this.
--
-- Fix: insert stub rows for every orphan id, marked archived_at = now() so
-- the UI hides them from new-entry forms but they still resolve in history.
-- Same treatment for orphan screen IDs.
--
-- Run AFTER 05 (which populates the live catalog) and BEFORE 06
-- (which adds the FKs).
--
-- Idempotent. Re-running picks up any newly-introduced orphans.
-- ============================================================================

begin;

do $$
declare
  v_cinema_id        uuid;
  v_orphan_movies    int;
  v_orphan_screens   int;
begin
  select id into v_cinema_id
    from public.cinemas
    where archived_at is null
    order by created_at
    limit 1;

  if v_cinema_id is null then
    raise notice 'No cinema row — run 05_backfill.sql first.';
    return;
  end if;

  -- ── Orphan movies ────────────────────────────────────────────────────
  with orphans as (
    select distinct e.movie_id
    from public.entries e
    where e.movie_id is not null
      and not exists (select 1 from public.movies m where m.id = e.movie_id)
  )
  insert into public.movies (id, cinema_id, name, archived_at, updated_by)
  select
    o.movie_id,
    v_cinema_id,
    'Unknown (' || o.movie_id || ')',
    now(),
    'orphan-stub'
  from orphans o
  on conflict (id) do nothing;

  get diagnostics v_orphan_movies = row_count;

  -- ── Orphan screens ───────────────────────────────────────────────────
  with orphans as (
    select distinct e.screen_id
    from public.entries e
    where e.screen_id is not null
      and not exists (select 1 from public.screens s where s.id = e.screen_id)
  )
  insert into public.screens (id, cinema_id, name, archived_at, updated_by)
  select
    o.screen_id,
    v_cinema_id,
    'Unknown (' || o.screen_id || ')',
    now(),
    'orphan-stub'
  from orphans o
  on conflict (id) do nothing;

  get diagnostics v_orphan_screens = row_count;

  raise notice 'Orphan stubs inserted: % movies, % screens',
    v_orphan_movies, v_orphan_screens;
end $$;

commit;

-- Verify (uncomment):
-- select count(*) as orphan_stub_movies   from public.movies  where updated_by = 'orphan-stub';
-- select count(*) as orphan_stub_screens from public.screens where updated_by = 'orphan-stub';
--
-- After running, re-run 06_post_backfill_constraints.sql — the FK should succeed.
