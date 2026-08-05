# Stocktake & Consumption Variance — Design

*Drafted 2026-08-05. Status: **design agreed — all seven decisions locked. Ready for
build.** Nothing built yet. One input still needed: a sample recipe export from the
existing F&B software (§10.1).*

---

## 1. Purpose & scope

Today F&B stock is bought, sold and counted, but nothing joins those three facts up.
Nobody can answer "we sold 4,100 popcorns this fortnight — does the kernel we bought,
minus what's left on the shelf, agree with that?"

This module closes that loop. Staff count physical stock in the console. The module
computes what *should* be on the shelf — opening stock, plus goods received, plus and
minus transfers, minus recorded wastage, minus theoretical consumption derived from
item-wise sales run through recipes — and reports the gap, per stock location.

**Variance = counted − expected.** A persistent negative variance on cheese powder is
either a recipe that overstates portion size, an unrecorded wastage, or leakage. The
module's job is to make that number appear reliably after every count, localise it to
a counter, and make it cheap to investigate.

In scope for v1: stock item masters + UOM conversions, stores and counters, recipes
(with bulk upload), goods-received entry, transfers, wastage/staff/complimentary
adjustments, the count sheet with approval, per-location variance, and variance trend
across counts.

Out of scope for v1: purchase orders and indents, supplier price comparison,
expiry/batch tracking, automatic reorder alerts, and Tally/Zoho posting of stock
journals.

---

## 2. What already exists — the ground truth

Established by reading the schema and app, 2026-08-05. This shapes everything below.

| Fact | Where | Consequence for this module |
|---|---|---|
| **Item-wise sales are already stored.** `fb_entries` has one row per `(cinema_id, entry_date)` with an `items` JSONB array of `{name, qty, netAmount, category}`. | `fb_entries`, seeded historically by `Abhinaya DCR Cloud - FB Historical Backfill v2 (Item Report).sql`; typed as `FbItem` in `app/src/lib/types.ts:364` | **We do not need a new sales feed.** Theoretical consumption reads straight out of `fb_entries.items`. Roughly 350 days of history already present, so recipes can be backtested before anyone counts anything. |
| Sales items are identified by **free-text POS name**, not an id — `"Popcorn Cheese (s)"`, `"Coke (350 Ml)"`, `"Popcorn (l) + 2 Coke(s)"`. | same | Recipes must be keyed through a **normalised alias map**, not on raw strings. |
| Item sales are **per cinema per day — not per counter, not per shift.** | `fb_entries_cinema_date_uk` | Consumption cannot be split across counters by any rule the data supports. Resolved by **D3** — each item is assigned the counter that consumes it, so no split is ever needed. |
| Some `fb_entries` rows are `source = 'zoho'` (read-only imports), others manual/DSR. | `FbEntry.source`, `app/src/lib/fbSync.ts` | Consumption must read both, and the variance report states which source a period's sales came from. |
| A menu catalog already exists: `fb_products` (name, category, `default_rate`, `pos_item_number`, `is_active`), owner-only writes. | `app/src/lib/fb.ts:318`, `db-types.ts:99` | **Recipes hang off `fb_products`** rather than a parallel sale-item table. |
| Locations: `cinemas` → `operating_units` (`box_office` / `food_beverage` / `other`) → `pos_counters`. One cinema live today; schema is multi-cinema-ready. | `cash_01_phase1_schema.sql`, `cash_18_pos_counters.sql` | Stock locations attach to the cinema; counter-kind locations point at a `pos_counter`. |
| Suppliers already have a home: `parties` with `party_type = 'vendor'`, free-form `category`, GSTIN/PAN/bank fields. | `cash_07_signoff_parties_and_polish.sql:50` | **No new supplier table.** GRN references `parties`. |
| **There is no purchase, GRN, stock, inventory, recipe or UOM table anywhere.** | verified across `supabase/migrations` + `migrations-archive` | All of it is greenfield. |
| RLS helpers in use: `cinema_access(cid)`, `is_owner()`, `is_owner_or_manager()`, `is_cashier()`, `is_accountant_or_owner()`. Standard pattern = drop-and-recreate named policies in a `_01_rls.sql`. | `sops_01_rls.sql` is the cleanest template | Mirror it exactly. |
| Frontend has no react-query, no form library, no toast, no dropzone, no data-table. One `lib/<domain>.ts` data module + one page file per module; reads warn-and-default, writes throw. | `lib/sops.ts` + `pages/operations/Sops.tsx` are the reference pair | Stocktake follows the same data-module shape; the count sheet and variance report justify a `components/stocktake/` directory. |

