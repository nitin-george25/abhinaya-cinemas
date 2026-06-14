-- ============================================================================
-- 02 — Phase 2: petty_expenses + receipts storage bucket
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) petty_expenses table
-- ----------------------------------------------------------------------------

create table if not exists public.petty_expenses (
  id                     uuid primary key default gen_random_uuid(),
  operating_unit_id      uuid not null references public.operating_units(id) on delete restrict,
  expense_date           date not null default current_date,

  amount                 numeric(14,2) not null check (amount > 0),
  category               text,                              -- "Food", "Stationery", "Travel"
  description            text not null,
  paid_to                text,                              -- vendor name

  requested_by_email     text not null,                     -- cashier
  approved_by_email      text,                              -- daily manager
  approved_at            timestamptz,
  rejected_reason        text,

  receipt_url            text,                              -- Supabase Storage path

  status                 text not null default 'pending'
                            check (status in ('pending','approved','rejected')),

  -- Filled when the day's closing reconciles approved expenses.
  reconciled_closing_id  uuid references public.daily_cash_closings(id) on delete set null,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists petty_expenses_unit_date_idx
  on public.petty_expenses (operating_unit_id, expense_date desc);
create index if not exists petty_expenses_pending_idx
  on public.petty_expenses (operating_unit_id, expense_date) where status = 'pending';
create index if not exists petty_expenses_requested_by_idx
  on public.petty_expenses (requested_by_email);

alter table public.petty_expenses enable row level security;


-- ----------------------------------------------------------------------------
-- 2) Storage bucket: petty-receipts
--    Public-read so users can view their own receipts inline.
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
  values ('petty-receipts', 'petty-receipts', true)
  on conflict (id) do update set public = excluded.public;

-- Bucket policies (scoped to this bucket only).
drop policy if exists "petty_receipts_read"   on storage.objects;
drop policy if exists "petty_receipts_write"  on storage.objects;
drop policy if exists "petty_receipts_update" on storage.objects;
drop policy if exists "petty_receipts_delete" on storage.objects;

create policy "petty_receipts_read" on storage.objects
  for select using (bucket_id = 'petty-receipts');

create policy "petty_receipts_write" on storage.objects
  for insert with check (
    bucket_id = 'petty-receipts'
    and (public.is_cashier() or public.can_approve_petty_expense())
  );

create policy "petty_receipts_update" on storage.objects
  for update using (
    bucket_id = 'petty-receipts' and public.can_approve_petty_expense()
  );

create policy "petty_receipts_delete" on storage.objects
  for delete using (
    bucket_id = 'petty-receipts' and public.is_owner()
  );


commit;
