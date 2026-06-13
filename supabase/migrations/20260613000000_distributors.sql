-- ============================================================================
-- Distributors — first-class distributor records + movie FK.
--
-- WHY THIS EXISTS
-- ---------------
-- Until now `public.movies.distributor` was a free-text column: the same
-- distributor was retyped (and mis-typed) on every film, and there was
-- nowhere to keep the point-of-contact details we actually need when chasing
-- a settlement (POC name, phone, email).
--
-- WHAT THIS DOES
-- --------------
--   a) Creates `public.distributors` — one row per distributor per cinema,
--      with a point-of-contact (name / contact / email).
--   b) Adds `public.movies.distributor_id` referencing it (ON DELETE SET
--      NULL — deleting a distributor must never cascade-delete films or
--      break historical DCRs).
--   c) Backfills: one distributor row per distinct non-empty
--      `movies.distributor` name, then links each movie to its row.
--   d) Keeps the legacy `movies.distributor` TEXT column in place. It stays
--      the denormalized display name written onto every DCR / PDF / CSV
--      (a legal document must render the name it was filed with, even if the
--      distributor record is later renamed or removed). The app writes BOTH
--      columns going forward.
--   e) RLS mirrors the other catalog tables: read = cinema_access,
--      write = cinema_access AND owner-or-manager.
--
-- Single-screen single-cinema today, but everything is cinema-scoped so the
-- multi-cinema future Just Works.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Run on BOTH
-- staging and prod. Safe to re-run (idempotent).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Table.
-- ----------------------------------------------------------------------------
create table if not exists public.distributors (
  id           text primary key default gen_random_uuid()::text,
  cinema_id    uuid not null references public.cinemas(id) on delete restrict,
  name         text not null,
  poc_name     text,
  poc_contact  text,
  poc_email    text,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   text
);

create index if not exists distributors_cinema_idx
  on public.distributors (cinema_id)
  where archived_at is null;

-- ----------------------------------------------------------------------------
-- 2) Movie FK. ON DELETE SET NULL — a removed distributor leaves the film's
--    denormalized `distributor` name intact and simply unlinks.
-- ----------------------------------------------------------------------------
alter table public.movies
  add column if not exists distributor_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'movies_distributor_id_fkey'
      and conrelid = 'public.movies'::regclass
  ) then
    alter table public.movies
      add constraint movies_distributor_id_fkey
      foreign key (distributor_id)
      references public.distributors(id)
      on delete set null;
  end if;
end$$;

create index if not exists movies_distributor_id_idx
  on public.movies (distributor_id)
  where distributor_id is not null;

-- ----------------------------------------------------------------------------
-- 3) Backfill — one distributor per distinct trimmed name, per cinema.
--    Only runs for movies that have a name text but no link yet (idempotent).
-- ----------------------------------------------------------------------------
insert into public.distributors (cinema_id, name, updated_by)
select distinct m.cinema_id, btrim(m.distributor), 'migration:distributors'
  from public.movies m
 where m.distributor is not null
   and btrim(m.distributor) <> ''
   and not exists (
     select 1 from public.distributors d
      where d.cinema_id = m.cinema_id
        and lower(btrim(d.name)) = lower(btrim(m.distributor))
   );

update public.movies m
   set distributor_id = d.id
  from public.distributors d
 where m.distributor_id is null
   and m.distributor is not null
   and btrim(m.distributor) <> ''
   and d.cinema_id = m.cinema_id
   and lower(btrim(d.name)) = lower(btrim(m.distributor));

-- ----------------------------------------------------------------------------
-- 4) updated_at trigger (reuse the shared touch function if present).
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc where proname = 'touch_updated_at') then
    drop trigger if exists distributors_touch on public.distributors;
    create trigger distributors_touch
      before update on public.distributors
      for each row execute function public.touch_updated_at();
  end if;
end$$;

-- ----------------------------------------------------------------------------
-- 5) RLS — same shape as the other catalog tables.
-- ----------------------------------------------------------------------------
alter table public.distributors enable row level security;

drop policy if exists distributors_read  on public.distributors;
drop policy if exists distributors_write on public.distributors;

create policy distributors_read on public.distributors
  for select using (public.cinema_access(cinema_id));

create policy distributors_write on public.distributors
  for all using (public.cinema_access(cinema_id) and public.is_owner_or_manager())
         with check (public.cinema_access(cinema_id) and public.is_owner_or_manager());

-- ----------------------------------------------------------------------------
-- 6) Patch the AUTHORITATIVE config blob.
--    The app reads its catalog from public.config.data (a JSON snapshot of
--    AppState); the normalized tables above are a write-only mirror. So the
--    backfill is invisible to the running app unless we also seed the blob:
--      • config.data.distributors  ← the new distributor records (camelCase)
--      • config.data.movies[].distributorId ← link by matching name
--    Idempotent: re-running overwrites with identical values. Single-cinema
--    deployment, so the name→id map is unambiguous.
-- ----------------------------------------------------------------------------
do $$
declare
  v_arr     jsonb;
  v_namemap jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',         id,
           'name',       name,
           'pocName',    poc_name,
           'pocContact', poc_contact,
           'pocEmail',   poc_email
         ) order by name), '[]'::jsonb),
         coalesce(jsonb_object_agg(lower(btrim(name)), id), '{}'::jsonb)
    into v_arr, v_namemap
    from public.distributors
   where archived_at is null;

  update public.config c
     set data = jsonb_set(
       jsonb_set(c.data, '{distributors}', v_arr, true),
       '{movies}',
       coalesce((
         select jsonb_agg(
           case
             when m->>'distributor' is not null
                  and btrim(m->>'distributor') <> ''
                  and v_namemap ? lower(btrim(m->>'distributor'))
             then m || jsonb_build_object('distributorId',
                                          v_namemap -> lower(btrim(m->>'distributor')))
             else m
           end
         )
         from jsonb_array_elements(c.data->'movies') m
       ), c.data->'movies'),
       true
     )
   where c.id = 1
     and jsonb_typeof(c.data->'movies') = 'array';
end$$;

commit;

-- ============================================================================
-- VERIFY (run after applying):
--
--   -- Every distinct legacy name should now have exactly one distributor row.
--   select count(*) from public.distributors;
--
--   -- No film with a name text should be left unlinked.
--   select id, name, distributor, distributor_id
--     from public.movies
--    where distributor is not null and btrim(distributor) <> ''
--      and distributor_id is null;   -- expect zero rows
-- ============================================================================
