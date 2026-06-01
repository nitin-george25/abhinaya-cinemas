-- ============================================================================
-- Abhinaya Cinemas — Phase 1.8: Username + PIN auth (additional login method)
--
-- After this runs:
--   • authorized_users has a unique `username` column (nullable — Google
--     users don't need one)
--   • Owners can create non-email users via the admin-users Edge Function;
--     those users sign in with username + 6-digit PIN
--   • Existing Google users keep working untouched
--
-- HOW TO RUN:
--   1. https://supabase.com/dashboard → your prod project (and staging)
--   2. SQL Editor → New query → paste this file → Run
--
-- Safe to re-run.
-- ============================================================================

alter table public.authorized_users
  add column if not exists username text;

-- Unique constraint — one username per cinema.
create unique index if not exists authorized_users_username_key
  on public.authorized_users (lower(username))
  where username is not null;

-- Helpful for the admin "list users" page (small table, but cheap insurance).
create index if not exists authorized_users_role_idx
  on public.authorized_users (role);

-- ─── Verify ──────────────────────────────────────────────────────────────
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema='public' and table_name='authorized_users';
--
-- Existing rows have username = null. Add a username to your own row to
-- enable the username login flow for your account (optional — Google
-- works either way):
--   update public.authorized_users
--     set username = 'nitin' where email = 'nitin.george@abhinayacinemas.com';
