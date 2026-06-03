// ============================================================================
// ClosingFormDialog — modal that wraps the cash-closing form.
//
// Used from the unified `/cash/closings` page. Shift manager picks a unit /
// date / shift, types the POS payment-method breakdown, counts cash, and
// chooses one of three terminal actions:
//
//   • Save draft           — keep going later
//   • Save & sign          — manager signature, status → counted, surfaces
//                            the closing in the cashier's queue
//   • (Cashier sign)       — only the cashier can press their button, and
//                            only from the same dialog/page; they're sent
//                            here from the in-app banner described in the
//                            Closings.tsx header.
//
// Form math mirrors the legacy Today.tsx page exactly — the only behavior
// change is the dual-signoff order (manager first, cashier confirms).
// ============================================================================

import { useEffect, useMemo, useState } from "react";

import { Button } from "../ui/Button";
import { Field, Input, Select } from "../ui/Input";
import { useSync } from "../../lib/hooks/SyncContext";
import { useCashRefs } from "../../lib/hooks/useCashRefs";
import { fmtINR } from "../../lib/dashboard";
import { todayIso } from "../../lib/dates";
import {
  INR_DENOMINATIONS,
  cashTotalFromMethods,
  cashierSignClosing,
  computeDiscrepancy,
  getClosing,
  listCashierUsers,
  listClosings,
  listPettyExpenses,
  signClosing,
  totalFromDenominations,
  totalFromPaymentMethods,
  upsertClosing,
  type AuthorizedUserSummary,
  type CashClosingPaymentMethod,
  type CashDenomination,
  type ClosingShift,
  type DailyCashClosing,
} from "../../lib/cash";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Existing closing to open in the dialog. When undefined the dialog
   *  starts a brand-new draft. */
  existingId?: string;
  /** Defaults for a fresh closing (preselect unit/date/shift). */
  defaultUnitId?: string;
  defaultDate?: string;
  defaultShift?: ClosingShift;
  /** Notify parent so it can refresh the closings list. */
  onSaved?: () => void;
}

export function ClosingFormDialog({
  open,
  onClose,
  existingId,
  defaultUnitId,
  defaultDate,
  defaultShift = "all_day",
  onSaved,
}: Props) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-2"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop click closes; inner card stops propagation. */}
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="relative bg-paper-card rounded-2xl shadow-xl w-full max-w-3xl
                   max-h-[92vh] overflow-y-auto p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogBody
          existingId={existingId}
          defaultUnitId={defaultUnitId}
          defaultDate={defaultDate}
          defaultShift={defaultShift}
          onClose={onClose}
          onSaved={onSaved}
        />
      </div>
    </div>
  );
}

