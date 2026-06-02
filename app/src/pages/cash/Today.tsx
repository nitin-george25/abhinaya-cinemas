// ============================================================================
// /cash/today — daily cash closing form for the active operating unit.
//
// Daily manager picks unit + shift, types the POS report payment-method
// breakdown, counts cash by denomination. The form previews the discrepancy
// (cash + petty − POS cash expected) so it can be reconciled before sign.
//
// Sign action sets status='signed'; trigger fn_closing_to_ledger fires the
// matching bank-ledger row on the unit's primary account.
// ============================================================================

import { useEffect, useMemo, useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field, Input, Select } from "../../components/ui/Input";
import { useSync } from "../../lib/hooks/SyncContext";
import { useCashRefs } from "../../lib/hooks/useCashRefs";
import { fmtINR } from "../../lib/dashboard";
import { todayIso } from "../../lib/dates";
import {
  INR_DENOMINATIONS,
  cashTotalFromMethods,
  computeDiscrepancy,
  getClosing,
  listClosings,
  listPettyExpenses,
  signClosing,
  totalFromDenominations,
  totalFromPaymentMethods,
  upsertClosing,
  type CashClosingPaymentMethod,
  type CashDenomination,
  type ClosingShift,
  type DailyCashClosing,
} from "../../lib/cash";

