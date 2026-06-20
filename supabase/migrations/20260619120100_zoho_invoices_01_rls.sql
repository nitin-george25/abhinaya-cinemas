-- ============================================================================
-- Zoho Books integration — 01 RLS.
--
-- invoices + invoice_line_items are finance data: visible to owner / accountant
-- with access to the row's cinema; deletes owner-only (rows are machine-owned
-- from Zoho, so a manual delete is a rare owner escape hatch).
--   read/insert/update = cinema_access(cinema_id) AND is_accountant_or_owner()
--   delete             = cinema_access(cinema_id) AND is_owner()
-- Line items scope through their parent invoice (mirrors fb_checklist_items).
--
-- Sync plumbing (zoho_orgs / zoho_sync_state / zoho_dead_letters) is admin-only:
-- owner can read/manage the mapping; watermark + dead-letters are written ONLY
-- by the Edge functions (service-role key bypasses RLS). No client write policy
-- on those = no client can forge sync state.
--
-- The Zoho sync Edge functions use the service-role key, which bypasses RLS,
-- so all of these policies govern the human UI only.
-- Idempotent (drop + recreate).
-- ============================================================================

begin;

alter table public.invoices            enable row level security;
alter table public.invoice_line_items  enable row level security;
alter table public.zoho_orgs           enable row level security;
alter table public.zoho_sync_state     enable row level security;
alter table public.zoho_dead_letters   enable row level security;

-- ── invoices ────────────────────────────────────────────────────────────────
drop policy if exists invoices_read on public.invoices;
drop policy if exists invoices_ins  on public.invoices;
drop policy if exists invoices_upd  on public.invoices;
drop policy if exists invoices_del  on public.invoices;

create policy invoices_read on public.invoices
  for select using (
    public.cinema_access(cinema_id) and public.is_accountant_or_owner()
  );
create policy invoices_ins on public.invoices
  for insert with check (
    public.cinema_access(cinema_id) and public.is_accountant_or_owner()
  );
create policy invoices_upd on public.invoices
  for update using (
    public.cinema_access(cinema_id) and public.is_accountant_or_owner()
  ) with check (
    public.cinema_access(cinema_id) and public.is_accountant_or_owner()
  );
create policy invoices_del on public.invoices
  for delete using (
    public.cinema_access(cinema_id) and public.is_owner()
  );

-- ── invoice_line_items (scoped via the parent invoice) ───────────────────────
drop policy if exists invoice_line_items_read on public.invoice_line_items;
drop policy if exists invoice_line_items_ins  on public.invoice_line_items;
drop policy if exists invoice_line_items_upd  on public.invoice_line_items;
drop policy if exists invoice_line_items_del  on public.invoice_line_items;

create policy invoice_line_items_read on public.invoice_line_items
  for select using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_id
        and public.cinema_access(i.cinema_id)
        and public.is_accountant_or_owner()
    )
  );
create policy invoice_line_items_ins on public.invoice_line_items
  for insert with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_id
        and public.cinema_access(i.cinema_id)
        and public.is_accountant_or_owner()
    )
  );
create policy invoice_line_items_upd on public.invoice_line_items
  for update using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_id
        and public.cinema_access(i.cinema_id)
        and public.is_accountant_or_owner()
    )
  ) with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_id
        and public.cinema_access(i.cinema_id)
        and public.is_accountant_or_owner()
    )
  );
create policy invoice_line_items_del on public.invoice_line_items
  for delete using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_id
        and public.cinema_access(i.cinema_id)
        and public.is_owner()
    )
  );

-- ── zoho_orgs — owner manages the org/branch → cinema mapping ────────────────
drop policy if exists zoho_orgs_all on public.zoho_orgs;
create policy zoho_orgs_all on public.zoho_orgs
  for all using (public.is_owner()) with check (public.is_owner());

-- ── zoho_sync_state — owner read-only; writes are service-role only ─────────
drop policy if exists zoho_sync_state_read on public.zoho_sync_state;
create policy zoho_sync_state_read on public.zoho_sync_state
  for select using (public.is_owner());

-- ── zoho_dead_letters — owner read + resolve; inserts are service-role only ──
drop policy if exists zoho_dead_letters_read on public.zoho_dead_letters;
drop policy if exists zoho_dead_letters_upd  on public.zoho_dead_letters;
create policy zoho_dead_letters_read on public.zoho_dead_letters
  for select using (public.is_owner());
create policy zoho_dead_letters_upd on public.zoho_dead_letters
  for update using (public.is_owner()) with check (public.is_owner());

commit;

-- ============================================================================
-- VERIFY (after applying):
--   select tablename, count(*) from pg_policies
--    where tablename in ('invoices','invoice_line_items','zoho_orgs',
--                        'zoho_sync_state','zoho_dead_letters')
--    group by tablename;   -- invoices 4, invoice_line_items 4, zoho_orgs 1,
--                          -- zoho_sync_state 1, zoho_dead_letters 2
-- ============================================================================
