# Tally + Zoho Books Integration — Console Accounting Automation Plan

**Owner:** Nitin George
**Date:** 19 June 2026
**Status:** Draft plan for review (not yet scheduled into the build pipeline)
**Direction:** Console → accounting systems (one-way push), with read-back limited to confirmation refs

---

## 1. Goal

Make the console the single source of truth for daily operational data, and push that data automatically into the accounting systems so day-to-day bookkeeping stops being manual re-entry. We are starting with four workstreams, in priority order:

1. **Daily sales posting** — DCR ticket revenue + F&B revenue → sales vouchers/invoices, correctly GST-split.
2. **Payment reconciliation** — cash / card / Razorpay-QR collections and their T+N settlements → receipt and bank vouchers that reconcile to the bank statement.
3. **Expense & purchase entry** — petty expenses, vendor bills, F&B purchases, distributor settlements → purchase/payment vouchers.
4. **GST / statutory prep** — output tax correctly tagged so GSTR-1 / monthly filing is a report, not a rebuild.

Advanced features (P&L dashboards in-console, two-way ledger sync, automated bank-statement matching) are explicitly **out of scope for v1** and parked for later phases.

---

## 2. The constraint that shapes everything: two entities becoming one

Today there are **two firms with two accounting systems**:

| Entity (today) | System | What it books |
|---|---|---|
| Cinema firm | **Tally (TallyPrime)**, CA-managed | Ticket sales, distributor share, cinema operating costs |
| F&B firm | **Zoho Books** | Concession / café sales, F&B purchases |

These two are being **merged into a single company**. This is the single most important decision the integration must be designed around, because it determines whether we are building one pipeline or two — and for how long.

**Recommendation: design the integration as two independent target adapters from day one, but treat the merger as a forcing function to pick ONE system of record for the merged entity.** Reasons:

- Building both adapters now is not wasted work even if you later consolidate — during the transition period (pre-merger books, prior-year filing, CA continuity) both systems stay live and both need feeding.
- Post-merger, a single legal entity files **one GST return** and produces **one set of statutory accounts**. Running ticket revenue through Tally and F&B through Zoho under one GSTIN creates reconciliation and filing overhead indefinitely. You will want to converge.
- The console's job doesn't change either way: it emits clean, GST-tagged accounting documents to an outbox. Which downstream system(s) consume them is a routing decision, not an architecture change.

**Open decision for you + your CA (see §9):** for the merged company, do you consolidate on **Tally** (CA comfort, statutory norm in India, on-prem) or **Zoho Books** (cloud, API-native, far easier to integrate)? The integration is materially simpler and cheaper to operate if the merged entity standardises on Zoho Books; it is more conservative/CA-friendly if it standardises on Tally. This plan supports either, but flags the cost difference at each step.

---

## 3. Target architecture

The console backend is Supabase (Edge Functions + Postgres + pg_cron), cloud-hosted. The two accounting targets have **very different reachability**, and this asymmetry drives the design:

- **Zoho Books is cloud + REST.** A Supabase Edge Function can call it directly over HTTPS.
- **Tally is a desktop app on the cinema's local network.** Its integration surface is an HTTP/XML server on **port 9000**, reachable only on the LAN where Tally runs. A cloud function cannot reach it directly, and exposing port 9000 to the internet is not acceptable.

### 3.1 The outbox pattern (core of the design)

We never let business logic call an accounting API inline. Instead, every postable event writes a row to an **export outbox** table in Postgres. Adapters drain the outbox. This gives us idempotency, retries, an audit trail, and decoupling from accounting-system downtime.

```
DCR finalized / expense saved / settlement recorded
        │
        ▼
[ accounting_export ]  (Postgres outbox table)
   id, business_date, cinema_id, entity, doc_type,
   target ('zoho' | 'tally'), payload jsonb,
   idempotency_key, status ('pending'|'posted'|'failed'|'skipped'),
   external_ref, attempts, last_error, created_at, posted_at
        │
        ├─────────────► Zoho adapter (Supabase Edge Function, pg_cron every N min)
        │                  → POST to Zoho Books API → write back external_ref
        │
        └─────────────► Tally bridge (small agent on the on-prem Windows PC)
                           polls outbox over HTTPS (outbound only) →
                           POSTs XML to http://localhost:9000 →
                           writes back external_ref
```

