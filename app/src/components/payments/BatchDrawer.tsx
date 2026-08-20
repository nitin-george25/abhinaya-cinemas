// ============================================================================
// BatchDrawer — detail + actions for a batch payment (payments_100).
//
// The PaymentDrawer's sibling for "many invoices, one payee, one transfer". Same
// lifecycle beats, decided once for the whole batch:
//   draft         → Add/remove invoices · Submit · Cancel   (raiser)
//   awaiting      → Approve all / Reject                    (owner)
//   approved      → Request payment OTP                     (accountant + owner)
//   otp_requested → Mark paid (one receipt, one UTR)
//
// Two things the single-payment drawer has no equivalent of:
//   • the line list, with per-invoice amounts and files, and a remove control
//     while the batch is still a draft;
//   • Submit reporting back WHICH way the DB went — a batch whose invoices the
//     owner already approved one by one skips straight to 'approved' and no card
//     is posted, because asking twice for the same money is noise.
//
// Cancelling releases every invoice untouched, so they can still be paid singly.
// ============================================================================

import { useEffect, useState } from "react";

import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Modal } from "../ui/Modal";
import { Field, Input } from "../ui/Input";
import { cn } from "../ui/cn";
import { PaymentStatusBadge } from "./PaymentStatusBadge";
import { BatchMarkPaidModal } from "./BatchMarkPaidModal";
import { CorrectPaidAccountModal } from "./CorrectPaidAccountModal";
import { fmtINR } from "../../lib/dashboard";
import { useSync } from "../../lib/hooks/SyncContext";
import {
  getBatch,
  getBatchTotals,
  listBatchLines,
  submitBatch,
  approveBatch,
  rejectBatch,
  cancelBatch,
  requestBatchOtp,
  removeFromBatch,
  postBatchCard,
  postBatchOtpRequest,
  syncBatchCard,
  type PaymentBatch,
  type PaymentBatchTotals,
  type PaymentInboxRow,
} from "../../lib/payments";

const STEPS = ["Draft", "Awaiting owner", "Approved", "OTP requested", "Paid"];

function stepIndex(status: string): number {
  switch (status) {
    case "draft": case "rejected": return 0;
    case "approved": return 2;
    case "otp_requested": return 3;
    case "paid": return 4;
    default: return 1;
  }
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "numeric", minute: "2-digit",
  });
}

