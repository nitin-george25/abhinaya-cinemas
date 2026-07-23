-- ============================================================================
-- Picture Ending — 03 — hold-over rule + resolution audit trail.
--
-- WHY THIS EXISTS
-- ---------------
-- The hold-over date is the publicity cutoff: publicity is charged on the
-- exhibitor share earned up to and including it. Until now it was purely
-- auto-detected (first day the best 3 shows take less than one full house),
-- with no way to reflect a negotiated term.
--
-- Films release Thursday or Friday, so the opening weekend runs to Sunday. A
-- hold-over flagged during that weekend is premature — the weekend has not
-- finished playing out. Some distributors are settled on the basis that the
-- cutoff is pushed to the first Sunday of the run in that case.
--
-- WHAT THIS DOES
-- --------------
--   a) distributors.hold_over_rule — the standing term, one of:
--        'detected'       use the auto-detected date as-is (default, and the
--                         behaviour every existing distributor keeps)
--        'opening-sunday' take the LATER of the detected date and the first
--                         Sunday of the run. Only ever extends; a hold-over in
--                         week 2 is untouched.
--   b) picture_ending_statements — three columns recording how the applied
--      date was arrived at, so a statement re-read a year later is explicable:
--        detected_hold_over_date  raw detector output
--        hold_over_source         'detected' | 'rule' | 'override'
--        hold_over_date_override  the date the preparer typed, if any
--      `hold_over_date` continues to hold the APPLIED date — the one the PDF
--      prints. The printed statement deliberately shows only that; the detected
--      date is on-screen and in this table, not in the distributor's copy.
--
-- No behaviour changes for anyone until an owner/manager sets a distributor to
-- 'opening-sunday' in Settings → Distributors.
--
-- READ PATH NOTE: the app reads its catalog from the `public.config.data` blob
-- (config is authoritative; the normalized tables are a write-only mirror), so
-- section 3 seeds the blob's distributor entries with the default. Without it
-- the field would read as absent until each distributor is next saved.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Run on BOTH
-- staging and prod. Safe to re-run (idempotent).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Distributor standing term.
-- ----------------------------------------------------------------------------
alter table public.distributors
  add column if not exists hold_over_rule text not null default 'detected';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'distributors_hold_over_rule_chk'
      and conrelid = 'public.distributors'::regclass
  ) then
    alter table public.distributors
      add constraint distributors_hold_over_rule_chk
      check (hold_over_rule in ('detected', 'opening-sunday'));
  end if;
end$$;

-- ----------------------------------------------------------------------------
-- 2) Statement audit trail. Nullable — statements written before this
--    migration have no detected/source recorded and stay that way.
-- ----------------------------------------------------------------------------
alter table public.picture_ending_statements
  add column if not exists detected_hold_over_date date,
  add column if not exists hold_over_source        text,
  add column if not exists hold_over_date_override date;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pes_hold_over_source_chk'
      and conrelid = 'public.picture_ending_statements'::regclass
  ) then
    alter table public.picture_ending_statements
      add constraint pes_hold_over_source_chk
      check (hold_over_source is null
             or hold_over_source in ('detected', 'rule', 'override'));
  end if;
end$$;

-- ----------------------------------------------------------------------------
-- 3) Seed the AUTHORITATIVE config blob so the app sees the default without
--    waiting for each distributor to be re-saved. Only fills entries that do
--    not already carry the key, so a re-run never clobbers a real choice.
-- ----------------------------------------------------------------------------
update public.config c
   set data = jsonb_set(
     c.data,
     '{distributors}',
     coalesce((
       select jsonb_agg(
         case when d ? 'holdOverRule' then d
              else d || jsonb_build_object('holdOverRule', 'detected') end
       )
       from jsonb_array_elements(c.data->'distributors') d
     ), c.data->'distributors'),
     true
   )
 where c.id = 1
   and jsonb_typeof(c.data->'distributors') = 'array';

commit;

-- ============================================================================
-- VERIFY (run after applying):
--
--   -- Column present, everyone defaulted to the existing behaviour.
--   select hold_over_rule, count(*) from public.distributors group by 1;
--   -- expect a single row: detected | <n>
--
--   -- Audit columns present.
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='picture_ending_statements'
--      and column_name in ('detected_hold_over_date','hold_over_source',
--                          'hold_over_date_override');   -- expect 3 rows
--
--   -- Blob seeded: no distributor entry missing the key.
--   select count(*) from public.config c,
--        lateral jsonb_array_elements(c.data->'distributors') d
--    where c.id = 1 and not (d ? 'holdOverRule');        -- expect 0
-- ============================================================================