### 3.2 Zoho Books adapter

- Runs as a Supabase Edge Function, triggered by pg_cron on a short interval (e.g. every 10–15 min) or on-demand after DCR lock.
- Auth: OAuth 2.0. Create a **Zoho self-client**, do the one-time grant→refresh-token exchange, store the **refresh token in Supabase Vault** (same pattern already used for the digest secrets). Access tokens last ~1 hour; the adapter refreshes on demand.
- Rate limit: **100 requests/min/org**, HTTP 429 on breach with **no Retry-After header** — so the adapter must implement its own backoff. At our volume (a handful of documents per day) this is a non-issue, but the backoff still matters for batch backfills.
- Use the **India edition** (GST fields: `gst_treatment`, `gst_no`, HSN/SAC, place of supply).

### 3.3 Tally bridge

Tally needs a **small bridge agent running on the same Windows machine as TallyPrime** (or any always-on PC on that LAN). It:

1. Polls the Supabase outbox over **outbound HTTPS** (no inbound firewall rules, no port-forwarding, no tunnel exposure).
2. Transforms the JSON payload into a Tally **XML voucher envelope** (`<ENVELOPE><HEADER>…<BODY>…`).
3. POSTs it to `http://localhost:9000` while TallyPrime is running with the target company loaded.
4. Parses Tally's XML response, writes `external_ref` (Tally voucher GUID/master id) back to the outbox, marks `posted`.

