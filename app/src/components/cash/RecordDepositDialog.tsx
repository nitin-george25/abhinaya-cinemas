// ============================================================================
// Record deposit dialog — the cash_20 next-day deposit flow.
//
// Real process: two POS shifts → two closings/day; the combined cash goes
// to the bank the NEXT day as ONE physical deposit. This dialog lists the
// unit's un-deposited closings (last 14 days), pre-selects all of them,
// and records a single cash_deposits row covering the selection via the
// cash_deposit_closings join table.
//
// Deposit math (owner decision): deposited + retained must equal the
// covered closings' cash_counted sum. Retained = till float, recorded once
// per deposit. The form pre-fills retained from the unit's recommended
// float and keeps the pair balanced; save is blocked until they reconcile.
// ============================================================================

import { useEffect, useMemo, useState } from "react";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Field, Input, Select } from "../ui/Input";
import { useCashRefs } from "../../lib/hooks/useCashRefs";
import { useSync } from "../../lib/hooks/SyncContext";
import { fmtINR } from "../../lib/dashboard";
import { todayIso } from "../../lib/dates";
import {
  createCashDeposit,
  listUndepositedClosings,
  uploadCashSlip,
  type DailyCashClosing,
} from "../../lib/cash";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Unit pre-selected from the Closings page filter. */
  defaultUnitId?: string;
  onSaved?: () => void;
}