export function BatchDrawer({
  batchId,
  role,
  bankAccounts,
  onClose,
  onChanged,
}: {
  batchId: string;
  role: string | null;
  bankAccounts: { id: string; name: string; isPrimary: boolean }[];
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const { state } = useSync();
  const canRaise = role === "owner" || role === "manager" || role === "accountant";
  const isOwner = role === "owner";
  const canMarkPaid = role === "owner" || role === "accountant";

  const [batch, setBatch] = useState<PaymentBatch | null>(null);
  const [lines, setLines] = useState<PaymentInboxRow[]>([]);
  const [totals, setTotals] = useState<PaymentBatchTotals>({ lineCount: 0, gross: 0, applied: 0, net: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [showMarkPaid, setShowMarkPaid] = useState(false);
  const [showCorrectAccount, setShowCorrectAccount] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);

  async function load() {
    setLoading(true);
    const [b, l, t] = await Promise.all([
      getBatch(batchId), listBatchLines(batchId), getBatchTotals(batchId),
    ]);
    setBatch(b); setLines(l); setTotals(t); setLoading(false);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [batchId]);

  async function act(fn: () => Promise<void>) {
    setBusy(true); setErr(null); setWarn(null); setInfo(null);
    try { await fn(); await load(); await onChanged(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  function noteSlack(reason: string | null, what: string) {
    if (reason) setWarn(`${what}, but Slack wasn't updated: ${reason}`);
  }

  const status = batch?.status ?? "draft";
  const idx = stepIndex(status);
  const frozen = status === "paid" || status === "cancelled";
  // A batch whose invoices the owner already approved one by one has nothing
  // left to approve, so don't offer to "submit it for approval" — the button is
  // just a confirmation on the way to the OTP.
  const nothingToApprove = lines.length > 0 && lines.every((l) => l.status === "approved");

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <aside className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-line bg-paper-card shadow-card">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <div className="text-lg font-semibold text-ink">{batch?.payeeName ?? "Batch"}</div>
            <div className="text-sm text-ink-muted">
              Batch · {totals.lineCount} invoice{totals.lineCount === 1 ? "" : "s"}
            </div>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink" aria-label="Close">✕</button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {/* Total + status */}
          <div className="flex items-center justify-between">
            <div className="font-mono text-2xl tabular-nums">
              {fmtINR(batch?.paidAmount ?? totals.net, 2)}
            </div>
            <PaymentStatusBadge status={status} />
          </div>

          {err ? <div className="text-sm text-red-600">{err}</div> : null}
          {warn ? <div className="text-sm text-amber-700">{warn}</div> : null}
          {info ? <div className="text-sm text-green-800">{info}</div> : null}

          {loading ? (
            <div className="space-y-2">
              <div className="h-4 w-2/3 animate-pulse rounded bg-line" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-line" />
            </div>
          ) : !batch ? (
            <div className="text-sm text-red-600">Couldn't load this batch.</div>
          ) : (
            <>
              {/* Lifecycle */}
              <ol className="space-y-2">
                {STEPS.map((label, i) => (
                  <li key={label} className="flex items-center gap-3">
                    <span className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
                      i < idx && "border-green-200 bg-green-50 text-green-800",
                      i === idx && "border-ink bg-ink text-white",
                      i > idx && "border-line bg-paper text-ink-muted",
                    )}>{i + 1}</span>
                    <span className={cn("text-sm", i === idx ? "font-medium text-ink" : "text-ink-muted")}>{label}</span>
                  </li>
                ))}
              </ol>

              {/* Money */}
              <div className="space-y-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-ink-muted">Invoices total</span>
                  <span className="font-mono tabular-nums">{fmtINR(totals.gross, 2)}</span>
                </div>
                {totals.applied > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-ink-muted">Advances applied</span>
                    <span className="font-mono tabular-nums">− {fmtINR(totals.applied, 2)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between border-t border-line pt-1 font-medium">
                  <span>{status === "paid" ? "Transferred" : "Net payable"}</span>
                  <span className="font-mono tabular-nums">
                    {fmtINR(batch.paidAmount ?? totals.net, 2)}
                  </span>
                </div>
                {batch.paidAmountReason ? (
                  <div className="pt-1 text-xs text-ink-muted">{batch.paidAmountReason}</div>
                ) : null}
              </div>

              {/* Lines */}
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Invoices</div>
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {lines.map((l) => (
                    <li key={l.id} className="flex items-start justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-ink">{l.source}</div>
                        <div className="text-xs text-ink-muted">
                          {l.typeLabel}
                          {l.status !== "approved" && status === "draft" ? ` · ${l.status}` : ""}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-sm tabular-nums">{fmtINR(l.amount, 2)}</span>
                        {status === "draft" && canRaise ? (
                          <button
                            className="text-xs text-ink-muted hover:text-red-600"
                            disabled={busy}
                            title="Remove from this batch"
                            onClick={() => void act(() => removeFromBatch(batch.id, l.id))}
                          >
                            ✕
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                  {lines.length === 0 ? (
                    <li className="px-3 py-4 text-center text-sm text-ink-muted">
                      No invoices in this batch yet.
                    </li>
                  ) : null}
                </ul>
              </div>

              {batch.rejectedReason && status === "draft" ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  Sent back — {batch.rejectedReason}. Revise the invoices and resubmit.
                </div>
              ) : null}

              {status === "otp_requested" ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-ink-soft">
                  OTP requested{batch.otpRequestedBy ? ` by ${batch.otpRequestedBy}` : ""}
                  {batch.otpRequestedAt ? ` · ${fmtWhen(batch.otpRequestedAt)}` : ""}.
                  The owner replies with it in Slack — make the single transfer, then mark it paid with the receipt.
                </div>
              ) : null}

              {status === "paid" ? (
                <dl className="space-y-1 text-sm">
                  {batch.bankReference ? <Line label="Reference" value={batch.bankReference} /> : null}
                  {batch.paidAt ? <Line label="Paid on" value={fmtWhen(batch.paidAt)} /> : null}
                  {batch.paymentReceiptUrl ? (
                    <a
                      href={batch.paymentReceiptUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-sm text-amber-700 hover:underline"
                    >
                      Transaction receipt
                    </a>
                  ) : null}
                </dl>
              ) : null}
            </>
          )}
        </div>

        {/* Actions. A paid batch is otherwise done, but the owner can still
            correct which account the one transfer actually left. */}
        {batch && (!frozen || (status === "paid" && isOwner)) ? (
          <div className="mt-auto flex flex-wrap gap-2 border-t border-line px-5 py-4">
            {status === "paid" && isOwner ? (
              <Button variant="secondary" disabled={busy} onClick={() => setShowCorrectAccount(true)}>
                Correct paid-from account
              </Button>
            ) : null}
            {status === "draft" ? (
              <Button
                disabled={busy || !canRaise || lines.length < 2}
                title={lines.length < 2 ? "A batch needs at least two invoices" : undefined}
                onClick={() => void act(async () => {
                  const outcome = await submitBatch(batch.id);
                  if (outcome === "awaiting_approval") {
                    noteSlack(await postBatchCard(batch.id, window.location.href), "Submitted");
                  } else {
                    setInfo("Every invoice was already approved — the batch is ready to pay, no second approval needed.");
                  }
                })}
              >
                {nothingToApprove ? "Confirm — ready to pay" : "Submit for approval"}
              </Button>
            ) : null}

            {status === "awaiting_approval" && isOwner ? (
              <>
                <Button
                  disabled={busy}
                  onClick={() => void act(async () => {
                    await approveBatch(batch.id);
                    noteSlack(await syncBatchCard(batch.id), "Approved");
                  })}
                >
                  Approve all
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => setShowReject(true)}>Reject</Button>
              </>
            ) : null}

            {status === "approved" ? (
              <Button
                disabled={busy || !canMarkPaid}
                onClick={() => void act(async () => {
                  await requestBatchOtp(batch.id);
                  noteSlack(await postBatchOtpRequest(batch.id, window.location.href), "OTP requested");
                })}
              >
                Request payment OTP
              </Button>
            ) : null}

            {status === "otp_requested" ? (
              <>
                <Button disabled={busy || !canMarkPaid} onClick={() => setShowMarkPaid(true)}>Mark paid</Button>
                <Button
                  variant="secondary"
                  disabled={busy || !canMarkPaid}
                  onClick={() => void act(async () => {
                    await requestBatchOtp(batch.id);
                    noteSlack(await postBatchOtpRequest(batch.id, window.location.href), "Asked again");
                  })}
                >
                  Ask again
                </Button>
              </>
            ) : null}

            {canRaise && !frozen ? (
              <Button variant="ghost" disabled={busy} onClick={() => setShowCancel(true)}>Cancel batch</Button>
            ) : null}
          </div>
        ) : null}
      </aside>

      {showMarkPaid && batch ? (
        <BatchMarkPaidModal
          batch={batch}
          totals={totals}
          lines={lines}
          bankAccounts={bankAccounts}
          uploaderEmail={state.email}
          onClose={() => setShowMarkPaid(false)}
          onPaid={async () => { await load(); await onChanged(); }}
          onError={setErr}
          onWarn={setWarn}
        />
      ) : null}

      {showCorrectAccount && batch ? (
        <CorrectPaidAccountModal
          kind="batch"
          id={batch.id}
          currentAccountId={batch.paidViaBankAccountId}
          bankAccounts={bankAccounts}
          onClose={() => setShowCorrectAccount(false)}
          onDone={async () => { await load(); await onChanged(); }}
          onError={setErr}
        />
      ) : null}

      {showReject && batch ? (
        <Modal open onClose={() => setShowReject(false)} maxWidth="max-w-sm" title="Reject batch">
          <div className="space-y-3">
            <Field label="Reason (sends every invoice back for revision)">
              <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowReject(false)}>Cancel</Button>
              <Button
                variant="danger"
                disabled={busy || !rejectReason.trim()}
                onClick={() => {
                  setShowReject(false);
                  void act(async () => {
                    await rejectBatch(batch.id, rejectReason);
                    noteSlack(await syncBatchCard(batch.id), "Rejected");
                  }).then(() => setRejectReason(""));
                }}
              >
                Reject
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      <ConfirmDialog
        open={showCancel}
        title="Cancel this batch?"
        confirmLabel="Cancel batch"
        busy={busy}
        onCancel={() => setShowCancel(false)}
        onConfirm={() => {
          setShowCancel(false);
          if (batch) void act(async () => {
            await cancelBatch(batch.id, "Cancelled from inbox");
            onClose();
          });
        }}
      >
        The invoices go back to the inbox untouched and can still be paid on their own.
        Only the batch is cancelled.
      </ConfirmDialog>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-ink-muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}
