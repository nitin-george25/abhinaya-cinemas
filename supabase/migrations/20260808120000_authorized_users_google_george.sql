-- ============================================================================
-- authorized_users — grant console access to george@abhinayacinemas.com
--
-- George already has a username+PIN account (george@local.abhinayacinemas.com,
-- role owner). This adds the Google identity so he can also sign in through
-- the "Continue with Google" tab with his @abhinayacinemas.com Workspace
-- account.
--
-- authorized_users IS the access list. Google OAuth creates the auth.users
-- row on first sign-in, but the app's boot sequence (useSupabaseSync) marks
-- any session whose email has no row here as "unauthorized" — so inserting
-- the row is the whole grant; no auth user needs to be pre-created.
--
-- cinema_ids is seeded from every cinema on record, matching the other owner
-- rows. Leaving it '{}' makes cinema_access() fail every RLS check (symptom:
-- empty Unit dropdowns everywhere).
--
-- Idempotent: no-op when the row already exists, apart from refreshing role
-- and cinema access.
-- ============================================================================

do $$
declare
  v_email  text := 'george@abhinayacinemas.com';
  v_cinema uuid[];
begin
  if to_regclass('public.authorized_users') is null then
    return;
  end if;

  if to_regclass('public.cinemas') is not null then
    select coalesce(array_agg(id), '{}'::uuid[]) into v_cinema from public.cinemas;
  else
    v_cinema := '{}'::uuid[];
  end if;

  if exists (select 1 from public.authorized_users where lower(email) = v_email) then
    update public.authorized_users
       set role       = 'owner',
           cinema_ids = v_cinema
     where lower(email) = v_email;
    raise notice 'authorized_users: refreshed % (owner)', v_email;
  else
    insert into public.authorized_users
      (email, role, full_name, username, cinema_ids, must_change_pin)
    values
      (v_email, 'owner', 'George', null, v_cinema, false);
    raise notice 'authorized_users: granted console access to % (owner)', v_email;
  end if;
end $$;

-- verify:
--   select email, role, full_name, username, cinema_ids
--     from public.authorized_users
--    where email = 'george@abhinayacinemas.com';
-- expect: one row, role owner, username null, cinema_ids non-empty
