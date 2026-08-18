// ============================================================================
// /payments — the unified Payments inbox (S1), the accountant's home for this
// module. A single worklist of everything needing a payment action across
// General, Project and Petty sources, with status lanes, KPI tiles, search, and
// a state-aware row → detail drawer.
//
// Batching (payments_100): tick two or more invoices for the SAME payee and the
// selection bar offers to pay them together — one approval, one OTP, one UTR,
// one bank-book line. Batched invoices leave this list and reappear folded into
// their batch row, which opens the BatchDrawer instead.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Card, CardBody } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { LaneTabs, type Lane } from "../../components/payments/LaneTabs";
import { PaymentRow } from "../../components/payments/PaymentRow";
import { PaymentStatusBadge } from "../../components/payments/PaymentStatusBadge";
import { PaymentDrawer } from "../../components/payments/PaymentDrawer";
import { BatchDrawer } from "../../components/payments/BatchDrawer";
import { PayeeGroupList, groupByPayee } from "../../components/payments/PayeeGroupList";
import { useSync } from "../../lib/hooks/SyncContext";
import { useCashRefs } from "../../lib/hooks/useCashRefs";
import { fmtINR } from "../../lib/dashboard";
import {
  listInbox,
  createBatch,
  addToBatch,
  type PaymentInboxRow,
} from "../../lib/payments";

/**
 * Statuses an invoice can be in and still join a batch (mirrors the DB gate).
 * Anything awaiting the owner is excluded on purpose — it already has a live
 * Slack card, and a batch card would be a second way to move the same money.
 */
const BATCHABLE = new Set(["draft", "rejected", "invoiced", "approved"]);

/** A batch pays one payee — this is the key rows must agree on to be batched. */
function payeeKey(r: PaymentInboxRow): string {
  return r.payee.trim().toLowerCase();
}

