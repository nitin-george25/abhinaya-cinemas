// ============================================================================
// /payments/batch/new — raise several invoices for one payee in a single pass
// (payments_100).
//
// The motion: an employee hands in a month of reimbursement bills, or a sundry
// creditor's invoices have piled up. Rather than walking Make-a-Payment six
// times and then hunting the six rows down in the inbox, this collects the payee
// once and the invoices as lines.
//
// What it builds is exactly what the inbox's "Pay together" builds — a batch
// with N payment_requests hanging off it — so there is one lifecycle, one set of
// RPCs and one drawer behind both doors. Each line is still a real, separately
// typed payment: its own accounting head, its own invoice file, its own Zoho
// push. What they share is the approval, the OTP, the transfer and the receipt.
//
// Payee scope: the parties catalog (vendors, employees, others). Distributor
// share remittances are settled from the box office, never batched here — the
// same rule the single-payment form follows.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field, Input, Select, SearchSelect } from "../../components/ui/Input";
import { MoneyInput } from "../../components/payments/MoneyInput";
import { useSync } from "../../lib/hooks/SyncContext";
import { useCashRefs } from "../../lib/hooks/useCashRefs";
import { listParties, createParty, type Party } from "../../lib/cash";
import { fmtINR } from "../../lib/dashboard";
import {
  listPaymentTypes,
  createPayment,
  createBatch,
  addToBatch,
  submitBatch,
  postBatchCard,
  uploadPaymentFile,
  extractInvoice,
  type PaymentType,
} from "../../lib/payments";
import type { PaymentRequestMode } from "../../lib/db-types";

interface LineDraft {
  key:       number;          // stable react key; lines are added/removed freely
  typeId:    string;
  amount:    string;
  note:      string;
  file:      File | null;
  reading:   boolean;         // invoice extraction in flight
  autofilled: boolean;
}

let nextKey = 1;
function blankLine(typeId = ""): LineDraft {
  return { key: nextKey++, typeId, amount: "", note: "", file: null, reading: false, autofilled: false };
}

