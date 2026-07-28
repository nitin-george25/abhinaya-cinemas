-- ============================================================================
-- 00 — SOP library schema
--
-- Backs Operations → Standard Operating Procedures. One row per SOP document,
-- filed under one of the fourteen areas from the SOP Library Master Plan. The
-- document itself (the branded bilingual PDF) lives in the `sop-documents`
-- storage bucket — see sops_02_storage.
--
-- Mirrors the guides table: area_id is a fixed slug whose set is kept in
-- lockstep with app/src/lib/sops.ts, and rows are cinema-scoped so a second
-- site gets its own library.
--
-- `code` is the SOP code exactly as printed on the document header (BO-01,
-- FB-02, …). It is stored, not derived, so the console can never contradict
-- the PDF a manager is holding.
--
-- Idempotent. Reuses helpers from earlier migrations: cinema_access(),
-- is_owner_or_manager().
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) sops — one row per SOP document.
--    The fourteen area slugs match PART A of the master plan and the
--    SOP_AREA_DEFS array in app/src/lib/sops.ts — add an area in both places.
-- ----------------------------------------------------------------------------
create table if not exists public.sops (
  id            uuid primary key default gen_random_uuid(),
  cinema_id     uuid not null references public.cinemas(id) on delete cascade,
  area_id       text not null check (
                  area_id in (
                    'box-office','fb','projection','housekeeping',
                    'front-of-house','safety','cash','inventory',
                    'people','open-close','maintenance',
                    'customer-experience','compliance','marketing'
                  )
                ),
  -- As printed on the document (e.g. 'BO-01'). Unique within an area so a
  -- re-run of the seeding script updates rather than duplicates.
  code          text not null,
  title         text not null,
  description   text,
  -- Public URL of the PDF, and the bucket path behind it (kept so a delete can
  -- clean up the object too).
  doc_url       text not null,
  storage_path  text,
  version       text not null default 'v1.0',
  sort_order    int  not null default 0,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    text
);

create unique index if not exists sops_cinema_area_code_key
  on public.sops (cinema_id, area_id, code);

create index if not exists sops_cinema_area_idx
  on public.sops (cinema_id, area_id, sort_order, code);

alter table public.sops enable row level security;

commit;