---

## 3. Design decisions — all locked 2026-08-05

| # | Decision | Choice |
|---|---|---|
| D1 | Where goods-received quantities come from | **Build GRN entry inside this module.** Supplier (`parties`), invoice no/date, item, qty, UOM, rate. Self-contained, and the only way to get a defensible cost for valuing variance. |
| D2 | Stock granularity | **Multiple stock locations per cinema** — bulk stores *and* POS counters both hold stock, with transfers between them. |
| D3 | Variance reporting level | **Per location — store and counter.** Each stock item is assigned the counter(s) that consume it; theoretical consumption deducts from there. Stores never consume, they only receive and issue. See §4.3. |
| D4 | Costing | **Weighted average**, computed per period per item at cinema level — see §4.4. |
| D5 | Count workflow | **Count → approve.** Daily manager or F&B staff enters the count as `draft`; owner or manager approves and locks it. Only an approved count sets the next opening stock. |
| D9 | Combo recipes | **Flat.** Every recipe line is a stock item; combos list their full component set. No nesting. The recipe book is maintained in the existing F&B software and bulk-uploaded, so re-uploading on a portion change is cheap — cheaper than maintaining a nesting layer that has to stay in sync with an external master. |
| D11 | Count cadence | **Generic — no fixed cadence.** A stocktake's period runs from each item's *previous approved count* to this one. Full counts, partial counts and rolling counts all fall out of the same rule, and variance is trended across counts. See §4.2. |

---

## 4. The variance model

### 4.1 Locations and what they do

| Location kind | Receives GRN | Issues transfers | Consumes | Counted |
|---|---|---|---|---|
| `store` | ✓ | ✓ | — | ✓ |
| `counter` | ✓ (direct deliveries) | ✓ | ✓ | ✓ |

Stores are pure custody: everything that arrives must later be issued or still be
there. That makes a store variance a *handling* signal — receiving errors, unrecorded
issues, or theft from the back. A counter variance, by contrast, is a *usage* signal —
portioning, recipe accuracy, or leakage at the point of sale. Separating the two is
most of the diagnostic value of D3.

### 4.2 Period boundaries — per item, per location

The period is not a property of the stocktake. It is a property of each line:

```
period(item, location) = (last approved count of that item at that location, this count_date]
```

A stocktake covering every item is the common case; one covering only the high-value
items is equally valid, and each of those items simply carries a longer period next
time it is counted. Nothing special-cases a partial count — it is the general rule
with a full item list.

Counts are taken after close of business on `count_date`, so that day's sales belong
to the period being closed. An item counted for the first time has no predecessor: it
is an **opening line**, produces no variance, and only sets a baseline.

### 4.3 The equation

Per stock item, per location, over that line's period, in the item's base unit:

```
expected_closing = opening_counted        -- last approved count, this location
                 + received               -- posted GRN lines to this location
                 + transfers_in
                 − transfers_out
                 − adjustments            -- wastage, staff, complimentary, breakage
                 − theoretical_consumption -- only if this location consumes this item

variance_qty     = counted_closing − expected_closing
variance_value   = variance_qty × period_cost
usage_variance_% = variance_qty ÷ theoretical_consumption   -- counters only
```

Because consumption is deducted at exactly one place, **the sum of location variances
equals the cinema variance.** That reconciliation is worth preserving; any future
change to this model should keep it true.

**Assigning consumption.** `stock_item_consumption` maps a stock item to the
location(s) that consume it:

- **Exactly one location** — the normal case. The soft-serve machine, the coffee
  machine, the popcorn popper each live at one counter. Consumption deducts there and
  variance reports there. Clean.
- **More than one location** — e.g. kernel popped at both counters. Those locations
  form a **variance pool** for that item: consumption deducts from the pool, and the
  item's variance is reported against the pool's combined count. No ratio is invented,
  because we have no data to justify one. Pool members must be counted in the same
  stocktake; the count sheet enforces this.
