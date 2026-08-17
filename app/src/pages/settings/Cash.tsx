// ============================================================================
// /settings/cash — CRUD for operating units, bank accounts, and payment
// methods. Lightweight: lists current rows + a new-row form per section.
//
// The page is open to the owner AND the accountant (the accountant needs the
// pay-from defaults and the parties catalog), so anything destructive is gated
// on the owner in the UI as well as in the DB. Bank accounts are editable and
// removable by the owner since bank_accounts_owner_manage; "remove" deletes an
// untouched account outright and archives one with history behind it, because
// ledger entries, deposits and settlements all point at it.
// ============================================================================

import { useCallback, useEffect, useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field, Input, Select } from "../../components/ui/Input";
import { useSync } from "../../lib/hooks/SyncContext";
import { useCashRefs } from "../../lib/hooks/useCashRefs";
import { getSupabase } from "../../lib/supabase";
import {
  archivePosCounter,
  bankAccountUsage,
  createPosCounter,
  deleteBankAccount,
  listAllBankAccounts,
  listPaymentMethodsForUnit,
  renamePosCounter,
  restoreBankAccount,
  saveBankAccount,
  setOperatingUnitMethods,
  updateOperatingUnitFloat,
  updateOperatingUnitPayDefaults,
  updatePaymentMethodBank,
  updatePaymentMethodSettlementDays,
  type BankAccount,
  type OperatingUnit,
  type PaymentMethod,
  type PosCounter,
} from "../../lib/cash";
import type { PaymentFlowType, PaymentRequestMode } from "../../lib/db-types";