export default function PaymentsCreateBatchPage() {
  const { state } = useSync();
  const refs = useCashRefs();
  const navigate = useNavigate();
  const role = state.role;
  const canRaise = role === "owner" || role === "manager" || role === "accountant";

  const [types, setTypes] = useState<PaymentType[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneId, setDoneId] = useState<string | null>(null);
  const [doneOutcome, setDoneOutcome] = useState<"approved" | "awaiting_approval" | null>(null);

  // Header
  const [unitId, setUnitId] = useState("");
  const [bankId, setBankId] = useState("");
  const [mode, setMode] = useState<PaymentRequestMode>("bank_transfer");
  const [partyId, setPartyId] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [note, setNote] = useState("");

  // Lines — two to start, because one invoice is not a batch.
  const [lines, setLines] = useState<LineDraft[]>([blankLine(), blankLine()]);

  useEffect(() => {
    if (!refs.cinemaId) return;
    let alive = true;
    void listPaymentTypes(refs.cinemaId, { activeOnly: true }).then((t) => alive && setTypes(t));
    void listParties(refs.cinemaId).then((p) => alive && setParties(p));
    return () => { alive = false; };
  }, [refs.cinemaId]);

  // Settlement-backed and asset types are out: the first is initiated from the
  // box office, the second must gather quotations before any money moves.
  const pickableTypes = useMemo(
    () => types.filter((t) => t.invoiceRule !== "settlement" && !t.isAsset),
    [types],
  );

  // Default the unit, then its pay-from account and mode.
  useEffect(() => {
    if (!unitId && refs.units.length > 0) setUnitId(refs.units[0]?.id ?? "");
  }, [refs.units, unitId]);
  useEffect(() => {
    if (!unitId || refs.units.length === 0) return;
    const unit = refs.units.find((u) => u.id === unitId);
    const fallback = refs.bankAccounts.find((b) => b.isPrimary) ?? refs.bankAccounts[0];
    setBankId(unit?.defaultBankAccountId ?? fallback?.id ?? "");
    setMode(unit?.defaultPaymentMode ?? "bank_transfer");
  }, [unitId, refs.units, refs.bankAccounts]);

  // ── add-new payee (inline, same shape as Make-a-Payment) ──────────────────
  const [addingPayee, setAddingPayee] = useState(false);
  const [newName, setNewName] = useState("");
  const [newLast4, setNewLast4] = useState("");
  const [newIfsc, setNewIfsc] = useState("");

  async function addPayee() {
    if (!refs.cinemaId || !state.email) return;
    if (!newName.trim()) { setErr("Enter the payee name."); return; }
    setBusy(true); setErr(null);
    try {
      const id = await createParty(
        {
          cinemaId: refs.cinemaId,
          name: newName.trim(),
          partyType: "vendor",
          category: "Vendor",
          accountLast4: newLast4 || null,
          ifsc: newIfsc || null,
        },
        state.email,
      );
      setParties(await listParties(refs.cinemaId));
      setPartyId(id);
      setAddingPayee(false);
      setNewName(""); setNewLast4(""); setNewIfsc("");
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  // ── line helpers ──────────────────────────────────────────────────────────
  function patchLine(key: number, p: Partial<LineDraft>) {
    setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...p } : l)));
  }

  /** Read the invoice and pre-fill this line's amount/note. Best-effort. */
  async function onLineFile(key: number, file: File | null) {
    patchLine(key, { file, autofilled: false });
    if (!file) return;
    patchLine(key, { reading: true });
    try {
      const ex = await extractInvoice(file);
      if (ex) {
        setLines((cur) => cur.map((l) => {
          if (l.key !== key) return l;
          const label = [ex.vendor, ex.invoiceNo].filter(Boolean).join(" · ");
          return {
            ...l,
            amount: l.amount || (ex.total != null ? String(ex.total) : ""),
            note: l.note || label,
            autofilled: true,
          };
        }));
      }
    } finally { patchLine(key, { reading: false }); }
  }

  const selectedParty = parties.find((p) => p.id === partyId) ?? null;
  const total = lines.reduce((a, l) => a + (Number(l.amount) || 0), 0);

  function problem(): string | null {
    if (!unitId) return "Pick an operating unit.";
    if (!selectedParty) return "Pick or add the payee.";
    if (lines.length < 2) return "A batch needs at least two invoices.";
    for (const [i, l] of lines.entries()) {
      const t = types.find((x) => x.id === l.typeId);
      if (!t) return `Line ${i + 1}: pick a payment type.`;
      if (!(Number(l.amount) > 0)) return `Line ${i + 1}: enter a positive amount.`;
      if (t.invoiceRule === "required" && !l.file) return `Line ${i + 1}: attach the invoice.`;
    }
    return null;
  }

  /**
   * Build the batch, then every line as a real payment attached to it, then
   * submit. The batch is created FIRST so a line that fails validation leaves a
   * draft batch the accountant can finish, rather than orphaned payments.
   */
  async function save(submit: boolean) {
    const p = problem();
    if (p) { setErr(p); return; }
    if (!refs.cinemaId || !state.email || !selectedParty) return;
    setBusy(true); setErr(null); setWarn(null);
    try {
      const batchId = await createBatch({
        operatingUnitId: unitId,
        payeeName: selectedParty.name,
        payeePartyId: selectedParty.id,
        payeeAccountLast4: selectedParty.accountLast4 ?? null,
        payeeIfsc: selectedParty.ifsc ?? null,
        bankAccountId: bankId || null,
        mode,
        note: note || null,
        neededBy: neededBy || null,
      });

      for (const l of lines) {
        const type = types.find((x) => x.id === l.typeId)!;
        const invoiceUrl = l.file ? await uploadPaymentFile(l.file, state.email) : null;
        const paymentId = await createPayment({
          operatingUnitId:   unitId,
          paymentTypeId:     type.id,
          bankAccountId:     bankId || null,
          payeeName:         selectedParty.name,
          payeePartyId:      selectedParty.id,
          payeeAccountLast4: selectedParty.accountLast4 ?? null,
          payeeIfsc:         selectedParty.ifsc ?? null,
          amount:            Number(l.amount),
          mode,
          invoiceUrl,
          neededBy:          neededBy || null,
          note:              l.note || null,
          typeName:          type.name,
          requestedByEmail:  state.email,
          status:            "draft",
        });
        await addToBatch(batchId, paymentId);
      }

      if (!submit) { navigate("/payments"); return; }

      const outcome = await submitBatch(batchId);
      if (outcome === "awaiting_approval") {
        const slackErr = await postBatchCard(batchId, `${window.location.origin}/payments`);
        if (slackErr) setWarn(`Submitted, but the Slack approval card didn't go out: ${slackErr}`);
      }
      setDoneOutcome(outcome);
      setDoneId(batchId);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  if (!canRaise) {
    return (
      <Card>
        <CardBody className="py-10 text-center text-ink-muted">
          You don't have permission to raise payments.
        </CardBody>
      </Card>
    );
  }

  if (doneId) {
    return (
      <Card className="mx-auto max-w-[760px]">
        <CardBody className="space-y-4 py-10 text-center">
          <h2 className="font-display text-2xl uppercase tracking-tight">Batch raised</h2>
          <p className="text-sm text-ink-muted">
            {lines.length} invoices for {selectedParty?.name} — {fmtINR(total, 2)}.{" "}
            {doneOutcome === "approved"
              ? "Every invoice was already approved, so it is ready to pay."
              : "It is now with the owner as a single approval."}
          </p>
          {warn ? <p className="text-sm text-amber-700">{warn}</p> : null}
          <div className="flex justify-center gap-2">
            <Link to="/payments"><Button>Go to payments</Button></Link>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-[860px] space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl uppercase tracking-tight">Pay several invoices</h2>
          <p className="text-sm text-ink-muted">
            One payee, many invoices, one transfer — one approval and one receipt for the lot.
          </p>
        </div>
      </div>

      {err ? <div className="text-sm text-red-600">{err}</div> : null}
      {warn ? <div className="text-sm text-amber-700">{warn}</div> : null}

      {/* Payee + disbursement */}
      <Card>
        <CardHeader><CardTitle>Who is being paid</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <div className="space-y-2">
            <Field label="Payee">
              <SearchSelect
                value={partyId}
                onChange={setPartyId}
                options={parties.map((p) => ({ value: p.id, label: p.name }))}
                placeholder="Search payees…"
              />
            </Field>
            {!addingPayee ? (
              <button
                type="button"
                className="text-xs font-medium text-amber-700 hover:underline"
                onClick={() => setAddingPayee(true)}
              >
                + Add a new payee
              </button>
            ) : (
              <div className="space-y-2 rounded-lg border border-line bg-paper p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Field label="Name">
                    <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
                  </Field>
                  <Field label="A/c last 4">
                    <Input value={newLast4} onChange={(e) => setNewLast4(e.target.value)} />
                  </Field>
                  <Field label="IFSC">
                    <Input value={newIfsc} onChange={(e) => setNewIfsc(e.target.value)} />
                  </Field>
                </div>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setAddingPayee(false)}>Cancel</Button>
                  <Button size="sm" disabled={busy} onClick={() => void addPayee()}>Add payee</Button>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Operating unit">
              <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                {refs.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
            <Field label="Paid from (bank account)">
              <Select value={bankId} onChange={(e) => setBankId(e.target.value)}>
                <option value="">—</option>
                {refs.bankAccounts.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}{b.isPrimary ? " · primary" : ""}</option>
                ))}
              </Select>
            </Field>
            <Field label="Mode">
              <Select value={mode} onChange={(e) => setMode(e.target.value as PaymentRequestMode)}>
                <option value="bank_transfer">Bank transfer</option>
                <option value="cheque">Cheque</option>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
              </Select>
            </Field>
            <Field label="Needed by (optional)">
              <Input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
            </Field>
          </div>

          <Field label="What is this batch for (optional)">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. July reimbursements"
            />
          </Field>
        </CardBody>
      </Card>

      {/* Lines */}
      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
          <span className="font-mono text-sm tabular-nums text-ink-muted">{fmtINR(total, 2)}</span>
        </CardHeader>
        <CardBody className="space-y-3">
          {pickableTypes.length === 0 ? (
            <div className="py-6 text-center text-sm text-ink-muted">
              No payment types configured yet. Ask the owner to set them up in
              Settings → Payment Types.
            </div>
          ) : null}

          {lines.map((l, i) => {
            const type = types.find((t) => t.id === l.typeId) ?? null;
            return (
              <div key={l.key} className="space-y-3 rounded-lg border border-line bg-paper p-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Invoice {i + 1}
                  </div>
                  {lines.length > 2 ? (
                    <button
                      type="button"
                      className="text-xs text-ink-muted hover:text-red-600"
                      onClick={() => setLines((cur) => cur.filter((x) => x.key !== l.key))}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Type">
                    <Select
                      value={l.typeId}
                      onChange={(e) => patchLine(l.key, { typeId: e.target.value })}
                    >
                      <option value="">—</option>
                      {pickableTypes.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </Select>
                    {type ? (
                      <div className="mt-1 text-xs text-ink-muted">{type.accountingHead}</div>
                    ) : null}
                  </Field>
                  <Field label="Amount">
                    <MoneyInput value={l.amount} onChange={(v) => patchLine(l.key, { amount: v })} />
                  </Field>
                </div>

                <Field
                  label={type?.invoiceRule === "required" ? "Invoice (required)" : "Invoice / bill"}
                >
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => void onLineFile(l.key, e.target.files?.[0] ?? null)}
                    className="block w-full text-sm"
                  />
                  {l.file ? <div className="mt-1 truncate text-xs text-ink-muted">{l.file.name}</div> : null}
                  {l.reading ? (
                    <div className="mt-1 text-xs text-ink-muted">Reading invoice…</div>
                  ) : l.autofilled ? (
                    <div className="mt-1 text-xs text-amber-700">Auto-filled from invoice — review it.</div>
                  ) : null}
                </Field>

                <Field label="Note (optional)">
                  <Input
                    value={l.note}
                    onChange={(e) => patchLine(l.key, { note: e.target.value })}
                    placeholder="What this bill is for"
                  />
                </Field>
              </div>
            );
          })}

          <div>
            <Button
              variant="secondary"
              onClick={() => setLines((cur) => [...cur, blankLine(cur[cur.length - 1]?.typeId ?? "")])}
            >
              + Add another invoice
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Save */}
      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-ink-muted">
            {lines.length} invoice{lines.length === 1 ? "" : "s"} ·{" "}
            <span className="font-mono tabular-nums text-ink">{fmtINR(total, 2)}</span> in one transfer
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => void save(false)}>
              {busy ? "Saving…" : "Save as draft"}
            </Button>
            <Button disabled={busy} onClick={() => void save(true)}>
              {busy ? "Submitting…" : "Submit for approval"}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
