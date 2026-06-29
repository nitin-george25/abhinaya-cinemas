-- ============================================================================
-- payments_01 — Payment-type taxonomy (unified Payments module, phase 1).
--
-- WHY THIS EXISTS
-- ---------------
-- The unified Payments module (docs/Payments - Unified Workflow Design.md §5)
-- replaces the free-text payment-request create with a *typed* "Make a Payment"
-- form. Each payment now carries a payment_type whose flags drive the flow and
-- the books:
--   • invoice_rule    — required | exempt | settlement (is an attachment needed?)
--   • is_asset        — capex; forces the quotation stage (phase 4)
--   • requires_quotation — derived from is_asset (kept explicit for the editor)
--   • quote_skip_floor   — trivial asset buys below ₹X may skip quoting
--   • accounting_head — Zoho/Tally posting target + cash-flow report grouping
--   • zoho_push       — F&B supplier payments post to Zoho on mark-paid (phase 6)
--
-- Owner-editable in Settings. Cinema-scoped so the multi-cinema future works.
-- The 16-type seed lands in payments_02; this migration only creates the table.
--
-- RLS mirrors the other catalog tables: read = cinema_access,
-- write = owner only (the taxonomy is an owner-managed setting).
--
-- HOW TO RUN: npm run db:push:staging / :prod (Supabase CLI). Idempotent.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Table.
-- ----------------------------------------------------------------------------
create table if not exists public.payment_types (
  id                 uuid primary key default gen_random_uuid(),
  cinema_id          uuid not null references public.cinemas(id) on delete cascade,
  name               text not null,
  -- normalized payee-category token; the form keys payee source off this
  -- (distributor → distributors catalog, internal → none, else → parties).
  payee_category     text not null
                       check (payee_category in
                         ('distributor','vendor','landlord','employee',
                          'government','bank','internal','other')),
  invoice_rule       text not null default 'required'
                       check (invoice_rule in ('required','exempt','settlement')),
  is_asset           boolean not null default false,
  requires_quotation boolean not null default false,
  quote_skip_floor   numeric(14,2) not null default 0,
  accounting_head    text not null,
  zoho_push          boolean not null default false,
  active             boolean not null default true,
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         text
);

-- One row per (cinema, type name) — lets the seed be ON CONFLICT DO NOTHING and
-- guards the owner editor against accidental duplicates.
create unique index if not exists payment_types_cinema_name_uidx
  on public.payment_types (cinema_id, lower(name));

create index if not exists payment_types_cinema_active_idx
  on public.payment_types (cinema_id, sort_order)
  where active;

-- ----------------------------------------------------------------------------
-- 2) updated_at touch trigger (reuse the shared fn if present).
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc where proname = 'touch_updated_at') then
    drop trigger if exists payment_types_touch on public.payment_types;
    create trigger payment_types_touch
      before update on public.payment_types
      for each row execute function public.touch_updated_at();
  end if;
end$$;

-- ----------------------------------------------------------------------------
-- 3) RLS — read for any cinema member; write for the owner only.
-- ----------------------------------------------------------------------------
alter table public.payment_types enable row level security;

drop policy if exists payment_types_read  on public.payment_types;
drop policy if exists payment_types_write on public.payment_types;

create policy payment_types_read on public.payment_types
  for select using (public.cinema_access(cinema_id));

create policy payment_types_write on public.payment_types
  for all using (public.cinema_access(cinema_id) and public.is_owner())
         with check (public.cinema_access(cinema_id) and public.is_owner());

commit;

-- ============================================================================
-- VERIFY (after applying):
--   select to_regclass('public.payment_types');
--   select polname from pg_policies where tablename = 'payment_types';
-- ============================================================================
