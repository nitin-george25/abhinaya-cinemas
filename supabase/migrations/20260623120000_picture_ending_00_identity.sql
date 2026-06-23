-- ============================================================================
-- Picture Ending — 00 — statutory identity columns.
--
-- WHY THIS EXISTS
-- ---------------
-- The Picture Ending Statement (the end-of-run settlement we hand a
-- distributor) prints both parties' statutory identity in its header:
--   • Theatre side  — GSTIN, PAN, ARN, TAN, address, phone, email (cinemas).
--   • Distributor side — GST ID + PAN (distributors).
--
-- `public.cinemas` already carries gstin/pan/address/phone/email; it is only
-- missing ARN + TAN. `public.distributors` carries only the point-of-contact;
-- it has no GST ID / PAN yet. This migration adds the missing columns.
--
-- Intra- vs inter-state GST (SGST+CGST vs IGST) on the distributor share is
-- derived at statement time from the first two digits (the GST state code) of
-- each party's GSTIN — so no separate `state` column is needed here.
--
-- READ PATH NOTE: the app reads its catalog from the `public.config.data`
-- blob (config is authoritative; the normalized tables are a write-only
-- mirror). The new distributor columns therefore reach the app once an
-- owner/manager fills them in Settings → Distributors (which rewrites the
-- blob and dual-writes these columns). We deliberately do NOT seed the blob
-- here — the fields start empty.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Run on BOTH
-- staging and prod. Safe to re-run (idempotent).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Theatre statutory ids missing from cinemas.
-- ----------------------------------------------------------------------------
alter table public.cinemas
  add column if not exists arn text,   -- GST ARN (provisional registration ack.)
  add column if not exists tan text;   -- TAN (TDS deduction account number)

-- ----------------------------------------------------------------------------
-- 2) Distributor GST ID + PAN (printed on the statement; GST ID's state code
--    also drives the SGST/CGST-vs-IGST split).
-- ----------------------------------------------------------------------------
alter table public.distributors
  add column if not exists gstin text,
  add column if not exists pan   text;

commit;

-- ============================================================================
-- VERIFY (run after applying):
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='distributors'
--      and column_name in ('gstin','pan');           -- expect 2 rows
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='cinemas'
--      and column_name in ('arn','tan');              -- expect 2 rows
-- ============================================================================
