-- ============================================================================
-- cash_17 — POS counters.
--
-- One cinema runs multiple POS counters (tills) inside each operating unit:
-- e.g. Box Office counter 1 + 2, an F&B counter. Until now a closing was
-- keyed (operating_unit_id, business_date, shift) — one closing per unit per
-- shift — so parallel counters couldn't each close their own till.
--
-- This migration:
--   1) Adds `pos_counters` — managed by the owner in Settings → Cash, the
--      same way screens are managed at cinema level. Each counter belongs
--      to an operating unit (and through it to the cinema).
--   2) Seeds one "Counter 1" per existing operating unit so live data keeps
--      working in both staging and prod without manual steps.
--   3) Re-keys daily_cash_closings: unique (pos_counter_id, business_date,
--      shift). Existing closings are backfilled to their unit's default
--      counter. A composite FK guarantees the counter belongs to the
--      closing's unit.
--   4) Makes petty_expenses counter-scoped (required), backfilled the same
--      way, so each expense reconciles against its own counter's closing.
--   5) Links approved petty expenses to the counter's closing when the
--      manager signs (status → counted). The existing
--      trg_recompute_closing_petty trigger then keeps petty_expenses_paid
--      and the generated discrepancy honest.
--
-- Works identically in staging and prod — pure backfill, no hard-coded ids.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) pos_counters
-- ----------------------------------------------------------------------------

create table if not exists public.pos_counters (
  id                 uuid primary key default gen_random_uuid(),
  cinema_id          uuid not null references public.cinemas(id) on delete cascade,
  operating_unit_id  uuid not null references public.operating_units(id) on delete restrict,
  name               text not null,
  display_order      int not null default 0,
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         text,
  constraint pos_counters_unit_name_uk unique (operating_unit_id, name),
  -- Composite uniqueness target so child tables can enforce
  -- "counter belongs to the row's unit" with a two-column FK.
  constraint pos_counters_id_unit_uk unique (id, operating_unit_id)
);

create index if not exists pos_counters_cinema_idx on public.pos_counters (cinema_id);
create index if not exists pos_counters_unit_idx   on public.pos_counters (operating_unit_id);

alter table public.pos_counters enable row level security;

-- RLS mirrors operating_units: any cinema member reads, owner writes.
drop policy if exists pos_counters_read  on public.pos_counters;
drop policy if exists pos_counters_write on public.pos_counters;
create policy pos_counters_read on public.pos_counters
  for select using (public.cinema_access(cinema_id));
create policy pos_counters_write on public.pos_counters
  for all using (public.cinema_access(cinema_id) and public.is_owner())
         with check (public.cinema_access(cinema_id) and public.is_owner());

-- ----------------------------------------------------------------------------
-- 2) Seed — one default counter per operating unit (idempotent)
-- ----------------------------------------------------------------------------

insert into public.pos_counters (cinema_id, operating_unit_id, name, display_order)
select u.cinema_id, u.id, 'Counter 1', 10
  from public.operating_units u
 where not exists (
   select 1 from public.pos_counters pc where pc.operating_unit_id = u.id
 );

-- ----------------------------------------------------------------------------
-- 3) daily_cash_closings — per-counter natural key
-- ----------------------------------------------------------------------------

alter table public.daily_cash_closings
  add column if not exists pos_counter_id uuid;

-- Backfill existing closings to their unit's first counter.
update public.daily_cash_closings c
   set pos_counter_id = (
     select pc.id
       from public.pos_counters pc
      where pc.operating_unit_id = c.operating_unit_id
      order by pc.display_order, pc.created_at
      limit 1
   )
 where c.pos_counter_id is null;

alter table public.daily_cash_closings
  alter column pos_counter_id set not null;

-- Counter must belong to the closing's unit.
alter table public.daily_cash_closings
  drop constraint if exists daily_cash_closings_counter_fk;
alter table public.daily_cash_closings
  add constraint daily_cash_closings_counter_fk
  foreign key (pos_counter_id, operating_unit_id)
  references public.pos_counters (id, operating_unit_id)
  on delete restrict;

-- Re-key: one closing per counter per date per shift.
alter table public.daily_cash_closings
  drop constraint if exists daily_cash_closings_unit_date_shift_uk;
alter table public.daily_cash_closings
  drop constraint if exists daily_cash_closings_counter_date_shift_uk;
alter table public.daily_cash_closings
  add constraint daily_cash_closings_counter_date_shift_uk
  unique (pos_counter_id, business_date, shift);

create index if not exists daily_cash_closings_counter_date_idx
  on public.daily_cash_closings (pos_counter_id, business_date desc);

-- ----------------------------------------------------------------------------
-- 4) petty_expenses — counter-scoped (required)
-- ----------------------------------------------------------------------------

alter table public.petty_expenses
  add column if not exists pos_counter_id uuid;

update public.petty_expenses e
   set pos_counter_id = (
     select pc.id
       from public.pos_counters pc
      where pc.operating_unit_id = e.operating_unit_id
      order by pc.display_order, pc.created_at
      limit 1
   )
 where e.pos_counter_id is null;

alter table public.petty_expenses
  alter column pos_counter_id set not null;

alter table public.petty_expenses
  drop constraint if exists petty_expenses_counter_fk;
alter table public.petty_expenses
  add constraint petty_expenses_counter_fk
  foreign key (pos_counter_id, operating_unit_id)
  references public.pos_counters (id, operating_unit_id)
  on delete restrict;

create index if not exists petty_expenses_counter_date_idx
  on public.petty_expenses (pos_counter_id, expense_date desc);

-- ----------------------------------------------------------------------------
-- 5) Link approved petty expenses to the counter's closing on manager sign.
--
--    Fires on the draft → counted transition (manager signature) so the
--    cashier reviews a closing whose petty_expenses_paid is already final.
--    Also fires on → signed as a safety net for legacy rows that skipped
--    the counted step. Idempotent: only picks up unlinked approved expenses
--    for the same counter + business date. trg_recompute_closing_petty
--    (cash_03) reacts to reconciled_closing_id changing and refreshes the
--    closing's petty_expenses_paid total.
-- ----------------------------------------------------------------------------

create or replace function public.fn_link_petty_to_closing()
  returns trigger
  language plpgsql
  security definer set search_path = public
as $$
begin
  if new.status in ('counted', 'signed')
     and (old.status is distinct from new.status) then
    update public.petty_expenses e
       set reconciled_closing_id = new.id
     where e.pos_counter_id = new.pos_counter_id
       and e.expense_date   = new.business_date
       and e.status         = 'approved'
       and e.reconciled_closing_id is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_link_petty_to_closing on public.daily_cash_closings;
create trigger trg_link_petty_to_closing
  after update of status on public.daily_cash_closings
  for each row execute function public.fn_link_petty_to_closing();

commit;
