-- ============================================================================
-- auth — forced PIN change on first login (pipeline item 5).
--
-- Username+PIN users get their initial PIN from the owner (create) or a
-- reset. `must_change_pin` forces them through a "Choose your own PIN"
-- screen before they reach the app:
--
--   • admin-users Edge Function sets the flag true on `create` and
--     `reset_pin` (service role — bypasses RLS).
--   • The app gates on the flag at boot; the user picks a new PIN
--     (auth.updateUser) and then calls fn_clear_must_change_pin().
--
-- Existing users keep default false — only PINs issued after this
-- migration force a change. Google-auth users are never flagged.
--
-- fn_clear_must_change_pin is SECURITY DEFINER on purpose: there is no
-- self-UPDATE policy on authorized_users (one would let users edit their
-- own role), so the function is the only path, and it can only flip this
-- one flag on the caller's own row.
-- ============================================================================

begin;

alter table public.authorized_users
  add column if not exists must_change_pin boolean not null default false;

comment on column public.authorized_users.must_change_pin is
  'True when the PIN was issued by the owner/manager (create or reset) '
  'and the user has not yet replaced it with their own. The app blocks '
  'on a Change-PIN screen while true. Always false for Google users.';

create or replace function public.fn_clear_must_change_pin()
returns void
language sql
security definer
set search_path = public
as $$
  update public.authorized_users
     set must_change_pin = false
   where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

revoke all on function public.fn_clear_must_change_pin() from public;
grant execute on function public.fn_clear_must_change_pin() to authenticated;

commit;

-- verify:
--   select column_name, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'authorized_users'
--      and column_name = 'must_change_pin';
--   select proname, prosecdef from pg_proc
--    where proname = 'fn_clear_must_change_pin';
-- expect: column with default false; function with prosecdef = true
