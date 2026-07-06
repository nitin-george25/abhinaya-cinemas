-- ============================================================================
-- Recompute movies.status on the movie row's OWN insert/edit.
--
-- WHY
-- ---
-- movies.status is a DERIVED column (cash_16 / cash_20). It is recomputed by:
--   • the trigger on public.entries — when a DCR lands / changes / is deleted;
--   • the daily pg_cron job — the time-based "no entry yesterday -> past" demote.
--
-- Neither path fires when the MOVIE row itself changes. So:
--   • a freshly inserted movie sits at the column default until some later
--     entries write or the 19:00 IST cron happens to recompute it;
--   • editing release_date / archived_at / status_override on the movie does
--     not take effect immediately — the landing page keeps showing the stale
--     classification until an unrelated recompute fires.
--
-- WHAT
-- ----
-- A BEFORE INSERT OR UPDATE trigger on public.movies that computes the row's
-- effective status in-place (sets NEW.status). Same CASE logic as
-- refresh_movie_statuses() (cash_20 variant, incl. the entry_counts_as_played
-- filter on last_entry), applied to the single changed row.
--
-- Why BEFORE (not AFTER): mutating NEW recomputes within the same write with no
-- second UPDATE, so it is immediate AND cannot recurse. The engine already owns
-- this column (the catalog dual-write writes status_override, never status), so
-- overwriting whatever status the caller supplied is correct, not a clobber.
--
-- Interaction with the entries trigger: that trigger issues
-- `update public.movies set status = ...`, which now also fires this BEFORE
-- trigger and recomputes the identical value — harmless and consistent.
--
-- Run on BOTH staging and prod. Idempotent (create or replace + drop/create).
-- ============================================================================

begin;

create or replace function public.trg_movies_compute_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  last_entry date;
begin
  select max(e.entry_date)
    into last_entry
    from public.entries e
   where e.movie_id = NEW.id
     and public.entry_counts_as_played(e.shows, e.cancelled_shows);

  NEW.status := case
    when NEW.status_override is not null then NEW.status_override
    when NEW.archived_at is not null     then 'past'
    when NEW.release_date is not null
         and NEW.release_date > public.today_ist() then 'coming_soon'
    when last_entry is not null
         and last_entry >= public.today_ist() - 1 then 'now_showing'
    when NEW.release_date is not null
         and NEW.release_date >= public.today_ist() - 1 then 'now_showing'
    else 'past'
  end;

  return NEW;
end;
$$;

drop trigger if exists movies_compute_status on public.movies;
create trigger movies_compute_status
  before insert or update on public.movies
  for each row execute function public.trg_movies_compute_status();

-- Bring every existing row in line with the engine in one shot.
select public.refresh_movie_statuses();

commit;

-- ============================================================================
-- Verify:
--   -- Insert a movie dated in the future -> lands as coming_soon immediately:
--   insert into public.movies (id, cinema_id, name, release_date)
--     values ('t_trg', <cinema_uuid>, 'Trigger Test', current_date + 30);
--   select status from public.movies where id = 't_trg';   -- coming_soon
--   -- Pin it and re-check without any entries write:
--   update public.movies set status_override = 'now_showing' where id = 't_trg';
--   select status from public.movies where id = 't_trg';   -- now_showing
--   delete from public.movies where id = 't_trg';
-- ============================================================================
