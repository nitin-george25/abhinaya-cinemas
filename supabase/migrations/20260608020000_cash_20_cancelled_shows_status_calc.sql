-- ============================================================================
-- 20 — Cancelled shows + status engine ignores zero-ticket mistake entries.
--
-- Problem (found 2026-06-08): cash_16's status engine counts ANY entries row
-- as "the film played", so an accidentally saved empty draft (0 tickets, or
-- an empty shows array) kept a long-finished film on the landing page as
-- Now Showing. Real case: Athiradi (released 13 May) was re-promoted by two
-- empty drafts dated 7 Jun.
--
-- But a zero-ticket day is not always a mistake: whole shows get cancelled
-- (strike, power cut, festival closure) while the film is still running.
-- The owner needs to tell the two apart.
--
-- Fix:
--   a) entries.cancelled_shows integer — count of shows scheduled but NOT
--      run that day. Entered in the console's entry editor. Deliberately
--      stored OUTSIDE the shows jsonb so the locked DCR engine
--      (isRealShow / batta / fund math) never sees cancelled shows.
--   b) entry_counts_as_played(shows, cancelled) — an entry counts as
--      "the film played / was scheduled" iff it has at least one sold
--      ticket OR at least one recorded cancelled show.
--   c) refresh_movie_statuses() + trg_refresh_movie_status() recompute
--      last_entry over counting entries only. Empty drafts stop promoting.
--
-- Effective status rule (unchanged otherwise, all dates IST):
--   status_override present                          -> status_override
--   archived_at present                              -> 'past'
--   release_date in the future                       -> 'coming_soon'
--   a COUNTING entry today or yesterday              -> 'now_showing'
--   release_date today or yesterday (opening grace)  -> 'now_showing'
--   otherwise                                        -> 'past'
--
-- Run on BOTH staging and prod (npm run db:push:staging / db:push:prod).
-- Safe to re-run (idempotent).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) New column.
-- ----------------------------------------------------------------------------
alter table public.entries
  add column if not exists cancelled_shows integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'entries_cancelled_shows_check'
  ) then
    alter table public.entries
      add constraint entries_cancelled_shows_check
      check (cancelled_shows >= 0 and cancelled_shows <= 24);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2) "Does this entry count as the film having played / been scheduled?"
--    True iff any show row sold at least one ticket, or the owner recorded
--    at least one cancelled show. Defensive about jsonb shapes: shows may
--    be SQL null, json null, or shows[i].rows may be missing.
-- ----------------------------------------------------------------------------
create or replace function public.entry_counts_as_played(
  p_shows     jsonb,
  p_cancelled integer
)
returns boolean
language sql
immutable
as $$
  select coalesce(p_cancelled, 0) > 0
      or (
        jsonb_typeof(p_shows) = 'array'
        and exists (
          select 1
            from jsonb_array_elements(p_shows) sh
            cross join lateral jsonb_each(
              case when jsonb_typeof(sh->'rows') = 'object'
                   then sh->'rows' else '{}'::jsonb end
            ) r
           where coalesce(nullif(r.value->>'tickets', ''), '0')::numeric > 0
        )
      );
$$;

-- ----------------------------------------------------------------------------
-- 3) Status engine recompute — last_entry now only over counting entries.
--    (Same shape as cash_16, lateral filter added.)
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
           and public.entry_counts_as_played(e.shows, e.cancelled_shows)
      ) le on true
    ) computed
   where m.id = computed.id
     and m.status is distinct from computed.eff;
$$;

-- ----------------------------------------------------------------------------
-- 4) Trigger function — same filter for the per-movie recompute.
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
      select mv.id,
             (select max(e.entry_date)
                from public.entries e
               where e.movie_id = mv.id
                 and public.entry_counts_as_played(e.shows, e.cancelled_shows)
             ) as last_entry
        from public.movies mv
       where mv.id = any(ids)
    ) le
   where m.id = le.id;

  return coalesce(NEW, OLD);
end;
$$;

-- (Trigger itself unchanged — entries_refresh_movie_status from cash_16
--  already points at trg_refresh_movie_status(); replacing the function
--  body is enough. Any insert/update/delete on entries — including edits
--  to cancelled_shows — fires it.)

-- ----------------------------------------------------------------------------
-- 5) Apply once now.
-- ----------------------------------------------------------------------------
select public.refresh_movie_statuses();

-- ----------------------------------------------------------------------------
-- Verify:
--   select name, status, status_override, release_date from public.movies
--    where status <> 'past' order by release_date;
--   -- empty-draft test (as owner): save an entry with no tickets and
--   -- cancelled_shows = 0 → movie must NOT promote; set cancelled_shows = 1
--   -- → movie promotes; delete the entry → demotes.
-- ----------------------------------------------------------------------------
