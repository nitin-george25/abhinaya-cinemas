# Tally Integration — Step-by-Step Roadmap

**Owner:** Nitin George
**Date:** 3 July 2026
**Status:** Approved direction — Tally (TallyPrime) is the system of record for the merged entity.
**Supersedes:** sequencing in [`Tally + Zoho Accounting Integration - Plan.md`](./Tally%20+%20Zoho%20Accounting%20Integration%20-%20Plan.md) §6 (which assumed Zoho-first). Architecture, data mapping, and safety design in that plan remain authoritative — this doc turns it into a build sequence with Tally as the single target.

---

## 1. Objectives

1. **Automate operations end-to-end.** Once a business day is locked in the console, its accounting entries appear in Tally without anyone re-keying them.
2. **Exactly-once posting.** No invoice, sales entry, or voucher is ever posted twice — retries, re-runs, and backfills are safe by construction.
3. **Redirect the Finance team.** Manual entry work drops to exception handling; capacity moves to audits, analysis, and strategy.

**Non-goals for v1:** in-console P&L dashboards, two-way ledger sync, automated bank-statement matching, automated payments or filings. The integration books entries; it never moves money.

---

## 2. Architecture recap (from the plan doc)

```
Console event (DCR lock / expense / settlement)
        ▼
[ accounting_export ] outbox table (Postgres, RLS)
        ▼  outbound HTTPS poll (no inbound ports)
Tally bridge agent (Windows service on the cinema LAN)
        ▼  XML voucher envelope → http://localhost:9000
TallyPrime (company loaded) → voucher GUID → written back to outbox
```

Business logic never calls Tally inline. The outbox is the only path into the books.

---

## 3. Exactly-once design (the dedupe guarantees)

This is the answer to "avoid multiple uploads of the same invoices/sales entries," enforced at four layers:

1. **Deterministic idempotency key** per document — `{entity}:{business_date}:{doc_type}:{stream}` — with a **unique index** on the outbox. The same day's ticket sales physically cannot enqueue twice.
2. **Status gate in the bridge.** The bridge claims a row (`pending → posting`) before sending; only `pending` rows are ever sent. A crash mid-post leaves the row in `posting`, which is **verified, never blindly retried** (see 3).
3. **Verify-before-retry.** On restart or timeout ambiguity, the bridge queries Tally (voucher by our reference in the narration/UDF field) before re-sending. Found → record GUID, mark `posted`. Not found → safe to retry.
4. **External-ref write-back + drift check.** Every posted voucher stores its Tally GUID. A daily pg_cron job compares console totals vs posted outbox totals and Tally refs, flagging gaps or duplicates into the existing digest email.

Corrections are **adjustment vouchers**, never edits or re-posts — the audit trail stays append-only.

---

## 4. Phases

### Phase 0 — Decisions & CA workshop (1–2 weeks elapsed, ~1 day effort)

Everything downstream sequences off this. Sit with the CA and lock:

- **Chart-of-accounts mapping:** exact ledger names for each revenue stream, expense category, distributor, and method clearing ledger (Cash in hand, Card Receivable, Razorpay Receivable).
- **GST specifics:** ticket-price slabs/thresholds, Kerala local-body entertainment tax treatment, F&B/restaurant-service slab + ITC eligibility, HSN/SAC codes.
- **Posting granularity:** one consolidated daily sales voucher per stream, or itemised.
- **Distributor share treatment:** purchase/film-hire expense + payable, per current practice.
- **Interim F&B handling:** F&B books live in Zoho until the merger. Decide: keep F&B manual-in-Zoho until the merged GSTIN, or point the F&B stream at Tally from day one under the merged company. (Recommendation: keep Zoho manual for the short transition; do **not** build a Zoho adapter we plan to retire.)
- **Bridge host:** which always-on Windows PC runs the bridge; confirm TallyPrime is reliably open with the right company loaded, or schedule Tally to auto-start.

**Exit:** signed-off mapping sheet (becomes the seed for config tables) + interim-F&B decision + named host machine.

### Phase 1 — Foundations (~3–4 days)

- `accounting_export` outbox table + RLS + unique idempotency index; statuses `pending | posting | posted | failed | skipped`.
- Mapping config tables: `expense_category → tally_ledger`, revenue stream → ledger, distributor → ledger. Seeded from the Phase 0 sheet; editable in console settings (owner-only) so ledger changes never need a deploy. Reuse/extend the existing `accounting_head` column from the payments taxonomy migration (`20260629120000_payments_01_taxonomy.sql`) rather than adding a parallel field; the `zoho_push` flag there is subject to the Phase 0 interim-F&B decision.
- Environment parity: staging targets a **test Tally company**, prod targets live books, detected by hostname per project rule. No hard-coded company names.
- Enqueue triggers: DCR finalize/lock → sales + distributor rows; expense approval → expense row; settlement record → settlement row. Post-after-lock only (after the 2-day edit window), so vouchers don't churn on same-day corrections.

