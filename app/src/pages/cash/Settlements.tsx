// ============================================================================
// /cash/settlements — POS payouts received from Pinelabs / Razorpay / BMS /
// other non-cash processors.
//
// Accountant flow:
//   1. "+ New settlement" — pick payment method, settlement date,
//      bank account, expected amount; tick which closings this payout
//      covers (m:n). Creates a row with status='pending'.
//   2. When the bank credit lands, "Mark received" — enter received amount,
//      fee (defaults to expected − received), bank reference, upload the
//      payout slip. Trigger writes the bank-ledger row.
//
// Owner + manager can also create / mark. Cashier has no access.
// ============================================================================

import { useEffect, useMemo, useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field, Input, Select } from "../../components/ui/Input";
import { useSync } from "../../lib/hooks/SyncContext";
import { useCashRefs } from "../../lib/hooks/useCashRefs";
import { fmtINR } from "../../lib/dashboard";
import { todayIso, addDaysIso } from "../../lib/dates";
import {
  createPosSettlement,
  listClosings,
  listPosSettlements,
  markPosSettlementReceived,
  uploadCashSlip,
  type DailyCashClosing,
  type PosSettlement,
} from "../../lib/cash";

export default function CashSettlementsPage() {
  const { state }     = useSync();
  const refs          = useCashRefs();
  const cinemaId      = state.cinemaId;
  const role          = state.role;
  const canAct        = role === "owner" || role === "manager" || role === "accountant";

  const [rows, setRows]     = useState<PosSettlement[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    const list = await listPosSettlements({});
    setRows(list);
    setLoading(false);
  }
  useEffect(() => { void reload(); }, []);

  const nonCashMethods = useMemo(
    () => refs.paymentMethods.filter((m) => m.flowType !== "cash"),
    [refs.paymentMethods],
  );
  const methodName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of refs.paymentMethods) m.set(p.id, p.displayName);
    return (id: string) => m.get(id) ?? id;
  }, [refs.paymentMethods]);
  const bankName = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of refs.bankAccounts) m.set(b.id, b.name);
    return (id: string) => m.get(id) ?? id;
  }, [refs.bankAccounts]);

  // Splits.
  const pending  = useMemo(() => rows.filter((r) => r.status === "pending"), [rows]);
  const received = useMemo(() => rows.filter((r) => r.status === "received" || r.status === "reconciled"), [rows]);
  const disputed = useMemo(() => rows.filter((r) => r.status === "disputed"), [rows]);

  return (
    <div className="space-y-4 md:space-y-6">
      <Card>
        <CardHeader className="flex-wrap gap-2">
          <CardTitle>POS settlements</CardTitle>
        </CardHeader>
        {!cinemaId ? (
          <CardBody className="text-sm text-ink-muted">No cinema configured.</CardBody>
        ) : null}
      </Card>

      {err ? <div className="text-sm text-red-600">{err}</div> : null}

      {canAct && cinemaId ? (
        <NewSettlementForm
          cinemaId={cinemaId}
          nonCashMethods={nonCashMethods}
          bankAccounts={refs.bankAccounts}
          counters={refs.counters}
          onCreated={reload}
          onError={setErr}
        />
      ) : null}

      <Section
        title="Pending"
        rows={pending}
        loading={loading}
        canAct={canAct}
        methodName={methodName}
        bankName={bankName}
        onReceived={reload}
        onError={setErr}
        userEmail={state.email}
      />
      <Section
        title="Received"
        rows={received}
        loading={loading}
        methodName={methodName}
        bankName={bankName}
        onError={setErr}
        userEmail={state.email}
      />
      {disputed.length > 0 ? (
        <Section
          title="Disputed"
          rows={disputed}
          loading={loading}
          methodName={methodName}
          bankName={bankName}
          onError={setErr}
          userEmail={state.email}
        />
      ) : null}
    </div>
  );
}

// ── New-settlement form ────────────────────────────────────────────────

