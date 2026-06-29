// ============================================================================
// /payments/quotations — asset purchase quotation flow (S4, §6.2).
//
// Left: asset payments still in quoting / quote_approved / invoiced. Right: the
// selected payment's quotes (compare + owner approves one → locks vendor/price),
// the add-quote form, skip-quotation, the invoice-attach form (subtotal must
// match the locked quote), and submit-for-payment once invoiced.
// ============================================================================

import { useEffect, useMemo, useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field, Input } from "../../components/ui/Input";
import { cn } from "../../components/ui/cn";
import { PaymentStatusBadge } from "../../components/payments/PaymentStatusBadge";
import { QuoteCompareCard } from "../../components/payments/QuoteCompareCard";
import { MoneyInput } from "../../components/payments/MoneyInput";
import { useSync } from "../../lib/hooks/SyncContext";
import { useCashRefs } from "../../lib/hooks/useCashRefs";
import { fmtINR } from "../../lib/dashboard";
import {
  listAssetPayments, getPaymentDetail, listQuotations, addQuotation, approveQuotation,
  skipQuotation, attachAssetInvoice, uploadPaymentFile, submitPayment, postPaymentCard,
  type PaymentInboxRow, type PaymentDetail, type PaymentQuotation,
} from "../../lib/payments";

export default function PaymentsQuotationsPage() {
  const { state } = useSync();
  const refs = useCashRefs();
  const isOwner = state.role === "owner";
  const canRaise = ["owner", "manager", "accountant"].includes(state.role ?? "");
  const unitIds = useMemo(() => refs.units.map((u) => u.id), [refs.units]);

  const [list, setList] = useState<PaymentInboxRow[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PaymentDetail | null>(null);
  const [quotes, setQuotes] = useState<PaymentQuotation[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reloadList() {
    if (refs.loading) return;
    const rows = await listAssetPayments(unitIds);
    setList(rows);
    if (!selId && rows[0]) setSelId(rows[0].id);
  }
  useEffect(() => { void reloadList(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [refs.loading, unitIds.join(",")]);

  async function reloadDetail() {
    if (!selId) { setDetail(null); setQuotes([]); return; }
    const [d, q] = await Promise.all([getPaymentDetail(selId), listQuotations(selId)]);
    setDetail(d); setQuotes(q);
  }
  useEffect(() => { void reloadDetail(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [selId]);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr(null);
    try { await fn(); await reloadDetail(); await reloadList(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  const lowest = useMemo(() => {
    const submitted = quotes.filter((q) => q.status !== "rejected");
    if (submitted.length === 0) return null;
    return submitted.reduce((m, q) => (q.amount < m.amount ? q : m)).id;
  }, [quotes]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-2xl uppercase tracking-tight">Asset quotations</h2>
        <p className="text-sm text-ink-muted">Gather quotes, lock a vendor, then invoice &amp; pay.</p>
      </div>

      {err ? <div className="text-sm text-red-600">{err}</div> : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
        {/* List */}
        <Card>
          <CardHeader><CardTitle>Asset payments</CardTitle></CardHeader>
          <CardBody className="p-0">
            {list.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-ink-muted">No asset payments in progress.</div>
            ) : (
              <ul className="divide-y divide-line">
                {list.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => setSelId(r.id)}
                      className={cn("w-full px-4 py-3 text-left hover:bg-paper", selId === r.id && "bg-paper")}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-ink">{r.payee}</span>
                        <PaymentStatusBadge status={r.status} />
                      </div>
                      <div className="mt-0.5 font-mono text-xs tabular-nums text-ink-muted">{fmtINR(r.amount)}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Detail */}
        {detail ? (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{detail.payeeName} · {detail.typeName}</CardTitle>
                <PaymentStatusBadge status={detail.status} />
              </CardHeader>
              <CardBody className="space-y-4">
                {detail.quoteLockedVendor ? (
                  <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                    Locked: {detail.quoteLockedVendor} @ {fmtINR(detail.quoteLockedAmount ?? 0, 2)}
                  </div>
                ) : null}

                {/* Quotes */}
                {quotes.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {quotes.map((q) => (
                      <QuoteCompareCard
                        key={q.id}
                        quote={q}
                        lowest={q.id === lowest}
                        canApprove={isOwner && detail.status === "quoting"}
                        busy={busy}
                        onApprove={() => void run(() => approveQuotation(q.id))}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-ink-muted">No quotes yet — add at least one.</p>
                )}

                {/* Add quote / skip — while quoting or draft */}
                {["draft", "quoting"].includes(detail.status) && canRaise ? (
                  <AddQuoteForm
                    paymentId={detail.id}
                    email={state.email}
                    busy={busy}
                    canSkip={canRaise}
                    onSkip={(reason) => void run(() => skipQuotation(detail.id, reason))}
                    onError={setErr}
                    onRun={run}
                  />
                ) : null}

                {/* Invoice attach — after quote approved */}
                {detail.status === "quote_approved" && canRaise ? (
                  <AttachInvoiceForm
                    paymentId={detail.id}
                    lockedAmount={detail.quoteLockedAmount}
                    email={state.email}
                    busy={busy}
                    onRun={run}
                    onError={setErr}
                  />
                ) : null}

                {/* Submit for payment — once invoiced */}
                {detail.status === "invoiced" && canRaise ? (
                  <div className="flex items-center justify-between rounded-lg border border-line bg-paper px-3 py-2">
                    <span className="text-sm text-ink-muted">Invoice attached — send for owner's payment approval.</span>
                    <Button
                      disabled={busy}
                      onClick={() => void run(async () => {
                        await submitPayment(detail.id);
                        await postPaymentCard(detail.id, `${window.location.origin}/payments`);
                      })}
                    >
                      Submit for payment
                    </Button>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          </div>
        ) : (
          <Card><CardBody className="py-12 text-center text-ink-muted">Select an asset payment.</CardBody></Card>
        )}
      </div>
    </div>
  );
}

function AddQuoteForm({
  paymentId, email, busy, canSkip, onSkip, onError, onRun,
}: {
  paymentId: string;
  email: string | null;
  busy: boolean;
  canSkip: boolean;
  onSkip: (reason: string) => void;
  onError: (m: string) => void;
  onRun: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [lead, setLead] = useState("");
  const [warranty, setWarranty] = useState("");
  const [file, setFile] = useState<File | null>(null);

  async function add() {
    if (!email) return;
    if (!vendor.trim() || !(Number(amount) > 0) || !file) { onError("Vendor, amount and a quote file are required."); return; }
    await onRun(async () => {
      const url = await uploadPaymentFile(file, email);
      await addQuotation(paymentId, { vendor: vendor.trim(), amount: Number(amount), fileUrl: url, leadTime: lead || null, warranty: warranty || null });
      setVendor(""); setAmount(""); setLead(""); setWarranty(""); setFile(null);
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-line bg-paper p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Add a quote</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Vendor"><Input value={vendor} onChange={(e) => setVendor(e.target.value)} /></Field>
        <Field label="Amount"><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Lead time"><Input value={lead} onChange={(e) => setLead(e.target.value)} /></Field>
        <Field label="Warranty"><Input value={warranty} onChange={(e) => setWarranty(e.target.value)} /></Field>
      </div>
      <Field label="Quote file (required)">
        <input type="file" accept="image/*,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
      </Field>
      <div className="flex justify-between">
        {canSkip ? (
          <Button variant="ghost" disabled={busy} onClick={() => {
            const reason = window.prompt("Reason to skip quotation (known vendor / trivial buy):");
            if (reason) onSkip(reason);
          }}>Skip quotation</Button>
        ) : <span />}
        <Button disabled={busy} onClick={() => void add()}>Add quote</Button>
      </div>
    </div>
  );
}

function AttachInvoiceForm({
  paymentId, lockedAmount, email, busy, onRun, onError,
}: {
  paymentId: string;
  lockedAmount: number | null;
  email: string | null;
  busy: boolean;
  onRun: (fn: () => Promise<void>) => Promise<void>;
  onError: (m: string) => void;
}) {
  const [subtotal, setSubtotal] = useState(lockedAmount ? String(lockedAmount) : "");
  const [gst, setGst] = useState("");
  const [freight, setFreight] = useState("");
  const [deviation, setDeviation] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const differs = lockedAmount != null && Number(subtotal) !== lockedAmount;
  const total = (Number(subtotal) || 0) + (Number(gst) || 0) + (Number(freight) || 0);

  async function attach() {
    if (!email) return;
    if (!(Number(subtotal) > 0) || !file) { onError("Subtotal and the tax invoice are required."); return; }
    if (differs && !deviation.trim()) { onError("Give a deviation reason — subtotal doesn't match the locked quote."); return; }
    await onRun(async () => {
      const url = await uploadPaymentFile(file, email);
      await attachAssetInvoice(paymentId, {
        subtotal: Number(subtotal), gst: Number(gst) || 0, freight: Number(freight) || 0,
        fileUrl: url, deviationReason: differs ? deviation : null,
      });
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-line bg-paper p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Attach tax invoice</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Field label="Subtotal"><MoneyInput value={subtotal} onChange={setSubtotal} /></Field>
        <Field label="GST"><MoneyInput value={gst} onChange={setGst} /></Field>
        <Field label="Freight"><MoneyInput value={freight} onChange={setFreight} /></Field>
      </div>
      {differs ? (
        <Field label="Deviation reason (subtotal ≠ locked quote)">
          <Input value={deviation} onChange={(e) => setDeviation(e.target.value)} />
        </Field>
      ) : null}
      <Field label="Tax invoice (required)">
        <input type="file" accept="image/*,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
      </Field>
      <div className="flex items-center justify-between">
        <span className="text-sm text-ink-muted">Total payable: <span className="font-mono tabular-nums">{fmtINR(total, 2)}</span></span>
        <Button disabled={busy} onClick={() => void attach()}>Attach invoice</Button>
      </div>
    </div>
  );
}
