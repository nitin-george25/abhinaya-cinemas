// ============================================================================
// /settings/payment-types — owner-managed editor for the payment taxonomy (S8).
//
// Lists the current types + a new-row form, following the settings/Cash.tsx
// pattern. Owner-only (RLS write = is_owner). The editable knobs are the ones
// that change the flow/books downstream: invoice rule, is-asset (→ quotation),
// quote-skip floor, accounting head, Zoho push, active.
// ============================================================================

import { useEffect, useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Field, Input, Select } from "../../components/ui/Input";
import { useSync } from "../../lib/hooks/SyncContext";
import { fmtINR } from "../../lib/dashboard";
import {
  listPaymentTypes,
  createPaymentType,
  updatePaymentType,
  PAYEE_CATEGORY_LABEL,
  type PaymentType,
  type PaymentInvoiceRule,
  type PaymentPayeeCategory,
} from "../../lib/payments";

const CATEGORIES = Object.keys(PAYEE_CATEGORY_LABEL) as PaymentPayeeCategory[];
const RULES: PaymentInvoiceRule[] = ["required", "exempt", "settlement"];

export default function SettingsPaymentTypesPage() {
  const { state } = useSync();
  const cinemaId = state.cinemaId;
  const email = state.email;
  const isOwner = state.role === "owner";

  const [types, setTypes] = useState<PaymentType[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!cinemaId) return;
    setTypes(await listPaymentTypes(cinemaId));
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cinemaId]);

  // new-row form
  const [nName, setNName] = useState("");
  const [nCat, setNCat] = useState<PaymentPayeeCategory>("vendor");
  const [nRule, setNRule] = useState<PaymentInvoiceRule>("required");
  const [nAsset, setNAsset] = useState(false);
  const [nHead, setNHead] = useState("");
  const [nFloor, setNFloor] = useState("");
  const [nZoho, setNZoho] = useState(false);

  async function addType() {
    if (!cinemaId || !email) return;
    if (!nName.trim() || !nHead.trim()) { setErr("Name and accounting head are required."); return; }
    setBusy(true); setErr(null);
    try {
      await createPaymentType(
        {
          cinemaId,
          name: nName.trim(),
          payeeCategory: nCat,
          invoiceRule: nRule,
          isAsset: nAsset,
          quoteSkipFloor: Number(nFloor) || 0,
          accountingHead: nHead.trim(),
          zohoPush: nZoho,
          sortOrder: (types[types.length - 1]?.sortOrder ?? 0) + 1,
        },
        email,
      );
      setNName(""); setNHead(""); setNFloor(""); setNAsset(false); setNZoho(false);
      await reload();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  if (!isOwner) {
    return (
      <Card>
        <CardBody className="py-10 text-center text-ink-muted">
          Payment types are managed by the owner.
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight">Payment types</h2>
        <p className="mt-1 text-sm text-ink-muted">
          The taxonomy behind "Make a Payment". Flags here drive the flow and the books.
        </p>
      </div>

      {err ? <div className="text-sm text-red-600">{err}</div> : null}

      <Card>
        <CardHeader><CardTitle>Types</CardTitle><span className="text-xs text-ink-muted">{types.length}</span></CardHeader>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-paper text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-left">Invoice</th>
                <th className="px-3 py-2 text-left">Asset</th>
                <th className="px-3 py-2 text-right">Quote-skip floor</th>
                <th className="px-3 py-2 text-left">Accounting head</th>
                <th className="px-3 py-2 text-left">Zoho</th>
                <th className="px-3 py-2 text-left">Active</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <TypeRow key={t.id} type={t} email={email} onSaved={reload} onError={setErr} />
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Add a type</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Name">
              <Input value={nName} onChange={(e) => setNName(e.target.value)} />
            </Field>
            <Field label="Payee category">
              <Select value={nCat} onChange={(e) => setNCat(e.target.value as PaymentPayeeCategory)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{PAYEE_CATEGORY_LABEL[c]}</option>)}
              </Select>
            </Field>
            <Field label="Invoice rule">
              <Select value={nRule} onChange={(e) => setNRule(e.target.value as PaymentInvoiceRule)}>
                {RULES.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
            <Field label="Accounting head">
              <Input value={nHead} onChange={(e) => setNHead(e.target.value)} />
            </Field>
            <Field label="Quote-skip floor (₹)">
              <Input type="number" inputMode="decimal" value={nFloor} onChange={(e) => setNFloor(e.target.value)} />
            </Field>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={nAsset} onChange={(e) => setNAsset(e.target.checked)} /> Asset
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={nZoho} onChange={(e) => setNZoho(e.target.checked)} /> Zoho
              </label>
            </div>
          </div>
          <div className="flex justify-end">
            <Button disabled={busy || !nName || !nHead} onClick={() => void addType()}>Add type</Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function TypeRow({
  type, email, onSaved, onError,
}: {
  type: PaymentType;
  email: string | null;
  onSaved: () => void | Promise<void>;
  onError: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [rule, setRule] = useState<PaymentInvoiceRule>(type.invoiceRule);
  const [asset, setAsset] = useState(type.isAsset);
  const [floor, setFloor] = useState(String(type.quoteSkipFloor || ""));
  const [head, setHead] = useState(type.accountingHead);
  const [zoho, setZoho] = useState(type.zohoPush);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!email) return;
    setBusy(true);
    try {
      await updatePaymentType(
        type.id,
        { invoiceRule: rule, isAsset: asset, quoteSkipFloor: Number(floor) || 0, accountingHead: head, zohoPush: zoho },
        email,
      );
      setEditing(false);
      await onSaved();
    } catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function toggleActive() {
    if (!email) return;
    setBusy(true);
    try {
      await updatePaymentType(type.id, { active: !type.active }, email);
      await onSaved();
    } catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (!editing) {
    return (
      <tr className={`border-t border-line ${type.active ? "" : "opacity-50"}`}>
        <td className="px-3 py-2 font-medium">{type.name}</td>
        <td className="px-3 py-2">{PAYEE_CATEGORY_LABEL[type.payeeCategory]}</td>
        <td className="px-3 py-2">{type.invoiceRule}</td>
        <td className="px-3 py-2">{type.isAsset ? <Badge tone="blue">Asset</Badge> : "—"}</td>
        <td className="px-3 py-2 text-right tabular-nums">{type.quoteSkipFloor ? fmtINR(type.quoteSkipFloor) : "—"}</td>
        <td className="px-3 py-2">{type.accountingHead}</td>
        <td className="px-3 py-2">{type.zohoPush ? <Badge tone="amber">Zoho</Badge> : "—"}</td>
        <td className="px-3 py-2">{type.active ? "Yes" : "No"}</td>
        <td className="px-3 py-2 whitespace-nowrap text-right">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void toggleActive()}>
            {type.active ? "Disable" : "Enable"}
          </Button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-line bg-paper">
      <td className="px-3 py-2 font-medium">{type.name}</td>
      <td className="px-3 py-2">{PAYEE_CATEGORY_LABEL[type.payeeCategory]}</td>
      <td className="px-3 py-2">
        <Select value={rule} onChange={(e) => setRule(e.target.value as PaymentInvoiceRule)}>
          {RULES.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
      </td>
      <td className="px-3 py-2">
        <input type="checkbox" checked={asset} onChange={(e) => setAsset(e.target.checked)} />
      </td>
      <td className="px-3 py-2 text-right">
        <Input type="number" inputMode="decimal" value={floor} onChange={(e) => setFloor(e.target.value)} className="text-right" />
      </td>
      <td className="px-3 py-2">
        <Input value={head} onChange={(e) => setHead(e.target.value)} />
      </td>
      <td className="px-3 py-2">
        <input type="checkbox" checked={zoho} onChange={(e) => setZoho(e.target.checked)} />
      </td>
      <td className="px-3 py-2">{type.active ? "Yes" : "No"}</td>
      <td className="px-3 py-2 whitespace-nowrap text-right">
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        <Button size="sm" disabled={busy} onClick={() => void save()}>Save</Button>
      </td>
    </tr>
  );
}
