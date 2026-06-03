-- ============================================================================
-- 14 — Job openings (Careers page).
--
--   1. `public.job_openings` table — each row is one published role on the
--      careers section of the marketing site. Owner + manager write; the
--      world reads only `is_published = true` rows.
--   2. RLS — anon SELECT restricted to published rows; insert/update/delete
--      gated to owner + manager via the same authorized_users check the rest
--      of the cash-management schema uses.
--
-- Idempotent.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Table.
-- ----------------------------------------------------------------------------

create table if not exists public.job_openings (
  id            uuid          primary key default gen_random_uuid(),
  title         text          not null,
  location      text          not null default 'Changanacherry, Kerala',
  employment    text          not null default 'Full-time',
  -- short one-liner shown on the card before "Read more"
  summary       text          not null default '',
  -- long-form description; markdown rendered client-side as plain paragraphs
  description   text          not null default '',
  -- where applicants should send their resume / note
  apply_email   text          not null default 'hr@abhinayacinemas.com',
  -- ordering knob; lower = higher on the page
  sort_order    integer       not null default 100,
  is_published  boolean       not null default true,
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now(),
  archived_at   timestamptz
);

create index if not exists idx_job_openings_published
  on public.job_openings (is_published, sort_order)
  where archived_at is null;

-- ----------------------------------------------------------------------------
-- 2) RLS.
-- ----------------------------------------------------------------------------

alter table public.job_openings enable row level security;

drop policy if exists "job_openings_read"   on public.job_openings;
drop policy if exists "job_openings_write"  on public.job_openings;
drop policy if exists "job_openings_update" on public.job_openings;
drop policy if exists "job_openings_delete" on public.job_openings;

-- Public read — only published, non-archived rows are visible to anon.
-- Owner + manager get full read via the authorized_users escape hatch.
create policy "job_openings_read" on public.job_openings
  for select using (
    (is_published = true and archived_at is null)
    or exists (
      select 1 from public.authorized_users
       where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
         and role in ('owner','manager')
    )
  );

create policy "job_openings_write" on public.job_openings
  for insert with check (
    exists (
      select 1 from public.authorized_users
       where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
         and role in ('owner','manager')
    )
  );

create policy "job_openings_update" on public.job_openings
  for update using (
    exists (
      select 1 from public.authorized_users
       where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
         and role in ('owner','manager')
    )
  );

create policy "job_openings_delete" on public.job_openings
  for delete using (
    exists (
      select 1 from public.authorized_users
       where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
         and role in ('owner','manager')
    )
  );

-- ----------------------------------------------------------------------------
-- 3) Keep updated_at fresh.
-- ----------------------------------------------------------------------------

create or replace function public.tg_job_openings_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists job_openings_touch_updated_at on public.job_openings;
create trigger job_openings_touch_updated_at
  before update on public.job_openings
  for each row execute function public.tg_job_openings_touch_updated_at();

commit;
