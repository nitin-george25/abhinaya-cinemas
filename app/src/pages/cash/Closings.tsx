// ============================================================================
// /cash/closings — unified "Cash Closing" tab.
//
// Replaces the previous Today + Closings split. Single home for everything
// closing-related:
//
//   • Awaiting-signature banner — closings that need *this* user's signature
//     (cashier sees confirm prompts, manager sees their own drafts).
//   • CTA — "+ New cash closing" opens ClosingFormDialog in create mode.
//   • Table (desktop) / card list (mobile) — every closing for the active
//     unit, newest first, with sales, cash counted, other-mode totals,
//     discrepancy, and inline signoff names.
//
// Multi-closing: the natural key on daily_cash_closings is
// (operating_unit_id, business_date, shift). Different units / shifts / dates
// can coexist, so the dialog opens fresh by default and resolves the unique
// key on save. The dialog now shows a conflict banner instead of silently
// pre-loading an existing row.
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
import {
  listAuthorizedUsers,
  listClosings,
  type AuthorizedUserSummary,
  type DailyCashClosing,
} from "../../lib/cash";

export default function CashClosingsPage() {
  const { state }             = useSync();
  const refs                  = useCashRefs();
  const role                  = state.role;
  const isCashier             = role === "cashier";
  const isManager             = role === "owner" || role === "manager" || role === "daily_manager";
  // Per migration 12, RLS narrows the result set for cashier (own
  // assignments) and daily_manager (own creations). Both should see a
  // "My closings" header instead of "All closings".
  const isOwnScope            = isCashier || role === "daily_manager";

  const [unitId, setUnitId]   = useState<string>("");
  const [rows, setRows]       = useState<DailyCashClosing[]>([]);
  const [loading, setLoading] = useState(false);
  // Dialog state: when open, either a fresh draft (existingId = null) or
  // hydrated from an existing closing's id.
  const [dialogOpen, setDialogOpen]       = useState(false);
  const [editingId, setEditingId]         = useState<string | undefined>(undefined);

  // Email → name lookup so we can render "Manager: Nitin" in the signoff
  // column instead of full email addresses. Loaded once per mount.
  const [users, setUsers] = useState<AuthorizedUserSummary[]>([]);
  useEffect(() => {
    let alive = true;
    void listAuthorizedUsers().then((u) => alive && setUsers(u));
    return () => { alive = false; };
  }, []);
  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of users) {
      if (u.email) map.set(u.email.toLowerCase(), u.fullName ?? u.email);
    }
    return (email?: string | null) => {
      if (!email) return null;
      return map.get(email.toLowerCase()) ?? email;
    };
  }, [users]);

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
  //
  // Cashier-style attention is keyed off the email recorded on the
  // closing, not the user's role — anyone listed as the cashier on till
  // (often the owner in a single-screen op) gets the confirm prompt.
  const pendingForMe = useMemo(() => {
    const myEmail = (state.email ?? "").toLowerCase();
    const awaitingMyConfirm = rows.filter((r) =>
      r.status === "counted"
      && r.cashierEmail
      && r.cashierEmail.toLowerCase() === myEmail
    );
    if (isCashier) return awaitingMyConfirm;
    if (isManager) {
      // Manager attention: their own drafts + any closing waiting on
      // their confirmation. Drafts come first because they're the
      // active workflow step.
      const drafts = rows.filter((r) => r.status === "draft");
      return [...drafts, ...awaitingMyConfirm];
    }
    return awaitingMyConfirm;
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
    <div className="space-y-4 md:space-y-6">
      {/* ── Header: unit picker + primary CTA ───────────────────────── */}
      <Card>
        <CardHeader className="flex-wrap gap-2">
          <CardTitle>Cash closing</CardTitle>
          {isManager ? (
            <Button onClick={openNew} className="whitespace-nowrap">+ New cash closing</Button>
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
                <li
                  key={r.id}
                  className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {r.businessDate} · {r.shift}
                    </div>
                    <div className="text-xs text-ink-muted">
                      Cash counted {fmtINR(r.cashCounted)} · POS {fmtINR(r.posTotalSales)}
                      {r.managerSignedByEmail
                        ? ` · signed by ${nameOf(r.managerSignedByEmail)}`
                        : ""}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => openExisting(r.id)}
                    className="self-end sm:self-auto"
                  >
                    {isCashier ? "Confirm" : "Open"}
                  </Button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {/* ── Closings list ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>
            {isOwnScope ? "My closings" : "All closings"}
          </CardTitle>
        </CardHeader>

        {/* Desktop: full table */}
        <CardBody className="p-0 hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Shift</th>
                <th className="px-3 py-2 text-right">Sales</th>
                <th className="px-3 py-2 text-right">Cash</th>
                <th className="px-3 py-2 text-right">Other modes</th>
                <th className="px-3 py-2 text-right">Discrepancy</th>
                <th className="px-3 py-2 text-left">Signoffs</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-ink-muted">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-ink-muted">No closings yet.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-2">
                    <div>{r.businessDate}</div>
                    <div className="text-xs text-ink-muted">{weekday(r.businessDate)}</div>
                  </td>
                  <td className="px-3 py-2">{r.shift}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(r.posTotalSales)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(r.cashCounted)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(r.posNonCashTotal)}</td>
                  <td className={
                    "px-3 py-2 text-right tabular-nums " +
                    (r.discrepancy === 0 ? "" :
                     r.discrepancy > 0 ? "text-emerald-600" : "text-red-600")
                  }>{fmtINR(r.discrepancy)}</td>
                  <td className="px-3 py-2">
                    <SignoffSummary closing={r} nameOf={nameOf} />
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

        {/* Mobile: card list */}
        <CardBody className="p-0 md:hidden">
          {loading ? (
            <div className="px-4 py-6 text-center text-ink-muted text-sm">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-6 text-center text-ink-muted text-sm">No closings yet.</div>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id} className="px-4 py-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">
                        {r.businessDate} · {r.shift}
                      </div>
                      <div className="text-xs text-ink-muted">{weekday(r.businessDate)}</div>
                    </div>
                    {r.status === "draft" || r.status === "counted" ? (
                      <Button size="sm" variant="secondary" onClick={() => openExisting(r.id)}>
                        Open
                      </Button>
                    ) : (
                      <Link className="text-amber-600 text-sm underline" to={`/cash/closings/${r.id}`}>
                        View
                      </Link>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <span className="text-ink-muted">Sales</span>
                    <span className="text-right tabular-nums">{fmtINR(r.posTotalSales)}</span>
                    <span className="text-ink-muted">Cash</span>
                    <span className="text-right tabular-nums">{fmtINR(r.cashCounted)}</span>
                    <span className="text-ink-muted">Other modes</span>
                    <span className="text-right tabular-nums">{fmtINR(r.posNonCashTotal)}</span>
                    <span className="text-ink-muted">Discrepancy</span>
                    <span className={
                      "text-right tabular-nums " +
                      (r.discrepancy === 0 ? "" :
                       r.discrepancy > 0 ? "text-emerald-600" : "text-red-600")
                    }>{fmtINR(r.discrepancy)}</span>
                  </div>
                  <div className="text-xs text-ink-muted">
                    <SignoffSummary closing={r} nameOf={nameOf} />
                  </div>
                </li>
              ))}
            </ul>
          )}
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
 * Two-line signoff status. Replaces the old single status pill with
 * the actual names from the manager + cashier sign columns. Pending
 * sigs say "pending" in italic muted text.
 */
function SignoffSummary({
  closing,
  nameOf,
}: {
  closing: DailyCashClosing;
  nameOf: (email?: string | null) => string | null;
}) {
  const manager = closing.managerSignedByEmail ?? (closing.signedAt ? closing.closedByEmail : null);
  const cashier = closing.cashierSignedByEmail;
  return (
    <div className="text-xs leading-snug space-y-0.5">
      <div>
        <span className="text-ink-muted">Manager:</span>{" "}
        {manager
          ? <span className="text-ink">{nameOf(manager)}</span>
          : <span className="text-amber-600 italic">pending</span>}
      </div>
      <div>
        <span className="text-ink-muted">Cashier:</span>{" "}
        {cashier
          ? <span className="text-ink">{nameOf(cashier)}</span>
          : <span className={closing.status === "counted" ? "text-amber-600 italic" : "text-ink-muted italic"}>
              {closing.status === "counted" ? "awaiting" : "—"}
            </span>}
      </div>
    </div>
  );
}
