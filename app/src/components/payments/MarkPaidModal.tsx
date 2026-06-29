// ============================================================================
// MarkPaidModal — confirm a real money-out (S5). Picks the paid-from bank
// account, captures the NEFT/UTR/cheque reference, allows an edited paid amount
// (with a required reason when it differs), and a paid date. On success the row
// moves to Paid and the bank-ledger row is written by the DB trigger. For F&B
// it shows a "queued to Zoho" notice (the actual push lands in phase 6).
// ============================================================================

import { useState } from "react";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Field, Input, Select } from "../ui/Input";
import { MoneyInput } from "./MoneyInput";
import { fmtINR } from "../../lib/dashboard";
import { markPaid, type PaymentDetail } from "../../lib/payments";

export function MarkPaidModal({
  detail,
  bankAccounts,
  zohoNotice,
  onClose,
  onPaid,
  onError,
}: {
  detail: PaymentDetail;
  bankAccounts: { id: string; name: string; isPrimary: boolean }[];
  zohoNotice: boolean;
  onClose: () => void;
  onPaid: () => void | Promise<void>;
  onError: (m: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [bankId, setBankId] = useState(
    detail.bankAccountId
      ?? bankAccounts.find((b) => b.isPrimary)?.id
      ?? bankAccounts[0]?.id
      ?? "",
  );
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState(String(detail.amount));
  const [reason, setReason] = useState("");
  const [paidDate, setPaidDate] = useState(today);
  const [busy, setBusy] = useState(false);

  const differs = Number(amount) !== detail.amount;

  async function confirm() {
    if (!bankId) { onError("Pick a bank account."); return; }
    if (!(Number(amount) > 0)) { onError("Enter a positive paid amount."); return; }
    if (differs && !reason.trim()) {
      onError("Give a reason when the paid amount differs from the requested amount.");
      return;
    }
    setBusy(true);
    try {
      await markPaid(detail.id, {
        bankAccountId: bankId,
        reference: reference || null,
        paidAmount: Number(amount),
        paidReason: differs ? reason : null,
        paidDate: paidDate || null,
      });
      await onPaid();
      onClose();
    } catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      maxWidth="max-w-md"
      title={`Mark paid — ${detail.payeeName}`}
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-line bg-paper px-3 py-2 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-muted">Requested</span>
            <span className="font-mono tabular-nums">{fmtINR(detail.amount, 2)}</span>
          </div>
        </div>

        <Field label="Paid from (bank account)">
          <Select value={bankId} onChange={(e) => setBankId(e.target.value)}>
            <option value="">—</option>
            {bankAccounts.map((b) => (
              <option key={b.id} value={b.id}>{b.name}{b.isPrimary ? " · primary" : ""}</option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Paid amount">
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          <Field label="Paid date">
            <Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
          </Field>
        </div>

        {differs ? (
          <Field label="Reason for the difference (required)">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        ) : null}

        <Field label="Bank reference (NEFT / UTR / cheque no.)">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>

        {zohoNotice ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-ink-soft">
            F&amp;B payment — will be queued to Zoho Books on confirm (push lands in a later phase).
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => void confirm()}>
            {busy ? "Recording…" : "Confirm payment"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
