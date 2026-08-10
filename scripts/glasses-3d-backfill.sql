-- ============================================================================
-- scripts/glasses-3d-backfill.sql
--
-- Add the 3D glasses rental line to shows that were ALREADY ENTERED before the
-- feature existed.
--
-- This is NOT a migration — it lives in scripts/ on purpose. `supabase db push`
-- applies every file in supabase/migrations/ exactly once, which is wrong for a
-- script you edit and re-run per film. Run this by hand instead:
--
--   Supabase dashboard → SQL Editor → paste → run one STEP at a time
--   or:  psql "$DATABASE_URL" -f scripts/glasses-3d-backfill.sql
--
-- Run against STAGING first, then check Reports → Box Office → 3D Glasses for
-- the backfilled run before touching prod. (Not the DCR — the rental is
-- cinema-only income and is deliberately absent from that document.)
--
-- ── WHAT IT WRITES ─────────────────────────────────────────────────────────
-- Each matching show in entries.shows gains:
--     "glasses3d": { "rate": 30, "gstPct": 18 }
--
-- `qty` is deliberately ABSENT. The engine reads that as "auto" and resolves
-- the charge to the show's paid ticket count at render time — so backfilled
-- shows need no quantity, stay correct if a ticket count is later corrected,
-- and bill nothing on a zero-ticket show. Free passes are never charged.
--
-- ── WHAT IT CANNOT AFFECT ──────────────────────────────────────────────────
-- Gross Collection, Net Share, DS and ES. The glasses lane is computed in
-- parallel to the box office and feeds none of them, so backfilling cannot
-- change any figure a distributor was ever settled against. Picture Ending
-- Statements already filed are likewise untouched.
--
-- ── THE 2-DAY EDIT LOCK — READ THIS ────────────────────────────────────────
-- trg_entries_edit_lock freezes entries.shows past 2 days. Its bypass is
-- checked in this order (see 20260620100000_entries_share_editable_after_lock):
--
--   1. request.jwt.claims is NULL, or its `role` is 'service_role'  → allowed
--   2. is_owner()                                                   → allowed
--   3. otherwise: manager may change ONLY the share %; everyone else nothing
--
-- Do NOT assume your session lands on 1 or 2 — run STEP 0 below, which prints
-- exactly what the trigger will see. A session that falls through to 3 is
-- rejected with:
--
--   ERROR: DCR locked: after 2 days only the distributor share % may be edited
--
-- STEP 3 claims branch 1 inside a DO block. A DO block is a SINGLE statement,
-- so it is one transaction regardless of how the client splits the script —
-- which a bare `begin; set_config(...); update; commit;` is not, if the editor
-- sends each statement separately. STEP 3B is a guaranteed fallback that
-- suspends the trigger outright.
--
-- ── IDEMPOTENT ─────────────────────────────────────────────────────────────
-- A show that already carries glasses3d is skipped untouched, so re-running
-- never double-charges and never overwrites a hand-set quantity.
-- ============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 0 — DIAGNOSTIC. What does the edit-lock trigger see from this session?
--
-- Run this FIRST. It tells you which branch you land on, so you stop guessing:
--
--   claims_role = 'service_role', or claims is null  → branch 1, writes allowed
--   is_owner = true                                  → branch 2, writes allowed
--   otherwise                                        → branch 3, writes BLOCKED
--
-- If `is_owner_or_manager` is true while `jwt_email` is blank, check the last
-- column: an authorized_users row with an empty/blank email makes every
-- unauthenticated session match it, which silently grants that row's role to
-- the SQL editor. That is a data bug worth fixing on its own.
-- ═══════════════════════════════════════════════════════════════════════════
select current_user,
       current_setting('request.jwt.claims', true)          as claims,
       current_setting('request.jwt.claims', true)::json ->> 'role'
                                                            as claims_role,
       coalesce(auth.jwt() ->> 'email', '(none)')           as jwt_email,
       public.is_owner()                                    as is_owner,
       public.is_owner_or_manager()                         as is_owner_or_manager,
       (select count(*) from public.authorized_users
         where coalesce(trim(email), '') = '')              as blank_email_rows;


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 0B — What is ACTUALLY deployed?
--
-- Run these if STEP 0 says claims is null / is_owner_or_manager is false and
-- a write still fails. Those two facts are incompatible with the trigger as
-- committed (null claims returns early; the manager error needs
-- is_owner_or_manager true), which means the database has drifted from the
-- repo. Compare the function body below against
-- supabase/migrations/20260620100000_entries_share_editable_after_lock.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- a) The live function body. This is the authority, not the migration file.
select pg_get_functiondef(p.oid) as deployed_body
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'enforce_entry_edit_lock';