- **Zero locations** — a setup gap. The item's consumption lands in a cinema-level
  unassigned bucket and the variance report flags it loudly rather than quietly
  misattributing it.

Items bought and consumed but never sold — napkins, straws, cleaning chemicals — carry
`variance_expected = false`. Their quantity is still tracked, but their entire usage
would otherwise land as variance and drown the real signal, so they are excluded from
flagging.

### 4.4 Costing — periodic weighted average

A true perpetual moving average recalculates unit cost on every receipt, which requires
quantity-on-hand at that instant, which requires a ledger of every issue. We don't
observe issues — consumption is derived in bulk from a period of sales. Building a
perpetual ledger to support it would mean fabricating issue timing.

So: **weighted average computed per period**, per item, at cinema level (cost does not
depend on which shelf something sits on):

```
period_cost = (opening_qty × opening_cost + Σ received_qty × received_rate)
              ÷ (opening_qty + Σ received_qty)
```

The result carries forward as the next period's `opening_cost`. This is the standard
periodic-inventory treatment and exactly what an auditor expects behind a physical
count. It is honest about what we measure, needs no invented data, and still moves with
supplier prices.

### 4.5 Snapshotting

At approval, the stocktake **freezes**: expected quantity, every component of the
equation, period cost and variance are written onto the stocktake lines as stored
values, not recomputed on read. A back-dated GRN entered next month must not silently
rewrite a variance report the owner already acted on. Late corrections produce a
visible restatement, not a quiet edit.

This is also what makes trend analysis (§7) trustworthy — each point on the trend line
is the number as it stood when it was approved.

### 4.6 Coverage — the honesty check

Theoretical consumption is only as good as recipe coverage. Every variance report leads
with:

> **Recipe coverage: 94.2% of F&B net sales this period.**
> 11 sale items worth ₹38,400 have no recipe — their consumption is excluded.

Without this the report looks authoritative while quietly omitting a third of the menu.
Unmapped items appear as a worklist with a one-click jump to create the recipe.

---

## 5. Data model

Thirteen tables. Naming follows the house style (`stock_*` prefix, `cinema_id` on every
root table, `created_by` / `updated_by` text, timestamps, `archived_at` for soft delete
on masters).

### 5.1 Masters

**`stock_items`** — what is counted. Distinct from `fb_products`, which is what is
*sold*.
`id, cinema_id, code, name, category ('food'|'beverage'|'packaging'|'consumable'),
base_uom ('g'|'ml'|'ea'), variance_expected boolean default true, is_active, notes,
timestamps`.
Unique `(cinema_id, code)`. Base unit is deliberately the smallest sensible one so
recipe quantities stay integers.

**`stock_item_uoms`** — conversions. Purchases arrive in cases and sacks, recipes are in
grams, counts happen in whatever is easiest to eyeball.
`id, stock_item_id, uom_code ('kg'|'case'|'packet'|'sack'|…), qty_in_base numeric,
is_purchase_default, is_count_default`.
So `1 case = 24 ea`, `1 sack = 25000 g`. Every quantity anywhere in the module is stored
twice — as entered (`qty` + `uom_code`) and as `qty_base` — so a later conversion fix
cannot rewrite history.

**`stock_locations`** — stores and counters (D2, D3).
`id, cinema_id, name, kind ('store'|'counter'), pos_counter_id (nullable FK to
pos_counters), operating_unit_id (nullable), display_order, archived_at, timestamps`.
A CHECK enforces `pos_counter_id is not null` when `kind = 'counter'`.

**`stock_item_consumption`** — which location(s) consume an item (§4.3).
`stock_item_id, location_id, timestamps`, PK on both. A trigger rejects a
`kind = 'store'` location — stores don't consume.

### 5.2 Recipes

**`recipes`** — one effective-dated recipe per sale item.
`id, cinema_id, fb_product_id, version int, effective_from date, is_active,
yield_qty numeric default 1, source ('upload'|'manual'), notes, timestamps`.
Unique `(cinema_id, fb_product_id, effective_from)`. Effective dating matters: when the
popcorn portion changes in September, August's variance must still compute on August's
recipe. A bulk re-upload creates a new version dated from the upload, it does not
overwrite the old one.

