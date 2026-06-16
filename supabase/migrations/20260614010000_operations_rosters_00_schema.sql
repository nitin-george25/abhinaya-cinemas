-- ============================================================================
-- 00 — Operations: staff rosters schema
--
-- Backs the Operations → Rosters → Daily Manager Roster surface.
--
-- Four tables:
--   staff_rosters            — one row per (cinema, staff_type, week_start).
--                              week_start is the Thursday that opens the
--                              Thu→Wed roster week.
--   roster_assignments       — one row per day in the week (7), naming the
--                              staff member on duty for that 3:00 PM → 3:00 PM
--                              (next-day) shift.
--   roster_swaps             — a request to swap two days; needs manager
--                              approval; carries a reason.
--   roster_emergency_leaves  — a day flagged as emergency leave; manager
--                              records the cover + approves.
--
-- Designed for daily managers first (staff_type = 'daily_manager') but the
-- staff_type column keeps it reusable for other staff rosters later.
--
-- Idempotent. Reuses helpers from earlier migrations:
--   cinema_access()  (catalog-normalization), is_owner(), is_entry_writer().
-- Adds one new helper: is_roster_manager() = owner | manager.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0) Helper — is_roster_manager(): owner or manager.
--    Rosters are built + approved by owner/manager; daily managers may only
--    request swaps and flag emergency leave (enforced by the policies below).
-- ----------------------------------------------------------------------------
create or replace function public.is_roster_manager()
  returns boolean
  language plpgsql stable security definer set search_path = public
as $$
begin
  return exists (
    select 1 from public.authorized_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and role in ('owner','manager')
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 1) staff_rosters — one per (cinema, staff_type, week_start = Thursday).
-- ----------------------------------------------------------------------------
create table if not exists public.staff_rosters (
  id          uuid primary key default gen_random_uuid(),
  cinema_id   uuid not null references public.cinemas(id) on delete cascade,
  staff_type  text not null default 'daily_manager',
  week_start  date not null,
  status      text not null default 'draft' check (status in ('draft','published')),
  notes       text,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text,
  -- Postgres dow: Sun=0 … Thu=4. The roster week opens on a Thursday.
  constraint staff_rosters_week_thursday check (extract(dow from week_start) = 4),
  constraint staff_rosters_unique unique (cinema_id, staff_type, week_start)
);

create index if not exists staff_rosters_cinema_week_idx
  on public.staff_rosters (cinema_id, staff_type, week_start desc);

alter table public.staff_rosters enable row level security;

-- ----------------------------------------------------------------------------
-- 2) roster_assignments — one per day of the week (day_offset 0..6 = Thu..Wed).
--    assignee_email may be null (unassigned). The shift is a fixed 24h window
--    starting 15:00 (3:00 PM) and running to 15:00 the next day.
-- ----------------------------------------------------------------------------
create table if not exists public.roster_assignments (
  id             uuid primary key default gen_random_uuid(),
  roster_id      uuid not null references public.staff_rosters(id) on delete cascade,
  work_date      date not null,
  day_offset     int  not null check (day_offset between 0 and 6),
  assignee_email text,
  shift_start    time not null default '15:00',
  shift_label    text not null default '3:00 PM → 3:00 PM (next day)',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     text,
  constraint roster_assignments_unique unique (roster_id, work_date)
);

create index if not exists roster_assignments_roster_idx
  on public.roster_assignments (roster_id);

alter table public.roster_assignments enable row level security;

-- ----------------------------------------------------------------------------
-- 3) roster_swaps — request to swap two days. Needs manager approval; the
--    reason is mandatory. On approval the client swaps the two assignments'
--    assignee_email values (managers have write on roster_assignments).
-- ----------------------------------------------------------------------------
create table if not exists public.roster_swaps (
  id                  uuid primary key default gen_random_uuid(),
  roster_id           uuid not null references public.staff_rosters(id) on delete cascade,
  requested_by        text not null,
  from_date           date not null,
  to_date             date not null,
  counterparty_email  text,
  reason              text not null,
  status              text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by          text,
  decided_at          timestamptz,
  decision_note       text,
  created_at          timestamptz not null default now()
);

create index if not exists roster_swaps_roster_status_idx
  on public.roster_swaps (roster_id, status);

alter table public.roster_swaps enable row level security;

-- ----------------------------------------------------------------------------
-- 4) roster_emergency_leaves — a day flagged as emergency leave. The manager
--    records a cover + approves. Reason is mandatory.
-- ----------------------------------------------------------------------------
create table if not exists public.roster_emergency_leaves (
  id           uuid primary key default gen_random_uuid(),
  roster_id    uuid not null references public.staff_rosters(id) on delete cascade,
  work_date    date not null,
  staff_email  text not null,
  reason       text not null,
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  cover_email  text,
  decided_by   text,
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists roster_emergency_leaves_roster_status_idx
  on public.roster_emergency_leaves (roster_id, status);

alter table public.roster_emergency_leaves enable row level security;

commit;