-- b) Every non-internal trigger on entries — is there more than one?
--    tgenabled: 'O' = enabled, 'D' = disabled.
select t.tgname, t.tgenabled, p.proname as calls
  from pg_trigger t
  join pg_proc p on p.oid = t.tgfoid
 where t.tgrelid = 'public.entries'::regclass
   and not t.tgisinternal
 order by t.tgname;

-- c) Restrictive RLS policies still in force? 20260620100000 was supposed to
--    drop entries_edit_lock_update and replace it with the trigger.
select policyname, permissive, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'entries'
 order by policyname;

-- d) Did that migration ever land here?
select version
  from supabase_migrations.schema_migrations
 where version in ('20260613140000', '20260620100000')
 order by version;


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 1 — Find the film. Which runs are candidates?
-- ═══════════════════════════════════════════════════════════════════════════
select e.movie_id,
       m.name,
       min(e.entry_date)                      as first_day,
       max(e.entry_date)                      as last_day,
       count(*)                               as dcr_days,
       sum(jsonb_array_length(e.shows))       as shows,
       count(*) filter (
         where exists (select 1 from jsonb_array_elements(e.shows) s
                        where s -> 'glasses3d' is not null)
       )                                      as days_already_3d
  from public.entries e
  left join public.movies m on m.id = e.movie_id
 where e.shows is not null
   and jsonb_typeof(e.shows) = 'array'
 group by e.movie_id, m.name
 order by first_day desc
 limit 60;


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 2 — PREVIEW. Edit the three ►► lines, then run.
--
-- Nothing is written. Check `pairs_to_bill` and `total_to_add` against what
-- you remember collecting before going on to STEP 3.
--
-- Date bounds are optional — the defaults cover a film's whole run. Narrow
-- them if only part of the run played 3D (e.g. a film that moved to 2D prints
-- after opening week).
-- ═══════════════════════════════════════════════════════════════════════════
with target as (
  select e.*
    from public.entries e
   where e.movie_id in ('PUT-MOVIE-ID-HERE')        -- ►► from STEP 1
     and e.entry_date >= '1900-01-01'::date         -- ►► optional run start
     and e.entry_date <= '2999-12-31'::date         -- ►► optional run end
     and e.shows is not null
     and jsonb_typeof(e.shows) = 'array'
),
per_show as (
  select t.entry_date,
         t.movie_id,
         t.screen_id,
         sh -> 'glasses3d' is not null as already_3d,
         (select coalesce(sum((r.value ->> 'tickets')::numeric), 0)
            from jsonb_each(coalesce(sh -> 'rows', '{}'::jsonb)) r) as tickets
    from target t
    cross join lateral jsonb_array_elements(t.shows) sh
)
select count(distinct (entry_date, movie_id, screen_id))         as dcr_days,
       count(*) filter (where not already_3d)                    as shows_to_backfill,
       count(*) filter (where already_3d)                        as shows_skipped,
       coalesce(sum(tickets) filter (where not already_3d), 0)    as pairs_to_bill,
       coalesce(sum(tickets) filter (where not already_3d), 0) * 30 as total_to_add
  from per_show;


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 3 — WRITE. Same movie_id / dates as STEP 2, and the rate the shows
--          actually played at (30 unless you changed it since).
--
-- This is ONE statement — a DO block — on purpose. set_config(..., true) is
-- transaction-local, and a DO block is a single statement, so the claim and
-- the update are guaranteed to share a transaction no matter how the client
-- splits the script. A bare `begin; set_config(); update; commit;` is NOT
-- guaranteed that, which is why it can still fail with the lock error.
--
-- The rate is snapshotted onto each show exactly as a live entry would do, so
-- these shows keep reporting at this rate even if Settings changes later.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_rows int;
begin
  -- Claim branch 1 of the edit-lock trigger. Reverts when this transaction
  -- ends, so it cannot leak to another session on a pooled connection.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  update public.entries e
     set shows = (
           select jsonb_agg(
                    case
                      when sh -> 'glasses3d' is null
                        then sh || jsonb_build_object(
                               'glasses3d',
                               jsonb_build_object('rate', 30, 'gstPct', 18))  -- ►► rate
                      else sh
                    end
                    order by ord
                  )
             from jsonb_array_elements(e.shows) with ordinality x(sh, ord)
         ),
         updated_by = 'glasses-3d-backfill',
         updated_at = now()
   where e.movie_id in ('PUT-MOVIE-ID-HERE')          -- ►► same as STEP 2
     and e.entry_date >= '1900-01-01'::date            -- ►► same as STEP 2
     and e.entry_date <= '2999-12-31'::date            -- ►► same as STEP 2
     and e.shows is not null
     and jsonb_typeof(e.shows) = 'array'
     and exists (select 1 from jsonb_array_elements(e.shows) s
                  where s -> 'glasses3d' is null);

  get diagnostics v_rows = row_count;
  raise notice '3D glasses backfill: % DCR rows updated', v_rows;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 3B — FALLBACK, only if STEP 3 still raises the lock error.
