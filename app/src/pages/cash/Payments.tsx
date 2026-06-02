// ============================================================================
// /cash/payments — payment requests.
//
// Accountant raises a request. Owner always approves; manager approves only
// when amount < cinema.payment_approval_threshold (₹5,000 default).
// Marking a request "paid" picks a bank account + reference; the
// fn_payment_to_ledger trigger writes the matching bank-ledger row.
// ============================================================================

import { useEffect, useMemo, useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field, Input, Select } from "../../components/ui/Input";
import { useSync } from "../../lib/hooks/SyncContext";
import { useCashRefs } from "../../lib/hooks/useCashRefs";
import { fmtINR } from "../../lib/dashboard";
import {
  approvePaymentRequest,
  createPaymentRequest,
  listPaymentRequests,
  markPaymentRequestPaid,
  rejectPaymentRequest,
  type PaymentRequest,
  type PaymentRequestMode,
} from "../../lib/cash";

const APPROVAL_THRESHOLD_DEFAULT = 5000;

export default function CashPaymentsPage() {
  const { state }             = useSync();
  const refs                  = useCashRefs();
  const role                  = state.role;
  const canApproveAll         = role === "owner";
  const canApproveLow         = role === "manager";
  const isAccountant          = role === "accountant";

  const [unitId, setUnitId]   = useState<string>("");
  const [rows, setRows]       = useState<PaymentRequest[]>([]);
  const [err, setErr]         = useState<string | null>(null);

  // Threshold defaults to ₹5,000 unless the cinema customized it.
  // Future Settings page will surface this — for now we hold the constant.
  const threshold = APPROVAL_THRESHOLD_DEFAULT;

  useEffect(() => {
    if (!unitId && refs.units.length > 0) setUnitId(refs.units[0]?.id ?? "");
  }, [refs.units, unitId]);

  async function reload() {
    if (!unitId) return;
    const r = await listPaymentRequests({ operatingUnitId: unitId });
    setRows(r);
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [unitId]);

  // ── New request form ─────────────────────────────────────────────────
  const [payee, setPayee]       = useState("");
  const [amount, setAmount]     = useState("");
  const [mode, setMode]         = useState<PaymentRequestMode>("bank_transfer");
  const [purpose, setPurpose]   = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [last4, setLast4]       = useState("");
  const [ifsc, setIfsc]         = useState("");
  const [busy, setBusy]         = useState(false);

  async function submitNew() {
    if (!state.email || !unitId) return;
    const amt = Number(amount);
    if (!payee || !amt || amt <= 0 || !purpose) {
      setErr("Fill payee, amount, and purpose."); return;
    }
    setBusy(true); setErr(null);
    try {
      await createPaymentRequest({
        operatingUnitId: unitId,
        neededBy: neededBy || null,
        payeeName: payee,
        payeeAccountLast4: last4 || null,
        payeeIfsc: ifsc || null,
        amount: amt,
        mode,
        purpose,
        requestedByEmail: state.email,
      });
      setPayee(""); setAmount(""); setPurpose(""); setNeededBy(""); setLast4(""); setIfsc("");
      await reload();
    } catch (e) { setErr((e as Error).message); }
    finally    { setBusy(false); }
  }

  // ── Approval / mark-paid handlers ────────────────────────────────────
  async function approve(r: PaymentRequest) {
    if (!state.email) return;
    try { await approvePaymentRequest(r.id, state.email); await reload(); }
    catch (e) { setErr((e as Error).message); }
  }
  async function reject(r: PaymentRequest) {
    if (!state.email) return;
    const reason = prompt("Reason");
    if (!reason) return;
    try { await rejectPaymentRequest(r.id, state.email, reason); await reload(); }
    catch (e) { setErr((e as Error).message); }
  }
  async function markPaid(r: PaymentRequest) {
    if (refs.bankAccounts.length === 0) {
      setErr("Add a bank account in Settings first."); return;
    }
    const acct = refs.bankAccounts[0];
    const bankId = prompt(
      "Bank account ID (default = primary):\n" +
        refs.bankAccounts.map((a) => `${a.id} — ${a.name}`).join("\n"),
      acct?.id ?? "",
    );
    if (!bankId) return;
    const ref = prompt("UTR / cheque number (optional)") || null;
    try { await markPaymentRequestPaid(r.id, bankId, ref); await reload(); }
    catch (e) { setErr((e as Error).message); }
  }

  const pending  = useMemo(() => rows.filter((r) => r.status === "pending"),  [rows]);
  const approved = useMemo(() => rows.filter((r) => r.status === "approved"), [rows]);
  const closed   = useMemo(() => rows.filter((r) => r.status === "paid" || r.status === "rejected"), [rows]);

  function canApprove(r: PaymentRequest): boolean {
    if (canApproveAll) return true;
    if (canApproveLow) return r.amount < threshold;
    return false;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Payment requests</CardTitle></CardHeader>
        <CardBody className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Unit">
            <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              {refs.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
        </CardBody>
      </Card>

      {err ? <div className="text-sm text-red-600">{err}</div> : null}

      {(isAccountant || canApproveAll) ? (
        <Card>
          <CardHeader><CardTitle>New request</CardTitle></CardHeader>
          <CardBody className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Payee">
                <Input value={payee} onChange={(e) => setPayee(e.target.value)} />
              </Field>
              <Field label="Amount (₹)">
                <Input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <Field label="Mode">
                <Select value={mode} onChange={(e) => setMode(e.target.value as PaymentRequestMode)}>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="cheque">Cheque</option>
                  <option value="upi">UPI</option>
                  <option value="cash">Cash</option>
                </Select>
              </Field>
              <Field label="Needed by">
                <Input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
              </Field>
              <Field label="A/c last 4">
                <Input value={last4} onChange={(e) => setLast4(e.target.value)} />
              </Field>
              <Field label="IFSC">
                <Input value={ifsc} onChange={(e) => setIfsc(e.target.value)} />
              </Field>
            </div>
            <Field label="Purpose">
              <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            </Field>
            <div className="flex justify-end">
              <Button disabled={busy} onClick={() => void submitNew()}>Submit</Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Section
        title="Pending approval"
        rows={pending}
        cta={(r) => canApprove(r) ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => void reject(r)}>Reject</Button>
            <Button size="sm" className="ml-2" onClick={() => void approve(r)}>Approve</Button>
          </>
        ) : (
          <span className="text-xs text-ink-muted">Needs owner</span>
        )}
      />
      <Section
        title="Approved · awaiting payment"
        rows={approved}
        cta={(r) => isAccountant || canApproveAll || canApproveLow ? (
          <Button size="sm" onClick={() => void markPaid(r)}>Mark paid</Button>
        ) : null}
      />
      <Section title="Closed" rows={closed} />
    </div>
  );
}

function Section({
  title, rows, cta,
}: { title: string; rows: PaymentRequest[]; cta?: (r: PaymentRequest) => React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <span className="text-xs text-ink-muted">{rows.length}</span>
      </CardHeader>
      <CardBody className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-paper text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2 text-left">Needed by</th>
              <th className="px-3 py-2 text-left">Payee</th>
              <th className="px-3 py-2 text-left">Purpose</th>
              <th className="px-3 py-2 text-left">Mode</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-left">Status</th>
              {cta ? <th className="px-3 py-2 text-right"></th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={cta ? 7 : 6} className="px-3 py-6 text-center text-ink-muted">Nothing here.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-3 py-2">{r.neededBy ?? "—"}</td>
                <td className="px-3 py-2">{r.payeeName}</td>
                <td className="px-3 py-2">{r.purpose}</td>
                <td className="px-3 py-2">{r.mode}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtINR(r.amount)}</td>
                <td className="px-3 py-2">{r.status}</td>
                {cta ? <td className="px-3 py-2 text-right whitespace-nowrap">{cta(r)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}
