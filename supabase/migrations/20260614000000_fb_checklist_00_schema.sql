-- ============================================================================
-- 00 — F&B SOP checklist schema
--
-- Two tables:
--   fb_checklist_runs   — one row per completed checklist instance
--                         (a date + type + shift, with sign-off + cash recon).
--   fb_checklist_items  — one row per SOP step result inside a run.
--
-- The bilingual step *text* lives in the app (src/lib/fbChecklist.ts), keyed
-- by sop_code (e.g. 'FB-OPEN-04'), so the DB stays lean and the wording stays
-- in one place. We only persist which steps were done + the evidence.
--
-- Idempotent. Run after the catalog-normalization + cash-management migrations
-- (it reuses their helpers: cinema_access(), is_entry_writer(), is_owner()).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Runs — one per (cinema, date, checklist_type, shift).
-- ----------------------------------------------------------------------------
create table if not exists public.fb_checklist_runs (
  id                    uuid primary key default gen_random_uuid(),
  cinema_id             uuid not null references public.cinemas(id) on delete cascade,
  run_date              date not null,
  checklist_type        text not null check (checklist_type in ('opening','midshift','closing')),
  shift                 text not null default '',
  status                text not null default 'in_progress' check (status in ('in_progress','completed')),
  staff_name            text,
  staff_email           text,
  manager_signoff_email text,
  manager_signed_at     timestamptz,
  notes                 text,
  -- Free-form extras: closing cash reconciliation (pos_total, cash_counted,
  -- upi_total, variance), interval times, etc. Kept as jsonb so the shape can
  -- evolve without a migration.
  extra                 jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  updated_by            text,
  constraint fb_checklist_runs_unique unique (cinema_id, run_date, checklist_type, shift)
);

create index if not exists fb_checklist_runs_cinema_date_idx
  on public.fb_checklist_runs (cinema_id, run_date desc);

alter table public.fb_checklist_runs enable row level security;

-- ----------------------------------------------------------------------------
-- 2) Items — one per SOP step inside a run.
-- ----------------------------------------------------------------------------
create table if not exists public.fb_checklist_items (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references public.fb_checklist_runs(id) on delete cascade,
  sop_code     text not null,
  checked      boolean not null default false,
  done_at      timestamptz,
  initial      text,
  photo_url    text,
  position     int not null default 0,
  created_at   timestamptz not null default now(),
  constraint fb_checklist_items_unique unique (run_id, sop_code)
);

create index if not exists fb_checklist_items_run_idx
  on public.fb_checklist_items (run_id);

alter table public.fb_checklist_items enable row level security;

commit;
