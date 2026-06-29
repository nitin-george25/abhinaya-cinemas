-- ============================================================================
-- payments_03 — Extend payment_requests for the typed Make-a-Payment form +
--               vendor-advance proformas (unified Payments module, phase 1).
--
-- WHAT THIS DOES
-- --------------
--   1) payment_proformas — first-class proforma invoices for vendor advances
--      (§8.2). Distinct from the final tax invoice; the advance links to one.
--   2) Extends public.payment_requests with the typed-form fields (§11):
--        payment_type_id, payee_party_id, payee_distributor_id,
--        is_advance + advance link target (movie / proforma / party),
--        proforma_url, and the asset-invoice split (subtotal/gst/freight/total).
--   3) Adds 'draft' to the status CHECK (additive — the legacy cash payments
--      page keeps working on its own statuses; the full §6 lifecycle enum lands
--      in phase 2).
--   4) Relaxes the mandatory-invoice CHECK (added in cash_08) so EXEMPT typed
--      payments can be saved without an attachment. The invoice rule for typed
--      rows is enforced at the app + submit-transition layer (phase 2): a row
--      carrying a payment_type_id is allowed to have no invoice_url here;
--      legacy free-text rows (no payment_type_id) still require one.
--
-- HOW TO RUN: npm run db:push:staging / :prod (Supabase CLI). Idempotent.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) payment_proformas — vendor-advance proforma invoices.
-- ----------------------------------------------------------------------------
create table if not exists public.payment_proformas (
  id          uuid primary key default gen_random_uuid(),
  cinema_id   uuid not null references public.cinemas(id) on delete cascade,
  party_id    uuid references public.parties(id) on delete set null,
  file_url    text,
  amount      numeric(14,2),
  notes       text,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists payment_proformas_cinema_idx
  on public.payment_proformas (cinema_id, party_id);

alter table public.payment_proformas enable row level security;

drop policy if exists payment_proformas_read  on public.payment_proformas;
drop policy if exists payment_proformas_write on public.payment_proformas;

create policy payment_proformas_read on public.payment_proformas
  for select using (public.cinema_access(cinema_id));

-- Raise rights mirror payment_requests: accountant + manager + owner.
create policy payment_proformas_write on public.payment_proformas
  for all using (
    public.cinema_access(cinema_id)
    and exists (select 1 from public.authorized_users
                 where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                   and role in ('owner','manager','accountant'))
  ) with check (
    public.cinema_access(cinema_id)
    and exists (select 1 from public.authorized_users
                 where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                   and role in ('owner','manager','accountant'))
  );

-- ----------------------------------------------------------------------------
-- 2) Extend payment_requests with the typed-form columns.
-- ----------------------------------------------------------------------------
alter table public.payment_requests
  add column if not exists payment_type_id      uuid    references public.payment_types(id) on delete set null,
  -- intended "paid from" account chosen at creation; confirmed/overwritten by
  -- paid_via_bank_account_id at mark-paid (phase 2).
  add column if not exists bank_account_id      uuid    references public.bank_accounts(id) on delete set null,
  add column if not exists payee_party_id       uuid    references public.parties(id)       on delete set null,
  add column if not exists payee_distributor_id text    references public.distributors(id)  on delete set null,
  add column if not exists is_advance           boolean not null default false,
  add column if not exists advance_movie_id     text    references public.movies(id)        on delete set null,
  add column if not exists advance_proforma_id  uuid    references public.payment_proformas(id) on delete set null,
  add column if not exists advance_party_id     uuid    references public.parties(id)       on delete set null,
  add column if not exists proforma_url         text,
  add column if not exists subtotal             numeric(14,2),
  add column if not exists gst                  numeric(14,2),
  add column if not exists freight              numeric(14,2),
  add column if not exists total                numeric(14,2);

create index if not exists payment_requests_type_idx
  on public.payment_requests (payment_type_id);

-- ----------------------------------------------------------------------------
-- 3) Add 'draft' to the status CHECK (additive). The inline CHECK from cash_03
--    is auto-named payment_requests_status_check.
-- ----------------------------------------------------------------------------
alter table public.payment_requests
  drop constraint if exists payment_requests_status_check;
alter table public.payment_requests
  add constraint payment_requests_status_check
  check (status in ('draft','pending','approved','rejected','paid'));

-- ----------------------------------------------------------------------------
-- 4) Relax the mandatory-invoice CHECK so EXEMPT typed payments can be saved
--    without an attachment. Legacy free-text rows (no payment_type_id) still
--    require an invoice_url.
-- ----------------------------------------------------------------------------
alter table public.payment_requests
  drop constraint if exists payment_requests_invoice_required_chk;
alter table public.payment_requests
  add constraint payment_requests_invoice_required_chk
  check (
    (invoice_url is not null and length(trim(invoice_url)) > 0)
    or payment_type_id is not null
  );

commit;

-- ============================================================================
-- VERIFY (after applying):
--   select to_regclass('public.payment_proformas');
--   select column_name from information_schema.columns
--     where table_name = 'payment_requests' and column_name like '%advance%';
--   -- exempt typed row allowed without invoice:
--   --   insert ... (payment_type_id, ...) values (<exempt type>, ...);  -- OK
-- ============================================================================
