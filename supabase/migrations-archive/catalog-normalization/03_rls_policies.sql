-- ============================================================================
-- 03 — RLS policies
--
-- Read: cinema_access(row.cinema_id) — caller has the cinema in their array.
-- Write: read + a role check that matches the table's sensitivity.
--
-- Three role tiers (defined as functions in 00):
--   is_owner()             — owner only. Cinema setup, tax, user mgmt.
--   is_owner_or_manager()  — owner + manager. Catalog edits.
--   is_entry_writer()      — owner + manager + daily_manager. BO / F&B days.
--
-- Policies are dropped + recreated so this file is idempotent and any old
-- policies with the same name get cleanly replaced.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Convenience macro for catalog tables: read = cinema_access, write =
--    cinema_access + owner_or_manager. Repeated inline.
-- ----------------------------------------------------------------------------

-- brands — small, owner-only writes; everyone reads
drop policy if exists brands_read  on public.brands;
drop policy if exists brands_write on public.brands;
create policy brands_read on public.brands
  for select using (true);                       -- brands are not cinema-scoped
create policy brands_write on public.brands
  for all using (public.is_owner())
         with check (public.is_owner());


-- cinemas — read by anyone with at least one cinema; write owner-only
drop policy if exists cinemas_read  on public.cinemas;
drop policy if exists cinemas_write on public.cinemas;
create policy cinemas_read on public.cinemas
  for select using (public.cinema_access(id));
create policy cinemas_write on public.cinemas
  for all using (public.cinema_access(id) and public.is_owner())
         with check (public.cinema_access(id) and public.is_owner());


-- tax_configs — read scoped; write owner-only (legal correctness)
drop policy if exists tax_configs_read  on public.tax_configs;
drop policy if exists tax_configs_write on public.tax_configs;
create policy tax_configs_read on public.tax_configs
  for select using (public.cinema_access(cinema_id));
create policy tax_configs_write on public.tax_configs
  for all using (public.cinema_access(cinema_id) and public.is_owner())
         with check (public.cinema_access(cinema_id) and public.is_owner());


-- classes
drop policy if exists classes_read  on public.classes;
drop policy if exists classes_write on public.classes;
create policy classes_read on public.classes
  for select using (public.cinema_access(cinema_id));
create policy classes_write on public.classes
  for all using (public.cinema_access(cinema_id) and public.is_owner_or_manager())
         with check (public.cinema_access(cinema_id) and public.is_owner_or_manager());


-- screens
drop policy if exists screens_read  on public.screens;
drop policy if exists screens_write on public.screens;
create policy screens_read on public.screens
  for select using (public.cinema_access(cinema_id));
create policy screens_write on public.screens
  for all using (public.cinema_access(cinema_id) and public.is_owner_or_manager())
         with check (public.cinema_access(cinema_id) and public.is_owner_or_manager());


-- screen_classes — cinema_id resolved via screens
drop policy if exists screen_classes_read  on public.screen_classes;
drop policy if exists screen_classes_write on public.screen_classes;
create policy screen_classes_read on public.screen_classes
  for select using (exists (
    select 1 from public.screens s
    where s.id = screen_id and public.cinema_access(s.cinema_id)
  ));
create policy screen_classes_write on public.screen_classes
  for all using (
    public.is_owner_or_manager() and exists (
      select 1 from public.screens s
      where s.id = screen_id and public.cinema_access(s.cinema_id)
    )
  ) with check (
    public.is_owner_or_manager() and exists (
      select 1 from public.screens s
      where s.id = screen_id and public.cinema_access(s.cinema_id)
    )
  );


-- price_cards
drop policy if exists price_cards_read  on public.price_cards;
drop policy if exists price_cards_write on public.price_cards;
create policy price_cards_read on public.price_cards
  for select using (exists (
    select 1 from public.screens s
    where s.id = screen_id and public.cinema_access(s.cinema_id)
  ));
create policy price_cards_write on public.price_cards
  for all using (
    public.is_owner_or_manager() and exists (
      select 1 from public.screens s
      where s.id = screen_id and public.cinema_access(s.cinema_id)
    )
  ) with check (
    public.is_owner_or_manager() and exists (
      select 1 from public.screens s
      where s.id = screen_id and public.cinema_access(s.cinema_id)
    )
  );


-- price_card_prices — resolve via price_cards → screens
drop policy if exists price_card_prices_read  on public.price_card_prices;
drop policy if exists price_card_prices_write on public.price_card_prices;
create policy price_card_prices_read on public.price_card_prices
  for select using (exists (
    select 1 from public.price_cards pc
    join public.screens s on s.id = pc.screen_id
    where pc.id = price_card_id and public.cinema_access(s.cinema_id)
  ));