Bridge implementation options, cheapest-first:
- **(A) Custom lightweight agent** (Node/Python, ~a day's work) running as a Windows service or scheduled task. Recommended — full control, no licence cost, fits the outbox model exactly.
- **(B) Third-party Tally connector** (e.g. commercial Tally integration middleware). Faster to stand up, recurring licence cost, less control.
- **(C) Move Tally to a cloud VM** so the Edge Function reaches it directly. Removes the on-prem dependency but adds VM cost, Tally licensing-on-cloud questions, and CA workflow disruption. Only worth it if Tally remains the long-term system of record.

> ⚠️ **Reality check:** the Tally side is the operationally fragile part — it depends on a specific PC being on, Tally being open, and the right company being loaded. If the merged entity consolidates on **Zoho Books**, this entire bridge disappears. That is the strongest practical argument for Zoho as the converged system.

---

## 4. Data mapping (per workstream)

> Account/ledger names below are indicative. Exact ledger names, GST rates, and HSN/SAC codes must be confirmed with your CA before build (see §9). GST rates and entertainment-tax treatment change; do not hard-code without confirmation.

### 4.1 Daily sales posting

**Trigger:** DCR is **finalized/locked** for a business date. We deliberately post **after** the existing 2-day edit lock closes, so we don't churn vouchers on same-day corrections. (Alternative: post a provisional voucher on close and an adjustment voucher if edited — more complex; defer unless the CA wants daily provisional booking.)

**One business date → one sales document per revenue stream:**

| Console source | Accounting document | Notes |
|---|---|---|
| DCR ticket gross by class (era-tagged classes) | Sales voucher (Tally) / Invoice or Journal (Zoho) | Split net revenue vs output GST vs any local-body entertainment tax. Kerala local-body entertainment tax may apply on top of GST — **confirm with CA.** |
| Distributor share of net collection | Purchase/expense + payable to distributor | Distributor catalog + per-movie FK already in console; map each distributor to a ledger. |
| F&B / concession sales (Razorpay QR + cash) | Sales voucher / Invoice (F&B entity → Zoho today) | Restaurant-service GST treatment differs from packaged goods — **confirm slab + ITC eligibility.** |

GST split is the hard part. Movie tickets and F&B sit in **different GST slabs**, and ticket pricing may straddle slab thresholds. The console already knows price-by-class and item-by-category, so the **split is computed in the console** and emitted pre-split in the payload — the adapters never guess tax.

### 4.2 Payment reconciliation

The console already models **payment methods** (cash, card, Razorpay/UPI-QR) and **per-method settlement lag (T+N)** with a settlements/deposits flow. This maps cleanly onto a two-step accounting model:

1. **On collection day (T):** sales receipt debits a *method clearing/control ledger* (e.g. "Razorpay Receivable", "Card Receivable", "Cash in hand") rather than the bank directly.
2. **On settlement day (T+N):** a bank receipt voucher moves the amount from the clearing ledger to the bank, net of gateway fees. The console's settlement records (which already know the settlement date and amount) drive this second voucher.

This means the accounting bank balance tracks **actual settled cash**, and any gap between collected and settled is visible as a clearing-ledger balance — which is exactly the reconciliation signal you want. Gateway fees → a "Payment Gateway Charges" expense ledger.

### 4.3 Expense & purchase entry

| Console source | Accounting document |
|---|---|
| Petty cash expenses (with mandatory receipt) | Payment voucher (cash) + expense ledger by category |
| Vendor bills / F&B purchases | Purchase voucher + input GST (ITC) where eligible |
| Distributor settlement payouts | Payment voucher against the distributor payable from §4.1 |

Expense **category → ledger** mapping is a one-time config table in the console (`expense_category → {tally_ledger, zoho_account}`). Receipts are already mandatory in the console; attach/reference them so the CA has source documents.

### 4.4 GST / statutory prep

Because every sales/purchase document is emitted **already tagged** with GST rate, HSN/SAC, place of supply, and registration treatment, the monthly filing becomes a **report pull** rather than a reconstruction:

- Output GST flows from §4.1 sales documents.
- Input GST (ITC) flows from §4.3 purchase documents.
- After the entity merger, both ticket and F&B revenue file under **one GSTIN** — which is the cleanest argument for converging onto one system, because otherwise GSTR-1 is assembled from two tools.

v1 deliverable here is **correct tagging at source**, not an in-console GST return. The return is generated in Tally/Zoho (or by the CA) from correctly-tagged data.

---

## 5. Idempotency, safety & audit

This is money data, so the guardrails matter as much as the happy path:

- **Deterministic idempotency key** per document, e.g. `{entity}:{business_date}:{doc_type}:{stream}`. The adapter refuses to post if a `posted` row with that key already exists. Prevents double-booking on retries.
- **External ref write-back.** Every posted document stores the Tally voucher GUID / Zoho document id, so we can trace console → ledger both ways and detect drift.
- **Post-after-lock.** Sales documents only generate after the DCR edit-lock window, eliminating same-day churn. Edits after lock (owner override) generate an **adjustment** document, never a silent overwrite.
- **Staging + prod parity.** Per existing project rule, the adapter detects environment by hostname and points at a **Zoho sandbox org / a test Tally company** in staging — never the live books. No hard-coded org/company ids.
- **Reconciliation report.** A daily check (pg_cron) compares console totals vs `posted` outbox totals and flags any `pending`/`failed` older than N hours — surfaced in the existing digest email.
- **Nothing auto-pays.** The integration books entries only. It never initiates a payment, transfer, or filing.

---

## 6. Phased rollout

| Phase | Scope | Exit criteria |
|---|---|---|
| **P0 — Foundations** | Outbox table + RLS; env/parity detection; Zoho self-client + Vault token; Tally bridge skeleton (poll + auth, no posting yet); ledger/account mapping config tables. | Outbox rows created on DCR lock; bridge authenticates and polls; mappings seeded with CA. |
| **P1 — Daily sales (Zoho first)** | F&B + (if converging on Zoho) ticket sales → Zoho Books invoices/journals, GST-split, in **sandbox org**. | A full day's revenue posts correctly to a Zoho sandbox and matches the DCR to the rupee. |
| **P2 — Daily sales (Tally)** | Ticket sales + distributor share → Tally XML vouchers via bridge, into a **test company**. | A full day posts to test Tally; voucher GUIDs written back; CA reviews voucher shape. |
| **P3 — Payment reconciliation** | Method clearing ledgers + T+N settlement vouchers + gateway-fee booking. | Bank ledger matches settled cash for a test week; clearing balances explain the gap. |
| **P4 — Expense & purchase** | Petty expense + vendor/F&B purchase + distributor payout vouchers with ITC tagging. | Expenses and purchases reconcile for a test month. |
| **P5 — GST/statutory + go-live** | Validate output/input GST tagging against a real filing period; cut over from sandbox/test to live orgs/company; reconciliation report into digest. | CA signs off that a monthly filing can be produced from the data with no manual rebuild. |
| **P6 — Merger convergence** | Once the single company is live, retire the duplicate target and route all streams to the chosen system of record. | One entity, one GSTIN, one accounting system fed end-to-end. |

Sequencing note: **do P1 (Zoho) before P2 (Tally)** regardless of the long-term system-of-record decision — Zoho is faster to integrate and lets us validate the entire outbox→GST-split→post→reconcile loop in the cloud before taking on the on-prem Tally fragility.

---

## 7. Security

- Zoho refresh token and org id → **Supabase Vault**, never in code or client. Reuse the existing prod-secret pattern.
- Tally bridge auths to Supabase with a **scoped service credential** that can only read `pending` outbox rows and write back refs/status — not touch DCR or cash tables.
- Bridge makes **outbound HTTPS only**; no inbound ports opened on the cinema network.
- All accounting writes are append-only from the console's side; corrections are new adjustment documents, preserving an audit trail.

---

## 8. Rough effort shape (for planning, not a quote)

- P0 foundations: ~3–5 days (outbox, mappings, Zoho auth, bridge skeleton).
- P1 Zoho sales + GST split: ~4–6 days (the GST split logic is the bulk).
- P2 Tally bridge + XML vouchers: ~5–8 days (XML templating + bridge ops hardening).
- P3 reconciliation: ~3–5 days.
- P4 expenses/purchases: ~3–4 days.
- P5 GST validation + go-live: ~3–5 days + CA review cycles.

The Tally bridge (P2) and CA-dependent mapping/validation are the schedule risks. If the merged entity standardises on Zoho, **P2 drops entirely** and the project is roughly a third smaller and far less fragile to operate.

---

## 9. Open decisions (need you / your CA before build)

1. **System of record for the merged company:** Tally or Zoho Books? (Biggest driver of cost and operational fragility — Zoho removes the on-prem bridge.)
2. **Timing of the merger vs this build:** do we build both adapters for the transition, or wait for the merged GSTIN and build one? Recommendation: build Zoho now (P1), decide Tally (P2) against the merger timeline.
3. **GST specifics to confirm with CA:** current ticket-price GST slabs and thresholds; Kerala **local-body entertainment tax** applicability and treatment; F&B/restaurant-service slab and ITC eligibility; HSN/SAC codes per revenue stream.
4. **Chart-of-accounts mapping:** exact ledger/account names for each revenue stream, each expense category, each distributor, and the method clearing ledgers.
5. **Posting granularity:** one consolidated daily sales voucher, or itemised — what does your CA want to see in the books?
6. **Distributor share treatment:** booked as purchase/film-hire expense + payable, per current practice? Confirm.
7. **Tally host machine:** which always-on PC runs the bridge, and is Tally reliably open with the right company loaded during the polling window?

---

## 10. Recommended next step

Lock decisions **#1 and #2** (system of record + merger timing) first — everything else sequences off them. In parallel, this can be captured as pipeline items (P0–P6 above) so it enters the normal build backlog. Suggested first build slice: **P0 + P1 (Zoho sales posting into a sandbox org)**, because it proves the whole outbox→GST-split→post→reconcile loop without the Tally on-prem dependency.
