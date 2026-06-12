// ============================================================================
// /cash/reports — month-end summary + YTD cashflow.
//
// Reads closings + payment requests + ledger rows for the chosen month and
// builds a one-page summary the accountant can paste into a board email.
// Exports the underlying rows as CSV for offline checking.
// ============================================================================

import { useEffect, useMemo, useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field, Input, Select } from "../../components/ui/Input";
import { useCashRefs } from "../../lib/hooks/useCashRefs";
import { fmtINR } from "../../lib/dashboard";
import { downloadCsv } from "../../lib/csv";
import { addDaysIso, todayIso } from "../../lib/dates";
import {
  listClosings,
  listLedgerEntries,
  listPaymentRequests,
  listPettyExpenses,
  listPosSettlements,
  type BankLedgerEntry,
  type DailyCashClosing,
  type PaymentRequest,
  type PettyExpense,
  type PosSettlement,
} from "../../lib/cash";

export default function CashReportsPage() {
  const refs                    = useCashRefs();
  const [month, setMonth]       = useState<string>(currentMonth());
  const [unitId, setUnitId]     = useState<string>("");
  const [closings, setClosings] = useState<DailyCashClosing[]>([]);
  const [petty, setPetty]       = useState<PettyExpense[]>([]);
  const [reqs, setReqs]         = useState<PaymentRequest[]>([]);
  const [ledger, setLedger]     = useState<BankLedgerEntry[]>([]);
  const [settlements, setSettlements] = useState<PosSettlement[]>([]);

  useEffect(() => {
    if (!unitId && refs.units.length > 0) setUnitId(refs.units[0]?.id ?? "");
  }, [refs.units, unitId]);

  const range = useMemo(() => monthRange(month), [month]);

  useEffect(() => {
    if (!unitId) return;
    let alive = true;
    void Promise.all([
      listClosings({ operatingUnitId: unitId, from: range.from, to: range.to }),
      listPettyExpenses({ operatingUnitId: unitId, from: range.from, to: range.to }),
      listPaymentRequests({ operatingUnitId: unitId, from: range.from, to: range.to }),
      refs.bankAccounts[0]
        ? listLedgerEntries(refs.bankAccounts[0].id, range.from, range.to)
        : Promise.resolve([] as BankLedgerEntry[]),
      // Settlements landing within the month + a tail window, so we can tell
      // which closings' non-cash money is already accounted for (T+N pushes
      // some payout dates past the month end).
      listPosSettlements({ from: range.from, to: addDaysIso(range.to, 10) }),
    ]).then(([c, p, r, l, s]) => {
      if (!alive) return;
      setClosings(c); setPetty(p); setReqs(r); setLedger(l); setSettlements(s);
    });
    return () => { alive = false; };
  }, [unitId, range.from, range.to, refs.bankAccounts]);

  // ── KPIs ──────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const sales   = closings.reduce((s, c) => s + c.posTotalSales, 0);
    const cashIn  = closings.reduce((s, c) => s + c.cashDeposited, 0);
    const pettyOk = petty.filter((p) => p.status === "approved").reduce((s, p) => s + p.amount, 0);
    const paidOut = reqs.filter((r) => r.status === "paid").reduce((s, r) => s + r.amount, 0);
    const pendingOut = reqs.filter((r) => r.status !== "paid" && r.status !== "rejected")
                           .reduce((s, r) => s + r.amount, 0);
    const discrepancySum = closings.reduce((s, c) => s + c.discrepancy, 0);
    return { sales, cashIn, pettyOk, paidOut, pendingOut, discrepancySum };
  }, [closings, petty, reqs]);

  // ── Projected incoming settlements ──────────────────────────────────────
  // Each closing's non-cash money lands in the bank T+N days later (per the
  // method's settlement_days). Project the expected payout date for money
  // that isn't already covered by a recorded settlement, so the accountant
  // can see what's still due in. Gross of processor fees.
  const projected = useMemo(() => {
    const methodById = new Map(refs.paymentMethods.map((m) => [m.id, m]));
    // (closingId|methodId) pairs already covered by a settlement row
    // (pending or received) — exclude them; they're being tracked already.
    const handled = new Set<string>();
    for (const s of settlements) {
      for (const cid of s.closingIds) handled.add(`${cid}|${s.paymentMethodId}`);
    }
    type Line = { date: string; methodName: string; amount: number; overdue: boolean };
    const lines: Line[] = [];
    const today = todayIso();
    for (const c of closings) {
      for (const pm of c.paymentMethods) {
        if (!pm.amount) continue;
        const method = methodById.get(pm.paymentMethodId);
        if (!method || method.flowType === "cash") continue;       // cash isn't a payout
        if (handled.has(`${c.id}|${pm.paymentMethodId}`)) continue; // already recorded
        const date = addDaysIso(c.businessDate, method.settlementDays ?? 0);
        lines.push({ date, methodName: method.displayName, amount: pm.amount, overdue: date < today });
      }
    }
    // Roll up to one row per (date, method).
    const byKey = new Map<string, Line>();
    for (const l of lines) {
      const k = `${l.date}|${l.methodName}`;
      const cur = byKey.get(k);
      if (cur) cur.amount += l.amount;
      else byKey.set(k, { ...l });
    }
    const rows = Array.from(byKey.values()).sort((a, b) => a.date.localeCompare(b.date));
    const total = rows.reduce((s, r) => s + r.amount, 0);
    return { rows, total };
  }, [closings, settlements, refs.paymentMethods]);

  function exportCsv() {
    type Line = { kind: string; date: string; ref: string; narration: string; amount: number };
    const lines: Line[] = [
      ...closings.map((c) => ({
        kind: "closing",
        date: c.businessDate, ref: c.shift,
        narration: `Sign · cash counted ${c.cashCounted}, deposited ${c.cashDeposited}`,
        amount: c.posTotalSales,
      })),
      ...petty.filter((p) => p.status === "approved").map((p) => ({
        kind: "petty", date: p.expenseDate, ref: p.requestedByEmail,
        narration: p.description, amount: -p.amount,
      })),
      ...reqs.filter((r) => r.status === "paid").map((r) => ({
        kind: "payment", date: r.paidAt?.slice(0, 10) ?? "",
        ref: r.bankReference ?? "",
        narration: `${r.payeeName} · ${r.purpose}`,
        amount: -r.amount,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date));
    const rows: Array<Array<string | number | null | undefined>> = [
      ["kind", "date", "ref", "narration", "amount"],
      ...lines.map((l) => [l.kind, l.date, l.ref, l.narration, l.amount]),
    ];
    downloadCsv(`cash-${month}.csv`, rows);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Cashflow report</CardTitle>
          <Button size="sm" variant="secondary" onClick={exportCsv}>Export CSV</Button>
        </CardHeader>
        <CardBody className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Unit">
            <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              {refs.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
          <Field label="Month">
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </Field>
        </CardBody>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
        <Tile label="Sales"             value={fmtINR(kpis.sales)} />
        <Tile label="Cash deposited"    value={fmtINR(kpis.cashIn)} accent="good" />
        <Tile label="Petty paid"        value={fmtINR(kpis.pettyOk)} accent="bad" />
        <Tile label="Payments out"      value={fmtINR(kpis.paidOut)} accent="bad" />
        <Tile label="Payments pending"  value={fmtINR(kpis.pendingOut)} />
        <Tile
          label="Discrepancy sum"
          value={fmtINR(kpis.discrepancySum)}
          accent={kpis.discrepancySum === 0 ? "good" : "bad"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Projected incoming ({projected.rows.length})</CardTitle>
          <span className="text-sm font-semibold tabular-nums">{fmtINR(projected.total)}</span>
        </CardHeader>
        <CardBody className="p-0 overflow-x-auto">
          <p className="px-3 pt-3 text-xs text-ink-muted">
            Non-cash money expected in the bank, by settlement date (closing
            date + T+N). Excludes payouts already recorded as settlements.
            Gross of processor fees. Overdue dates are flagged.
          </p>
          {projected.rows.length === 0 ? (
            <p className="px-3 py-4 text-sm text-ink-muted">
              Nothing outstanding — every non-cash payout this month is recorded.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-paper text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Expected date</th>
                  <th className="px-3 py-2 text-left">Method</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {projected.rows.map((r) => (
                  <tr key={`${r.date}|${r.methodName}`} className="border-t border-line">
                    <td className={`px-3 py-2 ${r.overdue ? "text-red-600 font-medium" : ""}`}>
                      {r.date}{r.overdue ? " · overdue" : ""}
                    </td>
                    <td className="px-3 py-2">{r.methodName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtINR(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Closings ({closings.length})</CardTitle>
        </CardHeader>
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Shift</th>
                <th className="px-3 py-2 text-right">Sales</th>
                <th className="px-3 py-2 text-right">Cash counted</th>
                <th className="px-3 py-2 text-right">Discrepancy</th>
              </tr>
            </thead>
            <tbody>
              {closings.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="px-3 py-2">{c.businessDate}</td>
                  <td className="px-3 py-2">{c.shift}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(c.posTotalSales)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(c.cashCounted)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(c.discrepancy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bank ledger ({ledger.length})</CardTitle>
          <span className="text-xs text-ink-muted">{refs.bankAccounts[0]?.name ?? "—"}</span>
        </CardHeader>
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Narration</th>
                <th className="px-3 py-2 text-right">In</th>
                <th className="px-3 py-2 text-right">Out</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td className="px-3 py-2">{e.entryDate}</td>
                  <td className="px-3 py-2">{e.narration}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {e.receiptAmount > 0 ? fmtINR(e.receiptAmount) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {e.paymentAmount > 0 ? fmtINR(e.paymentAmount) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthRange(yyyymm: string): { from: string; to: string } {
  const [y, m] = yyyymm.split("-").map(Number);
  if (!y || !m) return { from: yyyymm, to: yyyymm };
  const last  = new Date(y, m, 0).getDate();
  const mm    = String(m).padStart(2, "0");
  const last2 = String(last).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${last2}` };
}

function Tile({ label, value, accent }:
  { label: string; value: string; accent?: "good" | "bad" }) {
  const color =
    accent === "good" ? "text-emerald-600"
    : accent === "bad" ? "text-red-600"
    : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-paper-card p-3">
      <div className="text-xs uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`mt-1 font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