create policy price_card_prices_write on public.price_card_prices
  for all using (
    public.is_owner_or_manager() and exists (
      select 1 from public.price_cards pc
      join public.screens s on s.id = pc.screen_id
      where pc.id = price_card_id and public.cinema_access(s.cinema_id)
    )
  ) with check (
    public.is_owner_or_manager() and exists (
      select 1 from public.price_cards pc
      join public.screens s on s.id = pc.screen_id
      where pc.id = price_card_id and public.cinema_access(s.cinema_id)
    )
  );


-- movies
drop policy if exists movies_read  on public.movies;
drop policy if exists movies_write on public.movies;
create policy movies_read on public.movies
  for select using (public.cinema_access(cinema_id));
create policy movies_write on public.movies
  for all using (public.cinema_access(cinema_id) and public.is_owner_or_manager())
         with check (public.cinema_access(cinema_id) and public.is_owner_or_manager());


-- serial_starts — via screens
drop policy if exists serial_starts_read  on public.serial_starts;
drop policy if exists serial_starts_write on public.serial_starts;
create policy serial_starts_read on public.serial_starts
  for select using (exists (
    select 1 from public.screens s
    where s.id = screen_id and public.cinema_access(s.cinema_id)
  ));
create policy serial_starts_write on public.serial_starts
  for all using (
    public.is_owner_or_manager() and exists (
      select 1 from public.screens s
      where s.id = screen_id and public.cinema_access(s.cinema_id)
    )
  ) with check (
    public.is_owner_or_manager() and exists (
      select 1 from public.screens s
      where s.id = screen_id and public.cinema_access(s.cinema_id)
    )
  );


-- serial_start_classes — via serial_starts → screens
drop policy if exists serial_start_classes_read  on public.serial_start_classes;
drop policy if exists serial_start_classes_write on public.serial_start_classes;
create policy serial_start_classes_read on public.serial_start_classes
  for select using (exists (
    select 1 from public.serial_starts ss
    join public.screens s on s.id = ss.screen_id
    where ss.id = serial_start_id and public.cinema_access(s.cinema_id)
  ));
create policy serial_start_classes_write on public.serial_start_classes
  for all using (
    public.is_owner_or_manager() and exists (
      select 1 from public.serial_starts ss
      join public.screens s on s.id = ss.screen_id
      where ss.id = serial_start_id and public.cinema_access(s.cinema_id)
    )
  ) with check (
    public.is_owner_or_manager() and exists (
      select 1 from public.serial_starts ss
      join public.screens s on s.id = ss.screen_id
      where ss.id = serial_start_id and public.cinema_access(s.cinema_id)
    )
  );


-- openings — references movies + screens; cinema comes from either
drop policy if exists openings_read  on public.openings;
drop policy if exists openings_write on public.openings;
create policy openings_read on public.openings
  for select using (exists (
    select 1 from public.screens s
    where s.id = screen_id and public.cinema_access(s.cinema_id)
  ));
create policy openings_write on public.openings
  for all using (
    public.is_owner() and exists (
      select 1 from public.screens s
      where s.id = screen_id and public.cinema_access(s.cinema_id)
    )
  ) with check (
    public.is_owner() and exists (
      select 1 from public.screens s
      where s.id = screen_id and public.cinema_access(s.cinema_id)
    )
  );


-- audit_log — owner reads (it's the audit trail); writes only via trigger
-- (service-role bypasses RLS so triggers work).
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log
  for select using (
    public.is_owner() or (cinema_id is not null and public.cinema_access(cinema_id) and public.is_owner_or_manager())
  );


-- realtime_version — readable by anyone authorized (to receive notifications)
drop policy if exists realtime_version_read on public.realtime_version;
create policy realtime_version_read on public.realtime_version
  for select using (
    exists (select 1 from public.authorized_users
            where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  );


-- ----------------------------------------------------------------------------
-- Updates to existing-tables' policies — re-point to cinema_access().
--
-- entries / fb_entries / fb_products had RLS based on the
-- legacy is_authorized() / is_manager_or_owner() functions. They keep
-- working for now; we add additional cinema-scoping policies and remove
-- the legacy ones in 06 once cinema_id is populated and NOT NULL.
-- ----------------------------------------------------------------------------

-- Until 06, leave existing policies alone. Browse them in the dashboard if
-- you want to audit. The compound (legacy + new) gate stays correct.


commit;
