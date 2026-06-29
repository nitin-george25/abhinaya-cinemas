// ============================================================================
// /payments/advances — outstanding advances (S7, §8.3).
//
// Two tabs: Distributor (auto-net off the DCR settlement — display only) and
// Vendor (proforma-driven; net them against a final invoice from that payment's
// drawer → "Net advances"). Shows paid, applied, balance and age.
// ============================================================================

import { useEffect, useMemo, useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Tabs } from "../../components/ui/Tabs";
import { useCashRefs } from "../../lib/hooks/useCashRefs";
import { fmtINR } from "../../lib/dashboard";
import { listOutstandingAdvances, type OutstandingAdvance } from "../../lib/payments";

function ageDays(iso: string | null): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return `${days}d`;
}

export default function PaymentsAdvancesPage() {
  const refs = useCashRefs();
  const unitIds = useMemo(() => refs.units.map((u) => u.id), [refs.units]);
  const [tab, setTab] = useState<"distributor" | "vendor">("vendor");
  const [rows, setRows] = useState<OutstandingAdvance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (refs.loading) return;
    let alive = true;
    setLoading(true);
    void listOutstandingAdvances(unitIds).then((r) => { if (alive) { setRows(r); setLoading(false); } });
    return () => { alive = false; };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [refs.loading, unitIds.join(",")]);

  const shown = rows.filter((r) => r.kind === tab && r.balance > 0.005);
  const totalOutstanding = shown.reduce((a, r) => a + r.balance, 0);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-2xl uppercase tracking-tight">Outstanding advances</h2>
        <p className="text-sm text-ink-muted">Unrecovered advances by distributor and vendor.</p>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        options={[{ value: "vendor", label: "Vendor" }, { value: "distributor", label: "Distributor" }]}
      />

      <Card>
        <CardHeader>
          <CardTitle>Unrecovered</CardTitle>
          <span className="font-mono tabular-nums text-ink-muted">{fmtINR(totalOutstanding)}</span>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="px-4 py-10 text-center text-sm text-ink-muted">Loading…</div>
          ) : shown.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-ink-muted">No outstanding {tab} advances.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-paper text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-2 text-left">Payee</th>
                  <th className="px-4 py-2 text-right">Paid</th>
                  <th className="px-4 py-2 text-right">Applied</th>
                  <th className="px-4 py-2 text-right">Balance</th>
                  <th className="px-4 py-2 text-left">Age</th>
                  <th className="px-4 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-4 py-2 font-medium">{r.payee}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{fmtINR(r.paid)}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{fmtINR(r.applied)}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{fmtINR(r.balance)}</td>
                    <td className="px-4 py-2">{ageDays(r.createdAt)}</td>
                    <td className="px-4 py-2">
                      {tab === "distributor"
                        ? <Badge tone="blue">Auto-net at settlement</Badge>
                        : <Badge tone="amber">Net at final invoice</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {tab === "distributor" ? (
        <p className="text-xs text-ink-muted">
          Distributor share advances auto-net against the film's final share remittance when the
          Picture-Ending settlement is computed — no manual netting needed.
        </p>
      ) : (
        <p className="text-xs text-ink-muted">
          To net a vendor advance, open the final payment in the inbox and use “Net advances”.
        </p>
      )}
    </div>
  );
}
