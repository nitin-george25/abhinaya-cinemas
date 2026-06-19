# Zoho Books Integration — build handoff + runbook

Feature: import Zoho Books **Bills** (purchase invoices) and **Invoices** (F&B sales)
into the console. Plan: `~/.claude/plans/ethereal-baking-mccarthy.md`.

- **Purchase invoices** surface in a new **Invoices** page (Finance nav group).
- **Sales** roll up into the existing daily **F&B Sales** model (`fb_entries`),
  with Zoho as the **source of truth** (manual/DSR entry demoted to gap-fill).
- Sync is **hybrid**: a real-time webhook + a scheduled OAuth pull (backfill +
  reconcile). One Zoho org spans multiple cinemas; each record's cinema is
  derived from its **branch** via `public.zoho_orgs`.

---

## What was added / changed

### Database (`supabase/migrations/`)
- **`20260619120000_zoho_invoices_00_schema.sql`** — tables `invoices`,
  `invoice_line_items`, `zoho_orgs` (org/branch→cinema map), `zoho_sync_state`
  (per-module pull watermark), `zoho_dead_letters` (unmapped/failed parking).
  Also `alter table public.fb_entries add column source default 'manual'`
  (reaper-safety — see below). `invoices` reserves nullable `project_id /
  budget_item_id / expense_id` so `project_invoices` can fold in later.
- **`20260619120100_zoho_invoices_01_rls.sql`** — RLS: invoices read/write =
  `cinema_access(cinema_id) AND is_accountant_or_owner()`, delete = `is_owner()`;
  sync-plumbing tables are owner-read / service-role-write only.
- **`20260619120200_zoho_sync_cron_schedule.sql`** — pg_cron every 15 min calls
  `zoho-sync`. Vault-backed + prod-only (reuses `digest_project_url` /
  `digest_anon_key`); no-ops on staging.

### Edge Functions (`supabase/functions/`)
- **`_shared/zoho.ts`** — OAuth refresh (cached), org/branch→cinema mapping,
  Bill/Invoice → row normalization, idempotent `upsertInvoice` (conflict on
  `(cinema_id, zoho_id)` + last-modified guard), `recomputeFbEntry` (sales →
  daily `fb_entries` with food/bev split), dead-letter helper.
- **`zoho-webhook/index.ts`** — public (`verify_jwt=false`); validates the
  `x-webhook-secret` header; routes `?module=bills|invoices`; upserts; recomputes
  `fb_entries` for sales.
- **`zoho-sync/index.ts`** — OAuth pull; `?mode=backfill` (full history) vs
  incremental (by watermark). No-ops when Zoho secrets are absent.
- **`supabase/config.toml`** — added `[functions.zoho-webhook]` (verify_jwt=false)
  and `[functions.zoho-sync]` (verify_jwt=true).

### Frontend (`app/src/`)
- **`lib/invoices.ts`** — direct-DAL (mirrors `projects.ts`): `listInvoices`,
  `getInvoiceLines`, owner-only `deleteInvoice` + `db-types.ts` row types.
- **`pages/Invoices.tsx`** — purchase-invoice register + detail modal (line items
  + CGST/SGST/IGST). Routed in `App.tsx` (`canSeeReports`); nav leaf in the
  Finance group (`nav.ts`), gated owner|manager|accountant.