export default function PaymentsInboxPage() {
  const { state } = useSync();
  const refs = useCashRefs();
  const navigate = useNavigate();

  const [rows, setRows] = useState<PaymentInboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  // The reason, not just the fact. A blank inbox and a broken query look the
  // same to the eye, so when the load fails the operator sees WHY.
  const [errored, setErrored] = useState<string | null>(null);
  const [lane, setLane] = useState<Lane>("all");
  const [query, setQuery] = useState("");
  // "list" is chronological — what needs doing next. "payee" answers the other
  // question the accountant has, which is who is owed and can they be paid in
  // one go; that is the view batching actually lives in.
  const [view, setView] = useState<"list" | "payee">("list");
  const [openRow, setOpenRow] = useState<PaymentInboxRow | null>(null);
  const [openBatchId, setOpenBatchId] = useState<string | null>(null);

  // Batch selection — ids of the invoices ticked to be paid together.
  const [picked, setPicked] = useState<string[]>([]);
  const [batching, setBatching] = useState(false);
  const [batchErr, setBatchErr] = useState<string | null>(null);

  const unitIds = useMemo(() => refs.units.map((u) => u.id), [refs.units]);

  async function reload() {
    if (!refs.cinemaId) return;
    setLoading(true); setErrored(null);
    try {
      setRows(await listInbox(unitIds, refs.cinemaId));
    } catch (e) { setErrored((e as Error).message); setRows([]); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    if (refs.loading) return;
    void reload();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [refs.loading, refs.cinemaId, unitIds.join(",")]);

  // counts per lane
  const counts = useMemo(() => {
    const c: Record<Lane, number> = { all: rows.length, draft: 0, awaiting: 0, approved: 0, paid: 0, petty: 0, other: 0 };
    for (const r of rows) c[r.lane] = (c[r.lane] ?? 0) + 1;
    return c;
  }, [rows]);

  // KPI sums
  const kpis = useMemo(() => {
    const sum = (pred: (r: PaymentInboxRow) => boolean) =>
      rows.filter(pred).reduce((a, r) => a + r.amount, 0);
    return {
      awaitingCount: counts.awaiting,
      awaitingAmt: sum((r) => r.lane === "awaiting"),
      approvedAmt: sum((r) => r.lane === "approved"),
      paidAmt: sum((r) => r.lane === "paid" && r.kind === "payment"),
      draftCount: counts.draft,
    };
  }, [rows, counts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (lane !== "all" && r.lane !== lane) return false;
      if (!q) return true;
      return r.payee.toLowerCase().includes(q)
        || r.typeLabel.toLowerCase().includes(q)
        || r.id.toLowerCase().includes(q);
    });
  }, [rows, lane, query]);

  // ── Batch selection ───────────────────────────────────────────────────────
  // Once one invoice is ticked, only invoices for the SAME payee stay tickable:
  // the constraint is the feature, and enforcing it here means the DB's refusal
  // is a backstop rather than the first time anyone hears about it.
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const pickedRows = useMemo(
    () => picked.map((id) => byId.get(id)).filter(Boolean) as PaymentInboxRow[],
    [picked, byId],
  );
  const lockedPayee = pickedRows[0] ? payeeKey(pickedRows[0]) : null;
  const pickedTotal = pickedRows.reduce((a, r) => a + r.amount, 0);

  function canBatch(r: PaymentInboxRow): boolean {
    return r.kind === "payment" && !r.readonly && !r.batchId && BATCHABLE.has(r.status);
  }

  function togglePick(id: string, on: boolean) {
    setBatchErr(null);
    setPicked((cur) => (on ? [...cur, id] : cur.filter((x) => x !== id)));
  }

  /**
   * Turn the ticked invoices into a batch. The header (payee, unit, pay-from
   * account, mode) is inherited from the first invoice — they all share a payee
   * by construction, and the accountant can still change the account at
   * mark-paid. Lands in the drawer so the next step is obvious.
   */
  async function payTogether(rows: PaymentInboxRow[]) {
    const first = rows[0];
    if (!first || rows.length < 2) return;
    setBatching(true); setBatchErr(null);
    try {
      const unitId = first.operatingUnitId ?? refs.units[0]?.id ?? "";
      const unit = refs.units.find((u) => u.id === unitId);
      const batchId = await createBatch({
        operatingUnitId: unitId,
        payeeName: first.payee,
        // The batch must identify its payee the SAME way its lines do. Sending
        // only a name left the batch with a null party id while every line
        // carried one, and fn_payment_batch_payee_matches then compared null
        // against a real id and refused every invoice — "does not match" on a
        // payee that plainly did.
        payeePartyId: first.payeePartyId ?? null,
        payeeDistributorId: first.payeeDistributorId ?? null,
        bankAccountId: unit?.defaultBankAccountId
          ?? refs.bankAccounts.find((b) => b.isPrimary)?.id
          ?? null,
        mode: unit?.defaultPaymentMode ?? "bank_transfer",
        note: `${rows.length} invoices`,
      });
      // Sequential on purpose: fn_payment_batch_add validates each invoice
      // against the batch, and a mid-way refusal should stop rather than race.
      for (const r of rows) await addToBatch(batchId, r.id);
      setPicked([]);
      await reload();
      setOpenBatchId(batchId);
    } catch (e) {
      setBatchErr((e as Error).message);
      await reload();
    } finally { setBatching(false); }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl uppercase tracking-tight">Payments inbox</h2>
          <p className="text-sm text-ink-muted">Everything needing a payment action, in one place.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search payee, type, ID…"
            className="w-56"
          />
          <Button variant="secondary" disabled={loading} onClick={() => void reload()}>Refresh</Button>
          <Button variant="secondary" onClick={() => navigate("/payments/batch/new")}>Pay several invoices</Button>
          <Button onClick={() => navigate("/payments/create")}>Make a Payment</Button>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Awaiting owner" value={fmtINR(kpis.awaitingAmt)} hint={`${kpis.awaitingCount} pending`} />
        <Kpi label="Ready to pay" value={fmtINR(kpis.approvedAmt)} hint="approved · OTP asked" tone="green" />
        <Kpi label="Paid (in view)" value={fmtINR(kpis.paidAmt)} hint="general payments" />
        <Kpi label="Drafts" value={String(kpis.draftCount)} hint="not submitted" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <LaneTabs value={lane} onChange={setLane} counts={counts} />
        <div className="flex items-center gap-1 rounded-lg border border-line bg-paper p-0.5 text-sm">
          {(["list", "payee"] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={`rounded-md px-3 py-1 ${
                view === v ? "bg-paper-card font-medium text-ink shadow-sm" : "text-ink-muted hover:text-ink"
              }`}
              onClick={() => { setView(v); setPicked([]); setBatchErr(null); }}
            >
              {v === "list" ? "By date" : "By payee"}
            </button>
          ))}
        </div>
      </div>

      {/* Selection bar — appears as soon as anything is ticked. */}
      {picked.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="text-sm text-ink-soft">
            <span className="font-medium text-ink">
              {picked.length} invoice{picked.length === 1 ? "" : "s"} selected
            </span>
            {pickedRows[0] ? <> for <span className="font-medium">{pickedRows[0].payee}</span></> : null}
            {" · "}
            <span className="font-mono tabular-nums">{fmtINR(pickedTotal)}</span>
            {picked.length < 2 ? (
              <span className="text-ink-muted"> — tick one more to pay them together.</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" disabled={batching} onClick={() => { setPicked([]); setBatchErr(null); }}>
              Clear
            </Button>
            <Button disabled={batching || picked.length < 2} onClick={() => void payTogether(pickedRows)}>
              {batching ? "Building batch…" : "Pay together"}
            </Button>
          </div>
        </div>
      ) : null}
      {batchErr ? <div className="text-sm text-red-600">{batchErr}</div> : null}

      {/* Worklist */}
      {loading ? (
        <InboxSkeleton />
      ) : errored ? (
        <Card>
          <CardBody className="space-y-3 py-10 text-center">
            <div className="text-ink">Couldn't load payments.</div>
            <div className="mx-auto max-w-lg text-sm text-ink-muted">{errored}</div>
            <div className="text-xs text-ink-muted">
              Nothing has been deleted — this is a read that failed. If the console was
              just redeployed, the database may still be behind it; applying the pending
              migrations usually fixes this.
            </div>
            <div><Button onClick={() => void reload()}>Retry</Button></div>
          </CardBody>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardBody className="py-12 text-center text-ink-muted">
            {rows.length === 0 ? "No payments yet. Raise one with “Make a Payment”." : "Nothing in this lane."}
          </CardBody>
        </Card>
      ) : view === "payee" ? (
        <PayeeGroupList
          groups={groupByPayee(filtered, canBatch)}
          busy={batching}
          onOpen={(r) => (r.kind === "batch" ? setOpenBatchId(r.id) : setOpenRow(r))}
          onPayTogether={(rows) => void payTogether(rows)}
        />
      ) : (
        <Card>
          <CardBody className="p-0">
            {/* Desktop table */}
            <table className="hidden w-full text-sm sm:table">
              <thead className="bg-paper text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="w-8 px-2 py-2"></th>
                  <th className="px-4 py-2 text-left">Payee</th>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-left">Source</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Needed by</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const eligible = canBatch(r);
                  const wrongPayee = eligible && !!lockedPayee && payeeKey(r) !== lockedPayee;
                  return (
                    <PaymentRow
                      key={`${r.kind}-${r.id}`}
                      row={r}
                      onOpen={() => (r.kind === "batch" ? setOpenBatchId(r.id) : setOpenRow(r))}
                      selectable={eligible}
                      selected={picked.includes(r.id)}
                      selectDisabled={wrongPayee}
                      selectHint={`A batch pays one payee — clear the selection to batch ${r.payee} instead.`}
                      onSelect={(on) => togglePick(r.id, on)}
                    />
                  );
                })}
              </tbody>
            </table>

            {/* Mobile cards */}
            <ul className="divide-y divide-line sm:hidden">
              {filtered.map((r) => (
                <li key={`${r.kind}-${r.id}`}>
                  <button
                    className="w-full px-4 py-3 text-left"
                    onClick={() => (r.kind === "batch" ? setOpenBatchId(r.id) : setOpenRow(r))}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink">{r.payee}</span>
                      <span className="font-mono tabular-nums">{fmtINR(r.amount)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-xs text-ink-muted">{r.typeLabel} · {r.source}</span>
                      <PaymentStatusBadge status={r.status} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {openRow ? (
        <PaymentDrawer
          row={openRow}
          role={state.role}
          bankAccounts={refs.bankAccounts}
          onClose={() => setOpenRow(null)}
          onChanged={reload}
        />
      ) : null}

      {openBatchId ? (
        <BatchDrawer
          batchId={openBatchId}
          role={state.role}
          bankAccounts={refs.bankAccounts}
          onClose={() => setOpenBatchId(null)}
          onChanged={reload}
        />
      ) : null}
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "green" }) {
  return (
    <Card>
      <CardBody className="space-y-1 py-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
        <div className={`font-mono text-xl tabular-nums ${tone === "green" ? "text-green-800" : "text-ink"}`}>{value}</div>
        <div className="text-xs text-ink-muted">{hint}</div>
      </CardBody>
    </Card>
  );
}

function InboxSkeleton() {
  return (
    <Card>
      <CardBody className="space-y-3 py-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <div className="h-4 w-40 animate-pulse rounded bg-line" />
            <div className="h-4 w-24 animate-pulse rounded bg-line" />
            <div className="h-4 w-20 animate-pulse rounded bg-line" />
            <div className="h-5 w-16 animate-pulse rounded-full bg-line" />
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
