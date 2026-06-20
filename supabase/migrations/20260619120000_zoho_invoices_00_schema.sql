-- ============================================================================
-- Zoho Books integration — 00 schema (invoices + line items + sync plumbing).
--
-- One unified raw store for every Zoho "invoice" document:
--   • type='purchase'  → Zoho Bills (accounts payable). Surfaced in the new
--     top-level "Invoices" page.
--   • type='sales'     → Zoho sales Invoices (cinema F&B concession sales, fed
--     by the POS). These are rolled up per cinema+date into public.fb_entries
--     (source='zoho') by the Edge functions, so the existing Dashboard /
--     /reports/fb / /fb/history readers are unchanged.
--
-- Both purchase and sales are the same shape, so they share `invoices` +
-- `invoice_line_items`, tagged by `type` and `category`. The project finance
-- tables (project_invoices) stay separate FOR NOW; the nullable project_id /
-- budget_item_id / expense_id columns are reserved so they can fold in later
-- without a schema break.
--
-- Sync plumbing:
--   • zoho_orgs        — maps a Zoho (organization_id, branch_id) → cinema_id.
--     One Zoho org spans multiple cinemas; the branch field selects which.
--   • zoho_sync_state  — per (org, module) last-modified watermark for the
--     scheduled pull (backfill + reconciliation).
--   • zoho_dead_letters— records that could not be mapped/processed, so an
--     unmapped branch or a bad payload is parked, never silently dropped.
--
-- Also adds public.fb_entries.source so the client delta-sync engine can tell
-- its own (manual) rows from Zoho-imported ones and never reap the latter.
-- Default 'manual' keeps every existing row client-owned — no backfill needed.
--
-- RLS lives in the companion 20260619120100_zoho_invoices_01_rls.sql.
-- HOW TO RUN: applied via `npm run db:push:staging` / `:prod` (Supabase CLI).
-- Idempotent / safe to re-run.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Invoices — unified header row for purchase (Bills) + sales (Invoices).
-- ----------------------------------------------------------------------------
create table if not exists public.invoices (
  id               uuid primary key default gen_random_uuid(),
  cinema_id        uuid not null references public.cinemas(id) on delete cascade,
  type             text not null check (type in ('purchase','sales')),
  source           text not null default 'zoho' check (source in ('zoho','manual')),
  category         text,                                   -- free tag e.g. 'f&b-supply','utilities'
  -- Zoho provenance (idempotency key + audit).
  zoho_org_id      text,
  zoho_branch_id   text,
  zoho_id          text,                                   -- bill_id / invoice_id
  -- Document fields (party_name = vendor for purchase, customer for sales).
  party_name       text,
  invoice_no       text,
  invoice_date     date,
  due_date         date,
  status           text,
  currency         text not null default 'INR',
  -- Money (rupees, 2dp). GST split kept for the Indian accountant's view.
  sub_total        numeric(14,2) not null default 0,
  tax_total        numeric(14,2) not null default 0,
  cgst             numeric(14,2) not null default 0,
  sgst             numeric(14,2) not null default 0,
  igst             numeric(14,2) not null default 0,
  total            numeric(14,2) not null default 0,
  balance          numeric(14,2) not null default 0,
  -- India/GST context.
  gst_treatment    text,
  place_of_supply  text,
  gstin            text,
  notes            text,
  -- Reserved for the later project_invoices fold-in (nullable, no FK yet).
  project_id       text,
  budget_item_id   text,
  expense_id       text,
  -- Raw Zoho payload — makes every derived field safely re-computable.
  raw              jsonb not null default '{}'::jsonb,
  zoho_last_modified timestamptz,
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       text,
  -- Idempotent upsert key. NULL zoho_id (manual rows) are not de-duped — that
  -- is correct: Postgres treats NULLs as distinct in a UNIQUE constraint.
  constraint invoices_zoho_unique unique (cinema_id, zoho_id)
);
create index if not exists invoices_cinema_type_date_idx
  on public.invoices (cinema_id, type, invoice_date desc);
create index if not exists invoices_sales_recompute_idx
  on public.invoices (cinema_id, invoice_date) where type = 'sales';

