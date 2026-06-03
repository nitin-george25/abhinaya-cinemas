-- ============================================================================
-- 11 — Unit renames, per-unit payment-method mapping, cashier dropdown RLS.
--
--   1. Rename seeded operating units: "Theatre" → "Box Office", "Cafe" → "F&B".
--   2. New join table operating_unit_payment_methods so each unit has its
--      own list of accepted methods (BO has Cash + UPI; F&B has Cash +
--      Pinelabs; etc.). Settings UI will edit this, and the closing form
--      will filter by the selected unit.
--   3. Seed defaults: BO gets cash + paytm + phonepe; F&B gets cash +
--      pinelabs. The owner can adjust from Settings → Cash.
--   4. RLS policy on authorized_users letting manager-tier roles read all
--      rows — fixes the empty cashier dropdown in the closing dialog
--      (the previous self-only SELECT policy hid cashier rows from the
--      manager picking who's on till).
--
-- Idempotent — re-runs safely.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Rename seeded operating units.
--    Touches only the rows we seeded by name; preserves any operator-added
--    units. Bank accounts + closings reference these by UUID, so renaming
--    doesn't break any FK.
-- ----------------------------------------------------------------------------

update public.operating_units
   set name = 'Box Office'
 where name = 'Theatre';

update public.operating_units
   set name = 'F&B'
 where name = 'Cafe';


-- ----------------------------------------------------------------------------
-- 2) operating_unit_payment_methods — m:n.
--
--    The closing dialog filters payment-method inputs by the selected unit.
--    Without rows, all methods are shown (sensible default for cinemas
--    that haven't customised yet); with rows, only those linked are shown.
--    The DAL implements this fallback so existing data keeps working.
-- ----------------------------------------------------------------------------

create table if not exists public.operating_unit_payment_methods (
  operating_unit_id  uuid not null references public.operating_units(id) on delete cascade,
  payment_method_id  uuid not null references public.payment_methods(id) on delete cascade,
  display_order      int  not null default 0,
  created_at         timestamptz not null default now(),
  primary key (operating_unit_id, payment_method_id)
);

create index if not exists oupm_unit_idx
  on public.operating_unit_payment_methods (operating_unit_id, display_order);

alter table public.operating_unit_payment_methods enable row level security;

drop policy if exists oupm_read  on public.operating_unit_payment_methods;
drop policy if exists oupm_write on public.operating_unit_payment_methods;

create policy oupm_read on public.operating_unit_payment_methods
  for select using (exists (
    select 1 from public.operating_units u
     where u.id = operating_unit_id and public.cinema_access(u.cinema_id)
  ));

create policy oupm_write on public.operating_unit_payment_methods
  for all using (exists (
    select 1 from public.operating_units u
     where u.id = operating_unit_id and public.cinema_access(u.cinema_id)
       and public.is_owner()
  )) with check (exists (
    select 1 from public.operating_units u
     where u.id = operating_unit_id and public.cinema_access(u.cinema_id)
       and public.is_owner()
  ));


-- ----------------------------------------------------------------------------
-- 3) Seed defaults — only when the mapping is currently empty for a unit.
--    Avoids stomping on owner customisations on re-run.
-- ----------------------------------------------------------------------------

-- Box Office: cash + paytm + phonepe
insert into public.operating_unit_payment_methods (operating_unit_id, payment_method_id, display_order)
  select u.id, m.id, 10
    from public.operating_units u
    join public.payment_methods m on m.cinema_id = u.cinema_id and m.code = 'cash'
   where u.name = 'Box Office'
     and not exists (
       select 1 from public.operating_unit_payment_methods x
        where x.operating_unit_id = u.id
     )
on conflict do nothing;

insert into public.operating_unit_payment_methods (operating_unit_id, payment_method_id, display_order)
  select u.id, m.id, 20
    from public.operating_units u
    join public.payment_methods m on m.cinema_id = u.cinema_id and m.code = 'paytm'
   where u.name = 'Box Office'
on conflict do nothing;

insert into public.operating_unit_payment_methods (operating_unit_id, payment_method_id, display_order)
  select u.id, m.id, 30
    from public.operating_units u
    join public.payment_methods m on m.cinema_id = u.cinema_id and m.code = 'phonepe'
   where u.name = 'Box Office'
on conflict do nothing;

-- F&B: cash + pinelabs
insert into public.operating_unit_payment_methods (operating_unit_id, payment_method_id, display_order)
  select u.id, m.id, 10
    from public.operating_units u
    join public.payment_methods m on m.cinema_id = u.cinema_id and m.code = 'cash'
   where u.name = 'F&B'
     and not exists (
       select 1 from public.operating_unit_payment_methods x
        where x.operating_unit_id = u.id
     )
on conflict do nothing;

insert into public.operating_unit_payment_methods (operating_unit_id, payment_method_id, display_order)
  select u.id, m.id, 20
    from public.operating_units u
    join public.payment_methods m on m.cinema_id = u.cinema_id and m.code = 'pinelabs'
   where u.name = 'F&B'
on conflict do nothing;


-- ----------------------------------------------------------------------------
-- 4) authorized_users read policy — manager tier sees everyone.
--
--    The pre-Phase-11 policy allowed only self-reads, so the cashier
--    dropdown in the closing form returned empty for owner/manager users.
--    We keep that legacy self-read intact and add a parallel policy that
--    lets anyone qualifying as owner / manager / daily_manager read all
--    rows. SECURITY DEFINER helpers prevent RLS recursion.
-- ----------------------------------------------------------------------------

-- Helper: any manager-tier role. Mirrors can_approve_petty_expense() but
-- named clearly for this gate.
create or replace function public.can_pick_cashier() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.authorized_users
     where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
       and role in ('owner','manager','daily_manager')
  );
$$;

drop policy if exists authorized_users_read_self        on public.authorized_users;
drop policy if exists authorized_users_read_for_picker  on public.authorized_users;

-- Self-read — every signed-in user can still read their own row.
create policy authorized_users_read_self on public.authorized_users
  for select using (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- Manager-tier read — owner / manager / daily_manager can list everyone
-- so the cashier dropdown populates and Settings → Users works.
create policy authorized_users_read_for_picker on public.authorized_users
  for select using (public.can_pick_cashier());


commit;
