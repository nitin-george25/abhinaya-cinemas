// ============================================================================
// /payments/create — the typed "Make a Payment" form (unified Payments, S2).
//
// One entry that adapts to the chosen type (progressive disclosure):
//   Step 1  Type      — grouped taxonomy picker (§5). Settlement-backed types
//                       (distributor share remittance) are excluded — those are
//                       initiated from the box-office settlement (§13-a).
//   Step 2  Details   — payee category (auto-set chip), payee (distributors for
//                       share types, parties otherwise, + add-new), amount,
//                       invoice (hidden when exempt), advance toggle + link
//                       target, paid-from bank account, needed-by, note.
//   Step 3  Review    — summary + Save draft / Submit for approval.
//
// Phase 1 has no inbox or Slack yet: "Submit" creates the row as 'pending' so it
// flows into the existing /cash/payments approval queue; "Save draft" parks it
// as 'draft' for the phase-2 inbox. Both write the typed columns added in
// migrations payments_01..03.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Field, Input, Select, SearchSelect } from "../../components/ui/Input";
import { Stepper } from "../../components/payments/Stepper";
import { TypePicker } from "../../components/payments/TypePicker";
import { MoneyInput } from "../../components/payments/MoneyInput";
import { useSync } from "../../lib/hooks/SyncContext";
import { useCashRefs } from "../../lib/hooks/useCashRefs";
import { listParties, createParty, type Party, type PartyType } from "../../lib/cash";
import { fmtINR } from "../../lib/dashboard";
import {
  listPaymentTypes,
  createPayment,
  createProforma,
  uploadPaymentFile,
  usesDistributorPayee,
  usesNoPayee,
  PAYEE_CATEGORY_LABEL,
  type PaymentType,
} from "../../lib/payments";

const STEPS = ["Type", "Details", "Review"];

/** Map a payment-type payee category to the parties catalog party_type. */
function partyTypeFor(t: PaymentType): PartyType {
  switch (t.payeeCategory) {
    case "employee": return "employee";
    case "vendor":   return "vendor";
    default:         return "other";
  }
}