-- ----------------------------------------------------------------------------
-- 2) Invoice line items — full fidelity (HSN/SAC + per-line GST split).
--    Replaced wholesale on each upsert of the parent (delete + re-insert).
-- ----------------------------------------------------------------------------
create table if not exists public.invoice_line_items (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references public.invoices(id) on delete cascade,
  line_no         int not null default 0,
  zoho_line_id    text,
  name            text,
  description     text,
  hsn_or_sac      text,
  quantity        numeric(14,3) not null default 0,
  rate            numeric(14,2) not null default 0,
  item_total      numeric(14,2) not null default 0,
  tax_percentage  numeric(6,2)  not null default 0,
  cgst            numeric(14,2) not null default 0,
  sgst            numeric(14,2) not null default 0,
  igst            numeric(14,2) not null default 0,
  account         text,
  raw             jsonb not null default '{}'::jsonb
);
create index if not exists invoice_line_items_invoice_idx
  on public.invoice_line_items (invoice_id);

-- ----------------------------------------------------------------------------
-- 3) Zoho org/branch → cinema mapping. One org, many cinemas: the branch
--    field on each Zoho record selects the cinema.
-- ----------------------------------------------------------------------------
create table if not exists public.zoho_orgs (
  id              uuid primary key default gen_random_uuid(),
  zoho_org_id     text not null,
  zoho_branch_id  text,                                    -- null = org-wide / single-branch org
  cinema_id       uuid not null references public.cinemas(id) on delete cascade,
  label           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      text,
  constraint zoho_orgs_unique unique (zoho_org_id, zoho_branch_id)
);

-- ----------------------------------------------------------------------------
-- 4) Pull watermark — one row per (org, module). The scheduled pull asks Zoho
--    for everything modified since `last_modified`, then splits records to
--    cinemas by branch at write time (so the watermark is org-wide, not per
--    branch).
-- ----------------------------------------------------------------------------
create table if not exists public.zoho_sync_state (
  id              uuid primary key default gen_random_uuid(),
  zoho_org_id     text not null,
  module          text not null check (module in ('bills','invoices')),
  last_modified   timestamptz,
  last_run_at     timestamptz,
  updated_at      timestamptz not null default now(),
  constraint zoho_sync_state_unique unique (zoho_org_id, module)
);

-- ----------------------------------------------------------------------------
-- 5) Dead-letter parking for unmapped / unprocessable records. A missing
--    branch→cinema mapping or a malformed payload lands here instead of being
--    written to the wrong cinema or dropped.
-- ----------------------------------------------------------------------------
create table if not exists public.zoho_dead_letters (
  id              uuid primary key default gen_random_uuid(),
  origin          text not null check (origin in ('webhook','sync')),
  module          text,
  zoho_org_id     text,
  zoho_branch_id  text,
  zoho_id         text,
  reason          text not null,
  raw             jsonb not null default '{}'::jsonb,
  resolved        boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists zoho_dead_letters_unresolved_idx
  on public.zoho_dead_letters (created_at desc) where resolved = false;

-- ----------------------------------------------------------------------------
-- 6) fb_entries.source — distinguishes manual/DSR rows (client-owned by the
--    delta-sync engine) from Zoho-imported rows (server-owned, never reaped).
--    Default 'manual' keeps all existing rows client-owned: zero backfill.
--    (fb_entries predates committed migrations — base table is live-DB
--    bootstrapped — so this is an ALTER, not part of a CREATE.)
-- ----------------------------------------------------------------------------
alter table public.fb_entries
  add column if not exists source text not null default 'manual';

-- ----------------------------------------------------------------------------
-- 7) updated_at triggers (reuse the shared touch fn if present — it lives in a
--    pre-CLI root SQL file, so guard on its existence).
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc where proname = 'touch_updated_at') then
    drop trigger if exists invoices_touch on public.invoices;
    create trigger invoices_touch before update on public.invoices
      for each row execute function public.touch_updated_at();

    drop trigger if exists zoho_orgs_touch on public.zoho_orgs;
    create trigger zoho_orgs_touch before update on public.zoho_orgs
      for each row execute function public.touch_updated_at();

    drop trigger if exists zoho_sync_state_touch on public.zoho_sync_state;
    create trigger zoho_sync_state_touch before update on public.zoho_sync_state
      for each row execute function public.touch_updated_at();
  end if;
end$$;

commit;

-- ============================================================================
-- VERIFY (after applying):
--   select to_regclass('public.invoices'),
--          to_regclass('public.invoice_line_items'),
--          to_regclass('public.zoho_orgs'),
--          to_regclass('public.zoho_sync_state'),
--          to_regclass('public.zoho_dead_letters');           -- all non-null
--   select count(*) from public.fb_entries where source <> 'manual';  -- 0
-- ============================================================================