function NewSettlementForm({
  cinemaId,
  nonCashMethods,
  bankAccounts,
  counters,
  onCreated,
  onError,
}: {
  cinemaId: string;
  nonCashMethods: ReturnType<typeof useCashRefs>["paymentMethods"];
  bankAccounts: ReturnType<typeof useCashRefs>["bankAccounts"];
  counters: ReturnType<typeof useCashRefs>["counters"];
  onCreated: () => void;
  onError: (m: string) => void;
}) {
  const [methodId, setMethodId]   = useState<string>("");
  const [bankId, setBankId]       = useState<string>("");
  const [date, setDate]           = useState<string>(todayIso());
  const [dateTouched, setDateTouched] = useState(false);
  const [expected, setExpected]   = useState<string>("");
  const [reference, setRef]       = useState<string>("");
  const [closingIds, setClosingIds] = useState<string[]>([]);
  const [closings, setClosings]   = useState<DailyCashClosing[]>([]);
  const [busy, setBusy]           = useState(false);

  // Default method = first non-cash.
  useEffect(() => {
    if (!methodId && nonCashMethods.length > 0) setMethodId(nonCashMethods[0]!.id);
  }, [nonCashMethods, methodId]);
  // Default bank = the method's settlement bank, else primary, else first.
  useEffect(() => {
    if (bankId) return;
    const m = nonCashMethods.find((x) => x.id === methodId);
    if (m?.receivesIntoBank) {
      setBankId(m.receivesIntoBank);
      return;
    }
    const primary = bankAccounts.find((b) => b.isPrimary) ?? bankAccounts[0];
    if (primary) setBankId(primary.id);
  }, [methodId, nonCashMethods, bankAccounts, bankId]);

  // Pull recent closings (last 30 days) so the accountant can tick which
  // ones the payout covers. Showing all closings would scale poorly.
  useEffect(() => {
    let alive = true;
    const from = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    void listClosings({ from }).then((rs) => alive && setClosings(rs));
    return () => { alive = false; };
  }, []);

  // Sum expected from the selected closings' payment-method amounts so the
  // accountant has a starting value. Editable.
  useEffect(() => {
    if (!methodId) return;
    const sum = closings
      .filter((c) => closingIds.includes(c.id))
      .reduce((s, c) => {
        const row = c.paymentMethods.find((p) => p.paymentMethodId === methodId);
        return s + (row?.amount ?? 0);
      }, 0);
    if (sum > 0) setExpected(String(sum));
  }, [closingIds, closings, methodId]);

  // Autofill the expected payout date = latest selected closing's business
  // date + the method's settlement lag (T+N). Editable; stops overwriting
  // once the accountant changes the date by hand.
  useEffect(() => {
    if (dateTouched || !methodId) return;
    const selected = closings.filter((c) => closingIds.includes(c.id));
    if (selected.length === 0) return;
    const method = nonCashMethods.find((m) => m.id === methodId);
    if (!method) return;
    const latest = selected.reduce(
      (a, c) => (c.businessDate > a ? c.businessDate : a),
      selected[0]!.businessDate,
    );
    setDate(addDaysIso(latest, method.settlementDays ?? 0));
  }, [closingIds, closings, methodId, nonCashMethods, dateTouched]);

  async function submit() {
    if (!methodId || !bankId || !date) { onError("Fill method, bank, and date."); return; }
    const amt = Number(expected);
    if (!amt || amt < 0) { onError("Enter the expected amount."); return; }
    setBusy(true);
    try {
      await createPosSettlement({
        cinemaId,
        paymentMethodId: methodId,
        bankAccountId:   bankId,
        settlementDate:  date,
        expectedAmount:  amt,
        bankReference:   reference || null,
        closingIds,
      });
      setExpected(""); setRef(""); setClosingIds([]); setDateTouched(false);
      onCreated();
    } catch (e) { onError((e as Error).message); }
    finally    { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>New settlement</CardTitle></CardHeader>
      <CardBody className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Payment method">
            <Select value={methodId} onChange={(e) => setMethodId(e.target.value)}>
              {nonCashMethods.map((m) => (
                <option key={m.id} value={m.id}>{m.displayName}</option>
              ))}
            </Select>
          </Field>
          <Field label="Settlement date">
            <Input
              type="date"
              value={date}
              onChange={(e) => { setDate(e.target.value); setDateTouched(true); }}
            />
          </Field>
          <Field label="Bank account">
            <Select value={bankId} onChange={(e) => setBankId(e.target.value)}>
              {bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>{b.name}{b.isPrimary ? " · primary" : ""}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Expected amount (₹)">
            <Input type="number" inputMode="decimal" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </Field>
          <Field label="Bank reference (optional)">
            <Input value={reference} onChange={(e) => setRef(e.target.value)} />
          </Field>
        </div>
        <Field label="Closings this payout covers">
          <ClosingChecklist
            closings={closings}
            methodId={methodId}
            selected={closingIds}
            onChange={setClosingIds}
            counterName={(id) => counters.find((c) => c.id === id)?.name ?? null}
          />
        </Field>
        <div className="flex justify-end">
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? "Saving…" : "Create settlement"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function ClosingChecklist({
  closings,
  methodId,
  selected,
  onChange,
  counterName,
}: {
  closings: DailyCashClosing[];
  methodId: string;
  selected: string[];
  onChange: (next: string[]) => void;
  counterName: (id: string) => string | null;
}) {
  const sel = new Set(selected);
  function toggle(id: string) {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(Array.from(next));
  }
  if (closings.length === 0) {
    return <div className="text-xs text-ink-muted">No recent closings.</div>;
  }
  return (
    <div className="max-h-48 overflow-y-auto rounded border border-line divide-y divide-line">
      {closings.map((c) => {
        const amt = c.paymentMethods.find((p) => p.paymentMethodId === methodId)?.amount ?? 0;
        return (
          <label
            key={c.id}
            className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-paper"
          >
            <input
              type="checkbox"
              checked={sel.has(c.id)}
              onChange={() => toggle(c.id)}
            />
            <span className="flex-1">
              {c.businessDate}
              {counterName(c.posCounterId) ? ` · ${counterName(c.posCounterId)}` : ""} · {c.shift}
            </span>
            <span className="tabular-nums text-ink-muted text-xs">{fmtINR(amt)}</span>
          </label>
        );
      })}
    </div>
  );
}

// ── List sections + per-row mark-received form ────────────────────────

function Section({
  title, rows, loading, canAct, methodName, bankName, onReceived, onError, userEmail,
}: {
  title: string;
  rows: PosSettlement[];
  loading?: boolean;
  canAct?: boolean;
  methodName: (id: string) => string;
  bankName:   (id: string) => string;
  onReceived?: () => void;
  onError: (m: string) => void;
  userEmail: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <span className="text-xs text-ink-muted">{rows.length}</span>
      </CardHeader>
      <CardBody className="p-0">
        {loading ? (
          <div className="px-4 py-6 text-center text-ink-muted text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-ink-muted text-sm">Nothing here.</div>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <SettlementRow
                key={r.id}
                row={r}
                canAct={!!canAct}
                methodName={methodName}
                bankName={bankName}
                userEmail={userEmail}
                onReceived={onReceived}
                onError={onError}
              />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function SettlementRow({
  row,
  canAct,
  methodName,
  bankName,
  userEmail,
  onReceived,
  onError,
}: {
  row: PosSettlement;
  canAct: boolean;
  methodName: (id: string) => string;
  bankName:   (id: string) => string;
  userEmail: string | null;
  onReceived?: () => void;
  onError: (m: string) => void;
}) {
  const [editing, setEditing]   = useState(false);
  const [received, setReceived] = useState<string>(String(row.expectedAmount || ""));
  const [fee, setFee]           = useState<string>("0");
  const [ref, setRef]           = useState<string>(row.bankReference ?? "");
  const [file, setFile]         = useState<File | null>(null);
  const [busy, setBusy]         = useState(false);

  // Sync fee with received as the user types.
  function onReceivedChange(v: string) {
    setReceived(v);
    const r = Number(v) || 0;
    const calcFee = Math.max(row.expectedAmount - r, 0);
    setFee(String(calcFee));
  }

  async function submit() {
    if (!userEmail) return;
    const rAmt = Number(received);
    if (!rAmt && rAmt !== 0) { onError("Enter the received amount."); return; }
    setBusy(true);
    try {
      let url: string | null = null;
      if (file) url = await uploadCashSlip(file, userEmail);
      await markPosSettlementReceived(row.id, userEmail, {
        receivedAmount: rAmt,
        feeAmount:      Number(fee) || 0,
        bankReference:  ref || null,
        slipUrl:        url ?? row.slipUrl ?? null,
      });
      setEditing(false);
      onReceived?.();
    } catch (e) { onError((e as Error).message); }
    finally    { setBusy(false); }
  }

  return (
    <li className="px-4 py-3 space-y-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {methodName(row.paymentMethodId)} · {row.settlementDate}
          </div>
          <div className="text-xs text-ink-muted">
            {bankName(row.bankAccountId)}
            {row.bankReference ? ` · ${row.bankReference}` : ""}
            {row.closingIds.length > 0 ? ` · ${row.closingIds.length} closing${row.closingIds.length === 1 ? "" : "s"}` : ""}
          </div>
        </div>
        {canAct && row.status === "pending" ? (
          <Button size="sm" onClick={() => setEditing((p) => !p)}>
            {editing ? "Cancel" : "Mark received"}
          </Button>
        ) : null}
        {row.slipUrl ? (
          <a className="text-amber-600 text-xs underline self-center" href={row.slipUrl} target="_blank" rel="noreferrer">
            View slip
          </a>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-xs">
        <span className="text-ink-muted">Expected</span>
        <span className="text-right tabular-nums">{fmtINR(row.expectedAmount)}</span>
        <span></span>
        <span className="text-ink-muted">Received</span>
        <span className="text-right tabular-nums">{row.status === "received" || row.status === "reconciled" ? fmtINR(row.receivedAmount) : "—"}</span>
        <span className="text-right text-ink-muted">{row.status === "received" || row.status === "reconciled" ? `fee ${fmtINR(row.feeAmount)}` : ""}</span>
      </div>

      {editing ? (
        <div className="rounded border border-line bg-paper p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Received amount (₹)">
              <Input type="number" inputMode="decimal" value={received} onChange={(e) => onReceivedChange(e.target.value)} />
            </Field>
            <Field label="Fee (₹)">
              <Input type="number" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
            </Field>
            <Field label="Bank reference">
              <Input value={ref} onChange={(e) => setRef(e.target.value)} />
            </Field>
          </div>
          <Field label="Settlement slip">
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm"
            />
            {file ? <div className="text-xs text-ink-muted mt-1 truncate">{file.name}</div> : null}
          </Field>
          <div className="flex justify-end">
            <Button size="sm" disabled={busy} onClick={() => void submit()}>
              {busy ? "Saving…" : "Confirm received"}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
