// ============================================================================
// /cash/closings — unified "Cash Closing" tab.
//
// Replaces the previous Today + Closings split. The page is the single home
// for everything closing-related:
//
//   • Banner at top — closings awaiting the current user's signature
//     (cashier sees "Confirm" prompts, manager sees their own drafts).
//   • CTA — "+ New cash closing" opens ClosingFormDialog in create mode.
//   • Table — every closing for the active unit, newest first, with inline
//     signoff status and an action button (Open / Confirm / View).
//
// Multi-closing: the natural key on daily_cash_closings is
// (operating_unit_id, business_date, shift). Different units / shifts / dates
// can coexist, so the dialog opens fresh by default and resolves the unique
// key on save. Operators can run several closings in a day without leaving
// this tab.
//
// Communication between manager and cashier is implicit but visible:
// when a manager saves and signs, the row moves into "awaiting cashier" and
// shows up in the cashier's banner the moment they navigate here. No email
// notification — this console runs on a small team and the operator is
// always at the same site.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field, Select } from "../../components/ui/Input";
import { ClosingFormDialog } from "../../components/cash/ClosingFormDialog";
import { useCashRefs } from "../../lib/hooks/useCashRefs";
import { useSync } from "../../lib/hooks/SyncContext";
import { fmtINR } from "../../lib/dashboard";
import { weekday } from "../../lib/format";
import { listClosings, type DailyCashClosing } from "../../lib/cash";

export default function CashClosingsPage() {
  const { state }             = useSync();
  const refs                  = useCashRefs();
  const role                  = state.role;
  const isCashier             = role === "cashier";
  const isManager             = role === "owner" || role === "manager" || role === "daily_manager";

  const [unitId, setUnitId]   = useState<string>("");
  const [rows, setRows]       = useState<DailyCashClosing[]>([]);
  const [loading, setLoading] = useState(false);
  // Dialog state: when open, either a fresh draft (existingId = null) or
  // hydrated from an existing closing's id.
  const [dialogOpen, setDialogOpen]       = useState(false);
  const [editingId, setEditingId]         = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!unitId && refs.units.length > 0) setUnitId(refs.units[0]?.id ?? "");
  }, [refs.units, unitId]);

  async function reload() {
    if (isCashier) {
      // Cashiers don't pick a unit — they see every closing across the
      // cinema and we filter to the ones tied to their email.
      setLoading(true);
      const list = await listClosings({});
      setRows(list);
      setLoading(false);
      return;
    }
    if (!unitId) return;
    setLoading(true);
    const list = await listClosings({ operatingUnitId: unitId });
    setRows(list);
    setLoading(false);
  }

  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },
    [unitId, isCashier]);

  // What requires *this user's* attention right now.
  const pendingForMe = useMemo(() => {
    if (isCashier) {
      const myEmail = (state.email ?? "").toLowerCase();
      return rows.filter((r) =>
        r.status === "counted"
        && (!r.cashierEmail || r.cashierEmail.toLowerCase() === myEmail)
      );
    }
    if (isManager) {
      // Manager attention: their own drafts that haven't been signed yet.
      return rows.filter((r) => r.status === "draft");
    }
    return [];
  }, [rows, isCashier, isManager, state.email]);

  function openNew() {
    setEditingId(undefined);
    setDialogOpen(true);
  }
  function openExisting(id: string) {
    setEditingId(id);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6">
      {/* ── Header: unit picker + primary CTA ───────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Cash closing</CardTitle>
          {isManager ? (
            <Button onClick={openNew}>+ New cash closing</Button>
          ) : null}
        </CardHeader>
        {isManager ? (
          <CardBody className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Unit">
              <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                {refs.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
          </CardBody>
        ) : null}
      </Card>

      {/* ── Awaiting-signature banner ──────────────────────────────── */}
      {pendingForMe.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {isCashier
                ? `${pendingForMe.length} closing${pendingForMe.length === 1 ? "" : "s"} awaiting your confirmation`
                : `${pendingForMe.length} draft${pendingForMe.length === 1 ? "" : "s"} not yet signed`}
            </CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            <ul className="divide-y divide-line">
              {pendingForMe.map((r) => (
                <li key={r.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {r.businessDate} · {r.shift}
                    </div>
                    <div className="text-xs text-ink-muted truncate">
                      Cash counted {fmtINR(r.cashCounted)} · POS {fmtINR(r.posTotalSales)} ·
                      {" "}signed by {r.managerSignedByEmail ?? r.closedByEmail}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => openExisting(r.id)}>
                    {isCashier ? "Confirm" : "Open"}
                  </Button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {/* ── Closings table ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>
            {isCashier ? "My closings" : "All closings"}
          </CardTitle>
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
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {r.status === "draft" || r.status === "counted" ? (
                      <Button size="sm" variant="secondary" onClick={() => openExisting(r.id)}>
                        Open
                      </Button>
                    ) : (
                      <Link className="text-amber-600 text-sm underline" to={`/cash/closings/${r.id}`}>
                        View
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <ClosingFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        existingId={editingId}
        defaultUnitId={unitId || undefined}
        onSaved={reload}
      />
    </div>
  );
}

/**
 * Status badge using the dual-signoff vocabulary surfaced everywhere else
 * in the page. The DB still stores `counted` because that's the schema's
 * label — we re-label it in the UI for clarity.
 */
function StatusPill({ status }: { status: DailyCashClosing["status"] }) {
  const [label, cls] = (() => {
    switch (status) {
      case "draft":    return ["draft",            "bg-amber-100 text-amber-700"];
      case "counted":  return ["awaiting cashier", "bg-blue-100 text-blue-700"];
      case "signed":   return ["signed",           "bg-emerald-100 text-emerald-700"];
      case "disputed": return ["disputed",         "bg-red-100 text-red-700"];
      case "resolved": return ["resolved",         "bg-paper text-ink-muted"];
    }
  })();
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded ${cls}`}>{label}</span>
  );
}
