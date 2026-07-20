-- =============================================================================
-- 2026-07-20  entries.rep_batta_waived — per-DCR rep-batta waiver.
--
-- Non-film screenings (e.g. FIFA match screenings) have no film rep, so no
-- rep batta. A per-entry boolean the engine reads as "entryRepBatta = 0 for
-- this entry"; the locked step/pooling math is otherwise untouched. Set from
-- a confirmed checkbox on the Entry page (same edit gating as the share %).
-- Idempotent.
-- =============================================================================

alter table public.entries
  add column if not exists rep_batta_waived boolean not null default false;

comment on column public.entries.rep_batta_waived is
  'No rep batta for this DCR (non-film screening, e.g. FIFA match). Engine returns 0 for entryRepBatta when true.';
