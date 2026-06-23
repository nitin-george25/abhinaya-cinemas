-- ============================================================================
-- Picture Ending — 01 — settlement tables.
--
-- Two transactional tables (NOT part of the config blob — they are event
-- records, loaded by their own DAL like cash / invoices):
--
--   public.distributor_payments
--     Money already paid to a distributor — the "ADVANCE" lines on the
--     statement (RTGS / cheque / etc.), plus the final settlement payment.
--     Reusable beyond Picture Ending (a distributor ledger later on).
--
--   public.picture_ending_statements
--     One persisted statement per generated document, with a running
--     statement number per cinema. Stores the editable inputs AND a frozen
--     snapshot of the computed weeks/totals so a re-print is byte-identical
--     even if the underlying DCR entries are later edited.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run on BOTH
-- staging and prod. Idempotent.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) distributor_payments — advances + settlements.
--    distributor_id / movie_id are text FKs (those PKs are text). ON DELETE
--    SET NULL so removing a catalog row never deletes a payment record.
-- ----------------------------------------------------------------------------
create table if not exists public.distributor_payments (
  id              uuid primary key default gen_random_uuid(),
  cinema_id       uuid not null references public.cinemas(id) on delete restrict,
  distributor_id  text references public.distributors(id) on delete set null,
  movie_id        text references public.movies(id)       on delete set null,
  paid_on         date not null,
  amount          numeric(14,2) not null,
  mode            text,            -- rtgs | neft | imps | upi | cheque | cash | adjustment
  instrument_ref  text,            -- cheque no / UTR / txn reference
  bank            text,            -- bank + account label, e.g. "ICICI BANK (ABHINAYA)"
  kind            text not null default 'advance'
                    check (kind in ('advance','settlement')),
  note            text,
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      text
);

create index if not exists distributor_payments_cinema_idx
  on public.distributor_payments (cinema_id, paid_on);
create index if not exists distributor_payments_distributor_idx
  on public.distributor_payments (distributor_id);
create index if not exists distributor_payments_movie_idx
  on public.distributor_payments (movie_id);

-- ----------------------------------------------------------------------------
-- 2) picture_ending_statements — the persisted statement.
--    statement_no is a per-cinema running number (unique (cinema_id, no)).
--    The weeks/totals/advances JSON columns freeze the computed document.
-- ----------------------------------------------------------------------------
create table if not exists public.picture_ending_statements (
  id                uuid primary key default gen_random_uuid(),
  cinema_id         uuid not null references public.cinemas(id) on delete restrict,
  statement_no      int  not null,
  movie_id          text references public.movies(id)        on delete set null,
  distributor_id    text references public.distributors(id)  on delete set null,

  -- Denormalized identity snapshot (a filed document renders the names it was
  -- filed with, even if the catalog is later renamed).
  movie_name        text,
  movie_format      text,        -- e.g. "M-2D" (language + dimension)
  distributor_name  text,
  theatre_name      text,        -- "NAME OF THEATRE" line
  representative    text,

  statement_date    date not null,
  run_from          date,
  run_to            date,
  hold_over_date    date,        -- auto-computed best-3 < full-house day

  -- Editable inputs / rates.
  tax_kind          text not null default 'intra'
                      check (tax_kind in ('intra','inter')),
  gst_pct           numeric(6,3) not null default 18,   -- on distributor share
  publicity_pct     numeric(6,3) not null default 2,    -- of ex-share
  tds_pct           numeric(6,3) not null default 2,    -- of share + publicity
  flex_charge       numeric(14,2) not null default 0,
  hold_over_amount  numeric(14,2) not null default 0,
  round_off         numeric(8,2)  not null default 0,

  -- Frozen computed snapshot.
  weeks             jsonb not null default '[]'::jsonb,  -- [{week,from,to,days,net,exShare,sharePct,share}]
  totals            jsonb not null default '{}'::jsonb,  -- {share,shareGst,publicity,publicityGst,tds,advances,credit,debit,balance,...}
  advances          jsonb not null default '[]'::jsonb,  -- snapshot of the advance lines used

  status            text not null default 'draft'
                      check (status in ('draft','final','sent')),
  notes             text,
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        text,

  unique (cinema_id, statement_no)
);

create index if not exists picture_ending_statements_cinema_idx
  on public.picture_ending_statements (cinema_id, statement_date desc);
create index if not exists picture_ending_statements_movie_idx
  on public.picture_ending_statements (movie_id);

-- ----------------------------------------------------------------------------
-- 3) updated_at triggers (reuse the shared touch function if present).
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc where proname = 'touch_updated_at') then
    drop trigger if exists distributor_payments_touch on public.distributor_payments;
    create trigger distributor_payments_touch
      before update on public.distributor_payments
      for each row execute function public.touch_updated_at();

    drop trigger if exists picture_ending_statements_touch on public.picture_ending_statements;
    create trigger picture_ending_statements_touch
      before update on public.picture_ending_statements
      for each row execute function public.touch_updated_at();
  end if;
end$$;

commit;
