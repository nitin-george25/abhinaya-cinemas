-- ============================================================================
-- 00 — Guides catalog schema
--
-- Backs the in-app /guides page (book icon, top-right). Guides used to live as
-- a hardcoded array in app/src/lib/guides.ts; this moves them into a table so
-- owners/managers can add new guides from the UI and everyone sees them.
--
-- One table:
--   guides — one row per guide. category_id is a fixed slug (the category tabs
--            stay defined in the client). Each guide embeds a hosted
--            walkthrough (Scribe) via its /embed/ URL.
--
-- Cinema-scoped like the rest of the app (single-screen today, multi-cinema
-- ready). Idempotent. Reuses helpers from earlier migrations:
--   cinema_access(), is_owner_or_manager().
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) guides — one row per guide, scoped to a cinema + a fixed category slug.
--    The category set is kept in lockstep with app/src/lib/guides.ts.
-- ----------------------------------------------------------------------------
create table if not exists public.guides (
  id           uuid primary key default gen_random_uuid(),
  cinema_id    uuid not null references public.cinemas(id) on delete cascade,
  category_id  text not null check (
                 category_id in ('box-office','fb','cash','finance','operations')
               ),
  title        text not null,
  description  text,
  embed_url    text not null,
  sort_order   int  not null default 0,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   text
);

create index if not exists guides_cinema_category_idx
  on public.guides (cinema_id, category_id, sort_order, created_at);

alter table public.guides enable row level security;

-- ----------------------------------------------------------------------------
-- 2) Seed the guides that previously lived in app/src/lib/guides.ts, once per
--    cinema. Guarded by NOT EXISTS on (cinema, category, title) so re-running
--    the migration never duplicates them.
-- ----------------------------------------------------------------------------
insert into public.guides (cinema_id, category_id, title, description, embed_url, sort_order)
select c.id, v.category_id, v.title, v.description, v.embed_url, v.sort_order
from public.cinemas c
cross join (values
  (
    'fb',
    'Upload Daily Sales',
    'Export the day''s F&B sales report from the POS and upload it into the console.',
    'https://scribehow.com/embed/How_to_Export_and_Upload_Daily_FandB_Sales_Reports__pG1UuQZdQrCcczaabZyCrQ',
    0
  ),
  (
    'operations',
    'Create a Daily Manager Roster',
    'Set up the daily manager roster so each shift has an assigned manager in the console.',
    'https://scribehow.com/embed/How_To_Create_A_Daily_Manager_Roster__PV8ujNtxSbONP8YQBW2W-g',
    0
  ),
  (
    'operations',
    'Add a New Expense to a Renovation Project',
    'Record a new expense against a renovation project''s budget from the Project Management module.',
    'https://scribehow.com/embed/How_To_Add_A_New_Expense_To_A_Renovation_Project__xJ_Klrr_QzK2vVIlrSxJcQ',
    1
  )
) as v(category_id, title, description, embed_url, sort_order)
where not exists (
  select 1 from public.guides g
  where g.cinema_id = c.id
    and g.category_id = v.category_id
    and g.title = v.title
);

commit;
