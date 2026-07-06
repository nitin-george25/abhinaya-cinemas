// ============================================================================
// /payments — the unified Payments inbox (S1), the accountant's home for this
// module. A single worklist of everything needing a payment action across
// General, Project and Petty sources, with status lanes, KPI tiles, search, and
// a state-aware row → detail drawer.
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
import { useSync } from "../../lib/hooks/SyncContext";
import { useCashRefs } from "../../lib/hooks/useCashRefs";
import { fmtINR } from "../../lib/dashboard";
import { listInbox, type PaymentInboxRow } from "../../lib/payments";

export default function PaymentsInboxPage() {
  const { state } = useSync();
  const refs = useCashRefs();
  const navigate = useNavigate();

  const [rows, setRows] = useState<PaymentInboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [lane, setLane] = useState<Lane>("all");
  const [query, setQuery] = useState("");
  const [openRow, setOpenRow] = useState<PaymentInboxRow | null>(null);

  const unitIds = useMemo(() => refs.units.map((u) => u.id), [refs.units]);

  async function reload() {
    if (!refs.cinemaId) return;
    setLoading(true); setErrored(false);
    try {
      setRows(await listInbox(unitIds, refs.cinemaId));
    } catch { setErrored(true); }
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
          <Button onClick={() => navigate("/payments/create")}>Make a Payment</Button>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Awaiting owner" value={fmtINR(kpis.awaitingAmt)} hint={`${kpis.awaitingCount} pending`} />
        <Kpi label="Ready to pay" value={fmtINR(kpis.approvedAmt)} hint="approved" tone="green" />
        <Kpi label="Paid (in view)" value={fmtINR(kpis.paidAmt)} hint="general payments" />
        <Kpi label="Drafts" value={String(kpis.draftCount)} hint="not submitted" />
      </div>

      <LaneTabs value={lane} onChange={setLane} counts={counts} />

      {/* Worklist */}
      {loading ? (
        <InboxSkeleton />
      ) : errored ? (
        <Card>
          <CardBody className="space-y-3 py-10 text-center">
            <div className="text-ink">Couldn't load payments.</div>
            <div><Button onClick={() => void reload()}>Retry</Button></div>
          </CardBody>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardBody className="py-12 text-center text-ink-muted">
            {rows.length === 0 ? "No payments yet. Raise one with “Make a Payment”." : "Nothing in this lane."}
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="p-0">
            {/* Desktop table */}
            <table className="hidden w-full text-sm sm:table">
              <thead className="bg-paper text-xs uppercase tracking-wide text-ink-muted">
                <tr>
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
                {filtered.map((r) => (
                  <PaymentRow key={`${r.kind}-${r.id}`} row={r} onOpen={() => setOpenRow(r)} />
                ))}
              </tbody>
            </table>

            {/* Mobile cards */}
            <ul className="divide-y divide-line sm:hidden">
              {filtered.map((r) => (
                <li key={`${r.kind}-${r.id}`}>
                  <button className="w-full px-4 py-3 text-left" onClick={() => setOpenRow(r)}>
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
