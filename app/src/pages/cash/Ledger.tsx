// ============================================================================
// /cash/ledger — bank ledger viewer for one account at a time.
//
// Receipts auto-fill from cash deposit triggers (cash closings) and payment
// triggers (payment requests). Inter-unit transfers are composed manually.
// Running balance is computed client-side — keeps the schema simple.
// ============================================================================

import { useEffect, useMemo, useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field, Input, Select } from "../../components/ui/Input";
import { useSync } from "../../lib/hooks/SyncContext";
import { useCashRefs } from "../../lib/hooks/useCashRefs";
import { fmtINR } from "../../lib/dashboard";
import { todayIso } from "../../lib/dates";
import {
  createInterUnitTransfer,
  listLedgerEntries,
  runningBalance,
  type BankLedgerEntry,
} from "../../lib/cash";

export default function CashLedgerPage() {
  const { state }                 = useSync();
  const refs                      = useCashRefs();
  const [accountId, setAccountId] = useState<string>("");
  const [rows, setRows]           = useState<BankLedgerEntry[]>([]);
  const [from, setFrom]           = useState(firstOfMonth());
  const [to, setTo]               = useState(todayIso());
  const [err, setErr]             = useState<string | null>(null);

  useEffect(() => {
    if (!accountId && refs.bankAccounts.length > 0) {
      setAccountId(refs.bankAccounts[0]?.id ?? "");
    }
  }, [refs.bankAccounts, accountId]);

  async function reload() {
    if (!accountId) return;
    const r = await listLedgerEntries(accountId, from, to);
    setRows(r);
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [accountId, from, to]);

  const account  = refs.bankAccounts.find((a) => a.id === accountId);
  const withBal  = useMemo(
    () => runningBalance(account?.openingBalance ?? 0, rows),
    [rows, account?.openingBalance],
  );
  const totals = useMemo(() => {
    let recv = 0, pay = 0;
    for (const e of rows) { recv += e.receiptAmount; pay += e.paymentAmount; }
    return { recv, pay };
  }, [rows]);

  // ── Inter-unit transfer composer ─────────────────────────────────────
  const [tfTo, setTfTo]         = useState<string>("");
  const [tfAmount, setTfAmount] = useState("");
  const [tfNote, setTfNote]     = useState("");
  const [tfBusy, setTfBusy]     = useState(false);

  async function transfer() {
    if (!state.email || !accountId || !tfTo) return;
    const amt = Number(tfAmount);
    if (!amt || amt <= 0) { setErr("Enter an amount."); return; }
    setTfBusy(true); setErr(null);
    try {
      await createInterUnitTransfer({
        fromBankAccountId: accountId,
        toBankAccountId: tfTo,
        amount: amt,
        entryDate: todayIso(),
        narration: tfNote || "Inter-unit transfer",
        createdBy: state.email,
      });
      setTfAmount(""); setTfNote(""); setTfTo("");
      await reload();
    } catch (e) { setErr((e as Error).message); }
    finally    { setTfBusy(false); }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Bank ledger</CardTitle></CardHeader>
        <CardBody className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Field label="Account">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {refs.bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <Tile label="Opening"  value={fmtINR(account?.openingBalance ?? 0)} />
        <Tile label="Receipts" value={fmtINR(totals.recv)} accent="good" />
        <Tile label="Payments" value={fmtINR(totals.pay)}  accent="bad" />
      </div>

      {err ? <div className="text-sm text-red-600">{err}</div> : null}

      <Card>
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Narration</th>
                <th className="px-3 py-2 text-left">Source</th>
                <th className="px-3 py-2 text-right">Receipt</th>
                <th className="px-3 py-2 text-right">Payment</th>
                <th className="px-3 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {withBal.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-muted">No entries.</td></tr>
              ) : withBal.map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td className="px-3 py-2">{e.entryDate}</td>
                  <td className="px-3 py-2">{e.narration}</td>
                  <td className="px-3 py-2 text-xs text-ink-muted">{e.sourceKind}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {e.receiptAmount > 0 ? fmtINR(e.receiptAmount) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {e.paymentAmount > 0 ? fmtINR(e.paymentAmount) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtINR(e.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Inter-unit transfer</CardTitle></CardHeader>
        <CardBody className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Field label="To account">
            <Select value={tfTo} onChange={(e) => setTfTo(e.target.value)}>
              <option value="">—</option>
              {refs.bankAccounts.filter((a) => a.id !== accountId).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Amount (₹)">
            <Input type="number" inputMode="decimal" value={tfAmount} onChange={(e) => setTfAmount(e.target.value)} />
          </Field>
          <Field label="Narration">
            <Input value={tfNote} onChange={(e) => setTfNote(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button disabled={tfBusy || !tfTo} onClick={() => void transfer()}>Transfer</Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function Tile({ label, value, accent }:
  { label: string; value: string; accent?: "good" | "bad" }) {
  const color =
    accent === "good" ? "text-emerald-600"
    : accent === "bad" ? "text-red-600"
    : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-paper-card p-3">
      <div className="text-xs uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`mt-1 font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