**`recipe_lines`** — flat (D9).
`id, recipe_id, stock_item_id, qty numeric, uom_code, qty_base, wastage_pct default 0`.
Unique `(recipe_id, stock_item_id)`. No `component_kind`, no self-reference — a combo
simply lists all of its components, exactly as the F&B software exports it.

**`fb_product_aliases`** — raw POS strings → `fb_products`.
`id, cinema_id, fb_product_id, alias_norm text, source ('auto'|'manual'), timestamps`.
Unique `(cinema_id, alias_norm)`. `alias_norm` is lowercased with punctuation and
whitespace collapsed, so `"Coke (350 Ml)"`, `"COKE 350ML"` and `"Coke  350 ml"` collide
onto one row. Auto-seeded by exact-normalised match against `fb_products`; everything
unmatched lands in the coverage worklist for a human to map once.

### 5.3 Transactions

**`stock_receipts`** / **`stock_receipt_lines`** — GRN (D1).
Header: `id, cinema_id, location_id, supplier_party_id → parties, invoice_no,
invoice_date, received_on date, status ('draft'|'posted'), notes, created_by, posted_at,
posted_by`.
Lines: `id, receipt_id, stock_item_id, qty, uom_code, qty_base, rate (per uom_code),
amount, free_qty_base default 0`.
Only `posted` receipts enter the variance equation. `free_qty_base` (supplier freebies)
adds quantity at zero cost, which is exactly right for weighted average.

**`stock_transfers`** / **`stock_transfer_lines`** — store→counter, store→store,
counter→counter.
Header: `id, cinema_id, from_location_id, to_location_id, transferred_on, status
('draft'|'posted'), notes, created_by`. Lines: `id, transfer_id, stock_item_id, qty,
uom_code, qty_base`.
Transfers are the backbone of D3 — without them, counter variance is meaningless, so
the UI makes issuing stock to a counter a two-tap operation rather than a form.

**`stock_adjustments`** / **`stock_adjustment_lines`** — everything that leaves stock
without being sold.
Header: `id, cinema_id, location_id, adjusted_on, reason ('wastage'|'expiry'|'breakage'|
'staff'|'complimentary'|'sample'|'correction'), status, notes, created_by`.
Lines: `id, adjustment_id, stock_item_id, qty, uom_code, qty_base, note`.
Reasons are a fixed vocabulary because "why did stock leave" is the whole point — free
text would make the analysis worthless.

### 5.4 The count

**`stocktakes`** — header.
`id, cinema_id, count_date, scope ('full'|'partial'), status ('draft'|'submitted'|
'approved'|'void'), recipe_coverage_pct, sales_source_note, submitted_by/at,
approved_by/at, notes, timestamps`.
No period columns on the header — periods are per line (§4.2).

**`stocktake_lines`** — one row per (item, location).
`id, stocktake_id, location_id, stock_item_id, period_start date, counted_qty,
count_uom, counted_qty_base, opening_qty_base, received_qty_base, transfer_in_base,
transfer_out_base, adjustment_qty_base, theoretical_qty_base, expected_qty_base,
variance_qty_base, unit_cost, variance_value, pool_key, note`.
Every component of the equation is stored, not just the answer — otherwise "why is this
−3 kg?" needs a re-derivation the operator can't perform. `pool_key` groups the lines of
a multi-location item (§4.3) so the report can present them as one figure.

**`stocktake_consumption`** — the snapshot of the derivation (§4.5).
`id, stocktake_id, fb_product_id (nullable), sale_item_name, qty_sold, net_amount,
stock_item_id (nullable), location_id (nullable), theoretical_qty_base, is_mapped
boolean`.
Unmapped sale items are kept as rows with `is_mapped = false` and a null
`stock_item_id`, which is what drives the coverage figure and the worklist.

---

## 6. Recipes and the mapping problem

The hard part of this module is not the arithmetic. It is that POS item names are typed
by humans and drift over time.

The pipeline, per line period:

1. Read every `fb_entries.items[]` entry in the date range. Aggregate `qty` and
   `netAmount` by normalised name.
