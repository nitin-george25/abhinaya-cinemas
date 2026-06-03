// ============================================================================
// /settings/cash — owner-only CRUD for operating units, bank accounts, and
// payment methods. Lightweight: lists current rows + a new-row form per
// section. Editing existing rows goes through Supabase Studio for now.
// ============================================================================

import { useEffect, useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field, Input, Select } from "../../components/ui/Input";
import { useSync } from "../../lib/hooks/SyncContext";
import { useCashRefs } from "../../lib/hooks/useCashRefs";
import { getSupabase } from "../../lib/supabase";
import type { PaymentFlowType } from "../../lib/db-types";

export default function SettingsCashPage() {
  const { state } = useSync();
  const refs      = useCashRefs();
  const [err, setErr]   = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Operating unit form
  const [uName, setUName] = useState("");
  const [uKind, setUKind] = useState<"box_office" | "food_beverage" | "other">("box_office");

  // Bank account form
  const [bUnit, setBUnit]   = useState("");
  const [bName, setBName]   = useState("");
  const [bBank, setBBank]   = useState("");
  const [bLast4, setBLast4] = useState("");
  const [bOpen, setBOpen]   = useState("");

  // Payment method form
  const [pCode, setPCode]   = useState("");
  const [pName, setPName]   = useState("");
  const [pFlow, setPFlow]   = useState<PaymentFlowType>("online_immediate");

  useEffect(() => {
    if (!bUnit && refs.units.length > 0) setBUnit(refs.units[0]?.id ?? "");
  }, [refs.units, bUnit]);

  async function addUnit() {
    if (!refs.cinemaId || !uName) return;
    setBusy(true); setErr(null);
    try {
      const sb = getSupabase();
      const { error } = await sb.from("operating_units").insert({
        cinema_id: refs.cinemaId,
        name: uName,
        kind: uKind,
        updated_by: state.email,
      });
      if (error) throw new Error(error.message);
      setUName("");
      refs.reload();
    } catch (e) { setErr((e as Error).message); }
    finally    { setBusy(false); }
  }

  async function addBank() {
    if (!refs.cinemaId || !bUnit || !bName) return;
    setBusy(true); setErr(null);
    try {
      const sb = getSupabase();
      const { error } = await sb.from("bank_accounts").insert({
        cinema_id: refs.cinemaId,
        operating_unit_id: bUnit,
        name: bName,
        bank_name: bBank || null,
        account_number_last4: bLast4 || null,
        opening_balance: Number(bOpen) || 0,
        is_primary: refs.bankAccounts.length === 0,
        updated_by: state.email,
      });
      if (error) throw new Error(error.message);
      setBName(""); setBBank(""); setBLast4(""); setBOpen("");
      refs.reload();
    } catch (e) { setErr((e as Error).message); }
    finally    { setBusy(false); }
  }

  async function addMethod() {
    if (!refs.cinemaId || !pCode || !pName) return;
    setBusy(true); setErr(null);
    try {
      const sb = getSupabase();
      const next = (refs.paymentMethods.at(-1)?.displayOrder ?? 0) + 10;
      const { error } = await sb.from("payment_methods").insert({
        cinema_id: refs.cinemaId,
        code: pCode,
        display_name: pName,
        flow_type: pFlow,
        display_order: next,
      });
      if (error) throw new Error(error.message);
      setPCode(""); setPName("");
      refs.reload();
    } catch (e) { setErr((e as Error).message); }
    finally    { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      {err ? <div className="text-sm text-red-600">{err}</div> : null}

      <Card>
        <CardHeader><CardTitle>Operating units</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          <table className="w-full text-sm">
            <thead className="bg-paper text-xs uppercase tracking-wide text-ink-muted">
              <tr><th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-left">Kind</th></tr>
            </thead>
            <tbody>
              {refs.units.map((u) => (
                <tr key={u.id} className="border-t border-line">
                  <td className="px-3 py-2">{u.name}</td>
                  <td className="px-3 py-2">{u.kind}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Name"><Input value={uName} onChange={(e) => setUName(e.target.value)} /></Field>
            <Field label="Kind">
              <Select value={uKind} onChange={(e) => setUKind(e.target.value as typeof uKind)}>
                <option value="box_office">Box office</option>
                <option value="food_beverage">F&B</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            <div className="flex items-end">
              <Button disabled={busy || !uName} onClick={() => void addUnit()}>Add unit</Button>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Bank accounts</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          <table className="w-full text-sm">
            <thead className="bg-paper text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Bank</th>
                <th className="px-3 py-2 text-left">Last 4</th>
                <th className="px-3 py-2 text-right">Opening</th>
              </tr>
            </thead>
            <tbody>
              {refs.bankAccounts.map((a) => (
                <tr key={a.id} className="border-t border-line">
                  <td className="px-3 py-2">{a.name}{a.isPrimary ? " ★" : ""}</td>
                  <td className="px-3 py-2">{a.bankName ?? "—"}</td>
                  <td className="px-3 py-2">{a.accountNumberLast4 ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.openingBalance}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            <Field label="Unit">
              <Select value={bUnit} onChange={(e) => setBUnit(e.target.value)}>
                {refs.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
            <Field label="Name"><Input value={bName} onChange={(e) => setBName(e.target.value)} /></Field>
            <Field label="Bank"><Input value={bBank} onChange={(e) => setBBank(e.target.value)} /></Field>
            <Field label="Last 4"><Input value={bLast4} onChange={(e) => setBLast4(e.target.value)} /></Field>
            <Field label="Opening (₹)"><Input type="number" value={bOpen} onChange={(e) => setBOpen(e.target.value)} /></Field>
            <div className="sm:col-span-5 flex justify-end">
              <Button disabled={busy || !bUnit || !bName} onClick={() => void addBank()}>Add account</Button>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Payment methods</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          <table className="w-full text-sm">
            <thead className="bg-paper text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Flow</th>
              </tr>
            </thead>
            <tbody>
              {refs.paymentMethods.map((m) => (
                <tr key={m.id} className="border-t border-line">
                  <td className="px-3 py-2">{m.code}</td>
                  <td className="px-3 py-2">{m.displayName}</td>
                  <td className="px-3 py-2">{m.flowType}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Field label="Code"><Input value={pCode} onChange={(e) => setPCode(e.target.value)} /></Field>
            <Field label="Display name"><Input value={pName} onChange={(e) => setPName(e.target.value)} /></Field>
            <Field label="Flow">
              <Select value={pFlow} onChange={(e) => setPFlow(e.target.value as PaymentFlowType)}>
                <option value="cash">Cash</option>
                <option value="online_immediate">Online · immediate</option>
                <option value="online_settled">Online · settled</option>
              </Select>
            </Field>
            <div className="flex items-end">
              <Button disabled={busy || !pCode || !pName} onClick={() => void addMethod()}>Add method</Button>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
