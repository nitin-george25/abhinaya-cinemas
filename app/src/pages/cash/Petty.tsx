// ============================================================================
// /cash/petty — approval queue for daily_manager+.
//
// Shows pending expenses on top with Approve / Reject buttons; below it, the
// last 30 days of decided expenses for reference.
// ============================================================================

import { useEffect, useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field, Select } from "../../components/ui/Input";
import { useSync } from "../../lib/hooks/SyncContext";
import { useCashRefs } from "../../lib/hooks/useCashRefs";
import { fmtINR } from "../../lib/dashboard";
import {
  approvePettyExpense,
  listPettyExpenses,
  rejectPettyExpense,
  type PettyExpense,
} from "../../lib/cash";

export default function CashPettyPage() {
  const { state }             = useSync();
  const refs                  = useCashRefs();
  const [unitId, setUnitId]   = useState<string>("");
  const [pending, setPending] = useState<PettyExpense[]>([]);
  const [recent,  setRecent]  = useState<PettyExpense[]>([]);
  const [err, setErr]         = useState<string | null>(null);

  useEffect(() => {
    if (!unitId && refs.units.length > 0) setUnitId(refs.units[0]?.id ?? "");
  }, [refs.units, unitId]);

  async function reload() {
    if (!unitId) return;
    const [p, r] = await Promise.all([
      listPettyExpenses({ operatingUnitId: unitId, status: "pending" }),
      listPettyExpenses({ operatingUnitId: unitId }),
    ]);
    setPending(p);
    setRecent(r.filter((x) => x.status !== "pending").slice(0, 50));
  }

  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [unitId]);

  async function decide(id: string, action: "approve" | "reject") {
    if (!state.email) return;
    try {
      if (action === "approve") await approvePettyExpense(id, state.email);
      else {
        const reason = prompt("Reason for rejection");
        if (!reason) return;
        await rejectPettyExpense(id, state.email, reason);
      }
      await reload();
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Petty expenses</CardTitle></CardHeader>
        <CardBody className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Unit">
            <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              {refs.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
        </CardBody>
      </Card>

      {err ? <div className="text-sm text-red-600">{err}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle>Pending approval</CardTitle>
          <span className="text-xs text-ink-muted">{pending.length} pending</span>
        </CardHeader>
        <CardBody className="p-0 overflow-x-auto">
          <PettyTable rows={pending} actions onDecide={decide} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recently decided</CardTitle></CardHeader>
        <CardBody className="p-0 overflow-x-auto">
          <PettyTable rows={recent} />
        </CardBody>
      </Card>
    </div>
  );
}

function PettyTable({
  rows,
  actions,
  onDecide,
}: {
  rows: PettyExpense[];
  actions?: boolean;
  onDecide?: (id: string, action: "approve" | "reject") => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-paper text-xs uppercase tracking-wide text-ink-muted">
        <tr>
          <th className="px-3 py-2 text-left">Date</th>
          <th className="px-3 py-2 text-left">Description</th>
          <th className="px-3 py-2 text-left">Category</th>
          <th className="px-3 py-2 text-left">Requested by</th>
          <th className="px-3 py-2 text-right">Amount</th>
          <th className="px-3 py-2 text-left">Receipt</th>
          <th className="px-3 py-2 text-left">Status</th>
          {actions ? <th className="px-3 py-2 text-right"></th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={actions ? 8 : 7} className="px-3 py-6 text-center text-ink-muted">Nothing here.</td></tr>
        ) : rows.map((r) => (
          <tr key={r.id} className="border-t border-line">
            <td className="px-3 py-2">{r.expenseDate}</td>
            <td className="px-3 py-2">
              <div>{r.description}</div>
              {r.paidTo ? <div className="text-xs text-ink-muted">to {r.paidTo}</div> : null}
            </td>
            <td className="px-3 py-2">{r.category ?? "—"}</td>
            <td className="px-3 py-2">{r.requestedByEmail}</td>
            <td className="px-3 py-2 text-right tabular-nums">{fmtINR(r.amount)}</td>
            <td className="px-3 py-2">
              {r.receiptUrl
                ? <a className="text-amber-600 underline" href={r.receiptUrl} target="_blank" rel="noreferrer">view</a>
                : "—"}
            </td>
            <td className="px-3 py-2">
              <span className={
                "inline-block text-xs px-2 py-0.5 rounded " +
                (r.status === "approved" ? "bg-emerald-100 text-emerald-700" :
                 r.status === "rejected" ? "bg-red-100 text-red-700" :
                                           "bg-amber-100 text-amber-700")
              }>{r.status}</span>
            </td>
            {actions ? (
              <td className="px-3 py-2 text-right whitespace-nowrap">
                <Button size="sm" variant="secondary" onClick={() => onDecide?.(r.id, "reject")}>Reject</Button>
                <Button size="sm" className="ml-2" onClick={() => onDecide?.(r.id, "approve")}>Approve</Button>
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