**Exit:** locking a staging DCR creates correctly-shaped, GST-split outbox rows; duplicate lock attempts create zero new rows.

### Phase 2 — Tally bridge agent (~4–6 days)

- Lightweight Node/Python Windows service on the host PC. Outbound HTTPS only; auths to Supabase with a **scoped credential** that can read `pending` rows and write back status/refs — nothing else.
- XML voucher templating (`<ENVELOPE>` envelopes) per doc type; response parsing; GUID write-back.
- Verify-before-retry logic (§3.3) and exponential backoff on Tally-unreachable.
- **Ops hardening — this is the fragile part:** bridge heartbeat row in Supabase; digest alert if no heartbeat for N hours or if `pending` rows age past a threshold; auto-start on boot; log file on the host.

**Exit:** bridge posts a hand-crafted test voucher to the **test company**, GUID written back; kill-and-restart mid-post produces no duplicate voucher.

### Phase 3 — Daily sales posting (~4–6 days)

- DCR ticket revenue by class → daily sales voucher, GST-split computed **in the console** (net vs output GST vs entertainment tax) — the bridge never calculates tax.
- Distributor share → purchase/film-hire voucher + distributor payable.
- F&B revenue stream per the Phase 0 interim decision.
- Post-lock edits (owner override) → adjustment voucher, auto-generated.

**Exit:** a full staging day posts to the test company and matches the DCR **to the rupee**; the CA reviews and approves voucher shape; re-running the day posts nothing.

### Phase 4 — Payment reconciliation (~3–5 days)

- Collection day (T): receipts debit method clearing ledgers, not the bank.
- Settlement day (T+N): console settlement records drive bank receipt vouchers, net of gateway fees; fees → Payment Gateway Charges ledger.
- Clearing-ledger balances become the collected-vs-settled reconciliation signal.

**Exit:** test-week bank ledger matches settled cash; clearing balances explain every in-flight rupee.

### Phase 5 — Expenses & purchases (~3–4 days)

- Approved petty expenses → cash payment vouchers by category ledger, receipt reference attached.
- Vendor bills / F&B purchases → purchase vouchers with input GST (ITC) tagging.
- Distributor settlement payouts → payment vouchers against Phase 3 payables.

**Exit:** a test month of expenses and purchases reconciles; every voucher traces to a console receipt.

### Phase 6 — GST validation & go-live (~3–5 days + CA review cycles)

- Run a full filing period in parallel: console→Tally test company vs the CA's manual books. Diff.
- Validate GSTR-1 can be pulled from Tally directly from our tagged data — no rebuild.
- Cutover checklist: switch prod target to the live company, backfill from an agreed start date (idempotency makes backfill safe), CA sign-off.

**Exit:** CA confirms a monthly filing is producible from console-fed data with no manual reconstruction. **Manual daily entry stops here.**

### Phase 7 — Automation hardening & finance workflow shift (~3–4 days, then ongoing)

- Daily reconciliation report in the digest: console totals vs posted totals vs Tally, aged `pending`/`failed` alerts, bridge health.
- Console "Accounting" view for the Finance team: exception queue (failed/aged rows, adjustment vouchers awaiting review) — their daily touchpoint replaces data entry.
- Runbook for the bridge host (restart, Tally company checks, what alerts mean).
- Merger convergence: when the single GSTIN is live, route F&B through the same pipeline and retire any interim Zoho handling.

**Exit:** Finance team's recurring work = reviewing exceptions and the daily reconciliation line, not entering vouchers.

---

## 5. Timeline shape

Roughly **20–28 build days** across Phases 1–7, gated by Phase 0 and CA review cycles. Critical path: Phase 0 → 1 → 2 → 3; Phases 4 and 5 can overlap once 3 is stable. Schedule risks: CA availability (Phases 0, 3, 6) and bridge-host reliability (Phase 2).

---

## 6. What the Finance team stops and starts doing

| Stops (automated) | Starts (freed capacity) |
|---|---|
| Re-keying daily sales into Tally | Reviewing the daily reconciliation report |
| Manual GST splitting per stream | Monthly filing review instead of rebuild |
| Entering expense/purchase vouchers | Spend analysis by category/vendor |
| Tracking T+N settlements by hand | Audit sampling from the append-only trail |
| Chasing "did we already enter this?" | Strategy: pricing, margin, capex planning |

---

## 7. Risks & mitigations

- **Bridge host down / Tally not open** → outbox just queues; nothing is lost. Heartbeat alert in digest; runbook restart. Longer-term option: Tally on a cloud VM (plan doc §3.3-C) if host reliability proves poor.
- **Ledger renames in Tally breaking mappings** → mapping table is config, not code; failed posts land in the exception queue with the Tally error verbatim.
- **GST rule changes** → rates/slabs live in console config with effective dates, never hard-coded (plan doc §4 warning).
- **Merger timing slips** → pipeline is unaffected; only the F&B routing decision (Phase 0) and Phase 7 convergence move.
