// ============================================================================
// PaymentDrawer — the right-side detail + action surface (S3).
//
// For a general payment it loads the full record + audit trail and renders the
// routine lifecycle stepper (§6.1) with state- and role-gated actions:
//   draft     → Submit / Cancel              (raiser)
//   awaiting  → Approve / Reject             (owner; interim console path until
//               Cancel                        Slack lands in phase 3)
//   approved  → Mark paid / Cancel           (accountant + owner)
// PM project expenses and petty rows are read-only windows here.
// ============================================================================

import { useEffect, useState } from "react";

import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Modal } from "../ui/Modal";
import { Field, Input } from "../ui/Input";
import { cn } from "../ui/cn";
import { PaymentStatusBadge } from "./PaymentStatusBadge";
import { MarkPaidModal } from "./MarkPaidModal";
import { fmtINR } from "../../lib/dashboard";
import {
  getPaymentDetail,
  listPaymentAudit,
  submitPayment,
  approvePayment,
  rejectPayment,
  cancelPayment,
  type PaymentInboxRow,
  type PaymentDetail,
  type PaymentAuditEntry,
} from "../../lib/payments";

const STEPS = ["Draft", "Awaiting owner", "Approved", "Paid"];

function stepIndex(status: string): number {
  switch (status) {
    case "draft": case "rejected": return 0;
    case "approved": return 2;
    case "paid": case "posted": return 3;
    default: return 1; // awaiting / asset mid-states
  }
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" });
}

