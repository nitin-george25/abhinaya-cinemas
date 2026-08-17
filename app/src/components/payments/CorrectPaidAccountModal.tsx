// ============================================================================
// CorrectPaidAccountModal — owner-only fix for "we paid this from the wrong
// account" (bank_accounts_owner_manage).
//
// A paid payment is frozen everywhere else, and should be: the money moved and
// the bank-ledger row is real. But the one mistake that freeze has no answer for
// is the account picked at mark-paid — get it wrong and the money left account A
// while the bank book says B, so neither reconciles.
//
// This changes ONLY where the money came from. Amount, payee and status are
// untouched, the reason is mandatory, and the DB moves the bank-book row in the
// same transaction — a correction that fixed the payment but not the ledger
// would be worse than none at all.
// ============================================================================

import { useState } from "react";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Field, Input, Select } from "../ui/Input";
import { correctPaidAccount, correctBatchPaidAccount } from "../../lib/payments";

export function CorrectPaidAccountModal({
  kind,
  id,
  currentAccountId,
  bankAccounts,
  onClose,
  onDone,
  onError,
}: {
  kind: "payment" | "batch";
  id: string;
  currentAccountId: string | null;
  bankAccounts: { id: string; name: string; isPrimary: boolean }[];
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onError: (m: string) => void;
}) {
  const [bankId, setBankId] = useState(currentAccountId ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const current = bankAccounts.find((b) => b.id === currentAccountId) ?? null;
  const changed = !!bankId && bankId !== currentAccountId;

  async function confirm() {
    if (!changed) { onError("Pick a different account."); return; }
    if (!reason.trim()) { onError("Give a reason for the correction."); return; }
    setBusy(true);
    try {
      if (kind === "batch") await correctBatchPaidAccount(id, bankId, reason.trim());
      else await correctPaidAccount(id, bankId, reason.trim());
      await onDone();
      onClose();
    } catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      maxWidth="max-w-md"
      title="Correct the paid-from account"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-line bg-paper px-3 py-2 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-muted">Recorded as paid from</span>
            <span>{current?.name ?? "—"}</span>
          </div>
        </div>

        <Field label="Actually paid from">
          <Select value={bankId} onChange={(e) => setBankId(e.target.value)}>
            <option value="">—</option>
            {bankAccounts.map((b) => (
              <option key={b.id} value={b.id}>{b.name}{b.isPrimary ? " · primary" : ""}</option>
            ))}
          </Select>
        </Field>

        <Field label="Reason (required — goes on the audit trail)">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. picked the wrong account at mark-paid"
          />
        </Field>

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-ink-soft">
          This moves the bank-book entry to the new account as well, so both
          accounts' balances correct themselves. The entry stops counting as
          reconciled — it can't be matched against a statement it never appeared on.
          Nothing about the amount, payee or status changes.
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !changed || !reason.trim()} onClick={() => void confirm()}>
            {busy ? "Correcting…" : "Correct account"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
