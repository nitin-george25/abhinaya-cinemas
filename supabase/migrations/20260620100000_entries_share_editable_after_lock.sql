-- =============================================================================
-- 2026-06-20  Distributor share % editable after the 2-day DCR lock
--             (manager + owner only).
--
-- The 2-day edit lock (migration 20260613140000) froze ENTIRE entries older
-- than 2 days for non-owners. Distributor share %, however, is a commercial
-- term that legitimately changes mid-run (relationship deals), so a MANAGER
-- (and the owner) must be able to edit it past the lock — while the box-office
-- figures stay frozen for audit. All other roles stay fully read-only past the
-- lock, exactly as before.
--
-- We move the UPDATE half of the lock from a restrictive RLS policy into a
-- BEFORE UPDATE trigger, because a policy cannot compare OLD vs NEW columns.
-- Service role / direct DB (CI migrations, repairs, backfills) bypass the
-- trigger, matching the original RLS policy which service_role and superuser
-- bypassed. INSERT lock, DELETE policy and SELECT are untouched.
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
  v_claims text := current_setting('request.jwt.claims', true);
  cutoff   date := ((now() at time zone 'Asia/Kolkata')::date - 2);
begin
  -- Service role / direct DB (CI migrations, repairs, backfills) bypass the
  -- app-level lock — the original RLS policy was likewise bypassed by
  -- service_role and superuser.
  if v_claims is null
     or coalesce(v_claims::json ->> 'role', '') = 'service_role' then
    return new;
  end if;

  -- Owner is unrestricted (back-dated corrections remain possible).
  if public.is_owner() then
    return new;
  end if;

  -- Within the 2-day window: normal edit (existing permissive policy governs).
  if old.entry_date >= cutoff and new.entry_date >= cutoff then
    return new;
  end if;

  -- Locked DCR (or an attempt to move a row into/out of the locked zone).
  -- Only a MANAGER may touch it past the lock; every other non-owner role is
  -- fully read-only.
  if not public.is_owner_or_manager() then
    raise exception
      'DCR locked: entries older than 2 days are read-only for your role (entry dated %).',
      old.entry_date
      using errcode = 'check_violation';
  end if;

  -- Manager on a locked row: ONLY the distributor share may change.
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