--
-- Suspends the trigger for the duration instead of trying to satisfy it. Also
-- a single DO block, so the disable can never outlive the statement: if the
-- update raises, the whole thing rolls back and the trigger comes back with
-- it. ALTER TABLE ... DISABLE TRIGGER is transactional in Postgres and takes
-- an ACCESS EXCLUSIVE lock, so no other session can write to entries while it
-- is off.
--
-- Requires ownership of public.entries (the SQL Editor's postgres role has
-- it). Edit the movie_id / dates / rate to match STEP 2, then uncomment.
-- ═══════════════════════════════════════════════════════════════════════════
-- do $$
-- declare
--   v_rows int;
-- begin
--   alter table public.entries disable trigger trg_entries_edit_lock;
--
--   update public.entries e
--      set shows = (
--            select jsonb_agg(
--                     case
--                       when sh -> 'glasses3d' is null
--                         then sh || jsonb_build_object(
--                                'glasses3d',
--                                jsonb_build_object('rate', 30, 'gstPct', 18))
--                       else sh
--                     end
--                     order by ord
--                   )
--              from jsonb_array_elements(e.shows) with ordinality x(sh, ord)
--          ),
--          updated_by = 'glasses-3d-backfill',
--          updated_at = now()
--    where e.movie_id in ('PUT-MOVIE-ID-HERE')
--      and e.entry_date >= '1900-01-01'::date
--      and e.entry_date <= '2999-12-31'::date
--      and e.shows is not null
--      and jsonb_typeof(e.shows) = 'array'
--      and exists (select 1 from jsonb_array_elements(e.shows) s
--                   where s -> 'glasses3d' is null);
--
--   get diagnostics v_rows = row_count;
--
--   alter table public.entries enable trigger trg_entries_edit_lock;
--   raise notice '3D glasses backfill (trigger suspended): % DCR rows updated', v_rows;
-- end $$;
--
-- -- Confirm the trigger is back ON. Must return 'O' (enabled).
-- select tgname, tgenabled
--   from pg_trigger
--  where tgrelid = 'public.entries'::regclass
--    and tgname = 'trg_entries_edit_lock';


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 4 — VERIFY. Per-day pairs and rupees now on the books.
-- ═══════════════════════════════════════════════════════════════════════════
select e.entry_date,
       m.name,
       e.screen_id,
       count(*)                                  as shows_3d,
       sum((select coalesce(sum((r.value ->> 'tickets')::numeric), 0)
              from jsonb_each(coalesce(sh -> 'rows', '{}'::jsonb)) r)) as pairs,
       sum((select coalesce(sum((r.value ->> 'tickets')::numeric), 0)
              from jsonb_each(coalesce(sh -> 'rows', '{}'::jsonb)) r)
           * (sh -> 'glasses3d' ->> 'rate')::numeric)                  as amount
  from public.entries e
  left join public.movies m on m.id = e.movie_id
  cross join lateral jsonb_array_elements(e.shows) sh
 where e.movie_id in ('PUT-MOVIE-ID-HERE')          -- ►► same as STEP 2
   and sh -> 'glasses3d' is not null
 group by e.entry_date, m.name, e.screen_id
 order by e.entry_date;


-- ═══════════════════════════════════════════════════════════════════════════
-- UNDO — removes the glasses line from the targeted run. Use only if a
--        backfill hit the wrong film. This also erases hand-set quantities.
--        Same DO-block shape as STEP 3, for the same reason.
-- ═══════════════════════════════════════════════════════════════════════════
-- do $$
-- begin
--   perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
--
--   update public.entries e
--      set shows = (
--            select jsonb_agg(sh - 'glasses3d' order by ord)
--              from jsonb_array_elements(e.shows) with ordinality x(sh, ord)
--          ),
--          updated_by = 'glasses-3d-backfill-undo',
--          updated_at = now()
--    where e.movie_id in ('PUT-MOVIE-ID-HERE')
--      and e.shows is not null
--      and jsonb_typeof(e.shows) = 'array';
-- end $$;
