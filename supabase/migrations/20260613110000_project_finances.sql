-- ============================================================================
-- Project Management — Finances (budget vs actuals + invoices).
--
-- Adds the money side of a project on top of 20260613100000_projects_module:
--   • project_budget_items — one row per cost line with an ESTIMATE.
--   • project_invoices      — uploaded bills with an amount, optionally
--     allocated to a budget item. A line's ACTUAL is the sum of its invoices;
--     unallocated invoices still count toward the project total.
--
-- Invoice files reuse the existing `project-files` storage bucket (created in
-- 20260613100000). RLS reuses the project helpers:
--   read   = cinema_access(project_cinema(project_id))
--   budget write = is_project_manager_or_owner   (PM/owner manage the budget)
--   invoice insert = is_project_member            (assigned staff add bills)
--   invoice update/delete = is_project_manager_or_owner
--
-- HOW TO RUN: applied via `npm run db:push:staging` / `:prod` (Supabase CLI).
-- Idempotent / safe to re-run.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Budget lines.
-- ----------------------------------------------------------------------------
create table if not exists public.project_budget_items (
  id          text primary key default gen_random_uuid()::text,
  project_id  text not null references public.projects(id) on delete cascade,
  seq         int not null default 0,
  name        text not null,
  category    text,
  estimate    numeric(14,2) not null default 0,
  notes       text,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists project_budget_items_project_idx
  on public.project_budget_items (project_id);

-- ----------------------------------------------------------------------------
-- 2) Invoices. budget_item_id ON DELETE SET NULL — removing a budget line
--    must not delete the bill; it just becomes unallocated.
-- ----------------------------------------------------------------------------
create table if not exists public.project_invoices (
  id              text primary key default gen_random_uuid()::text,
  project_id      text not null references public.projects(id) on delete cascade,
  budget_item_id  text references public.project_budget_items(id) on delete set null,
  vendor          text,
  invoice_no      text,
  invoice_date    date,
  amount          numeric(14,2) not null default 0,
  notes           text,
  file_url        text,
  file_name       text,
  file_size       bigint,
  content_type    text,
  uploaded_by     text,
  uploaded_at     timestamptz not null default now()
);
create index if not exists project_invoices_project_idx
  on public.project_invoices (project_id);
create index if not exists project_invoices_item_idx
  on public.project_invoices (budget_item_id);

-- ----------------------------------------------------------------------------
-- 3) updated_at trigger on budget items (reuse shared touch fn if present).
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc where proname = 'touch_updated_at') then
    drop trigger if exists project_budget_items_touch on public.project_budget_items;
    create trigger project_budget_items_touch
      before update on public.project_budget_items
      for each row execute function public.touch_updated_at();
  end if;
end$$;

-- ----------------------------------------------------------------------------
-- 4) RLS.
-- ----------------------------------------------------------------------------
alter table public.project_budget_items enable row level security;
alter table public.project_invoices     enable row level security;

drop policy if exists project_budget_items_read  on public.project_budget_items;
drop policy if exists project_budget_items_write on public.project_budget_items;
create policy project_budget_items_read on public.project_budget_items
  for select using (public.cinema_access(public.project_cinema(project_id)));
create policy project_budget_items_write on public.project_budget_items
  for all using (public.is_project_manager_or_owner(project_id))
         with check (public.is_project_manager_or_owner(project_id));

drop policy if exists project_invoices_read on public.project_invoices;
drop policy if exists project_invoices_ins  on public.project_invoices;
drop policy if exists project_invoices_upd  on public.project_invoices;
drop policy if exists project_invoices_del  on public.project_invoices;
create policy project_invoices_read on public.project_invoices
  for select using (public.cinema_access(public.project_cinema(project_id)));
create policy project_invoices_ins on public.project_invoices
  for insert with check (public.is_project_member(project_id));
create policy project_invoices_upd on public.project_invoices
  for update using (public.is_project_manager_or_owner(project_id))
            with check (public.is_project_manager_or_owner(project_id));
create policy project_invoices_del on public.project_invoices
  for delete using (public.is_project_manager_or_owner(project_id));

commit;

-- ============================================================================
-- VERIFY (after applying):
--   select to_regclass('public.project_budget_items'),
--          to_regclass('public.project_invoices');   -- both non-null
-- ============================================================================