export default function CashTodayPage() {
  const { state }     = useSync();
  const refs          = useCashRefs();
  const [unitId, setUnitId]         = useState<string>("");
  const [businessDate, setDate]     = useState<string>(todayIso());
  const [shift, setShift]           = useState<ClosingShift>("all_day");
  const [existing, setExisting]     = useState<DailyCashClosing | null>(null);

  const [methods, setMethods] = useState<CashClosingPaymentMethod[]>([]);
  const [denoms, setDenoms]   = useState<CashDenomination[]>(
    INR_DENOMINATIONS.map((d) => ({ denomination: d, count: 0 })),
  );
  const [pettyTotal, setPettyTotal] = useState(0);
  const [notes, setNotes]           = useState("");
  const [saving, setSaving]         = useState(false);
  const [err, setErr]               = useState<string | null>(null);

  // Default to first unit once refs load
  useEffect(() => {
    if (!unitId && refs.units.length > 0) {
      setUnitId(refs.units[0]?.id ?? "");
    }
  }, [refs.units, unitId]);

  // Reset method rows whenever payment_methods change
  useEffect(() => {
    setMethods(refs.paymentMethods.map((m) => ({ paymentMethodId: m.id, amount: 0 })));
  }, [refs.paymentMethods]);

  // Look up the existing closing whenever (unit, date, shift) changes
  useEffect(() => {
    if (!unitId) return;
    let alive = true;
    void listClosings({ operatingUnitId: unitId, from: businessDate, to: businessDate }).then((rows) => {
      if (!alive) return;
      const found = rows.find((r) => r.shift === shift) ?? null;
      setExisting(found);
      if (found) {
        // Repopulate inputs from the saved draft.
        setMethods(
          refs.paymentMethods.map((m) => ({
            paymentMethodId: m.id,
            amount:
              found.paymentMethods.find((x) => x.paymentMethodId === m.id)?.amount ?? 0,
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
        setNotes(found.notes ?? "");
      }
    });
    return () => { alive = false; };
  }, [unitId, businessDate, shift, refs.paymentMethods]);

  // Auto-pull approved petty expenses for the day on the chosen unit
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

  // ── derived ───────────────────────────────────────────────────────────
  const cashCounted   = useMemo(() => totalFromDenominations(denoms), [denoms]);
  const posTotal      = useMemo(() => totalFromPaymentMethods(methods), [methods]);
  const cashInMethods = useMemo(
    () => cashTotalFromMethods(methods, refs.paymentMethods),
    [methods, refs.paymentMethods],
  );
  const posNonCash    = useMemo(() => posTotal - cashInMethods, [posTotal, cashInMethods]);
  const posCashExp    = posTotal - posNonCash;
  const discrepancy   = computeDiscrepancy(posTotal, posNonCash, cashCounted, pettyTotal);

  // ── handlers ──────────────────────────────────────────────────────────
  function updateMethod(id: string, amount: number) {
    setMethods((curr) => curr.map((m) => (m.paymentMethodId === id ? { ...m, amount } : m)));
  }
  function updateDenom(denom: number, count: number) {
    setDenoms((curr) => curr.map((d) => (d.denomination === denom ? { ...d, count } : d)));
  }

  async function handleSave(signAfter = false) {
    if (!unitId || !state.email) return;
    setSaving(true);
    setErr(null);
    try {
      const id = await upsertClosing({
        operatingUnitId: unitId,
        businessDate,
        shift,
        closedByEmail: state.email,
        posTotalSales: posTotal,
        posNonCashTotal: posNonCash,
        cashCounted,
        cashDeposited: existing?.cashDeposited ?? 0,
        notes,
        denominations: denoms.filter((d) => d.count > 0),
        paymentMethods: methods.filter((m) => m.amount > 0),
      });
      if (signAfter) await signClosing(id);
      const fresh = await getClosing(id);
      setExisting(fresh);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (refs.loading) {
    return <div className="text-sm text-ink-muted">Loading…</div>;
  }
  if (!refs.cinemaId) {
    return <div className="text-sm text-ink-muted">No cinema configured.</div>;
  }
  if (refs.units.length === 0) {
    return (
      <div className="text-sm text-ink-muted">
        No operating units yet. Ask the owner to create one in Settings → Cash.
      </div>
    );
  }

  const isSigned = existing?.status === "signed";

  return (
    <div className="space-y-6">
      {/* Header — unit / date / shift selector */}
      <Card>
        <CardHeader>
          <CardTitle>Cash closing</CardTitle>
          {existing ? (
            <span className={
              "text-xs px-2 py-0.5 rounded " +
              (isSigned ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-700")
            }>
              {existing.status}
            </span>
          ) : null}
        </CardHeader>
        <CardBody className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Unit">
            <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              {refs.units.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Business date">
            <Input type="date" value={businessDate} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Shift">
            <Select value={shift} onChange={(e) => setShift(e.target.value as ClosingShift)}>
              <option value="all_day">All day</option>
              <option value="morning">Morning</option>
              <option value="evening">Evening</option>
            </Select>
          </Field>
        </CardBody>
      </Card>

      {/* Payment methods grid */}
      <Card>
        <CardHeader><CardTitle>Payment methods (from POS report)</CardTitle></CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {refs.paymentMethods.map((m) => {
              const row = methods.find((x) => x.paymentMethodId === m.id);
              return (
                <Field key={m.id} label={`${m.displayName}${m.flowType === "cash" ? " (cash)" : ""}`}>
                  <Input
                    type="number"
                    inputMode="decimal"
                    disabled={isSigned}
                    value={row?.amount ?? 0}
                    onChange={(e) => updateMethod(m.id, Number(e.target.value) || 0)}
                  />
                </Field>
              );
            })}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <Tile label="POS total"           value={fmtINR(posTotal)} />
            <Tile label="Non-cash"            value={fmtINR(posNonCash)} />
            <Tile label="Cash expected"       value={fmtINR(posCashExp)} />
          </div>
        </CardBody>
      </Card>

      {/* Denomination grid */}
      <Card>
        <CardHeader><CardTitle>Cash counted</CardTitle></CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {denoms.map((d) => (
              <Field key={d.denomination} label={`₹ ${d.denomination}`}>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  disabled={isSigned}
                  value={d.count}
                  onChange={(e) => updateDenom(d.denomination, Number(e.target.value) || 0)}
                />
              </Field>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <Tile label="Cash counted"        value={fmtINR(cashCounted)} />
            <Tile label="Petty expenses"      value={fmtINR(pettyTotal)} />
            <Tile
              label="Discrepancy"
              value={fmtINR(discrepancy)}
              accent={discrepancy === 0 ? "good" : "bad"}
            />
          </div>
        </CardBody>
      </Card>

      {/* Notes + actions */}
      <Card>
        <CardBody className="space-y-3">
          <Field label="Notes">
            <Input value={notes} disabled={isSigned} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {err ? <div className="text-sm text-red-600">{err}</div> : null}
          <div className="flex gap-3 justify-end">
            <Button
              variant="secondary"
              disabled={saving || isSigned}
              onClick={() => void handleSave(false)}
            >
              Save draft
            </Button>
            <Button
              disabled={saving || isSigned}
              onClick={() => void handleSave(true)}
            >
              {isSigned ? "Signed" : "Sign & close"}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function Tile({
  label,
  value,
  accent,
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
