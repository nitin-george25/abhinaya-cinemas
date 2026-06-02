-- ============================================================================
-- 00 — Role + helpers
--
-- Adds 'cashier' role to authorized_users + new RLS helpers that the cash
-- management tables in 01-03 will reference. Idempotent.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Extend the role CHECK to allow 'cashier'.
--    Pattern matches Step 5 Daily Manager — drop + re-add the constraint.
-- ----------------------------------------------------------------------------

alter table public.authorized_users
  drop constraint if exists authorized_users_role_check;

alter table public.authorized_users
  add constraint authorized_users_role_check
  check (role in ('owner','manager','daily_manager','accountant','cashier'));


-- ----------------------------------------------------------------------------
-- 2) is_cashier() — used by petty_expense write policies
-- ----------------------------------------------------------------------------

create or replace function public.is_cashier()
  returns boolean
  language plpgsql stable security definer set search_path = public
as $$
begin
  return exists (
    select 1 from public.authorized_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and role = 'cashier'
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- 3) can_approve_petty_expense()
--    Owner, manager, daily_manager all qualify (daily_manager is the shift
--    manager who runs day-to-day approvals).
-- ----------------------------------------------------------------------------

create or replace function public.can_approve_petty_expense()
  returns boolean
  language plpgsql stable security definer set search_path = public
as $$
begin
  return exists (
    select 1 from public.authorized_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and role in ('owner','manager','daily_manager')
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- 4) can_approve_payment_request(amount)
--    Owner: always. Manager: only if amount < cinema's threshold.
-- ----------------------------------------------------------------------------

create or replace function public.can_approve_payment_request(
  p_cinema_id  uuid,
  p_amount     numeric
) returns boolean
  language plpgsql stable security definer set search_path = public
as $$
declare
  v_role      text;
  v_threshold numeric;
begin
  select role into v_role from public.authorized_users
   where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
   limit 1;

  if v_role = 'owner' then return true; end if;
  if v_role <> 'manager' then return false; end if;

  -- Manager: need amount < threshold (column added in 01).
  select payment_approval_threshold into v_threshold
    from public.cinemas
    where id = p_cinema_id;

  return p_amount < coalesce(v_threshold, 5000);
end;
$$;


-- ----------------------------------------------------------------------------
-- 5) cinema_access_unit(unit_id) — resolves cinema via operating_units
-- ----------------------------------------------------------------------------

create or replace function public.cinema_access_unit(p_unit_id uuid)
  returns boolean
  language plpgsql stable security definer set search_path = public
as $$
declare
  v_cinema uuid;
begin
  select cinema_id into v_cinema
    from public.operating_units
    where id = p_unit_id;
  return public.cinema_access(v_cinema);
end;
$$;


commit;