export function RecordDepositDialog({ open, onClose, defaultUnitId, onSaved }: Props) {
  const { state } = useSync();
  const refs      = useCashRefs();

  const [unitId, setUnitId]       = useState<string>(defaultUnitId ?? "");
  const [candidates, setCandidates] = useState<DailyCashClosing[]>([]);
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [loading, setLoading]     = useState(false);

  const [depositDate, setDepositDate]       = useState<string>(todayIso());
  const [depositAmount, setDepositAmount]   = useState<string>("");
  const [retainedAmount, setRetainedAmount] = useState<string>("");
  const [bankId, setBankId]                 = useState<string>("");
  const [slipRef, setSlipRef]               = useState<string>("");
  const [slipFile, setSlipFile]             = useState<File | null>(null);
  const [saving, setSaving]                 = useState(false);
  const [err, setErr]                       = useState<string | null>(null);
  /** Set once the user edits an amount — stops the auto-prefill. */
  const [touched, setTouched]               = useState(false);

  // Default unit once refs load (or follow the page's filter).
  useEffect(() => {
    if (!open) return;
    if (!unitId) setUnitId(defaultUnitId || (refs.units[0]?.id ?? ""));
  }, [open, defaultUnitId, refs.units, unitId]);

  // Default bank = unit's primary account.
  useEffect(() => {
    if (!open || bankId) return;
    const primary = refs.bankAccounts.find((b) => b.isPrimary) ?? refs.bankAccounts[0];
    if (primary) setBankId(primary.id);
  }, [open, refs.bankAccounts, bankId]);

  // Load un-deposited closings whenever the unit changes; select all.
  useEffect(() => {
    if (!open || !unitId) return;
    let alive = true;
    setLoading(true);
    void listUndepositedClosings(unitId).then((rows) => {
      if (!alive) return;
      setCandidates(rows);
      setSelected(new Set(rows.map((r) => r.id)));
      setTouched(false);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [open, unitId]);

  const counterName = (id: string) =>
    refs.counters.find((c) => c.id === id)?.name ?? "—";

  const cashTotal = useMemo(
    () => candidates.filter((r) => selected.has(r.id))
                    .reduce((s, r) => s + r.cashCounted, 0),
    [candidates, selected],
  );

  // Pre-fill: retained = unit float (capped at the cash total), deposited
  // makes up the rest. Re-runs as the selection changes until the user
  // touches an amount field.
  useEffect(() => {
    if (touched) return;
    const unit = refs.units.find((u) => u.id === unitId);
    const float = Math.min(unit?.defaultFloatAmount ?? 0, cashTotal);
    setRetainedAmount(float > 0 ? String(float) : "");
    setDepositAmount(cashTotal - float > 0 ? String(cashTotal - float) : "");
  }, [touched, cashTotal, refs.units, unitId]);

  const deposited  = Number(depositAmount) || 0;
  const retained   = Number(retainedAmount) || 0;
  const difference = deposited + retained - cashTotal;
  const balanced   = selected.size > 0 && deposited > 0 && difference === 0;

  function toggle(id: string) {
    setSelected((curr) => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSave(markCompleted: boolean) {
    if (!state.email || !unitId || !bankId || !balanced) return;
    setSaving(true); setErr(null);
    try {
      let url: string | null = null;
      if (slipFile) url = await uploadCashSlip(slipFile, state.email);
      await createCashDeposit({
        closingIds:       [...selected],
        operatingUnitId:  unitId,
        bankAccountId:    bankId,
        depositDate:      depositDate || todayIso(),
        depositedAmount:  deposited,
        retainedAmount:   retained,
        slipUrl:          url,
        slipReference:    slipRef || null,
        depositedByEmail: state.email,
        status:           markCompleted ? "completed" : "pending",
      });
      onSaved?.();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title="Record bank deposit" maxWidth="max-w-2xl">
      <div className="space-y-4 p-4">
        <Field label="Unit">
          <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            {refs.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </Field>

        {/* Un-deposited closings — both shifts of yesterday show here. */}
        <div>
          <div className="text-xs uppercase tracking-wide text-ink-muted mb-2">
            Closings covered by this deposit
          </div>
          {loading ? (
            <div className="text-sm text-ink-muted">Loading…</div>
          ) : candidates.length === 0 ? (
            <div className="text-sm text-ink-muted">
              No closings with un-deposited cash in the last 14 days.
            </div>
          ) : (
            <ul className="divide-y divide-line rounded border border-line">
              {candidates.map((r) => (
                <li key={r.id} className="px-3 py-2 flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                  <span className="flex-1 min-w-0">
                    {r.businessDate} · {counterName(r.posCounterId)} · {r.shift}
                    {r.status !== "signed" ? (
                      <span className="ml-2 text-xs text-amber-600">({r.status})</span>
                    ) : null}
                  </span>
                  <span className="tabular-nums">{fmtINR(r.cashCounted)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Cash to account for">
            <div className="px-3 py-2 text-sm tabular-nums rounded border border-line bg-paper">
              {fmtINR(cashTotal)}
            </div>
          </Field>
          <Field label="Deposited">
            <Input
              type="number" inputMode="decimal" value={depositAmount}
              onChange={(e) => { setTouched(true); setDepositAmount(e.target.value); }}
            />
          </Field>
          <Field label="Retained as float">
            <Input
              type="number" inputMode="decimal" value={retainedAmount}
              onChange={(e) => { setTouched(true); setRetainedAmount(e.target.value); }}
            />
          </Field>
        </div>

        {/* Reconciliation line — deposited + retained must equal the cash. */}
        {selected.size > 0 ? (
          <div className={
            "text-xs tabular-nums " + (difference === 0 ? "text-emerald-600" : "text-red-600")
          }>
            {difference === 0
              ? "Reconciles: deposited + retained = cash counted."
              : `${difference > 0 ? "+" : "−"}${fmtINR(Math.abs(difference))} vs cash counted — adjust deposited or retained.`}
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Deposit date">
            <Input type="date" value={depositDate} onChange={(e) => setDepositDate(e.target.value)} />
          </Field>
          <Field label="Bank account">
            <Select value={bankId} onChange={(e) => setBankId(e.target.value)}>
              {refs.bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}{b.accountNumberLast4 ? ` ··${b.accountNumberLast4}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Slip reference">
            <Input value={slipRef} onChange={(e) => setSlipRef(e.target.value)} />
          </Field>
        </div>

        <Field label="Deposit slip (optional)">
          <input
            type="file" accept="image/*,.pdf"
            onChange={(e) => setSlipFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm"
          />
        </Field>

        {err ? <div className="text-sm text-red-600">{err}</div> : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            variant="ghost"
            disabled={saving || !balanced || !bankId}
            onClick={() => void handleSave(false)}
          >
            Save as pending
          </Button>
          <Button
            disabled={saving || !balanced || !bankId}
            onClick={() => void handleSave(true)}
          >
            {saving ? "Saving…" : "Save & mark deposited"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
