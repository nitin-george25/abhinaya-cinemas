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
  computeActualTotal,
  computeDiscrepancy,
  getClosing,
  listAuthorizedUsers,
  listCashDeposits,
  listClosings,
  listPaymentMethodsForUnit,
  listPettyExpenses,
  nonCashActualFromMethods,
  signClosing,
  totalFromDenominations,
  totalFromPaymentMethods,
  uploadCashSlip,
  upsertClosing,
  type AuthorizedUserSummary,
  type CashClosingPaymentMethod,
  type CashDenomination,
  type CashDeposit,
  type ClosingShift,
  type DailyCashClosing,
  type PaymentMethod,
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
  const isManager =
    role === "owner" || role === "manager" || role === "daily_manager";

  const [unitId, setUnitId]         = useState<string>(defaultUnitId ?? "");
  /** POS counter being closed — required (migration 18). Defaults to the
   *  selected unit's first counter. */
  const [counterId, setCounterId]   = useState<string>("");
  const [businessDate, setDate]     = useState<string>(defaultDate ?? todayIso());
  const [shift, setShift]           = useState<ClosingShift>(defaultShift);
  const [existing, setExisting]     = useState<DailyCashClosing | null>(null);
  const [cashiers, setCashiers]     = useState<AuthorizedUserSummary[]>([]);
  const [cashierEmail, setCashier]  = useState<string>("");

  const [methods, setMethods] = useState<CashClosingPaymentMethod[]>([]);
  /** Per-mode actual-settlement overrides, keyed by paymentMethodId.
   *  No key = the actual follows the POS figure (autofill). A key is set
   *  the moment the user edits an actual input, breaking the follow. */
  const [actuals, setActuals] = useState<Record<string, number>>({});
  /** Payment methods that apply to the selected operating unit. Falls
   *  back to all cinema methods when the unit has no mapping yet. */
  const [unitMethods, setUnitMethods] = useState<PaymentMethod[]>([]);
  const [denoms, setDenoms]   = useState<CashDenomination[]>(
    INR_DENOMINATIONS.map((d) => ({ denomination: d, count: 0 })),
  );
  const [pettyTotal, setPettyTotal] = useState(0);
  const [notes, setNotes]           = useState("");
  const [saving, setSaving]         = useState(false);
  const [err, setErr]               = useState<string | null>(null);

  // ── Phase 10 fields ──────────────────────────────────────────────────
  /** Optional EDC slip captured at closing time (separate from any later
   *  POS settlement record). Stored at the closing row level. */
  const [edcFile, setEdcFile]       = useState<File | null>(null);
  const [edcSlipUrl, setEdcSlipUrl] = useState<string | null>(null);

  /** Deposit covering this closing, if any — read-only since cash_20.
   *  Deposits are recorded next-day from the Closings page and can span
   *  multiple closings (both shifts in one bank deposit). */
  const [deposit, setDeposit]               = useState<CashDeposit | null>(null);

  // Default unit once refs load.
  useEffect(() => {
    if (!unitId && refs.units.length > 0) {
      setUnitId(refs.units[0]?.id ?? "");
    }
  }, [refs.units, unitId]);

  // Counters that belong to the selected unit.
  const unitCounters = useMemo(
    () => refs.counters.filter((c) => c.operatingUnitId === unitId),
    [refs.counters, unitId],
  );

  // Keep the counter selection consistent with the unit: when the unit
  // changes (or counters load), snap to the unit's first counter unless
  // the current selection already belongs to it. An existing closing may
  // reference an archived counter (absent from refs) — never snap away
  // from it, or re-saving would silently move the closing to another till.
  useEffect(() => {
    if (!unitId) return;
    if (counterId && unitCounters.some((c) => c.id === counterId)) return;
    if (counterId && counterId === existing?.posCounterId) return;
    setCounterId(unitCounters[0]?.id ?? "");
  }, [unitId, unitCounters, counterId, existing]);

  // "Cashier on till" dropdown. We list every authorized user, not just
  // role='cashier' — at this scale the owner / manager often physically
  // runs the till, so the field is "who is sitting at the till today",
  // not "who has the cashier role".
  useEffect(() => {
    let alive = true;
    void listAuthorizedUsers().then((u) => alive && setCashiers(u));
    return () => { alive = false; };
  }, []);

  // Load the payment methods scoped to the selected unit. Falls back to
  // the cinema-level list if the unit has no mapping rows. Refetches
  // whenever the unit selector changes — the closing dialog's payment-
  // method grid then re-renders against the right subset.
  useEffect(() => {
    if (!refs.cinemaId || !unitId) {
      setUnitMethods([]);
      return;
    }
    let alive = true;
    void listPaymentMethodsForUnit(refs.cinemaId, unitId).then((ms) => {
      if (!alive) return;
      setUnitMethods(ms);
    });
    return () => { alive = false; };
  }, [refs.cinemaId, unitId]);

  // Reset method rows whenever the unit-scoped method list changes.
  useEffect(() => {
    setMethods(unitMethods.map((m) => ({ paymentMethodId: m.id, amount: 0 })));
    setActuals({});
  }, [unitMethods]);

  // Hydrate from existingId when the parent passed one.
  useEffect(() => {
    if (!existingId) return;
    let alive = true;
    void getClosing(existingId).then((found) => {
      if (!alive || !found) return;
      setUnitId(found.operatingUnitId);
      setCounterId(found.posCounterId);
      setDate(found.businessDate);
      setShift(found.shift);
      setExisting(found);
      setCashier(found.cashierEmail ?? "");
      setNotes(found.notes ?? "");
      setEdcSlipUrl(found.edcSlipUrl ?? null);
      // Use the unit-scoped methods list when populated; falls back to
      // the cinema-level list for the brief window before the unit
      // mapping resolves on a fresh hydrate.
      const methodList = unitMethods.length > 0 ? unitMethods : refs.paymentMethods;
      setMethods(
        methodList.map((m) => ({
          paymentMethodId: m.id,
          amount: found.paymentMethods.find((x) => x.paymentMethodId === m.id)?.amount ?? 0,
        })),
      );
      setActuals(actualOverridesFrom(found.paymentMethods));
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
  }, [existingId, unitMethods, refs.paymentMethods]);

  // Hydrate any existing deposit record tied to this closing.
  useEffect(() => {
    if (!existing) {
      setDeposit(null);
      return;
    }
    let alive = true;
    void listCashDeposits({ closingId: existing.id }).then((rows) => {
      if (!alive) return;
      setDeposit(rows[0] ?? null);
    });
    return () => { alive = false; };
  }, [existing]);

  // For new-closing flow, surface a non-blocking conflict notice when the
  // current (counter, date, shift) tuple already has a closing — but do NOT
  // auto-hydrate the form from it. The previous version pre-loaded the
  // existing row, which made "+ New cash closing" look like it was always
  // re-opening today's draft. The user picks a different counter/shift/date
  // or explicitly clicks "Open existing" from the banner.
  const [conflict, setConflict] = useState<DailyCashClosing | null>(null);
  useEffect(() => {
    if (existingId) return;
    if (!counterId) return;
    let alive = true;
    void listClosings({
      posCounterId: counterId,
      from: businessDate,
      to: businessDate,
    }).then((rows) => {
      if (!alive) return;
      const found = rows.find((r) => r.shift === shift) ?? null;
      setConflict(found);
    });
    return () => { alive = false; };
  }, [existingId, counterId, businessDate, shift]);

  /** Switch the dialog into edit mode for the conflicting closing. */
  function openConflict() {
    if (!conflict) return;
    setExisting(conflict);
    setCounterId(conflict.posCounterId);
    setCashier(conflict.cashierEmail ?? "");
    setNotes(conflict.notes ?? "");
    const methodList = unitMethods.length > 0 ? unitMethods : refs.paymentMethods;
    setMethods(
      methodList.map((m) => ({
        paymentMethodId: m.id,
        amount: conflict.paymentMethods.find((x) => x.paymentMethodId === m.id)?.amount ?? 0,
      })),
    );
    setActuals(actualOverridesFrom(conflict.paymentMethods));
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
  // Counter-scoped from migration 18 — each till only answers for the
  // expenses paid out of its own drawer.
  useEffect(() => {
    if (!counterId) return;
    let alive = true;
    void listPettyExpenses({
      posCounterId: counterId,
      from: businessDate,
      to:   businessDate,
      status: "approved",
    }).then((rows) => {
      if (!alive) return;
      setPettyTotal(rows.reduce((s, r) => s + r.amount, 0));
    });
    return () => { alive = false; };
  }, [counterId, businessDate]);

  // ── derived ──────────────────────────────────────────────────────────
  const activeMethods  = unitMethods.length > 0 ? unitMethods : refs.paymentMethods;
  /** Cash needs no actual input — its actual is the denomination count. */
  const nonCashMethods = activeMethods.filter((m) => m.flowType !== "cash");

  const cashCounted   = useMemo(() => totalFromDenominations(denoms), [denoms]);
  const posTotal      = useMemo(() => totalFromPaymentMethods(methods), [methods]);
  const cashInMethods = useMemo(
    () => cashTotalFromMethods(methods, activeMethods),
    [methods, activeMethods],
  );
  const posNonCash    = useMemo(() => posTotal - cashInMethods, [posTotal, cashInMethods]);
  const posCashExp    = posTotal - posNonCash;
  // Non-cash actual settlements: the per-mode actual (override or autofill
  // from POS) summed across non-cash modes. Mirrors what handleSave persists.
  const nonCashActual = useMemo(
    () => nonCashActualFromMethods(
      methods.map((m) => ({ ...m, actualAmount: actuals[m.paymentMethodId] ?? m.amount })),
      activeMethods,
    ),
    [methods, actuals, activeMethods],
  );
  // cash_19: actual total = cash counted + petty paid + non-cash actual;
  // discrepancy = actual total - POS report total.
  const actualTotal   = computeActualTotal(cashCounted, pettyTotal, nonCashActual);
  const discrepancy   = computeDiscrepancy(posTotal, cashCounted, pettyTotal, nonCashActual);

  function updateMethod(id: string, amount: number) {
    setMethods((curr) => curr.map((m) => (m.paymentMethodId === id ? { ...m, amount } : m)));
  }
  function updateActual(id: string, amount: number) {
    setActuals((curr) => ({ ...curr, [id]: amount }));
  }
  function updateDenom(denom: number, count: number) {
    setDenoms((curr) => curr.map((d) => (d.denomination === denom ? { ...d, count } : d)));
  }

  async function handleSave(signAfter = false) {
    if (!unitId || !state.email) return;
    if (!counterId) {
      setErr("Pick the POS counter being closed. Counters are managed in Settings → Cash.");
      return;
    }
    // If a conflicting closing exists and the user hasn't opened it, block
    // the save and ask them what to do. Without this guard upsertClosing
    // would silently overwrite the existing row.
    if (!existing && conflict) {
      setErr(
        "A closing already exists for this counter, date and shift. Open it " +
          "from the banner above or pick a different counter/date/shift.",
      );
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      // If the manager picked an EDC slip file, upload it first so the
      // closing row can persist the URL in the same save.
      let nextEdcUrl = edcSlipUrl;
      if (edcFile) {
        nextEdcUrl = await uploadCashSlip(edcFile, state.email);
      }
      const id = await upsertClosing({
        operatingUnitId: unitId,
        posCounterId: counterId,
        businessDate,
        shift,
        cashierEmail: cashierEmail || null,
        closedByEmail: state.email,
        posTotalSales: posTotal,
        posNonCashTotal: posNonCash,
        nonCashActualTotal: nonCashActual,
        cashCounted,
        cashDeposited: existing?.cashDeposited ?? 0,
        notes,
        edcSlipUrl: nextEdcUrl,
        denominations: denoms.filter((d) => d.count > 0),
        // Keep rows the POS reported on *or* where an actual was recorded —
        // the manual-EDC case is exactly "POS says 0, machine says money".
        paymentMethods: methods
          .filter((m) => m.amount > 0 || (actuals[m.paymentMethodId] ?? 0) > 0)
          .map((m) => ({
            ...m,
            actualAmount: actuals[m.paymentMethodId] ?? m.amount,
          })),
      });
      // Manager sign-after — moves draft → counted (not signed). The
      // cashier still needs to confirm before the ledger row writes.
      if (signAfter && isManager) await signClosing(id, state.email);
      const fresh = await getClosing(id);
      setExisting(fresh);
      setEdcSlipUrl(fresh?.edcSlipUrl ?? null);
      setEdcFile(null);
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
  // Anyone whose email is recorded as the cashier on this closing can
  // confirm — not just users with role='cashier'. The field is
  // "who ran the till today"; in a small operation that's often the
  // owner. RLS still gates writes via the manager-tier (write_owner
  // -or-manager) policy or the cashier-only policy in migration 08.
  const canCashierConfirm =
    !!existing
    && existing.status === "counted"
    && !!existing.cashierEmail
    && existing.cashierEmail.toLowerCase() === (state.email ?? "").toLowerCase();

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
            A closing already exists for this counter on {conflict.businessDate} · {conflict.shift}
            {" "}(<span className="font-medium">{conflict.status === "counted" ? "awaiting cashier" : conflict.status}</span>).
          </span>
          <Button size="sm" variant="secondary" onClick={openConflict}>
            Open existing
          </Button>
        </div>
      ) : null}

      {/* Header — unit / counter / date / shift / cashier selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Field label="Unit">
          <Select value={unitId} disabled={lockedForManager} onChange={(e) => setUnitId(e.target.value)}>
            {refs.units.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Counter">
          <Select
            value={counterId}
            disabled={lockedForManager}
            onChange={(e) => setCounterId(e.target.value)}
          >
            {unitCounters.length === 0 ? (
              <option value="">— no counters —</option>
            ) : null}
            {unitCounters.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
            {/* Existing closing on a since-archived counter: keep it
                selectable so the row renders truthfully. */}
            {counterId && !unitCounters.some((c) => c.id === counterId) ? (
              <option value={counterId}>(archived counter)</option>
            ) : null}
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

      {/* Payment methods grid — scoped to the selected operating unit so
          BO only shows Cash/UPI and F&B only shows Cash/Pinelabs etc.
          Mapping is managed in Settings → Cash. */}
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-muted mb-2">
          Payment methods (from POS report)
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(unitMethods.length > 0 ? unitMethods : refs.paymentMethods).map((m) => {
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

      {/* Actuals — what each non-cash mode really settled (EDC machine /
          UPI app totals). Autofilled from the POS figures above; editable
          for the manual-EDC case where a sale never went through the POS.
          Cash needs no row here — its actual is the denomination count
          below. Per-mode discrepancy renders under each input. */}
      {nonCashMethods.length > 0 ? (
        <div>
          <div className="text-xs uppercase tracking-wide text-ink-muted mb-1">
            Actual settlements
          </div>
          <p className="text-xs text-ink-muted mb-2">
            From the EDC machine / UPI app totals. Autofilled from the POS
            figures — edit when they differ (e.g. a sale keyed manually on
            the EDC machine).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {nonCashMethods.map((m) => {
              const pos    = methods.find((x) => x.paymentMethodId === m.id)?.amount ?? 0;
              const actual = actuals[m.id] ?? pos;
              const diff   = actual - pos;
              return (
                <Field key={m.id} label={m.displayName}>
                  <Input
                    type="number"
                    inputMode="decimal"
                    disabled={lockedForManager}
                    value={actual}
                    onChange={(e) => updateActual(m.id, Number(e.target.value) || 0)}
                  />
                  <div
                    className={`text-xs mt-1 tabular-nums ${
                      diff === 0 ? "text-ink-muted" : "text-red-600"
                    }`}
                  >
                    {diff === 0
                      ? "matches POS"
                      : `${diff > 0 ? "+" : "−"}${fmtINR(Math.abs(diff))} vs POS`}
                  </div>
                </Field>
              );
            })}
          </div>
        </div>
      ) : null}

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
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Tile label="Cash counted"   value={fmtINR(cashCounted)} />
          <Tile label="Petty expenses" value={fmtINR(pettyTotal)} />
          {/* cash_19 — cash + petty + non-cash actual, vs the POS total. */}
          <Tile label="Actual total"   value={fmtINR(actualTotal)} />
          <Tile
            label="Discrepancy"
            value={fmtINR(discrepancy)}
            accent={discrepancy === 0 ? "good" : "bad"}
          />
        </div>
      </div>

      {/* EDC settlement slip — same-day evidence captured at closing time.
          The accountant logs the actual payout later as a pos_settlement
          record, which can also carry its own slip. */}
      <Field label="EDC / POS settlement slip (optional)">
        <input
          type="file"
          accept="image/*,.pdf"
          disabled={lockedForManager}
          onChange={(e) => setEdcFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm disabled:opacity-50"
        />
        {edcFile ? (
          <div className="text-xs text-ink-muted mt-1 truncate">{edcFile.name}</div>
        ) : edcSlipUrl ? (
          <div className="text-xs mt-1">
            <a className="text-amber-600 underline" href={edcSlipUrl} target="_blank" rel="noreferrer">
              View uploaded slip
            </a>
          </div>
        ) : null}
      </Field>

      {/* Deposit coverage — read-only since cash_20. Deposits are recorded
          next-day from the Closings page ("Record deposit") and can cover
          both shifts' closings in one bank deposit. */}
      {existing && isManager ? (
        deposit ? (
          <div className="text-xs rounded border border-line bg-paper px-3 py-2">
            Covered by {deposit.status === "completed" ? "completed" : deposit.status}
            {" "}deposit of {fmtINR(deposit.depositedAmount)} on {deposit.depositDate}
            {deposit.closingIds.length > 1
              ? ` (covers ${deposit.closingIds.length} closings)` : ""}.
          </div>
        ) : (
          <div className="text-xs text-ink-muted">
            No bank deposit covers this closing yet — record it from the
            Closings page once the cash goes to the bank.
          </div>
        )
      ) : null}

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

/**
 * Build the actual-override map from saved payment rows. Rows where the
 * saved actual is null (pre-cash_17) or equal to the POS figure stay in
 * "follow POS" mode (no key); only true divergences become overrides.
 */
function actualOverridesFrom(
  pms: CashClosingPaymentMethod[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of pms) {
    if (p.actualAmount != null && p.actualAmount !== p.amount) {
      out[p.paymentMethodId] = p.actualAmount;
    }
  }
  return out;
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
