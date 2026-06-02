// ============================================================================
// /cash/closings/:id — read-only detail of a signed (or draft) closing.
// ============================================================================

import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { useCashRefs } from "../../lib/hooks/useCashRefs";
import { fmtINR } from "../../lib/dashboard";
import {
  disputeClosing,
  getClosing,
  signClosing,
  type DailyCashClosing,
} from "../../lib/cash";

export default function CashClosingDetailPage() {
  const { id }                = useParams<{ id: string }>();
  const refs                  = useCashRefs();
  const [closing, setClosing] = useState<DailyCashClosing | null>(null);
  const [err, setErr]         = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);

  useEffect(() => {
    if (!id) return;
    void getClosing(id).then(setClosing);
  }, [id]);

  if (!closing) return <div className="text-sm text-ink-muted">Loading…</div>;
  const unit  = refs.units.find((u) => u.id === closing.operatingUnitId);
  const lkup  = new Map(refs.paymentMethods.map((m) => [m.id, m.displayName] as const));

  async function reload() { if (id) setClosing(await getClosing(id)); }

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link className="text-amber-600 underline" to="/cash/closings">← Back to closings</Link>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{closing.businessDate} · {closing.shift}</CardTitle>
            <div className="text-xs text-ink-muted mt-1">
              {unit?.name ?? "Unknown unit"} · Closed by {closing.closedByEmail}
            </div>
          </div>
          <span className={
            "text-xs px-2 py-0.5 rounded " +
            (closing.status === "signed"    ? "bg-emerald-100 text-emerald-700" :
             closing.status === "draft"     ? "bg-amber-100 text-amber-700" :
             closing.status === "disputed"  ? "bg-red-100 text-red-700" :
                                              "bg-paper text-ink-muted")
          }>{closing.status}</span>
        </CardHeader>
        <CardBody className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Tile label="POS total"      value={fmtINR(closing.posTotalSales)} />
          <Tile label="Non-cash"       value={fmtINR(closing.posNonCashTotal)} />
          <Tile label="Cash expected"  value={fmtINR(closing.posCashExpected)} />
          <Tile label="Cash counted"   value={fmtINR(closing.cashCounted)} />
          <Tile label="Petty expenses" value={fmtINR(closing.pettyExpensesPaid)} />
          <Tile label="Cash deposited" value={fmtINR(closing.cashDeposited)} />
          <Tile
            label="Discrepancy"
            value={fmtINR(closing.discrepancy)}
            accent={closing.discrepancy === 0 ? "good" : "bad"}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Payment methods</CardTitle></CardHeader>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-paper text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left">Method</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {closing.paymentMethods.map((p) => (
                <tr key={p.paymentMethodId} className="border-t border-line">
                  <td className="px-3 py-2">{lkup.get(p.paymentMethodId) ?? p.paymentMethodId}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Cash denominations</CardTitle></CardHeader>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-paper text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left">₹</th>
                <th className="px-3 py-2 text-right">Count</th>
                <th className="px-3 py-2 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {closing.denominations.map((d) => (
                <tr key={d.denomination} className="border-t border-line">
                  <td className="px-3 py-2">₹ {d.denomination}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.count}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(d.denomination * d.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {closing.notes ? (
        <Card>
          <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
          <CardBody className="text-sm whitespace-pre-wrap">{closing.notes}</CardBody>
        </Card>
      ) : null}

      {err ? <div className="text-sm text-red-600">{err}</div> : null}
      <div className="flex justify-end gap-3">
        {closing.status === "draft" ? (
          <Button disabled={busy} onClick={async () => {
            setBusy(true); setErr(null);
            try { await signClosing(closing.id); await reload(); }
            catch (e) { setErr((e as Error).message); }
            finally  { setBusy(false); }
          }}>Sign now</Button>
        ) : null}
        {closing.status === "signed" ? (
          <Button variant="danger" disabled={busy} onClick={async () => {
            const reason = prompt("Dispute reason");
            if (!reason) return;
            setBusy(true); setErr(null);
            try { await disputeClosing(closing.id, reason); await reload(); }
            catch (e) { setErr((e as Error).message); }
            finally  { setBusy(false); }
          }}>Dispute</Button>
        ) : null}
      </div>
    </div>
  );
}

function Tile({ label, value, accent }:
  { label: string; value: string; accent?: "good" | "bad" }) {
  const color =
    accent === "good" ? "text-emerald-600"
    : accent === "bad" ? "text-red-600"
    : "text-ink";
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="text-xs uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`mt-1 font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