export default function PaymentsCreatePage() {
  const { state } = useSync();
  const refs = useCashRefs();
  const role = state.role;
  const canRaise = role === "owner" || role === "manager" || role === "accountant";

  const distributors = state.appState?.distributors ?? [];
  const movies = state.appState?.movies ?? [];

  // ── data ────────────────────────────────────────────────────────────────
  const [types, setTypes] = useState<PaymentType[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  useEffect(() => {
    if (!refs.cinemaId) return;
    let alive = true;
    void listPaymentTypes(refs.cinemaId, { activeOnly: true }).then((t) => alive && setTypes(t));
    void listParties(refs.cinemaId).then((p) => alive && setParties(p));
    return () => { alive = false; };
  }, [refs.cinemaId]);

  // Settlement-backed types are initiated from the box-office settlement (§13-a).
  const pickableTypes = useMemo(
    () => types.filter((t) => t.invoiceRule !== "settlement"),
    [types],
  );

  // ── form state ────────────────────────────────────────────────────────────
  const [step, setStep] = useState(1);
  const [typeId, setTypeId] = useState<string | null>(null);
  const type = useMemo(() => types.find((t) => t.id === typeId) ?? null, [types, typeId]);

  const [unitId, setUnitId] = useState("");
  const [bankId, setBankId] = useState("");
  const [partyId, setPartyId] = useState("");
  const [distributorId, setDistributorId] = useState("");
  const [amount, setAmount] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [note, setNote] = useState("");
  const [invoice, setInvoice] = useState<File | null>(null);

  const [isAdvance, setIsAdvance] = useState(false);
  const [advanceMovieId, setAdvanceMovieId] = useState("");
  const [proforma, setProforma] = useState<File | null>(null);

  const [busy, setBusy] = useState(false);

  // Default the operating unit + bank account once refs load.
  useEffect(() => {
    if (!unitId && refs.units.length > 0) setUnitId(refs.units[0]?.id ?? "");
  }, [refs.units, unitId]);
  useEffect(() => {
    if (bankId || refs.bankAccounts.length === 0) return;
    const primary = refs.bankAccounts.find((b) => b.isPrimary) ?? refs.bankAccounts[0];
    if (primary) setBankId(primary.id);
  }, [refs.bankAccounts, bankId]);

  // Distributor-payee types are advances by nature (#2 Distributor advance/MG).
  useEffect(() => {
    if (type && type.payeeCategory === "distributor") setIsAdvance(true);
  }, [type]);

  // ── add-new payee (inline) ────────────────────────────────────────────────
  const [addingPayee, setAddingPayee] = useState(false);
  const [newName, setNewName] = useState("");
  const [newLast4, setNewLast4] = useState("");
  const [newIfsc, setNewIfsc] = useState("");

  async function addPayee() {
    if (!refs.cinemaId || !state.email || !type) return;
    if (!newName.trim()) { setErr("Enter the payee name."); return; }
    setBusy(true); setErr(null);
    try {
      const id = await createParty(
        {
          cinemaId: refs.cinemaId,
          name: newName.trim(),
          partyType: partyTypeFor(type),
          category: PAYEE_CATEGORY_LABEL[type.payeeCategory],
          accountLast4: newLast4 || null,
          ifsc: newIfsc || null,
        },
        state.email,
      );
      const fresh = await listParties(refs.cinemaId);
      setParties(fresh);
      setPartyId(id);
      setAddingPayee(false);
      setNewName(""); setNewLast4(""); setNewIfsc("");
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  // ── derived ───────────────────────────────────────────────────────────────
  const invoiceRequired = type?.invoiceRule === "required";
  const needsPayee = type ? !usesNoPayee(type) : false;
  const useDistributor = type ? usesDistributorPayee(type) : false;
  const selectedParty = parties.find((p) => p.id === partyId) ?? null;
  const selectedDistributor = distributors.find((d) => d.id === distributorId) ?? null;
  const payeeName = useDistributor
    ? (selectedDistributor?.name ?? "")
    : (selectedParty?.name ?? "");

  function detailsComplete(): string | null {
    if (!type) return "Pick a payment type.";
    if (!unitId) return "Pick an operating unit.";
    if (!(Number(amount) > 0)) return "Enter a positive amount.";
    if (needsPayee && !payeeName) return "Pick or add a payee.";
    if (useDistributor && isAdvance && !advanceMovieId) return "Pick the movie this advance is for.";
    return null;
  }

  async function submit(asDraft: boolean) {
    const problem = detailsComplete();
    if (problem) { setErr(problem); return; }
    if (!asDraft && invoiceRequired && !invoice) {
      setErr("Attach the invoice for this payment (or save it as a draft).");
      return;
    }
    if (!refs.cinemaId || !state.email || !type) return;
    setBusy(true); setErr(null);
    try {
      let invoiceUrl: string | null = null;
      if (invoice) invoiceUrl = await uploadPaymentFile(invoice, state.email);

      // Vendor advance with a proforma → store it as a first-class artifact.
      let advanceProformaId: string | null = null;
      let proformaUrl: string | null = null;
      if (isAdvance && !useDistributor && proforma) {
        proformaUrl = await uploadPaymentFile(proforma, state.email);
        advanceProformaId = await createProforma({
          cinemaId: refs.cinemaId,
          partyId: partyId || null,
          fileUrl: proformaUrl,
          amount: Number(amount),
          createdBy: state.email,
        });
      }

      const id = await createPayment({
        operatingUnitId: unitId,
        paymentTypeId: type.id,
        bankAccountId: bankId || null,
        payeeName,
        payeePartyId: useDistributor ? null : (partyId || null),
        payeeDistributorId: useDistributor ? (distributorId || null) : null,
        payeeAccountLast4: selectedParty?.accountLast4 ?? null,
        payeeIfsc: selectedParty?.ifsc ?? null,
        amount: Number(amount),
        invoiceUrl,
        isAdvance,
        advanceMovieId: useDistributor && isAdvance ? (advanceMovieId || null) : null,
        advanceProformaId,
        advancePartyId: isAdvance && !useDistributor ? (partyId || null) : null,
        proformaUrl,
        neededBy: neededBy || null,
        note: note || null,
        typeName: type.name,
        requestedByEmail: state.email,
        status: asDraft ? "draft" : "pending",
      });
      setCreatedId(id);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  function resetForm() {
    setCreatedId(null); setStep(1); setTypeId(null);
    setPartyId(""); setDistributorId(""); setAmount(""); setNeededBy("");
    setNote(""); setInvoice(null); setIsAdvance(false); setAdvanceMovieId("");
    setProforma(null); setErr(null);
  }

  // ── permission denied ──────────────────────────────────────────────────────
  if (!canRaise) {
    return (
      <Card>
        <CardBody className="py-10 text-center text-ink-muted">
          You don't have permission to raise payments.
        </CardBody>
      </Card>
    );
  }

  // ── success ────────────────────────────────────────────────────────────────
  if (createdId) {
    return (
      <Card className="mx-auto max-w-[760px]">
        <CardBody className="space-y-4 py-10 text-center">
          <h2 className="font-display text-2xl uppercase tracking-tight">Payment saved</h2>
          <p className="text-sm text-ink-muted">
            Reference <span className="font-mono">{createdId.slice(0, 8)}</span> — it now sits in
            the approval queue.
          </p>
          <div className="flex justify-center gap-2">
            <Button variant="secondary" onClick={resetForm}>Make another</Button>
            <Link to="/cash/payments"><Button>Go to payments</Button></Link>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-[760px] space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl uppercase tracking-tight">Make a Payment</h2>
        <Stepper step={step} labels={STEPS} />
      </div>

      {err ? <div className="text-sm text-red-600">{err}</div> : null}

      {/* ── Step 1 — Type ─────────────────────────────────────────────────── */}
      {step === 1 ? (
        <Card>
          <CardHeader><CardTitle>Choose a payment type</CardTitle></CardHeader>
          <CardBody>
            {pickableTypes.length === 0 ? (
              <div className="py-6 text-center text-sm text-ink-muted">
                No payment types configured yet. Ask the owner to set them up in
                Settings → Payment Types.
              </div>
            ) : (
              <TypePicker types={pickableTypes} value={typeId} onChange={setTypeId} />
            )}
            <div className="mt-5 flex justify-end">
              <Button disabled={!typeId} onClick={() => { setErr(null); setStep(2); }}>
                Continue
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* ── Step 2 — Details ──────────────────────────────────────────────── */}
      {step === 2 && type ? (
        <Card>
          <CardHeader>
            <CardTitle>{type.name}</CardTitle>
            <Badge tone="neutral">{PAYEE_CATEGORY_LABEL[type.payeeCategory]}</Badge>
          </CardHeader>
          <CardBody className="space-y-4">
            {type.isAsset ? (
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                This is an asset purchase — it needs quotations approved before payment.
                Quotation handling arrives with the asset flow; for now you can park a draft.
              </div>
            ) : null}

            {/* Payee */}
            {needsPayee ? (
              useDistributor ? (
                <Field label="Distributor (payee)">
                  <SearchSelect
                    value={distributorId}
                    onChange={setDistributorId}
                    options={distributors.map((d) => ({ value: d.id, label: d.name }))}
                    placeholder="Search distributors…"
                  />
                </Field>
              ) : (
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
              )
            ) : (
              <div className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink-muted">
                Internal transfer to our own till — no external payee.
              </div>
            )}

            {/* Amount + needed-by */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Amount">
                <MoneyInput value={amount} onChange={setAmount} />
              </Field>
              <Field label="Needed by (optional)">
                <Input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
              </Field>
            </div>

            {/* Advance */}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isAdvance}
                disabled={useDistributor}
                onChange={(e) => setIsAdvance(e.target.checked)}
              />
              This is an advance
              {useDistributor ? (
                <span className="text-xs text-ink-muted">(distributor advances are always advances)</span>
              ) : null}
            </label>
            {isAdvance && useDistributor ? (
              <Field label="Movie (advance is tagged to this film)">
                <SearchSelect
                  value={advanceMovieId}
                  onChange={setAdvanceMovieId}
                  options={movies.map((m) => ({ value: m.id, label: m.name }))}
                  placeholder="Search movies…"
                />
              </Field>
            ) : null}
            {isAdvance && !useDistributor ? (
              <Field label="Proforma invoice (optional)">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setProforma(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm"
                />
                {proforma ? <div className="mt-1 truncate text-xs text-ink-muted">{proforma.name}</div> : null}
              </Field>
            ) : null}

            {/* Invoice (hidden when exempt) */}
            {type.invoiceRule !== "exempt" ? (
              <Field label={invoiceRequired ? "Invoice (required to submit)" : "Invoice / statement"}>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setInvoice(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm"
                />
                {invoice ? <div className="mt-1 truncate text-xs text-ink-muted">{invoice.name}</div> : null}
              </Field>
            ) : null}

            {/* Paid-from + unit */}
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
            </div>

            <Field label="Note (optional)">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is this for?" />
            </Field>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <Button
                onClick={() => {
                  const problem = detailsComplete();
                  if (problem) { setErr(problem); return; }
                  setErr(null); setStep(3);
                }}
              >
                Review
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* ── Step 3 — Review ───────────────────────────────────────────────── */}
      {step === 3 && type ? (
        <Card>
          <CardHeader><CardTitle>Review &amp; submit</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <dl className="divide-y divide-line text-sm">
              <Row label="Type" value={type.name} />
              <Row label="Accounting head" value={type.accountingHead} />
              <Row label="Payee" value={needsPayee ? (payeeName || "—") : "Internal (own till)"} />
              <Row label="Amount" value={fmtINR(Number(amount), 2)} mono />
              {isAdvance ? <Row label="Advance" value="Yes" /> : null}
              {neededBy ? <Row label="Needed by" value={neededBy} /> : null}
              <Row
                label="Invoice"
                value={invoice ? invoice.name : (type.invoiceRule === "exempt" ? "Not required" : "Not attached")}
              />
              {note ? <Row label="Note" value={note} /> : null}
            </dl>

            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => void submit(true)}>
                  {busy ? "Saving…" : "Save draft"}
                </Button>
                <Button disabled={busy} onClick={() => void submit(false)}>
                  {busy ? "Submitting…" : "Submit for approval"}
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={mono ? "font-mono tabular-nums" : "text-right"}>{value}</dd>
    </div>
  );
}
