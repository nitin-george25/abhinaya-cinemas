// ============================================================================
// /cash/petty/mine — cashier landing.
//
// Lets a cashier raise a petty-expense request (with optional receipt upload
// to the petty-receipts Storage bucket) and see their own history.
// ============================================================================

import { useEffect, useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field, Input, Select } from "../../components/ui/Input";
import { useSync } from "../../lib/hooks/SyncContext";
import { useCashRefs } from "../../lib/hooks/useCashRefs";
import { fmtINR } from "../../lib/dashboard";
import { todayIso } from "../../lib/dates";
import { getSupabase } from "../../lib/supabase";
import {
  createPettyExpense,
  listPettyExpenses,
  type PettyExpense,
} from "../../lib/cash";

export default function CashPettyMinePage() {
  const { state }             = useSync();
  const refs                  = useCashRefs();
  const [rows, setRows]       = useState<PettyExpense[]>([]);
  const [unitId, setUnitId]   = useState<string>("");
  /** POS counter the expense was paid from — required (migration 18). */
  const [counterId, setCounterId] = useState<string>("");
  const [date, setDate]       = useState(todayIso());
  const [amount, setAmount]   = useState("");
  const [desc, setDesc]       = useState("");
  const [category, setCat]    = useState("");
  const [paidTo, setPaidTo]   = useState("");
  const [file, setFile]       = useState<File | null>(null);
  /** When the cashier toggles "no receipt available", they must record why. */
  const [noReason, setNoReason] = useState("");
  const [noReceipt, setNoReceipt] = useState(false);
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState<string | null>(null);
  const [okMsg, setOk]        = useState<string | null>(null);

  useEffect(() => {
    if (!unitId && refs.units.length > 0) setUnitId(refs.units[0]?.id ?? "");
  }, [refs.units, unitId]);

  // Counters scoped to the selected unit; snap selection when unit changes.
  const unitCounters = refs.counters.filter((c) => c.operatingUnitId === unitId);
  useEffect(() => {
    if (!unitId) return;
    if (counterId && unitCounters.some((c) => c.id === counterId)) return;
    setCounterId(unitCounters[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId, refs.counters]);

  async function reload() {
    if (!state.email) return;
    const r = await listPettyExpenses({ requestedByEmail: state.email });
    setRows(r);
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [state.email]);

  async function uploadReceipt(): Promise<string | null> {
    if (!file) return null;
    const sb = getSupabase();
    const ext  = file.name.split(".").pop() ?? "jpg";
    const path = `${state.email}/${Date.now()}.${ext}`;
    const { error } = await sb.storage.from("petty-receipts").upload(path, file, { upsert: false });
    if (error) throw new Error(error.message);
    const { data } = sb.storage.from("petty-receipts").getPublicUrl(path);
    return data.publicUrl;
  }

  async function submit() {
    if (!state.email || !unitId) return;
    if (!counterId) { setErr("Pick the counter this was paid from."); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { setErr("Enter an amount."); return; }
    if (!desc.trim())     { setErr("Enter a description."); return; }
    // Mandatory receipt-or-reason policy (migration 08). Validate up
    // front so the cashier doesn't burn an upload on an invalid form.
    if (!noReceipt && !file) {
      setErr("Attach a receipt or tick \"no receipt available\".");
      return;
    }
    if (noReceipt && !noReason.trim()) {
      setErr("Explain why no receipt is available.");
      return;
    }
    setBusy(true); setErr(null); setOk(null);
    try {
      const receiptUrl = noReceipt ? null : await uploadReceipt();
      await createPettyExpense({
        operatingUnitId: unitId,
        posCounterId: counterId,
        expenseDate: date,
        amount: amt,
        category: category || null,
        description: desc.trim(),
        paidTo: paidTo || null,
        requestedByEmail: state.email,
        receiptUrl,
        noReceiptReason: noReceipt ? noReason.trim() : null,
      });
      setOk("Submitted — waiting for approval.");
      setAmount(""); setDesc(""); setCat(""); setPaidTo(""); setFile(null);
      setNoReceipt(false); setNoReason("");
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>New petty expense</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Unit">
              <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                {refs.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
            <Field label="Counter">
              <Select value={counterId} onChange={(e) => setCounterId(e.target.value)}>
                {unitCounters.length === 0 ? <option value="">— no counters —</option> : null}
                {unitCounters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Amount (₹)">
              <Input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Category">
              <Select value={category} onChange={(e) => setCat(e.target.value)}>
                <option value="">—</option>
                <option>Food</option>
                <option>Travel</option>
                <option>Stationery</option>
                <option>Maintenance</option>
                <option>Cleaning</option>
                <option>Other</option>
              </Select>
            </Field>
          </div>
          <Field label="Description">
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
          </Field>
          <Field label="Paid to (vendor)">
            <Input value={paidTo} onChange={(e) => setPaidTo(e.target.value)} />
          </Field>
          <Field label="Receipt">
            <input
              type="file"
              accept="image/*,.pdf"
              disabled={noReceipt}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm disabled:opacity-50"
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={noReceipt}
                onChange={(e) => {
                  setNoReceipt(e.target.checked);
                  if (e.target.checked) setFile(null);
                }}
              />
              No receipt available
            </label>
          </Field>
          {noReceipt ? (
            <Field label="Reason no receipt is available">
              <Input
                value={noReason}
                onChange={(e) => setNoReason(e.target.value)}
                placeholder="e.g. tea-stall didn't print a bill"
              />
            </Field>
          ) : null}
          {err ? <div className="text-sm text-red-600">{err}</div> : null}
          {okMsg ? <div className="text-sm text-emerald-600">{okMsg}</div> : null}
          <div className="flex justify-end">
            <Button disabled={busy} onClick={() => void submit()}>
              {busy ? "Submitting…" : "Submit"}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>My expenses</CardTitle></CardHeader>
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-ink-muted">No expenses yet.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-2">{r.expenseDate}</td>
                  <td className="px-3 py-2">{r.description}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(r.amount)}</td>
                  <td className="px-3 py-2">
                    <span className={
                      "inline-block text-xs px-2 py-0.5 rounded " +
                      (r.status === "approved" ? "bg-emerald-100 text-emerald-700" :
                       r.status === "rejected" ? "bg-red-100 text-red-700" :
                                                 "bg-amber-100 text-amber-700")
                    }>{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}