export default function SettingsCashPage() {
  const { state } = useSync();
  const refs      = useCashRefs();
  const [err, setErr]   = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isOwner = state.role === "owner";

  // The bank-account section lists ARCHIVED accounts too, so an archive done in
  // error can be undone. refs.bankAccounts (active only) still feeds every
  // picker on the page, so this is a second, deliberately wider read.
  const [allBanks, setAllBanks] = useState<BankAccount[]>([]);
  const reloadBanks = useCallback(async () => {
    if (!refs.cinemaId) return;
    setAllBanks(await listAllBankAccounts(refs.cinemaId));
  }, [refs.cinemaId]);
  useEffect(() => { void reloadBanks(); }, [reloadBanks, refs.bankAccounts.length]);

  // Operating unit form
  const [uName, setUName] = useState("");
  const [uKind, setUKind] = useState<"box_office" | "food_beverage" | "other">("box_office");

  // POS counter form
  const [cUnit, setCUnit]   = useState("");
  const [cName, setCName]   = useState("");

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
  useEffect(() => {
    if (!cUnit && refs.units.length > 0) setCUnit(refs.units[0]?.id ?? "");
  }, [refs.units, cUnit]);

  async function addCounter() {
    if (!refs.cinemaId || !cUnit || !cName || !state.email) return;
    setBusy(true); setErr(null);
    try {
      const siblings = refs.counters.filter((c) => c.operatingUnitId === cUnit);
      await createPosCounter({
        cinemaId: refs.cinemaId,
        operatingUnitId: cUnit,
        name: cName.trim(),
        displayOrder: ((siblings.at(-1)?.displayOrder ?? 0) + 10),
      }, state.email);
      setCName("");
      refs.reload();
    } catch (e) { setErr((e as Error).message); }
    finally    { setBusy(false); }
  }

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
      await reloadBanks();
    } catch (e) { setErr((e as Error).message); }
    finally    { setBusy(false); }
  }

  /**
   * Remove an account. The DB decides between a real delete and an archive
   * based on whether anything references it; we report which it chose and, when
   * it archived, what was holding on to it — a silent archive dressed up as a
   * delete is how people stop trusting a Delete button.
   */
  async function removeBank(a: BankAccount) {
    setBusy(true); setErr(null); setNote(null);
    try {
      const outcome = await deleteBankAccount(a.id);
      if (outcome === "deleted") {
        setNote(`"${a.name}" was never used, so it has been deleted.`);
      } else {
        const usage = await bankAccountUsage(a.id);
        const held = usage.map((u) => `${u.n} ${u.label.toLowerCase()}`).join(", ");
        setNote(
          `"${a.name}" has history behind it${held ? ` (${held})` : ""}, so it was archived instead — ` +
          "gone from every picker, records intact.",
        );
      }
      refs.reload();
      await reloadBanks();
    } catch (e) { setErr((e as Error).message); }
    finally    { setBusy(false); }
  }

  async function unarchiveBank(a: BankAccount) {
    setBusy(true); setErr(null); setNote(null);
    try {
      await restoreBankAccount(a.id);
      setNote(`"${a.name}" is active again.`);
      refs.reload();
      await reloadBanks();
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
      {note ? (
        <div className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink-soft">
          {note}
        </div>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Operating units</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          <p className="text-xs text-ink-muted">
            "Pay from" and "Mode" are what <em>Make a Payment</em> pre-selects once
            this unit is chosen — a starting point the accountant can still change
            on any individual payment. Leave them unset to fall back to the
            cinema's primary account and a bank transfer.
          </p>
          <table className="w-full text-sm">
            <thead className="bg-paper text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Kind</th>
                <th className="px-3 py-2 text-right">Default float (₹)</th>
                <th className="px-3 py-2 text-left">Pay from (default)</th>
                <th className="px-3 py-2 text-left">Mode</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {refs.units.map((u) => (
                <FloatRow
                  key={u.id}
                  unit={u}
                  bankAccounts={refs.bankAccounts}
                  email={state.email}
                  onSaved={refs.reload}
                  onError={setErr}
                />
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

      {/* POS counters — tills inside each unit. Closings + petty expenses
          are recorded per counter (migration 18). Managed like screens. */}
      <Card>
        <CardHeader><CardTitle>POS counters</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          <p className="text-xs text-ink-muted">
            One row per till. The closing form and petty expenses ask which
            counter they belong to. Archiving keeps history but removes the
            counter from dropdowns.
          </p>
          <table className="w-full text-sm">
            <thead className="bg-paper text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left">Unit</th>
                <th className="px-3 py-2 text-left">Counter</th>
                <th className="px-3 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {refs.counters.map((c) => (
                <CounterRow
                  key={c.id}
                  counter={c}
                  unitName={refs.units.find((u) => u.id === c.operatingUnitId)?.name ?? "—"}
                  email={state.email}
                  onSaved={refs.reload}
                  onError={setErr}
                />
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Unit">
              <Select value={cUnit} onChange={(e) => setCUnit(e.target.value)}>
                {refs.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
            <Field label="Name">
              <Input
                value={cName}
                placeholder="e.g. Counter 2"
                onChange={(e) => setCName(e.target.value)}
              />
            </Field>
            <div className="flex items-end">
              <Button disabled={busy || !cUnit || !cName.trim()} onClick={() => void addCounter()}>
                Add counter
              </Button>
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
                {isOwner ? <th className="px-3 py-2"></th> : null}
              </tr>
            </thead>
            <tbody>
              {allBanks.map((a) => (
                <BankAccountAdminRow
                  key={a.id}
                  account={a}
                  isOwner={isOwner}
                  busy={busy}
                  onSaved={async () => { refs.reload(); await reloadBanks(); }}
                  onRemove={() => void removeBank(a)}
                  onRestore={() => void unarchiveBank(a)}
                  onError={setErr}
                />
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
                <th className="px-3 py-2 text-right">Settles T+</th>
                <th className="px-3 py-2 text-left">Settles into</th>
              </tr>
            </thead>
            <tbody>
              {refs.paymentMethods.map((m) => (
                <MethodBankRow
                  key={m.id}
                  method={m}
                  bankAccounts={refs.bankAccounts}
                  onSaved={refs.reload}
                  onError={setErr}
                />
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

      {/* Methods accepted per operating unit — closing form filters by this. */}
      <Card>
        <CardHeader><CardTitle>Methods accepted per unit</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <p className="text-xs text-ink-muted">
            Tick the payment methods relevant to each unit. The closing form
            only shows ticked methods. Leaving everything unticked falls back
            to showing all methods for that unit.
          </p>
          {refs.units.map((u) => (
            <UnitMethodsEditor
              key={u.id}
              unit={u}
              cinemaId={refs.cinemaId}
              allMethods={refs.paymentMethods}
              onError={setErr}
            />
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

/**
 * Per-operating-unit checkbox grid for the payment-method mapping
 * (operating_unit_payment_methods table). Saves on every toggle so the
 * owner doesn't have to chase a Save button.
 */
function UnitMethodsEditor({
  unit,
  cinemaId,
  allMethods,
  onError,
}: {
  unit: OperatingUnit;
  cinemaId: string | null;
  allMethods: PaymentMethod[];
  onError: (m: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loaded, setLoaded]     = useState(false);
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    if (!cinemaId) return;
    let alive = true;
    void listPaymentMethodsForUnit(cinemaId, unit.id).then((ms) => {
      if (!alive) return;
      // listPaymentMethodsForUnit falls back to all-methods when the unit
      // has no mapping yet. We only want to pre-tick ACTUAL mapped rows,
      // so re-query the join table directly via a count: if the unit has
      // fewer mapped methods than all-cinema methods, treat the returned
      // list as the canonical selection. Otherwise: empty (no mapping).
      const ids = new Set(ms.map((m) => m.id));
      const allIds = new Set(allMethods.map((m) => m.id));
      // If the returned set equals the all-cinema set, the fallback
      // kicked in — leave selection empty so the owner sees the "no
      // mapping yet" state, which is what triggers the fallback.
      const isFallback =
        ids.size === allIds.size &&
        Array.from(ids).every((i) => allIds.has(i));
      setSelected(isFallback ? new Set() : ids);
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [cinemaId, unit.id, allMethods]);

  async function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
    setSaving(true);
    try {
      await setOperatingUnitMethods(unit.id, Array.from(next));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium">{unit.name}</div>
        <span className="text-xs text-ink-muted">
          {!loaded ? "loading…" : saving ? "saving…" : `${selected.size} selected`}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {allMethods.map((m) => (
          <label
            key={m.id}
            className="flex items-center gap-2 text-sm cursor-pointer rounded px-2 py-1 hover:bg-paper"
          >
            <input
              type="checkbox"
              checked={selected.has(m.id)}
              disabled={!loaded || saving}
              onChange={() => void toggle(m.id)}
            />
            <span className="truncate">{m.displayName}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * Inline row for a POS counter: rename + archive. Archive is a soft
 * delete — old closings keep their FK, the counter just leaves dropdowns.
 */
function CounterRow({
  counter,
  unitName,
  email,
  onSaved,
  onError,
}: {
  counter: PosCounter;
  unitName: string;
  email: string | null;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState(counter.name);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!email || !name.trim() || name.trim() === counter.name) return;
    setBusy(true);
    try {
      await renamePosCounter(counter.id, name.trim(), email);
      onSaved();
    } catch (e) { onError((e as Error).message); }
    finally    { setBusy(false); }
  }

  async function archive() {
    if (!email) return;
    if (!window.confirm(`Archive "${counter.name}"? Existing closings keep their history.`)) return;
    setBusy(true);
    try {
      await archivePosCounter(counter.id, email);
      onSaved();
    } catch (e) { onError((e as Error).message); }
    finally    { setBusy(false); }
  }

  return (
    <tr className="border-t border-line">
      <td className="px-3 py-2">{unitName}</td>
      <td className="px-3 py-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void save()}
          className="w-44"
        />
      </td>
      <td className="px-3 py-2 text-right">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void archive()}>
          {busy ? "…" : "Archive"}
        </Button>
      </td>
    </tr>
  );
}

/**
 * Inline editor for an operating unit's `default_float_amount`. The value
 * pre-fills the deposit form in the closing dialog.
 */
function FloatRow({
  unit,
  bankAccounts,
  email,
  onSaved,
  onError,
}: {
  unit: OperatingUnit;
  bankAccounts: BankAccount[];
  email: string | null;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [value, setValue] = useState<string>(String(unit.defaultFloatAmount));
  const [bank, setBank]   = useState<string>(unit.defaultBankAccountId ?? "");
  const [mode, setMode]   = useState<string>(unit.defaultPaymentMode ?? "");
  const [busy, setBusy]   = useState(false);

  // One Save for the row: the float and the payment defaults live on the same
  // operating_units row, so writing them together keeps it to one round trip.
  async function save() {
    if (!email) return;
    setBusy(true);
    try {
      await updateOperatingUnitFloat(unit.id, Number(value) || 0, email);
      await updateOperatingUnitPayDefaults(
        unit.id,
        { bankAccountId: bank || null, mode: (mode || null) as PaymentRequestMode | null },
        email,
      );
      onSaved();
    } catch (e) { onError((e as Error).message); }
    finally    { setBusy(false); }
  }
  return (
    <tr className="border-t border-line align-top">
      <td className="px-3 py-2">{unit.name}</td>
      <td className="px-3 py-2">{unit.kind}</td>
      <td className="px-3 py-2 text-right">
        <Input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="text-right tabular-nums w-32 ml-auto"
        />
      </td>
      <td className="px-3 py-2">
        <Select value={bank} onChange={(e) => setBank(e.target.value)} className="w-48">
          <option value="">Cinema primary</option>
          {bankAccounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}{a.isPrimary ? " · primary" : ""}</option>
          ))}
        </Select>
      </td>
      <td className="px-3 py-2">
        <Select value={mode} onChange={(e) => setMode(e.target.value)} className="w-36">
          <option value="">Not set</option>
          <option value="bank_transfer">Bank transfer</option>
          <option value="cheque">Cheque</option>
          <option value="cash">Cash</option>
          <option value="upi">UPI</option>
        </Select>
      </td>
      <td className="px-3 py-2 text-right">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </td>
    </tr>
  );
}

/**
 * Inline editor for `payment_methods.receives_into_bank`. Pre-fills the
 * bank picker on new POS settlement forms.
 */
function MethodBankRow({
  method,
  bankAccounts,
  onSaved,
  onError,
}: {
  method: PaymentMethod;
  bankAccounts: BankAccount[];
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [value, setValue] = useState<string>(method.receivesIntoBank ?? "");
  const [days, setDays]   = useState<string>(String(method.settlementDays ?? 0));
  const [busy, setBusy]   = useState(false);
  async function save(next: string) {
    setValue(next);
    setBusy(true);
    try {
      await updatePaymentMethodBank(method.id, next || null);
      onSaved();
    } catch (e) { onError((e as Error).message); }
    finally    { setBusy(false); }
  }
  async function saveDays(next: string) {
    setDays(next);
    const n = Math.max(0, Math.round(Number(next) || 0));
    setBusy(true);
    try {
      await updatePaymentMethodSettlementDays(method.id, n);
      onSaved();
    } catch (e) { onError((e as Error).message); }
    finally    { setBusy(false); }
  }
  return (
    <tr className="border-t border-line">
      <td className="px-3 py-2">{method.code}</td>
      <td className="px-3 py-2">{method.displayName}</td>
      <td className="px-3 py-2">{method.flowType}</td>
      <td className="px-3 py-2 text-right">
        <Input
          type="number"
          min={0}
          step={1}
          value={days}
          disabled={busy}
          onChange={(e) => setDays(e.target.value)}
          onBlur={(e) => void saveDays(e.target.value)}
          className="w-16 text-right"
        />
      </td>
      <td className="px-3 py-2">
        <Select
          value={value}
          disabled={busy}
          onChange={(e) => void save(e.target.value)}
          className="min-w-[8rem]"
        >
          <option value="">— none —</option>
          {bankAccounts.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </Select>
      </td>
    </tr>
  );
}

/**
 * One bank-account row, with inline edit for the owner.
 *
 * Editing is inline rather than a modal to match the rest of this page, and the
 * save goes through fn_bank_account_save rather than a bare UPDATE so the
 * primary flag stays exclusive across the cinema.
 *
 * The Remove button is honest about being two operations behind one label: the
 * DB deletes an account nothing has touched and archives one with history, and
 * the page reports which happened. Archived rows stay listed here (and only
 * here — every picker reads the active list) so an archive can be undone.
 */
function BankAccountAdminRow({
  account,
  isOwner,
  busy,
  onSaved,
  onRemove,
  onRestore,
  onError,
}: {
  account: BankAccount;
  isOwner: boolean;
  busy: boolean;
  onSaved: () => void | Promise<void>;
  onRemove: () => void;
  onRestore: () => void;
  onError: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [name, setName]       = useState(account.name);
  const [bank, setBank]       = useState(account.bankName ?? "");
  const [last4, setLast4]     = useState(account.accountNumberLast4 ?? "");
  const [opening, setOpening] = useState(String(account.openingBalance));
  const [primary, setPrimary] = useState(account.isPrimary);
  const [confirming, setConfirming] = useState(false);

  const archived = !!account.archivedAt;

  function cancel() {
    setName(account.name);
    setBank(account.bankName ?? "");
    setLast4(account.accountNumberLast4 ?? "");
    setOpening(String(account.openingBalance));
    setPrimary(account.isPrimary);
    setEditing(false);
  }

  async function save() {
    if (!name.trim()) { onError("The account needs a name."); return; }
    setSaving(true);
    try {
      await saveBankAccount(account.id, {
        name: name.trim(),
        bankName: bank || null,
        accountLast4: last4 || null,
        openingBalance: Number(opening) || 0,
        isPrimary: primary,
      });
      setEditing(false);
      await onSaved();
    } catch (e) { onError((e as Error).message); }
    finally { setSaving(false); }
  }

  if (editing) {
    return (
      <tr className="border-t border-line bg-paper">
        <td className="px-3 py-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
          <label className="mt-1 flex items-center gap-2 text-xs text-ink-muted">
            <input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} />
            Primary account
          </label>
        </td>
        <td className="px-3 py-2"><Input value={bank} onChange={(e) => setBank(e.target.value)} /></td>
        <td className="px-3 py-2"><Input value={last4} onChange={(e) => setLast4(e.target.value)} /></td>
        <td className="px-3 py-2">
          <Input type="number" value={opening} onChange={(e) => setOpening(e.target.value)} />
        </td>
        <td className="px-3 py-2">
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={saving} onClick={cancel}>Cancel</Button>
            <Button size="sm" disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className={`border-t border-line ${archived ? "text-ink-muted" : ""}`}>
      <td className="px-3 py-2">
        {account.name}{account.isPrimary ? " ★" : ""}
        {archived ? <span className="ml-2 text-xs uppercase tracking-wide">archived</span> : null}
      </td>
      <td className="px-3 py-2">{account.bankName ?? "—"}</td>
      <td className="px-3 py-2">{account.accountNumberLast4 ?? "—"}</td>
      <td className="px-3 py-2 text-right tabular-nums">{account.openingBalance}</td>
      {isOwner ? (
        <td className="px-3 py-2">
          <div className="flex justify-end gap-2">
            {archived ? (
              <Button size="sm" variant="secondary" disabled={busy} onClick={onRestore}>Restore</Button>
            ) : confirming ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Keep</Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={() => { setConfirming(false); onRemove(); }}
                >
                  Confirm remove
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
                  Remove
                </Button>
              </>
            )}
          </div>
        </td>
      ) : null}
    </tr>
  );
}