function DialogBody({
  existingId,
  defaultUnitId,
  defaultDate,
  defaultShift,
  onClose,
  onSaved,
}: {
  existingId?: string;
  defaultUnitId?: string;
  defaultDate?: string;
  defaultShift: ClosingShift;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { state } = useSync();
  const refs      = useCashRefs();
  const role      = state.role;
  const isCashier = role === "cashier";
  const isManager =
    role === "owner" || role === "manager" || role === "daily_manager";

  const [unitId, setUnitId]         = useState<string>(defaultUnitId ?? "");
  const [businessDate, setDate]     = useState<string>(defaultDate ?? todayIso());
  const [shift, setShift]           = useState<ClosingShift>(defaultShift);
  const [existing, setExisting]     = useState<DailyCashClosing | null>(null);
  const [cashiers, setCashiers]     = useState<AuthorizedUserSummary[]>([]);
  const [cashierEmail, setCashier]  = useState<string>("");

  const [methods, setMethods] = useState<CashClosingPaymentMethod[]>([]);
  const [denoms, setDenoms]   = useState<CashDenomination[]>(
    INR_DENOMINATIONS.map((d) => ({ denomination: d, count: 0 })),
  );
  const [pettyTotal, setPettyTotal] = useState(0);
  const [notes, setNotes]           = useState("");
  const [saving, setSaving]         = useState(false);
  const [err, setErr]               = useState<string | null>(null);

  // Default unit once refs load.
  useEffect(() => {
    if (!unitId && refs.units.length > 0) {
      setUnitId(refs.units[0]?.id ?? "");
    }
  }, [refs.units, unitId]);

  // Cashier dropdown.
  useEffect(() => {
    let alive = true;
    void listCashierUsers().then((u) => alive && setCashiers(u));
    return () => { alive = false; };
  }, []);

  // Reset method rows whenever payment_methods change.
  useEffect(() => {
    setMethods(refs.paymentMethods.map((m) => ({ paymentMethodId: m.id, amount: 0 })));
  }, [refs.paymentMethods]);

  // Hydrate from existingId when the parent passed one.
  useEffect(() => {
    if (!existingId) return;
    let alive = true;
    void getClosing(existingId).then((found) => {
      if (!alive || !found) return;
      setUnitId(found.operatingUnitId);
      setDate(found.businessDate);
      setShift(found.shift);
      setExisting(found);
      setCashier(found.cashierEmail ?? "");
      setNotes(found.notes ?? "");
      setMethods(
        refs.paymentMethods.map((m) => ({
          paymentMethodId: m.id,
          amount: found.paymentMethods.find((x) => x.paymentMethodId === m.id)?.amount ?? 0,
        })),
      );
      if (found.denominations.length > 0) {
        setDenoms(
          INR_DENOMINATIONS.map((d) => ({
            denomination: d,
            count: found.denominations.find((x) => x.denomination === d)?.count ?? 0,
          })),
        );
      }
    });
    return () => { alive = false; };
  }, [existingId, refs.paymentMethods]);

  // For new-closing flow, surface a non-blocking conflict notice when the
  // current (unit, date, shift) tuple already has a closing — but do NOT
  // auto-hydrate the form from it. The previous version pre-loaded the
  // existing row, which made "+ New cash closing" look like it was always
  // re-opening today's draft. The user picks a different shift/date or
  // explicitly clicks "Open existing" from the banner.
  const [conflict, setConflict] = useState<DailyCashClosing | null>(null);
  useEffect(() => {
    if (existingId) return;
    if (!unitId) return;
    let alive = true;
    void listClosings({
      operatingUnitId: unitId,
      from: businessDate,
      to: businessDate,
    }).then((rows) => {
      if (!alive) return;
      const found = rows.find((r) => r.shift === shift) ?? null;
      setConflict(found);
    });
    return () => { alive = false; };
  }, [existingId, unitId, businessDate, shift]);

  /** Switch the dialog into edit mode for the conflicting closing. */
  function openConflict() {
    if (!conflict) return;
    setExisting(conflict);
    setCashier(conflict.cashierEmail ?? "");
    setNotes(conflict.notes ?? "");
    setMethods(
      refs.paymentMethods.map((m) => ({
        paymentMethodId: m.id,
        amount: conflict.paymentMethods.find((x) => x.paymentMethodId === m.id)?.amount ?? 0,
      })),
    );
    if (conflict.denominations.length > 0) {
      setDenoms(
        INR_DENOMINATIONS.map((d) => ({
          denomination: d,
          count: conflict.denominations.find((x) => x.denomination === d)?.count ?? 0,
        })),
      );
    }
    setConflict(null);
  }

  // Pull approved petty totals (used to validate the cash count).
  useEffect(() => {
    if (!unitId) return;
    let alive = true;
    void listPettyExpenses({
      operatingUnitId: unitId,
      from: businessDate,
      to:   businessDate,
      status: "approved",
    }).then((rows) => {
      if (!alive) return;
      setPettyTotal(rows.reduce((s, r) => s + r.amount, 0));
    });
    return () => { alive = false; };
  }, [unitId, businessDate]);

  // ── derived ──────────────────────────────────────────────────────────
  const cashCounted   = useMemo(() => totalFromDenominations(denoms), [denoms]);
  const posTotal      = useMemo(() => totalFromPaymentMethods(methods), [methods]);
  const cashInMethods = useMemo(
    () => cashTotalFromMethods(methods, refs.paymentMethods),
    [methods, refs.paymentMethods],
  );
  const posNonCash    = useMemo(() => posTotal - cashInMethods, [posTotal, cashInMethods]);
  const posCashExp    = posTotal - posNonCash;
  const discrepancy   = computeDiscrepancy(posTotal, posNonCash, cashCounted, pettyTotal);

  function updateMethod(id: string, amount: number) {
    setMethods((curr) => curr.map((m) => (m.paymentMethodId === id ? { ...m, amount } : m)));
  }
  function updateDenom(denom: number, count: number) {
    setDenoms((curr) => curr.map((d) => (d.denomination === denom ? { ...d, count } : d)));
  }

  async function handleSave(signAfter = false) {
    if (!unitId || !state.email) return;
    // If a conflicting closing exists and the user hasn't opened it, block
    // the save and ask them what to do. Without this guard upsertClosing
    // would silently overwrite the existing row.
    if (!existing && conflict) {
      setErr(
        "A closing already exists for this date and shift. Open it from " +
          "the banner above or pick a different date/shift.",
      );
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const id = await upsertClosing({
        operatingUnitId: unitId,
        businessDate,
        shift,
        cashierEmail: cashierEmail || null,
        closedByEmail: state.email,
        posTotalSales: posTotal,
        posNonCashTotal: posNonCash,
        cashCounted,
        cashDeposited: existing?.cashDeposited ?? 0,
        notes,
        denominations: denoms.filter((d) => d.count > 0),
        paymentMethods: methods.filter((m) => m.amount > 0),
      });
      // Manager sign-after — moves draft → counted (not signed). The
      // cashier still needs to confirm before the ledger row writes.
      if (signAfter && isManager) await signClosing(id, state.email);
      const fresh = await getClosing(id);
      setExisting(fresh);
      onSaved?.();
      if (signAfter) onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCashierConfirm() {
    if (!state.email || !existing) return;
    setSaving(true); setErr(null);
    try {
      await cashierSignClosing(existing.id, state.email);
      const fresh = await getClosing(existing.id);
      setExisting(fresh);
      onSaved?.();
      onClose();
    } catch (e) { setErr((e as Error).message); }
    finally    { setSaving(false); }
  }

  // Friendly status label that matches the dual-signoff vocabulary used
  // throughout the rest of the cash module.
  const statusLabel: string = (() => {
    if (!existing) return "new";
    switch (existing.status) {
      case "draft":    return "draft";
      case "counted":  return "awaiting cashier";
      case "signed":   return "signed";
      case "disputed": return "disputed";
      case "resolved": return "resolved";
    }
  })();

  const lockedForManager = !!existing && existing.status !== "draft";
  const canCashierConfirm =
    isCashier
    && !!existing
    && existing.status === "counted"
    && (!existing.cashierEmail
        || existing.cashierEmail.toLowerCase() === (state.email ?? "").toLowerCase());

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Cash closing</h2>
          <p className="text-xs text-ink-muted mt-0.5">
            {existing ? `Status: ${statusLabel}` : "New closing"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="text-ink-muted hover:text-ink text-xl leading-none px-2"
        >
          ✕
        </button>
      </div>

      {/* Conflict notice — there's already a closing for the picked
          (unit, date, shift). Doesn't block the form; the user can pick a
          different shift/date or open the existing one. */}
      {!existing && conflict ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex flex-wrap items-center justify-between gap-2">
          <span>
            A closing already exists for {conflict.businessDate} · {conflict.shift}
            {" "}(<span className="font-medium">{conflict.status === "counted" ? "awaiting cashier" : conflict.status}</span>).
          </span>
          <Button size="sm" variant="secondary" onClick={openConflict}>
            Open existing
          </Button>
        </div>
      ) : null}

      {/* Header — unit / date / shift / cashier selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Field label="Unit">
          <Select value={unitId} disabled={lockedForManager} onChange={(e) => setUnitId(e.target.value)}>
            {refs.units.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Business date">
          <Input
            type="date"
            disabled={lockedForManager}
            value={businessDate}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Shift">
          <Select
            value={shift}
            disabled={lockedForManager}
            onChange={(e) => setShift(e.target.value as ClosingShift)}
          >
            <option value="all_day">All day</option>
            <option value="morning">Morning</option>
            <option value="evening">Evening</option>
          </Select>
        </Field>
        <Field label="Cashier on till">
          <Select
            value={cashierEmail}
            disabled={lockedForManager}
            onChange={(e) => setCashier(e.target.value)}
          >
            <option value="">—</option>
            {cashiers.map((c) => (
              <option key={c.email} value={c.email}>
                {c.fullName ?? c.email}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {/* Payment methods grid */}
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-muted mb-2">
          Payment methods (from POS report)
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {refs.paymentMethods.map((m) => {
            const row = methods.find((x) => x.paymentMethodId === m.id);
            return (
              <Field key={m.id} label={`${m.displayName}${m.flowType === "cash" ? " (cash)" : ""}`}>
                <Input
                  type="number"
                  inputMode="decimal"
                  disabled={lockedForManager}
                  value={row?.amount ?? 0}
                  onChange={(e) => updateMethod(m.id, Number(e.target.value) || 0)}
                />
              </Field>
            );
          })}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
          <Tile label="POS total"     value={fmtINR(posTotal)} />
          <Tile label="Non-cash"      value={fmtINR(posNonCash)} />
          <Tile label="Cash expected" value={fmtINR(posCashExp)} />
        </div>
      </div>

      {/* Denomination grid */}
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-muted mb-2">
          Cash counted
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {denoms.map((d) => (
            <Field key={d.denomination} label={`₹ ${d.denomination}`}>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                disabled={lockedForManager}
                value={d.count}
                onChange={(e) => updateDenom(d.denomination, Number(e.target.value) || 0)}
              />
            </Field>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
          <Tile label="Cash counted"   value={fmtINR(cashCounted)} />
          <Tile label="Petty expenses" value={fmtINR(pettyTotal)} />
          <Tile
            label="Discrepancy"
            value={fmtINR(discrepancy)}
            accent={discrepancy === 0 ? "good" : "bad"}
          />
        </div>
      </div>

      {/* Notes */}
      <Field label="Notes">
        <Input value={notes} disabled={lockedForManager} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      {/* Signoff trail */}
      {existing ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-ink-muted">
          <div>
            <span className="font-medium text-ink">Manager:</span>{" "}
            {existing.signedAt
              ? `${existing.managerSignedByEmail ?? existing.closedByEmail} · ${existing.signedAt.slice(0, 16).replace("T", " ")}`
              : "not signed"}
          </div>
          <div>
            <span className="font-medium text-ink">Cashier:</span>{" "}
            {existing.cashierSignedAt
              ? `${existing.cashierSignedByEmail} · ${existing.cashierSignedAt.slice(0, 16).replace("T", " ")}`
              : "awaiting"}
          </div>
        </div>
      ) : null}

      {err ? <div className="text-sm text-red-600">{err}</div> : null}

      {/* Action bar */}
      <div className="flex gap-2 justify-end flex-wrap pt-2 border-t border-line">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        {isManager && (!existing || existing.status === "draft") ? (
          <>
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => void handleSave(false)}
            >
              Save draft
            </Button>
            <Button
              disabled={saving}
              onClick={() => void handleSave(true)}
            >
              {saving ? "Saving…" : "Save & sign"}
            </Button>
          </>
        ) : null}
        {canCashierConfirm ? (
          <Button
            disabled={saving}
            onClick={() => void handleCashierConfirm()}
          >
            {saving ? "Confirming…" : "Confirm as cashier"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Tile({
  label, value, accent,
}: { label: string; value: string; accent?: "good" | "bad" }) {
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