- **F&B reaper safety** (highest-risk change):
  - `types.ts` `FbEntry.source`; `db-types.ts` `FbEntryRow.source/cinema_id`;
    `mappers.ts` carries `source`.
  - **`lib/fbSync.ts`** `planFbSync()` — pure decision: the client only upserts
    changed **manual** days and only reaps **manual** days; Zoho-owned days are
    never touched. Unit-tested in **`lib/fbSync.test.ts`** (7 cases).
  - `hooks/useSupabaseSync.ts` — `pullAll` routes `source='zoho'` dates into
    `synced.current.fbZohoDates` (out of the reaper's authority); `pushDeltas`
    drives off `planFbSync` and scopes the reaper delete by `cinema_id` (fixes a
    latent multi-cinema cross-delete bug).
  - `pages/fb/History.tsx` + `pages/fb/Entry.tsx` — "Zoho" badge; Zoho days are
    read-only (manual entry only for dates Zoho hasn't supplied).

**Why the reaper change matters:** the F&B delta-sync engine treats the client's
in-memory `fbEntries` as authoritative — it deletes any `fb_entries` date the
client doesn't hold. Without `source`, a Zoho-imported day would be silently
reaped on the next unrelated F&B edit. `source='manual'` default keeps every
legacy row client-owned, so the safety logic is correct on day one with no
backfill.

---

## One-time setup (per Zoho org)

### 1. OAuth self-client (for the pull/backfill)
1. <https://api-console.zoho.in> (India DC) → **Self Client** → create.
2. **Generate Code** tab → scopes `ZohoBooks.bills.READ,ZohoBooks.invoices.READ`
   (add `ZohoBooks.settings.READ` if needed) → pick your org → **Create** → copy
   the grant code (short TTL).
3. Exchange for tokens (run within the code TTL):
   ```sh
   curl -X POST "https://accounts.zoho.in/oauth/v2/token" \
     -d grant_type=authorization_code -d client_id=<ID> \
     -d client_secret=<SECRET> -d code=<GRANT_CODE>
   ```
   Save the `refresh_token` (does not expire).
4. Get `organization_id`: `GET https://www.zohoapis.in/books/v3/organizations`
   with header `Authorization: Zoho-oauthtoken <access_token>`.

> Confirm the org's data center first (login domain / `api_domain` in the token
> response). If it's not `.in`, set `ZOHO_DC` accordingly and use the matching
> `accounts.zoho.<dc>` / `zohoapis.<dc>` hosts.

### 2. Supabase Edge secrets (set per project — staging + prod)
```sh
supabase secrets set --project-ref <ref> \
  ZOHO_WEBHOOK_SECRET=<random-long-string> \
  ZOHO_CLIENT_ID=<id> ZOHO_CLIENT_SECRET=<secret> \
  ZOHO_REFRESH_TOKEN=<refresh_token> ZOHO_ORG_ID=<organization_id> ZOHO_DC=in
```

### 3. Deploy
```sh
npm run db:push:staging   # then :prod (or via the Dashboard GitHub integration)
supabase functions deploy zoho-webhook --project-ref <ref>
supabase functions deploy zoho-sync    --project-ref <ref>
```

### 4. Seed the org/branch → cinema map
For each cinema (Zoho **branch**), insert a `zoho_orgs` row (owner, in the SQL
editor or an admin tool):
```sql
insert into public.zoho_orgs (zoho_org_id, zoho_branch_id, cinema_id, label)
values ('<organization_id>', '<branch_id>', '<cinema uuid>', 'Audi-1');
```
> **Open item:** confirm which Zoho field carries the cinema. The code reads
> `branch_id`; if your org uses a custom field/location instead, tell the dev so
> `mapCinema` (and the seed rows) point at the right field. Unmapped records are
> parked in `zoho_dead_letters`, never written to a wrong cinema.

### 5. Zoho Workflow Rules + Webhooks (real-time)
For **Bills** and again for **Invoices** (Settings → Automation):
1. **Workflow Actions → Webhooks → New**: URL
   `https://<project>.supabase.co/functions/v1/zoho-webhook?module=bills`
   (and `?module=invoices`), Method **POST**, Payload **Default (JSON)**, add
   **Header** `x-webhook-secret: <ZOHO_WEBHOOK_SECRET>`.
2. **Workflow Rules → New**: module Bills (then Invoices), **Event Based**,
   trigger **Created or Edited**, frequency **every time edited**, Action = the
   webhook. Use **Save and Execute** to test.

### 6. Backfill history (workflow rules don't fire on pre-existing records)
Invoke repeatedly until each module reports `exhausted: true`:
```sh
supabase functions invoke zoho-sync --project-ref <ref> --no-verify-jwt \
  --method POST --url-query 'mode=backfill'
```
(Each run imports up to ~120 new records and cheaply skips already-imported ones,
so re-running after a timeout is safe.) The 15-min cron then keeps it reconciled.

---

## Verify
- **Webhook:** Zoho **Save and Execute** → a row in `public.invoices`; for a sales
  invoice, `fb_entries(cinema,date).source='zoho'` appears on Dashboard +
  `/reports/fb`, read-only in `/fb/history`. Re-send → no row growth (idempotent).
- **Invoices page:** `/invoices` lists Bills with line items + GST split.
- **RLS:** as an accountant scoped to cinema A, cinema B's invoices are invisible.
- **Reaper safety:** `app && npx vitest run src/lib/fbSync.test.ts` (7 pass).

## Troubleshooting
- **Unmapped records:** `select * from public.zoho_dead_letters where not resolved;`
  → add the missing `zoho_orgs` mapping, then re-run backfill.
- **Re-pull a module from scratch:** delete its `zoho_sync_state` row (or set
  `last_modified = null`) and run `?mode=backfill`.
- **Thin webhook payloads (no line_items):** the webhook re-fetches the full record
  via the OAuth credentials — ensure the Zoho secrets are set.
- **Token issues:** the refresh token is the only long-lived secret; rotate by
  re-running the self-client flow and updating `ZOHO_REFRESH_TOKEN`.

## Operational notes / known limitations
- **Sync concurrency:** `pg_cron` does not prevent overlapping `zoho-sync` runs.
  A run is bounded (≤120 writes, ≤60 pages) so it normally finishes in well under
  the 15-min cadence; if a run ever hangs (Zoho API timeout) and overlaps the
  next, the writes are idempotent (header guarded by `(cinema_id, zoho_id)` +
  last-modified; line items only replaced when a payload carries them; watermark
  is last-writer-wins), so it self-heals. If overlaps become real, add an
  advisory-lock guard at the top of `zoho-sync`.
- **Backfill resumes safely:** a run capped at 120 writes does NOT advance the
  incremental watermark, so the next run re-scans (cheaply skipping records it
  already holds) and continues — no records are skipped.

## Known pre-existing (unrelated) test failures
`app/src/lib/engine.test.ts` has 2 failing box-office tax assertions (`etax`,
`fund`) that predate this work and are untouched by it.
