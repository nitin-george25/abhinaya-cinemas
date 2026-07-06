// ============================================================================
// AdvanceNetSheet — net outstanding vendor advances against a final payment (S6).
// Auto-suggests the payee's unrecovered advances; the accountant ticks which to
// apply (partials allowed) and sees the running math:
//   invoice total − advances applied = net payable.
// ============================================================================

import { useState } from "react";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { MoneyInput } from "./MoneyInput";
import { fmtINR } from "../../lib/dashboard";
import { netAdvances, type PaymentDetail, type OutstandingAdvance } from "../../lib/payments";

export function AdvanceNetSheet({
  detail,
  candidates,
  onClose,
  onNetted,
  onError,
}: {
  detail: PaymentDetail;
  candidates: OutstandingAdvance[];
  onClose: () => void;
  onNetted: () => void | Promise<void>;
  onError: (m: string) => void;
}) {
  // selected advanceId → applied amount (string for editing)
  const [sel, setSel] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function toggle(a: OutstandingAdvance) {
    setSel((prev) => {
      const next = { ...prev };
      if (a.id in next) delete next[a.id];
      else next[a.id] = String(a.balance);
      return next;
    });
  }

  const applied = Object.values(sel).reduce((s, v) => s + (Number(v) || 0), 0);
  const net = detail.amount - applied;

  async function confirm() {
    const apps = Object.entries(sel).map(([advanceId, v]) => ({ advanceId, amount: Number(v) || 0 }));
    if (apps.length === 0) { onError("Tick at least one advance, or close."); return; }
    if (applied > detail.amount) { onError("Applied advances exceed the payment total."); return; }
    setBusy(true);
    try { await netAdvances(detail.id, apps); await onNetted(); onClose(); }
    catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} maxWidth="max-w-lg" title={`Net advances — ${detail.payeeName}`}>
      <div className="space-y-4">
        {candidates.length === 0 ? (
          <p className="text-sm text-ink-muted">No outstanding advances for this payee.</p>
        ) : (
          <ul className="divide-y divide-line">
            {candidates.map((a) => {
              const on = a.id in sel;
              return (
                <li key={a.id} className="flex items-center gap-3 py-2">
                  <input type="checkbox" checked={on} onChange={() => toggle(a)} />
                  <div className="flex-1">
                    <div className="text-sm text-ink">{a.payee}</div>
                    <div className="text-xs text-ink-muted">
                      Paid {fmtINR(a.paid)} · balance {fmtINR(a.balance)}
                    </div>
                  </div>
                  {on ? (
                    <div className="w-32">
                      <MoneyInput value={sel[a.id] ?? ""} onChange={(v) => setSel((p) => ({ ...p, [a.id]: v }))} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <dl className="space-y-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm">
          <Line label="Invoice total" value={fmtINR(detail.amount, 2)} />
          <Line label="Advances applied" value={`− ${fmtINR(applied, 2)}`} />
          <div className="flex justify-between border-t border-line pt-1 font-medium">
            <span>Net payable</span>
            <span className="font-mono tabular-nums">{fmtINR(net, 2)}</span>
          </div>
        </dl>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => void confirm()}>{busy ? "Applying…" : "Apply advances"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-ink-muted">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}
