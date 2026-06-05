-- ============================================================================
-- 13 — Movie posters.
--
--   1. `public.movies.poster_url` text column — URL to the poster image
--      stored in the `movie-posters` bucket. Nullable so historical movies
--      stay valid; the create form enforces a poster client-side.
--   2. `movie-posters` Storage bucket — public read so the (future) landing
--      page can display now-playing / coming-soon posters without auth.
--      Owner + manager can write.
--
-- Idempotent.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) movies.poster_url
-- ----------------------------------------------------------------------------

alter table public.movies
  add column if not exists poster_url text;


-- ----------------------------------------------------------------------------
-- 2) movie-posters Storage bucket.
--    Public read; write gated to owner + manager (the catalog write roles).
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
  values ('movie-posters', 'movie-posters', true)
  on conflict (id) do update set public = excluded.public;

drop policy if exists "movie_posters_read"   on storage.objects;
drop policy if exists "movie_posters_write"  on storage.objects;
drop policy if exists "movie_posters_update" on storage.objects;
drop policy if exists "movie_posters_delete" on storage.objects;

create policy "movie_posters_read" on storage.objects
  for select using (bucket_id = 'movie-posters');

create policy "movie_posters_write" on storage.objects
  for insert with check (
    bucket_id = 'movie-posters'
    and exists (
      select 1 from public.authorized_users
       where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
         and role in ('owner','manager')
    )
  );

create policy "movie_posters_update" on storage.objects
  for update using (
    bucket_id = 'movie-posters'
    and exists (
      select 1 from public.authorized_users
       where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
         and role in ('owner','manager')
    )
  );

create policy "movie_posters_delete" on storage.objects
  for delete using (
    bucket_id = 'movie-posters' and public.is_owner()
  );


commit;
