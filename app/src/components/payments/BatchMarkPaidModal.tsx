// ============================================================================
// BatchMarkPaidModal — confirm the ONE real transfer that settles a batch.
//
// The single-payment MarkPaidModal's sibling (payments_100). The differences are
// all consequences of "many invoices, one debit":
//   • the summary itemises gross → advances applied → net across every line;
//   • the amount field defaults to that net, and a figure that differs still
//     needs a reason — the reasoned delta lands on the BATCH (bank charges, a
//     round-off), while each invoice keeps its own value;
//   • one receipt and one UTR cover the lot;
//   • the Zoho push is fanned out per line, because accounting is per invoice.
// ============================================================================

import { useState } from "react";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Field, Input, Select } from "../ui/Input";
import { MoneyInput } from "./MoneyInput";
import { fmtINR } from "../../lib/dashboard";
import {
  markBatchPaid,
  pushPaymentToZoho,
  uploadPaymentFile,
  postBatchPaidNote,
  type PaymentBatch,
  type PaymentBatchTotals,
  type PaymentInboxRow,
} from "../../lib/payments";

export function BatchMarkPaidModal({
  batch,
  totals,
  lines,
  bankAccounts,
  uploaderEmail,
  onClose,
  onPaid,
  onError,
  onWarn,
}: {
  batch: PaymentBatch;
  totals: PaymentBatchTotals;
  lines: PaymentInboxRow[];
  bankAccounts: { id: string; name: string; isPrimary: boolean }[];
  uploaderEmail: string | null;
  onClose: () => void;
  onPaid: () => void | Promise<void>;
  onError: (m: string) => void;
  onWarn: (m: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [bankId, setBankId] = useState(
    batch.bankAccountId
      ?? bankAccounts.find((b) => b.isPrimary)?.id
      ?? bankAccounts[0]?.id
      ?? "",
  );
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState(String(totals.net));
  const [reason, setReason] = useState("");
  const [paidDate, setPaidDate] = useState(today);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const differs = Number(amount) !== totals.net;

  async function confirm() {
    if (!bankId) { onError("Pick a bank account."); return; }
    if (!(Number(amount) > 0)) { onError("Enter a positive paid amount."); return; }
    if (!receipt) { onError("Attach the transaction receipt."); return; }
    if (!uploaderEmail) { onError("Still signing in — try again in a moment."); return; }
    if (differs && !reason.trim()) {
      onError("Give a reason when the transfer differs from the batch net.");
      return;
    }
    setBusy(true);
    try {
      const receiptUrl = await uploadPaymentFile(receipt, uploaderEmail);
      await markBatchPaid(batch.id, {
        bankAccountId: bankId,
        receiptUrl,
        reference: reference || null,
        paidAmount: Number(amount),
        paidReason: differs ? reason : null,
        paidDate: paidDate || null,
      });
      // Accounting stays per invoice, so each line pushes on its own. The Edge
      // Function skips types that aren't Zoho-pushed; all of it is best-effort
      // and must never block a transfer that has already left the bank.
      await Promise.all(lines.map((l) => pushPaymentToZoho(l.id)));
      const slackReason = await postBatchPaidNote(batch.id);
      if (slackReason) onWarn(`Marked paid, but Slack wasn't updated: ${slackReason}`);
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
      title={`Mark batch paid — ${batch.payeeName}`}
    >
      <div className="space-y-4">
        <div className="space-y-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-muted">
              {totals.lineCount} invoice{totals.lineCount === 1 ? "" : "s"}
            </span>
            <span className="font-mono tabular-nums">{fmtINR(totals.gross, 2)}</span>
          </div>
          {totals.applied > 0 ? (
            <div className="flex justify-between">
              <span className="text-ink-muted">Advances applied</span>
              <span className="font-mono tabular-nums">− {fmtINR(totals.applied, 2)}</span>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-line pt-1 font-medium">
            <span>Net payable</span>
            <span className="font-mono tabular-nums">{fmtINR(totals.net, 2)}</span>
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
          <Field label="Transferred">
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          <Field label="Paid date">
            <Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
          </Field>
        </div>

        {differs ? (
          <Field label="Reason for the difference (required)">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. bank charges deducted"
            />
          </Field>
        ) : null}

        <Field label="Bank reference (NEFT / UTR / cheque no.)">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>

        <Field label="Transaction receipt (required)">
          <input
            type="file"
            accept="image/*,.pdf"
            onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
            className="block w-full text-sm"
          />
          {receipt
            ? <div className="mt-1 truncate text-xs text-ink-muted">{receipt.name}</div>
            : <div className="mt-1 text-xs text-ink-muted">One confirmation covers the whole batch.</div>}
        </Field>

        <div className="rounded-lg border border-line bg-paper px-3 py-2 text-xs text-ink-soft">
          This records one bank-book line of {fmtINR(Number(amount) || 0, 2)} and marks all{" "}
          {totals.lineCount} invoice{totals.lineCount === 1 ? "" : "s"} paid.
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !receipt} onClick={() => void confirm()}>
            {busy ? "Recording…" : "Confirm transfer"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
