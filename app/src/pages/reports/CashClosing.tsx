// ============================================================================
// Route page: /reports/pos/cash-closing — Daily POS cash closing summary.
//
// One business day at a time. Answers the morning-review questions over the
// previous day's tills:
//   • Who billed? — grouped by cashier (falls back to the manager who closed).
//   • How much did each sell, and is there a discrepancy?
//   • What's the total sale, and how much cash must be banked?
//
// Headline totals: total sale, cash to deposit (cash counted net of the till
// float each unit retains), non-cash collected, and the net discrepancy.
// CSV export gives the per-closing detail for the accountant.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field, Input, Select } from "../../components/ui/Input";
import { useCashRefs } from "../../lib/hooks/useCashRefs";
import { fmtINR } from "../../lib/dashboard";
import { downloadCsv } from "../../lib/csv";
import { todayIso } from "../../lib/dates";
import { weekday } from "../../lib/format";
import {
  listAuthorizedUsers,
  listClosings,
  type AuthorizedUserSummary,
  type DailyCashClosing,
} from "../../lib/cash";

export default function ReportsPosCashClosingPage() {
  const refs                  = useCashRefs();
  const [date, setDate]       = useState<string>(todayIso());
  const [unitId, setUnitId]   = useState<string>("");      // "" = all units
  const [rows, setRows]       = useState<DailyCashClosing[]>([]);
  const [loading, setLoading] = useState(false);

  // Email → name lookup (same pattern as the Cash Closing page) so the report
  // shows "Nitin" instead of full email addresses.
  const [users, setUsers] = useState<AuthorizedUserSummary[]>([]);
  useEffect(() => {
    let alive = true;
    void listAuthorizedUsers().then((u) => alive && setUsers(u));
    return () => { alive = false; };
  }, []);
  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of users) if (u.email) map.set(u.email.toLowerCase(), u.fullName ?? u.email);
    return (email?: string | null) => {
      if (!email) return "—";
      return map.get(email.toLowerCase()) ?? email;
    };
  }, [users]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void listClosings({ from: date, to: date, ...(unitId ? { operatingUnitId: unitId } : {}) })
      .then((list) => { if (alive) { setRows(list); setLoading(false); } });
    return () => { alive = false; };
  }, [date, unitId]);

  // Counter id → name. Old rows can point at archived counters refs doesn't
  // carry (active-only) — fall back to a dash.
  const counterName = (id: string) => refs.counters.find((c) => c.id === id)?.name ?? "—";

  // ── Day totals ──────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let sale = 0, cash = 0, nonCash = 0, petty = 0, discrepancy = 0;
    for (const r of rows) {
      sale        += r.posTotalSales;
      cash        += r.cashCounted;
      nonCash     += r.posNonCashTotal;
      petty       += r.pettyExpensesPaid;
      discrepancy += r.discrepancy;
    }
    return { sale, cash, nonCash, petty, discrepancy };
  }, [rows]);

  // Each till retains a float once at deposit time (deposited + float = cash
  // counted, per RecordDepositDialog). Net cash to bank = cash counted minus
  // one float for each unit that has a closing today.
  const floatRetained = useMemo(() => {
    const unitIds = new Set(rows.map((r) => r.operatingUnitId));
    let f = 0;
    for (const id of unitIds) f += refs.units.find((u) => u.id === id)?.defaultFloatAmount ?? 0;
    return f;
  }, [rows, refs.units]);
  const cashToDeposit = totals.cash - floatRetained;

  // ── Group by cashier ─────────────────────────────────────────────────────
  const byCashier = useMemo(() => {
    interface Agg {
      key: string; email: string | null;
      sale: number; cash: number; nonCash: number; discrepancy: number;
      count: number; counters: Set<string>; pending: number; disputed: number;
    }
    const map = new Map<string, Agg>();
    for (const r of rows) {
      const email = r.cashierEmail ?? r.closedByEmail ?? null;
      const key   = (email ?? "—").toLowerCase();
      let a = map.get(key);
      if (!a) {
        a = { key, email, sale: 0, cash: 0, nonCash: 0, discrepancy: 0,
              count: 0, counters: new Set(), pending: 0, disputed: 0 };
        map.set(key, a);
      }
      a.sale        += r.posTotalSales;
      a.cash        += r.cashCounted;
      a.nonCash     += r.posNonCashTotal;
      a.discrepancy += r.discrepancy;
      a.count       += 1;
      a.counters.add(counterName(r.posCounterId));
      if (r.status === "disputed") a.disputed += 1;
      else if (r.status !== "signed" && r.status !== "resolved") a.pending += 1;
    }
    return Array.from(map.values()).sort((x, y) => y.sale - x.sale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, refs.counters]);

  function exportCsv() {
    const out: Array<Array<string | number>> = [];
    out.push([
      "Date", "Cashier", "Closed by", "Counter", "Shift",
      "Sale", "Cash counted", "Non-cash", "Petty paid", "Discrepancy", "Status",
    ]);
    for (const r of rows) {
      out.push([
        r.businessDate,
        nameOf(r.cashierEmail),
        nameOf(r.closedByEmail),
        counterName(r.posCounterId),
        r.shift,
        r.posTotalSales,
        r.cashCounted,
        r.posNonCashTotal,
        r.pettyExpensesPaid,
        r.discrepancy,
        r.status,
      ]);
    }
    downloadCsv(`pos-cash-closing_${date}.csv`, out);
  }

  return (
    <div className="space-y-5 max-w-7xl">
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight">
          POS daily cash closing
        </h2>
        <p className="text-sm text-ink-muted mt-1">
          Summary of one day's till closings — who billed, what they sold, the
          cash to be banked, and any discrepancy.
        </p>
      </div>

      {/* ── Filters ──────────────────────────────────────────────────── */}
      <Card>
        <CardBody className="grid gap-3 sm:grid-cols-3 items-end">
          <Field label="Business date" hint={niceDate(date)}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Unit">
            <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              <option value="">All units</option>
              {refs.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
          <div>
            <Button
              variant="secondary" size="md"
              onClick={exportCsv} disabled={rows.length === 0}
              className="w-full sm:w-auto"
            >
              Export CSV
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* ── Headline totals ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Tile label="Total sale" value={fmtINR(totals.sale)} />
        <Tile
          label="Cash to deposit"
          value={fmtINR(cashToDeposit)}
          hint={floatRetained > 0
            ? `Cash ${fmtINR(totals.cash)} − float ${fmtINR(floatRetained)}`
            : `Cash counted ${fmtINR(totals.cash)}`}
          accent="good"
        />
        <Tile label="Non-cash" value={fmtINR(totals.nonCash)} />
        <Tile
          label="Discrepancy"
          value={fmtINR(totals.discrepancy)}
          accent={totals.discrepancy === 0 ? "good" : "bad"}
        />
      </div>

      {/* ── By cashier ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>By cashier</CardTitle>
          <span className="text-xs text-ink-muted">
            {byCashier.length} cashier{byCashier.length === 1 ? "" : "s"} · {rows.length} closing{rows.length === 1 ? "" : "s"}
          </span>
        </CardHeader>
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left">Cashier</th>
                <th className="px-3 py-2 text-left">Counters</th>
                <th className="px-3 py-2 text-right">Closings</th>
                <th className="px-3 py-2 text-right">Sale</th>
                <th className="px-3 py-2 text-right">Cash</th>
                <th className="px-3 py-2 text-right">Non-cash</th>
                <th className="px-3 py-2 text-right">Discrepancy</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-ink-muted">Loading…</td></tr>
              ) : byCashier.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-ink-muted">No closings for this day.</td></tr>
              ) : byCashier.map((a) => (
                <tr key={a.key} className="border-t border-line">
                  <td className="px-3 py-2">{nameOf(a.email)}</td>
                  <td className="px-3 py-2 text-ink-muted">{Array.from(a.counters).join(", ")}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.count}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(a.sale)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(a.cash)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(a.nonCash)}</td>
                  <td className={"px-3 py-2 text-right tabular-nums " + discColor(a.discrepancy)}>
                    {fmtINR(a.discrepancy)}
                  </td>
                  <td className="px-3 py-2">
                    {a.disputed > 0
                      ? <span className="text-red-600">{a.disputed} disputed</span>
                      : a.pending > 0
                        ? <span className="text-amber-600">{a.pending} pending</span>
                        : <span className="text-emerald-600">signed</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            {byCashier.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-line font-semibold bg-paper/40">
                  <td className="px-3 py-2" colSpan={2}>Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{rows.length}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(totals.sale)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(totals.cash)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(totals.nonCash)}</td>
                  <td className={"px-3 py-2 text-right tabular-nums " + discColor(totals.discrepancy)}>
                    {fmtINR(totals.discrepancy)}
                  </td>
                  <td className="px-3 py-2"></td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </CardBody>
      </Card>

      {/* ── Closing detail ───────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Closings</CardTitle>
        </CardHeader>
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left">Cashier</th>
                <th className="px-3 py-2 text-left">Counter</th>
                <th className="px-3 py-2 text-left">Shift</th>
                <th className="px-3 py-2 text-right">Sale</th>
                <th className="px-3 py-2 text-right">Cash</th>
                <th className="px-3 py-2 text-right">Non-cash</th>
                <th className="px-3 py-2 text-right">Petty</th>
                <th className="px-3 py-2 text-right">Discrepancy</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-ink-muted">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-ink-muted">No closings for this day.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-2">{nameOf(r.cashierEmail ?? r.closedByEmail)}</td>
                  <td className="px-3 py-2">{counterName(r.posCounterId)}</td>
                  <td className="px-3 py-2">{r.shift}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(r.posTotalSales)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(r.cashCounted)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(r.posNonCashTotal)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(r.pettyExpensesPaid)}</td>
                  <td className={"px-3 py-2 text-right tabular-nums " + discColor(r.discrepancy)}>
                    {fmtINR(r.discrepancy)}
                  </td>
                  <td className="px-3 py-2">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}

// ── helpers ────────────────────────────────────────────────────────────

function discColor(n: number): string {
  return n === 0 ? "" : n > 0 ? "text-emerald-600" : "text-red-600";
}

function niceDate(d: string): string {
  try { return format(parseISO(d), "EEE, d MMM yyyy"); } catch { return weekday(d); }
}

function Tile({ label, value, hint, accent }: {
  label: string; value: string; hint?: string; accent?: "good" | "bad";
}) {
  const color =
    accent === "good" ? "text-emerald-600"
    : accent === "bad" ? "text-red-600"
    : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-paper-card p-3">
      <div className="text-xs uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`mt-1 font-semibold tabular-nums ${color}`}>{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-ink-muted tabular-nums">{hint}</div> : null}
    </div>
  );
}