export function PaymentDrawer({
  row,
  role,
  bankAccounts,
  onClose,
  onChanged,
}: {
  row: PaymentInboxRow;
  role: string | null;
  bankAccounts: { id: string; name: string; isPrimary: boolean }[];
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const isPayment = row.kind === "payment";
  const canRaise = role === "owner" || role === "manager" || role === "accountant";
  const isOwner = role === "owner";
  const canMarkPaid = role === "owner" || role === "accountant";

  const [detail, setDetail] = useState<PaymentDetail | null>(null);
  const [audit, setAudit] = useState<PaymentAuditEntry[]>([]);
  const [loading, setLoading] = useState(isPayment);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [showMarkPaid, setShowMarkPaid] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);

  async function load() {
    if (!isPayment) return;
    setLoading(true);
    const [d, a] = await Promise.all([getPaymentDetail(row.id), listPaymentAudit(row.id)]);
    setDetail(d); setAudit(a); setLoading(false);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [row.id]);

  async function act(fn: () => Promise<void>) {
    setBusy(true); setErr(null);
    try { await fn(); await load(); await onChanged(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  const status = detail?.status ?? row.status;
  const idx = stepIndex(status);
  const zohoNotice = !!detail && (detail.accountingHead?.toLowerCase().includes("f&b") ?? false);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <aside className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-line bg-paper-card shadow-card">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <div className="text-lg font-semibold text-ink">{row.payee}</div>
            <div className="text-sm text-ink-muted">{row.typeLabel} · {row.source}</div>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink" aria-label="Close">✕</button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {/* Amount + status */}
          <div className="flex items-center justify-between">
            <div className="font-mono text-2xl tabular-nums">{fmtINR(detail?.amount ?? row.amount, 2)}</div>
            <PaymentStatusBadge status={status} />
          </div>

          {err ? <div className="text-sm text-red-600">{err}</div> : null}

          {!isPayment ? (
            <div className="rounded-lg border border-line bg-paper px-3 py-3 text-sm text-ink-muted">
              {row.kind === "project"
                ? "This is a project expense — manage it from Project Management. It appears here as a read-only window onto the same payment."
                : "This is a petty till expense — managed in the Petty Expenses flow."}
            </div>
          ) : loading ? (
            <div className="space-y-2">
              <div className="h-4 w-2/3 animate-pulse rounded bg-line" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-line" />
            </div>
          ) : detail ? (
            <>
              {/* Lifecycle stepper */}
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

              {status === "rejected" && detail.rejectedReason ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  Rejected — {detail.rejectedReason}
                </div>
              ) : null}

              {/* Files */}
              {(detail.invoiceUrl || detail.proformaUrl) ? (
                <div className="space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Documents</div>
                  {detail.invoiceUrl ? (
                    <a href={detail.invoiceUrl} target="_blank" rel="noreferrer" className="block text-sm text-amber-700 hover:underline">Invoice / statement</a>
                  ) : null}
                  {detail.proformaUrl ? (
                    <a href={detail.proformaUrl} target="_blank" rel="noreferrer" className="block text-sm text-amber-700 hover:underline">Proforma invoice</a>
                  ) : null}
                </div>
              ) : null}

              {/* Paid info */}
              {status === "paid" || status === "posted" ? (
                <dl className="space-y-1 text-sm">
                  <Line label="Paid amount" value={fmtINR(detail.paidAmount ?? detail.amount, 2)} mono />
                  {detail.bankReference ? <Line label="Reference" value={detail.bankReference} /> : null}
                  {detail.paidAt ? <Line label="Paid on" value={fmtWhen(detail.paidAt)} /> : null}
                </dl>
              ) : null}

              {/* Audit trail */}
              {audit.length > 0 ? (
                <div className="space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">History</div>
                  <ul className="space-y-1.5">
                    {audit.map((a) => (
                      <li key={a.id} className="text-xs text-ink-muted">
                        <span className="font-medium text-ink-soft">{a.toStatus}</span>
                        {a.actorEmail ? ` · ${a.actorEmail}` : a.actorSlackUser ? ` · Slack ${a.actorSlackUser}` : ""}
                        {" · "}{fmtWhen(a.createdAt)}
                        {a.note ? <span className="block pl-2 text-ink-muted">{a.note}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-sm text-red-600">Couldn't load this payment.</div>
          )}
        </div>

        {/* Actions */}
        {isPayment && detail ? (
          <div className="mt-auto flex flex-wrap gap-2 border-t border-line px-5 py-4">
            {status === "draft" ? (
              <Button disabled={busy || !canRaise} onClick={() => void act(() => submitPayment(detail.id))}>
                Submit for approval
              </Button>
            ) : null}
            {["pending", "awaiting_approval", "awaiting_payment_approval"].includes(status) && isOwner ? (
              <>
                <Button disabled={busy} onClick={() => void act(() => approvePayment(detail.id))}>Approve</Button>
                <Button variant="secondary" disabled={busy} onClick={() => setShowReject(true)}>Reject</Button>
              </>
            ) : null}
            {status === "approved" ? (
              <Button disabled={busy || !canMarkPaid} onClick={() => setShowMarkPaid(true)}>Mark paid</Button>
            ) : null}
            {status !== "paid" && status !== "posted" && status !== "cancelled" && canRaise ? (
              <Button variant="ghost" disabled={busy} onClick={() => setShowCancel(true)}>Cancel</Button>
            ) : null}
          </div>
        ) : null}
      </aside>

      {/* Mark-paid */}
      {showMarkPaid && detail ? (
        <MarkPaidModal
          detail={detail}
          bankAccounts={bankAccounts}
          zohoNotice={zohoNotice}
          onClose={() => setShowMarkPaid(false)}
          onPaid={async () => { await load(); await onChanged(); }}
          onError={setErr}
        />
      ) : null}

      {/* Reject reason */}
      {showReject && detail ? (
        <Modal open onClose={() => setShowReject(false)} maxWidth="max-w-sm" title="Reject payment">
          <div className="space-y-3">
            <Field label="Reason (sent back to draft for revision)">
              <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowReject(false)}>Cancel</Button>
              <Button
                variant="danger"
                disabled={busy || !rejectReason.trim()}
                onClick={() => { setShowReject(false); void act(() => rejectPayment(detail.id, rejectReason)).then(() => setRejectReason("")); }}
              >
                Reject
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* Cancel */}
      <ConfirmDialog
        open={showCancel}
        title="Cancel this payment?"
        confirmLabel="Cancel payment"
        busy={busy}
        onCancel={() => setShowCancel(false)}
        onConfirm={() => { setShowCancel(false); if (detail) void act(() => cancelPayment(detail.id, "Cancelled from inbox")); }}
      >
        This marks the payment cancelled. It can't be undone.
      </ConfirmDialog>
    </div>
  );
}

function Line({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-ink-muted">{label}</span>
      <span className={mono ? "font-mono tabular-nums" : ""}>{value}</span>
    </div>
  );
}
