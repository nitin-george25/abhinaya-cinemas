-- ============================================================================
-- payments_02 — Seed the 16-type payment taxonomy per cinema.
--
-- Inserts the §5 taxonomy (docs/Payments - Unified Workflow Design.md) for every
-- cinema. Idempotent: ON CONFLICT (cinema_id, lower(name)) DO NOTHING, so it
-- never disturbs an owner's later edits and is safe to re-run.
--
-- requires_quotation is derived from is_asset. zoho_push is true only for F&B
-- (#4). quote_skip_floor defaults to 0 (= always quote) until the owner sets a
-- number (open question §13-b). Type #1 (settlement-backed) is seeded so it
-- renders in the inbox/reports, but the creation form excludes it — share
-- remittances are initiated from the box-office settlement (§13-a).
--
-- HOW TO RUN: npm run db:push:staging / :prod (Supabase CLI). Idempotent.
-- ============================================================================

begin;

insert into public.payment_types
  (cinema_id, name, payee_category, invoice_rule, is_asset, requires_quotation,
   accounting_head, zoho_push, sort_order, updated_by)
select c.id, t.name, t.payee_category, t.invoice_rule, t.is_asset, t.is_asset,
       t.accounting_head, t.zoho_push, t.sort_order, 'migration:payments_02'
  from public.cinemas c
  cross join (values
    ( 1, 'Distributor share remittance', 'distributor', 'settlement', false, 'Distributor share (COGS)',      false),
    ( 2, 'Distributor advance / MG',     'distributor', 'exempt',     false, 'Advances to distributors',       false),
    ( 3, 'Publicity & marketing',        'vendor',      'required',   false, 'Publicity expense',              false),
    ( 4, 'F&B / concession stock',       'vendor',      'required',   false, 'F&B purchases (COGS)',           true ),
    ( 5, 'Maintenance & repairs',        'vendor',      'required',   false, 'Repairs & maintenance',          false),
    ( 6, 'Equipment / asset purchase',   'vendor',      'required',   true,  'Fixed assets (capex)',           false),
    ( 7, 'Renovation / project capex',   'vendor',      'required',   true,  'Capital WIP / fixed assets',     false),
    ( 8, 'Utilities (power, water, net)','vendor',      'required',   false, 'Utilities',                      false),
    ( 9, 'Rent / lease',                 'landlord',    'exempt',     false, 'Rent',                           false),
    (10, 'Salaries & wages',             'employee',    'exempt',     false, 'Salaries & wages',               false),
    (11, 'Statutory dues',               'government',  'exempt',     false, 'Statutory dues',                 false),
    (12, 'Professional fees',            'vendor',      'required',   false, 'Professional fees',              false),
    (13, 'Software & subscriptions',     'vendor',      'required',   false, 'Software / subscriptions',       false),
    (14, 'Bank charges / loan EMI',      'bank',        'exempt',     false, 'Finance costs',                  false),
    (15, 'Petty-cash top-up',            'internal',    'exempt',     false, 'Petty cash float',               false),
    (16, 'Miscellaneous',                'other',       'required',   false, 'Sundry expenses',                false)
  ) as t(sort_order, name, payee_category, invoice_rule, is_asset, accounting_head, zoho_push)
on conflict do nothing;

commit;

-- ============================================================================
-- VERIFY (after applying):
--   select sort_order, name, payee_category, invoice_rule, is_asset, zoho_push
--     from public.payment_types order by cinema_id, sort_order;   -- 16 per cinema
-- ============================================================================
