-- ============================================================================
-- 16 — Per-movie trailers + homepage feature flag + CALCULATED movie status.
--
-- Builds on cash_15 (which added movies.status + the anon-readable RLS).
-- Three new columns and a server-side status engine so the owner stops
-- hand-setting status:
--
--   a) trailer_url    text  — YouTube (or any) trailer link. Played by the
--                             landing page "Watch Trailer" CTA.
--   b) is_featured    bool  — at most one movie flagged; drives the landing
--                             hero film. Single-featured is enforced in the
--                             admin UI (no DB unique index, to avoid
--                             transient violations during a multi-row upsert).
--   c) status_override text — owner's manual pin. NULL = "Auto" (the engine
--                             decides). When set, the engine respects it.
--
-- STATUS ENGINE
--   public.movies.status becomes a DERIVED column owned by this engine, not
--   by the app's catalog dual-write. (mappers/catalog.ts is updated in the
--   same change to STOP writing `status` and to write `status_override`
--   instead — otherwise every config push would clobber the calc.)
--
--   Effective status (single screen, DCR entered daily), all dates in IST:
--     status_override present                          -> status_override
--     archived_at present                              -> 'past'
--     release_date in the future                       -> 'coming_soon'
--     a DCR entry today or yesterday (1-day window)    -> 'now_showing'
--     release_date today or yesterday (opening grace)  -> 'now_showing'
--     otherwise                                        -> 'past'
--
--   The 1-day window means: one full day with no entry retires the film.
--   The opening grace keeps a just-released film visible before its first
--   DCR is entered.
--
--   Recomputed by:
--     • a trigger on `entries` (insert/update/delete) — promotes a film the
--       moment its first DCR lands, and reacts to edits/deletes;
--     • a daily pg_cron job (19:00 IST / 13:30 UTC) — performs the
--       time-based "no entry yesterday -> past" demotion, which nothing
--       writes and so can only be driven by a clock.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Run on BOTH
-- staging and prod. Safe to re-run (idempotent).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Defensive: ensure cash_15's status column exists (no-op if it does).
-- ----------------------------------------------------------------------------
alter table public.movies add column if not exists status text;

-- ----------------------------------------------------------------------------
-- 1) New columns.
-- ----------------------------------------------------------------------------
alter table public.movies add column if not exists trailer_url     text;
alter table public.movies add column if not exists is_featured     boolean not null default false;
alter table public.movies add column if not exists status_override text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'movies_status_override_check'
  ) then
    alter table public.movies
      add constraint movies_status_override_check
      check (status_override is null
             or status_override in ('coming_soon', 'now_showing', 'past'));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2) IST "today" helper. Supabase runs in UTC; this cinema lives in IST, and
--    a 1-day window is sensitive to which calendar day "now" falls on.
-- ----------------------------------------------------------------------------
create or replace function public.today_ist()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

-- ----------------------------------------------------------------------------
-- 3) The status engine. One set-based recompute over all movies.
--    SECURITY DEFINER so the cron job + entry-writers (who may lack UPDATE
--    on movies under RLS) can still drive it.
-- ----------------------------------------------------------------------------
create or replace function public.refresh_movie_statuses()
returns void
language sql
security definer
set search_path = public
as $$
  update public.movies m
     set status = computed.eff,
         updated_at = now()
    from (
      select mv.id,
        case
          when mv.status_override is not null then mv.status_override
          when mv.archived_at is not null     then 'past'
          when mv.release_date is not null
               and mv.release_date > public.today_ist() then 'coming_soon'
          when le.last_entry is not null
               and le.last_entry >= public.today_ist() - 1 then 'now_showing'
          when mv.release_date is not null
               and mv.release_date >= public.today_ist() - 1 then 'now_showing'
          else 'past'
        end as eff
      from public.movies mv
      left join lateral (
        select max(e.entry_date) as last_entry
          from public.entries e
         where e.movie_id = mv.id
      ) le on true
    ) computed
   where m.id = computed.id
     and m.status is distinct from computed.eff;
$$;

-- ----------------------------------------------------------------------------
-- 4) Trigger on entries — recompute the touched movie(s) immediately.
--    Handles insert (promote on first DCR), update (incl. a movie_id change),
--    and delete (a removed DCR may flip the film back to past).
-- ----------------------------------------------------------------------------
create or replace function public.trg_refresh_movie_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ids text[];
begin
  ids := array_remove(array[
           case when tg_op <> 'INSERT' then OLD.movie_id end,
           case when tg_op <> 'DELETE' then NEW.movie_id end
         ], null);

  update public.movies m
     set status = case
           when m.status_override is not null then m.status_override
           when m.archived_at is not null     then 'past'
           when m.release_date is not null
                and m.release_date > public.today_ist() then 'coming_soon'
           when le.last_entry is not null
                and le.last_entry >= public.today_ist() - 1 then 'now_showing'
           when m.release_date is not null
                and m.release_date >= public.today_ist() - 1 then 'now_showing'
           else 'past'
         end,
         updated_at = now()
    from (
      select mv.id, (select max(e.entry_date) from public.entries e where e.movie_id = mv.id) as last_entry
        from public.movies mv
       where mv.id = any(ids)
    ) le
   where m.id = le.id;

  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists entries_refresh_movie_status on public.entries;
create trigger entries_refresh_movie_status
  after insert or update or delete on public.entries
  for each row execute function public.trg_refresh_movie_status();

-- ----------------------------------------------------------------------------
-- 5) Daily pg_cron job — the time-based demotion ("no entry yesterday").
--    19:00 IST = 13:30 UTC, comfortably after the day's DCR is entered.
-- ----------------------------------------------------------------------------
create extension if not exists pg_cron with schema extensions;

do $$
declare jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'abhinaya-refresh-movie-statuses';
  if found then perform cron.unschedule(jid); end if;
end $$;

select cron.schedule(
  'abhinaya-refresh-movie-statuses',
  '30 13 * * *',
  $cron$ select public.refresh_movie_statuses(); $cron$
);

-- ----------------------------------------------------------------------------
-- 6) Apply once now so the column reflects reality immediately after migrate.
-- ----------------------------------------------------------------------------
select public.refresh_movie_statuses();

-- ----------------------------------------------------------------------------
-- Verify:
--   select name, status, status_override, is_featured, release_date
--     from public.movies order by status, name;
--   select jobname, schedule from cron.job where jobname like 'abhinaya-%';
-- ----------------------------------------------------------------------------
