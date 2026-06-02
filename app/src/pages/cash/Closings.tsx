// ============================================================================
// /cash/closings — historical list of daily cash closings.
// ============================================================================

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Field, Select } from "../../components/ui/Input";
import { useCashRefs } from "../../lib/hooks/useCashRefs";
import { fmtINR } from "../../lib/dashboard";
import { weekday } from "../../lib/format";
import { listClosings, type DailyCashClosing } from "../../lib/cash";

export default function CashClosingsPage() {
  const refs                  = useCashRefs();
  const [unitId, setUnitId]   = useState<string>("");
  const [rows, setRows]       = useState<DailyCashClosing[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!unitId && refs.units.length > 0) setUnitId(refs.units[0]?.id ?? "");
  }, [refs.units, unitId]);

  useEffect(() => {
    if (!unitId) return;
    let alive = true;
    setLoading(true);
    void listClosings({ operatingUnitId: unitId }).then((r) => {
      if (alive) setRows(r);
    }).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [unitId]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Closings</CardTitle></CardHeader>
        <CardBody className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Unit">
            <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              {refs.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Shift</th>
                <th className="px-3 py-2 text-right">Sales</th>
                <th className="px-3 py-2 text-right">Cash counted</th>
                <th className="px-3 py-2 text-right">Discrepancy</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-muted">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-muted">No closings yet.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-2">
                    <div>{r.businessDate}</div>
                    <div className="text-xs text-ink-muted">{weekday(r.businessDate)}</div>
                  </td>
                  <td className="px-3 py-2">{r.shift}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(r.posTotalSales)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(r.cashCounted)}</td>
                  <td className={
                    "px-3 py-2 text-right tabular-nums " +
                    (r.discrepancy === 0 ? "" :
                     r.discrepancy > 0 ? "text-emerald-600" : "text-red-600")
                  }>{fmtINR(r.discrepancy)}</td>
                  <td className="px-3 py-2">
                    <span className={
                      "inline-block text-xs px-2 py-0.5 rounded " +
                      (r.status === "signed"    ? "bg-emerald-100 text-emerald-700" :
                       r.status === "draft"     ? "bg-amber-100 text-amber-700" :
                       r.status === "disputed"  ? "bg-red-100 text-red-700" :
                                                  "bg-paper text-ink-muted")
                    }>{r.status}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link className="text-amber-600 text-sm underline" to={`/cash/closings/${r.id}`}>View</Link>
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