2. Resolve each normalised name via `fb_product_aliases` → `fb_products`. Unresolved
   names are recorded and surfaced (§4.6), never silently dropped.
3. Find the recipe in force on the sales date: highest `effective_from ≤ date`,
   `is_active`.
4. Expand `recipe_lines`. Each line contributes
   `qty_sold × qty_base × (1 + wastage_pct/100)` to its stock item.
5. Route each stock item's total to its consuming location(s) via
   `stock_item_consumption` (§4.3).

Items that need no recipe because they are sold as-is — a bottle of water, a chocolate
bar — get a **1:1 direct-sale recipe**: one line, one stock item, `qty = 1 ea`. The UI
offers this as a single "sells as stock item" toggle rather than making someone
hand-build a one-line recipe for forty SKUs.

**Bulk upload.** The recipe book is maintained in the existing F&B software and
uploaded here (D9). The importer is built to *that software's export format* — the
sample export is the one outstanding input (§10.1). Below is the canonical internal
shape the importer normalises to; the real column names and header layout come from the
sample.

```
sale_item_name,        component_name,  qty, uom, wastage_pct
Popcorn Cheese (s),    Popcorn Kernel,   30, g,   3
Popcorn Cheese (s),    Cheese Powder,     8, g,   0
Popcorn Cheese (s),    Tub Small,         1, ea,  0
Popcorn (l) + 2 Coke(s), Popcorn Kernel, 60, g,   3
Popcorn (l) + 2 Coke(s), Tub Large,       1, ea,  0
Popcorn (l) + 2 Coke(s), Coke 350ml Can,  2, ea,  0
```

Mechanics mirror the SOP bulk upload (`UploadSopsModal` in `pages/operations/Sops.tsx`)
— sequential processing, per-row status, failures left on screen with their reason.
Validation is strict and pre-flight: unknown stock item, unknown UOM for that item, or a
duplicate component within a recipe rejects the row before anything is written. The
whole upload is one transaction per sale item, so a partial recipe can never land.

---

## 7. Screens

New nav group **Stocktake** — its own group, not a leaf under Operations, which it would
overload.

| Screen | Route | Who | What |
|---|---|---|---|
| **Count sheet** | `/stocktake/counts`, `/stocktake/counts/:id` | daily_manager, manager, owner | The primary surface. Location picker, then items grouped by category, count entered in the item's `is_count_default` UOM, running counted/not-counted progress, save-as-draft, submit. Warns when a pooled item's sibling locations are uncounted. Owner/manager see Approve. Mobile-first — this gets used standing at a shelf on a phone. |
| **Variance report** | `/stocktake/variance/:id` | owner, manager, accountant | Coverage banner, then a per-location breakdown with a cinema total that reconciles to the sum. Rows sorted by `\|variance_value\|` desc; each expands into the full equation. Flagged rows highlighted. CSV export. |
| **Variance trend** | `/stocktake/trend` | owner, manager, accountant | Per item (or per location), variance across the last N counts. Turns one fortnight's noise into a signal: an item that is −2% every single count is a recipe problem, one that spikes once is an event. Uses `recharts`, already a dependency. |
| **Goods received** | `/stocktake/receipts` | manager, owner, accountant | GRN list + entry form. Draft → posted. |
| **Transfers & adjustments** | `/stocktake/movements` | daily_manager, manager, owner | Store→counter issues and wastage/staff/complimentary entry. Optimised for speed — this is the highest-frequency screen in the module and the one most likely to be skipped under pressure. |
| **Recipes** | `/stocktake/recipes` | owner, manager | Recipe list with coverage %, editor, bulk upload, and the unmapped-sale-item worklist. |
| **Items & locations** | `/stocktake/items` | owner, manager | Stock item master, UOM conversions, stores and counters, and the item→counter consumption assignment. |

Registration follows the house pattern exactly: `NAV` group + `IconStocktake` in
`components/icons.tsx`, capability const + gated `<Route>` block in `App.tsx`,
`lib/stocktake.ts` for all data access and pure helpers, row types in `lib/db-types.ts`.
The count sheet, variance report and trend view warrant `components/stocktake/` — a
deliberate departure from the SOPs single-file shape.

