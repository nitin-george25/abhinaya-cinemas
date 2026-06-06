// ============================================================================
// /cash/closings/:id — read-only detail of a signed (or draft) closing.
// ============================================================================

import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { useCashRefs } from "../../lib/hooks/useCashRefs";
import { useSync } from "../../lib/hooks/SyncContext";
import { fmtINR } from "../../lib/dashboard";
import {
  cashierSignClosing,
  deleteClosing,
  disputeClosing,
  getClosing,
  signClosing,
  type DailyCashClosing,
} from "../../lib/cash";

export default function CashClosingDetailPage() {
  const { state }             = useSync();
  const { id }                = useParams<{ id: string }>();
  const refs                  = useCashRefs();
  const [closing, setClosing] = useState<DailyCashClosing | null>(null);
  const [err, setErr]         = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);
  const navigate              = useNavigate();
  const role                  = state.role;
  const isManager             = role === "owner" || role === "manager" || role === "daily_manager";
  const isOwner               = role === "owner";

  useEffect(() => {
    if (!id) return;
    void getClosing(id).then(setClosing);
  }, [id]);

  if (!closing) return <div className="text-sm text-ink-muted">Loading…</div>;
  const unit  = refs.units.find((u) => u.id === closing.operatingUnitId);
  const lkup  = new Map(refs.paymentMethods.map((m) => [m.id, m.displayName] as const));
  const flow  = new Map(refs.paymentMethods.map((m) => [m.id, m.flowType] as const));

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
             closing.status === "counted"   ? "bg-blue-100 text-blue-700" :
             closing.status === "draft"     ? "bg-amber-100 text-amber-700" :
             closing.status === "disputed"  ? "bg-red-100 text-red-700" :
                                              "bg-paper text-ink-muted")
          }>{
            closing.status === "counted" ? "awaiting cashier" : closing.status
          }</span>
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
                <th className="px-3 py-2 text-right">POS</th>
                <th className="px-3 py-2 text-right">Actual</th>
                <th className="px-3 py-2 text-right">Diff</th>
              </tr>
            </thead>
            <tbody>
              {closing.paymentMethods.map((p) => {
                // Cash's actual lives in the denomination count below;
                // legacy rows (pre-cash_17) have no recorded actual.
                const isCash = flow.get(p.paymentMethodId) === "cash";
                const actual = isCash ? null : p.actualAmount ?? null;
                const diff   = actual == null ? null : actual - p.amount;
                return (
                  <tr key={p.paymentMethodId} className="border-t border-line">
                    <td className="px-3 py-2">{lkup.get(p.paymentMethodId) ?? p.paymentMethodId}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtINR(p.amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                      {actual == null
                        ? (isCash ? "see cash count" : "—")
                        : fmtINR(actual)}
                    </td>
                    <td className={
                      "px-3 py-2 text-right tabular-nums " +
                      (diff == null ? "text-ink-muted"
                        : diff === 0 ? "text-emerald-600"
                        : "text-red-600")
                    }>
                      {diff == null ? "—" : diff === 0 ? "0" : fmtINR(diff)}
                    </td>
                  </tr>
                );
              })}
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

      {/* Signoff trail */}
      <Card>
        <CardHeader><CardTitle>Signoffs</CardTitle></CardHeader>
        <CardBody className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <span className="font-medium text-ink">Manager:</span>{" "}
            {closing.signedAt
              ? `${closing.managerSignedByEmail ?? closing.closedByEmail} · ${closing.signedAt.slice(0, 16).replace("T", " ")}`
              : "not signed"}
          </div>
          <div>
            <span className="font-medium text-ink">Cashier:</span>{" "}
            {closing.cashierSignedAt
              ? `${closing.cashierSignedByEmail} · ${closing.cashierSignedAt.slice(0, 16).replace("T", " ")}`
              : "awaiting"}
          </div>
        </CardBody>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        {/* Manager sign-now from detail view (parallel to the dialog).
            Draft → counted; cashier still must confirm. */}
        {isManager && closing.status === "draft" && state.email ? (
          <Button disabled={busy} onClick={async () => {
            setBusy(true); setErr(null);
            try { await signClosing(closing.id, state.email!); await reload(); }
            catch (e) { setErr((e as Error).message); }
            finally  { setBusy(false); }
          }}>Manager sign</Button>
        ) : null}
        {/* Cashier confirm — counted → signed. Triggers ledger write.
            Gated on email match, not role — anyone who's been listed as
            the cashier on this closing can confirm (owners and managers
            often run the till themselves). */}
        {closing.status === "counted"
          && state.email
          && closing.cashierEmail
          && closing.cashierEmail.toLowerCase() === state.email.toLowerCase() ? (
          <Button disabled={busy} onClick={async () => {
            setBusy(true); setErr(null);
            try { await cashierSignClosing(closing.id, state.email!); await reload(); }
            catch (e) { setErr((e as Error).message); }
            finally  { setBusy(false); }
          }}>Confirm as cashier</Button>
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
        {/* Owner-only delete. Strong confirmation prompt — this also tears
            down the auto-inserted cash_deposit ledger row via trigger. */}
        {isOwner ? (
          <Button variant="danger" disabled={busy} onClick={async () => {
            const ok = window.confirm(
              `Delete the closing for ${closing.businessDate} (${closing.shift})?\n\n` +
              `This removes the closing, its denominations and payment-method rows, ` +
              `and the matching bank-ledger entry. The action cannot be undone.`,
            );
            if (!ok) return;
            setBusy(true); setErr(null);
            try {
              await deleteClosing(closing.id);
              navigate("/cash/closings");
            } catch (e) { setErr((e as Error).message); setBusy(false); }
          }}>Delete</Button>
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
