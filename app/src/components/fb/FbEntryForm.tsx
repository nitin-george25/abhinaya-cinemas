// ============================================================================
// Manual F&B day entry — modal form for adding or editing a single F&B day.
//
// Bulk PDF upload + per-item editing stay in the legacy console for now
// (C6.2 first pass keeps daily ops in-app without porting the 800-LOC
// PDF parser). Owners + managers can both use this form.
// ============================================================================

import { useEffect, useState, type FormEvent } from "react";

import { todayIso } from "../../lib/dates";
import { N } from "../../lib/engine";
import { recomputeFbSummary } from "../../lib/fb";
import { fmtINR } from "../../lib/dashboard";
import type { DateISO, FbEntry } from "../../lib/types";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input, Field } from "../ui/Input";

interface Props {
  open: boolean;
  /** Existing entry to edit; null/undefined when adding a fresh day. */
  initial?: FbEntry | null;
  onClose: () => void;
  onSave: (next: FbEntry) => void;
  onDelete?: () => void;
}

export function FbEntryForm({ open, initial, onClose, onSave, onDelete }: Props) {
  const [date, setDate] = useState<DateISO>(initial?.date ?? todayIso());
  const [food, setFood] = useState(String(initial?.summary.foodSales ?? ""));
  const [bev, setBev] = useState(String(initial?.summary.beveragesSales ?? ""));
  const [tax, setTax] = useState(String(initial?.summary.addTax ?? ""));
  const [bills, setBills] = useState(
    initial?.summary.bills == null ? "" : String(initial.summary.bills),
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");

  // Reset state when the modal is reopened with different `initial`.
  useEffect(() => {
    if (!open) return;
    setDate(initial?.date ?? todayIso());
    setFood(String(initial?.summary.foodSales ?? ""));
    setBev(String(initial?.summary.beveragesSales ?? ""));
    setTax(String(initial?.summary.addTax ?? ""));
    setBills(initial?.summary.bills == null ? "" : String(initial.summary.bills));
    setNotes(initial?.notes ?? "");
  }, [open, initial]);

  const foodN = N(food);
  const bevN  = N(bev);
  const taxN  = N(tax);
  const net   = foodN + bevN;
  const total = net + taxN;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!date) return;
    const summary = recomputeFbSummary({
      foodSales: foodN,
      beveragesSales: bevN,
      addTax: taxN,
      bills: bills === "" ? null : N(bills),
    });
    const next: FbEntry = {
      id: initial?.id ?? cryptoId(),
      date,
      summary,
      items: initial?.items ?? [],
      notes: notes || undefined,
    };
    onSave(next);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="max-w-lg"
      title={initial ? `Edit F&B day · ${initial.date}` : "Add F&B day"}
      actions={
        <Button variant="ghost" size="sm" onClick={onClose} title="Close (Esc)">
          ✕
        </Button>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Date">
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value as DateISO)}
            disabled={!!initial}            // can't change the unique key
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Food sales (net of tax)">
            <MoneyInput value={food} onChange={setFood} />
          </Field>
          <Field label="Beverages sales (net of tax)">
            <MoneyInput value={bev} onChange={setBev} />
          </Field>
          <Field label="Tax (GST etc.)">
            <MoneyInput value={tax} onChange={setTax} />
          </Field>
          <Field label="Bill count">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={bills}
              onChange={(e) => setBills(e.target.value.replace(/\D/g, ""))}
              placeholder="—"
            />
          </Field>
        </div>

        <div className="rounded-lg bg-paper border border-line px-4 py-3 text-sm tabular-nums">
          <div className="flex items-baseline justify-between">
            <span className="text-ink-muted">Net (food + bev)</span>
            <b>{fmtINR(net)}</b>
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-ink-muted">Total with tax</span>
            <b>{fmtINR(total)}</b>
          </div>
        </div>

        <Field label="Notes (optional)">
          <Input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything worth recording"
          />
        </Field>

        <div className="flex items-center justify-between gap-2 pt-2">
          {onDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                if (confirm("Delete this F&B day?")) onDelete();
              }}
              className="text-red-700"
            >
              Delete
            </Button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!date}>
              Save
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function MoneyInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      min={0}
      step={0.01}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="0.00"
      className="text-right"
    />
  );
}

function cryptoId(): string {
  // Browser-safe random hex id. Falls back to Math.random when crypto
  // is missing (Node test env mostly).
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as { randomUUID: () => string }).randomUUID();
  }
  return Math.random().toString(36).slice(2);
}
