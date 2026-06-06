-- ============================================================================
-- Repair: authorized_users rows with empty cinema_ids
--
-- The admin-users Edge Function inserted new users (cashiers, daily
-- managers) without cinema_ids, so the column defaulted to '{}' and
-- cinema_access() failed every RLS check — symptom: empty Unit dropdown in
-- the petty expense form. The function now inherits the caller's
-- cinema_ids on create; this migration fixes the rows created before that.
--
-- Single-cinema assumption (matches 05_backfill): every empty row gets the
-- one cinema referenced by public.screens. Aborts gracefully when the
-- normalized layer is absent; no-op when no rows are empty. Idempotent.
-- ============================================================================

do $$
declare
  v_cinema_id uuid;
  v_fixed int;
begin
  if to_regclass('public.screens') is null
     or to_regclass('public.authorized_users') is null then
    return;  -- normalized layer not present on this DB
  end if;

  select cinema_id into v_cinema_id
    from public.screens
    where cinema_id is not null
    limit 1;
  if v_cinema_id is null then
    return;  -- nothing to anchor to yet
  end if;

  update public.authorized_users
     set cinema_ids = array[v_cinema_id]
   where cardinality(coalesce(cinema_ids, '{}'::uuid[])) = 0;

  get diagnostics v_fixed = row_count;
  raise notice 'cinema_ids repaired on % authorized_users row(s)', v_fixed;
end $$;
