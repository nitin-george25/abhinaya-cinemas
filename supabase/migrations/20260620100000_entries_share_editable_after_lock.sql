-- =============================================================================
-- 2026-06-20  Distributor share % editable after the 2-day DCR lock.
--
-- The 2-day edit lock (migration 20260613140000) froze ENTIRE entries older
-- than 2 days for non-owners. Distributor share %, however, is a commercial
-- term that legitimately changes mid-run (relationship deals), so it must stay
-- editable past the lock for managers too — while the box-office figures stay
-- frozen for audit.
--
-- We move the UPDATE half of the lock from a restrictive RLS policy into a
-- BEFORE UPDATE trigger, because a policy cannot compare OLD vs NEW columns.
-- The trigger lets a non-owner change ONLY `share` on a locked row; any change
-- to the date, movie, screen, shows, or cancelled-show count on a locked row
-- (or an attempt to move a row into the locked zone) is rejected. Owner stays
-- unrestricted. INSERT lock, DELETE policy and SELECT are untouched.
--
-- Idempotent. Apply to STAGING first, then prod.
-- =============================================================================
begin;

-- The UPDATE lock now lives in the trigger below (it needs OLD/NEW access),
-- so retire the restrictive UPDATE policy. INSERT lock policy stays.
drop policy if exists entries_edit_lock_update on public.entries;

create or replace function public.enforce_entry_edit_lock()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  cutoff date := ((now() at time zone 'Asia/Kolkata')::date - 2);
begin
  -- Owner is unrestricted (back-dated corrections remain possible).
  if public.is_owner() then
    return new;
  end if;

  -- Neither the existing nor the target date is in the locked zone → normal
  -- edit (the 2-day window allows full edits).
  if old.entry_date >= cutoff and new.entry_date >= cutoff then
    return new;
  end if;

  -- Locked DCR (or an attempt to move a row into/out of the locked zone):
  -- a non-owner may change ONLY the distributor share. Everything that feeds
  -- the filed figures stays frozen.
  if (new.entry_date      is distinct from old.entry_date)
     or (new.movie_id     is distinct from old.movie_id)
     or (new.screen_id    is distinct from old.screen_id)
     or (new.shows        is distinct from old.shows)
     or (new.cancelled_shows is distinct from old.cancelled_shows) then
    raise exception
      'DCR locked: after 2 days only the distributor share %% may be edited (entry dated %).',
      old.entry_date
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_entries_edit_lock on public.entries;
create trigger trg_entries_edit_lock
  before update on public.entries
  for each row execute function public.enforce_entry_edit_lock();

commit;