---

## 8. Roles and RLS

| Role | Count | Approve | GRN | Transfers / wastage | Recipes | Masters | Variance |
|---|---|---|---|---|---|---|---|
| `owner` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `manager` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `daily_manager` | ✓ | — | — | ✓ | — | — | — |
| `accountant` | — | — | ✓ | — | — | — | ✓ |
| `cashier` | — | — | — | — | — | — | — |

Policies mirror `sops_01_rls.sql`: named policies, drop-and-recreate, `cinema_access(cinema_id)`
on read, role helper conjoined on write. Two rules beyond the standard pattern:

- **Approved stocktakes are immutable.** `update`/`delete` policies on `stocktakes` and
  `stocktake_lines` carry `status <> 'approved'`, with a separate owner-only `void`
  transition. This is the integrity backbone of §4.5 — enforce it in the database, not
  the UI.
- **Posted receipts and transfers are immutable** on the same principle; corrections are
  a reversing entry, not an edit.

`ROLE_ACCESS.md` needs new rows for all seven routes — note it currently predates
Operations/SOPs too, so it is already one module behind.

---

## 9. Phasing

Each phase is one branch off `staging`, one migration pair (`_NN_*.sql` schema +
`_NN_*_rls.sql`), independently shippable.

| Phase | Delivers | Value on its own |
|---|---|---|
| **1 — Masters** | `stock_items`, `stock_item_uoms`, `stock_locations`, `stock_item_consumption` + the Items & locations screen + CSV import. | The stock list and the store/counter map stop living in someone's head. |
| **2 — Recipes** | `recipes`, `recipe_lines`, `fb_product_aliases`, alias auto-seed, recipe screen + bulk upload, **coverage report against the existing 350 days of `fb_entries`**. | Theoretical consumption becomes visible and backtestable before any counting starts. The phase that de-risks everything after it. |
| **3 — Goods received** | `stock_receipts` (+ lines), GRN screen, periodic weighted-average cost. | Purchase history in the console; supplier spend by item. |
| **4 — Movements** | `stock_transfers`, `stock_adjustments` (+ lines) and their screen. | Wastage gets recorded and measured — a control win independent of variance — and counter-level stock becomes real. |
| **5 — The count** | `stocktakes`, `stocktake_lines`, count sheet, submit/approve, opening carry-forward. | First real closing stock figure, per location. |
| **6 — Variance** | `stocktake_consumption`, variance report, trend view, threshold flags, CSV export, and a Slack/digest post on approval listing flagged items. | The whole point. |

Phase 2 before phase 3 is deliberate. Recipes can be validated against a year of real
sales that already exists, so by the time anyone counts anything we already know whether
the recipe book is trustworthy. Doing it the other way round means the first variance
report is uninterpretable — nobody can tell a bad count from a bad recipe.

Phase 4 before phase 5 is equally deliberate under D3: counter-level variance is only
meaningful once transfers are being recorded. If phase 5 shipped first, every counter
would show a fictitious variance equal to whatever was moved to it untracked.

---

## 10. Open inputs

1. **A sample recipe export from the existing F&B software** — the one thing blocking
   the phase-2 importer spec. Needed: the file itself (or a screenshot of the export
   dialog), so the importer is built to that format rather than forcing a re-key. Also
   worth knowing whether that software holds the *stock item* master too, in which case
   phase 1's CSV import should target the same export.
2. **Where does GRN physically land?** Assumed: deliveries go to a store and are issued
   to counters. If some suppliers deliver straight to a counter, the GRN screen needs
   the location picker defaulted per supplier rather than to the main store.
3. **GST on purchases** — is the GRN rate inclusive or exclusive, and is input credit
   tracked here or entirely Tally's job? Determines whether `stock_receipt_lines` needs
   a tax split.
4. **How far back do we backfill GRN?** Cleanest start is a full opening count on day
   one and no purchase backfill — the first period is then fully clean. Backfilling
   purchases to get an earlier start date buys little.
5. **Variance flag thresholds** — default proposed is ±2% of consumption *and* ≥ ₹250
   absolute, so trivial rupee amounts don't cry wolf. Confirm or set per category.
