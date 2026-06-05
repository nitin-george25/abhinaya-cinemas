-- ============================================================================
-- 15 — Movie status + anon-readable RLS for the landing page.
--
-- WHY THIS EXISTS
-- ---------------
-- Two related problems:
--
--   1) The landing site (abhinayacinemas.com/) reads `public.movies` with the
--      anon JWT. The existing `movies_read` policy gates SELECT on
--      `cinema_access(cinema_id)`, which checks `authorized_users` for the
--      caller's email — anon has no email, so anon sees zero rows. The
--      landing page silently renders its empty state.
--
--   2) The current "Now Showing vs Coming Soon" classification is inferred
--      from `release_date` and "today". That's fragile: a movie can be past
--      its release date but no longer screening, or have an unknown release
--      date, or be scheduled but in limbo. We need an explicit, owner-controlled
--      lifecycle flag.
--
-- WHAT THIS DOES
-- --------------
--   a) Adds `public.movies.status text` with a CHECK constraint enforcing one
--      of {'coming_soon', 'now_showing', 'past'}.
--   b) Backfills: archived → past; release_date in the future → coming_soon;
--      has an `entries` row in the last 14 days → now_showing; else → past.
--      The owner can correct any cells manually after the fact.
--   c) Adds index for the landing-page query path.
--   d) Adds an anon-readable RLS policy that exposes ONLY rows with
--      status in ('coming_soon','now_showing') AND archived_at IS NULL.
--      Owner/manager continue to see everything via the existing `movies_read`.
--   e) Default for new rows: 'coming_soon' (matches the natural authoring
--      flow — admin adds the movie ahead of release, then flips to
--      now_showing when it actually opens).
--
-- Idempotent.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Column + check constraint + default.
-- ----------------------------------------------------------------------------

alter table public.movies
  add column if not exists status text;

-- Add the check constraint only if it isn't already there.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'movies_status_check'
      and conrelid = 'public.movies'::regclass
  ) then
    alter table public.movies
      add constraint movies_status_check
      check (status in ('coming_soon', 'now_showing', 'past'));
  end if;
end$$;

-- Default for future inserts.
alter table public.movies
  alter column status set default 'coming_soon';


-- ----------------------------------------------------------------------------
-- 2) Backfill.
--    Run only on rows where status is still null (idempotent re-run).
-- ----------------------------------------------------------------------------

with active_in_last_14_days as (
  select distinct movie_id
    from public.entries
   where entry_date >= (current_date - interval '14 days')::date
)
update public.movies m
   set status = case
     when m.archived_at is not null                              then 'past'
     when m.release_date is not null and m.release_date > current_date then 'coming_soon'
     when a.movie_id is not null                                 then 'now_showing'
     else 'past'
   end
  from active_in_last_14_days a
 where m.status is null
   and (a.movie_id = m.id or true);   -- left-join via the cross-ref above

-- Catch any rows the join missed (movies with no entries at all and a past
-- release_date): set them to 'past' so we don't leave NULLs.
update public.movies
   set status = 'past'
 where status is null;

-- Now lock the column down.
alter table public.movies
  alter column status set not null;


-- ----------------------------------------------------------------------------
-- 3) Index for the landing-page query path.
-- ----------------------------------------------------------------------------

create index if not exists movies_status_public_idx
  on public.movies (status)
  where archived_at is null and status in ('coming_soon', 'now_showing');


-- ----------------------------------------------------------------------------
-- 4) Anon-readable RLS for the public landing page.
--
--    PostgreSQL combines multiple SELECT policies on the same table with OR.
--    So this policy lets anon read PUBLIC rows without affecting the
--    existing `movies_read` policy that grants owner/manager full access.
-- ----------------------------------------------------------------------------

drop policy if exists movies_anon_public_read on public.movies;
create policy movies_anon_public_read on public.movies
  for select
  using (
    status in ('coming_soon', 'now_showing')
    and archived_at is null
  );


-- ----------------------------------------------------------------------------
-- 5) Same treatment for the `movie-posters` Storage bucket — it's already
--    public-readable from migration 13, so nothing to change here, but
--    document the relationship so future-us doesn't get confused:
--    landing page reads `movies` rows via this new anon policy, then loads
--    the linked `poster_url` from the already-public storage bucket.
-- ----------------------------------------------------------------------------

commit;


-- ============================================================================
-- VERIFY (run after applying):
--
--   -- Should return the same count as the "active programme" you expect.
--   select status, count(*) from public.movies group by status;
--
--   -- Should return the public-facing rows when run AS ANON (no auth):
--   set role anon;
--   select id, name, status from public.movies order by status;
--   reset role;
-- ============================================================================
