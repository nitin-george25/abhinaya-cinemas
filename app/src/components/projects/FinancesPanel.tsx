// ============================================================================
// FinancesPanel — itemwise budget vs actuals + invoice uploads.
//
// A budget line carries an ESTIMATE; its ACTUAL is the sum of invoices
// allocated to it. Unallocated invoices still count toward the project total.
//   • budget lines: created/edited/deleted by owner + project manager
//   • invoices: uploaded by any assigned member; deleted by owner/PM
// ============================================================================

import { useRef, useState } from "react";

import { Button } from "../ui/Button";
import { Input, Select } from "../ui/Input";
import { fmtINR } from "../../lib/dashboard";
import {
  createBudgetItem, createBudgetItemsBulk, createInvoice, deleteBudgetItem,
  deleteInvoice, financeSummary, updateBudgetItem,
  type BudgetItemInput, type ProjectBudgetItem, type ProjectInvoice,
} from "../../lib/projects";

// Minimal CSV parser: respects double-quoted fields; one record per line.
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

// Parse a budget CSV into BudgetItemInput rows. Accepts an optional header row
// (name/category/estimate/notes, any order); otherwise assumes that column order.
function parseBudgetCsv(text: string): { rows: BudgetItemInput[]; error?: string } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { rows: [], error: "The file is empty." };
  const first = parseCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const hasHeader = first.includes("name") || first.includes("estimate");
  const col = (name: string, fallback: number) =>
    hasHeader ? first.indexOf(name) : fallback;
  const iName = col("name", 0), iCat = col("category", 1), iEst = col("estimate", 2), iNote = col("notes", 3);
  const body = hasHeader ? lines.slice(1) : lines;
  const rows: BudgetItemInput[] = [];
  for (const line of body) {
    const f = parseCsvLine(line);
    const name = (iName >= 0 ? f[iName] : "")?.trim() ?? "";
    if (!name) continue;
    const estRaw = (iEst >= 0 ? f[iEst] : "") ?? "";
    const estimate = Number(estRaw.replace(/[^0-9.\-]/g, "")) || 0;
    rows.push({
      name,
      category: (iCat >= 0 ? f[iCat] : "")?.trim() || null,
      estimate,
      notes: (iNote >= 0 ? f[iNote] : "")?.trim() || null,
    });
  }
  if (rows.length === 0) return { rows: [], error: "No valid rows found (need at least a name)." };
  return { rows };
}

export function FinancesPanel({
  projectId, budgetItems, invoices, email, canManage, canUploadInvoice, onChanged, onError,
}: {
  projectId: string;
  budgetItems: ProjectBudgetItem[];
  invoices: ProjectInvoice[];
  email: string;
  canManage: boolean;       // owner / project manager
  canUploadInvoice: boolean; // any assigned member
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showAddInv, setShowAddInv] = useState(false);

  const summary = financeSummary(budgetItems, invoices);
  const itemName = (id: string | null) =>
    id ? (budgetItems.find((b) => b.id === id)?.name ?? "—") : "Unallocated";

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); onChanged(); }
    catch (e) { onError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const overBudget = summary.variance < 0;

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Estimate" value={fmtINR(summary.totalEstimate)} />
        <SummaryCard label="Actual" value={fmtINR(summary.totalActual)} />
        <SummaryCard
          label={overBudget ? "Over budget" : "Remaining"}
          value={fmtINR(Math.abs(summary.variance))}
          tone={overBudget ? "red" : "green"}
        />
        <SummaryCard label="Spent" value={`${summary.spentPct}%`} />
      </div>

      {/* Budget vs actuals table */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold">Budget vs actuals</h3>
          {canManage ? (
            <div className="flex items-center gap-2">
              <input
                ref={csvRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  void run(async () => {
                    const text = await file.text();
                    const { rows, error } = parseBudgetCsv(text);
                    if (error) throw new Error(error);
                    await createBudgetItemsBulk(projectId, rows, email, budgetItems.length);
                  });
                }}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => csvRef.current?.click()}
                title="CSV columns: name, category, estimate, notes"
              >
                Upload CSV
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setShowAddItem((v) => !v)}>
                {showAddItem ? "Cancel" : "+ Budget line"}
              </Button>
            </div>
          ) : null}
        </div>

        {showAddItem ? (
          <BudgetItemForm
            busy={busy}
            onCancel={() => setShowAddItem(false)}
            onSubmit={(input) => run(async () => {
              await createBudgetItem(projectId, input, email, budgetItems.length);
              setShowAddItem(false);
            })}
          />
        ) : null}

        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-paper text-left text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-right">Estimate</th>
                <th className="px-3 py-2 text-right">Actual</th>
                <th className="px-3 py-2 text-right">Variance</th>
                {canManage ? <th className="px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {summary.items.length === 0 ? (
                <tr><td colSpan={canManage ? 5 : 4} className="px-3 py-4 text-ink-muted">No budget lines yet.</td></tr>
              ) : summary.items.map((it) => (
                editId === it.id ? (
                  <tr key={it.id}>
                    <td colSpan={canManage ? 5 : 4} className="px-3 py-2">
                      <BudgetItemForm
                        busy={busy}
                        initial={it}
                        onCancel={() => setEditId(null)}
                        onSubmit={(input) => run(async () => {
                          await updateBudgetItem(it.id, input, email);
                          setEditId(null);
                        })}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={it.id}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{it.name}</div>
                      {it.category ? <div className="text-xs text-ink-muted">{it.category}</div> : null}
                      <div className="text-xs text-ink-muted">{it.invoiceCount} invoice{it.invoiceCount === 1 ? "" : "s"}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtINR(it.estimate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtINR(it.actual)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${it.variance < 0 ? "text-red-600" : "text-green-700"}`}>
                      {fmtINR(it.variance)}
                    </td>
                    {canManage ? (
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button className="text-xs text-blue-700 hover:underline disabled:opacity-50" disabled={busy} onClick={() => setEditId(it.id)}>Edit</button>
                        <button className="ml-2 text-xs text-red-600 hover:underline disabled:opacity-50" disabled={busy} onClick={() => void run(() => deleteBudgetItem(it.id))}>Delete</button>
                      </td>
                    ) : null}
                  </tr>
                )
              ))}
              {summary.unallocatedCount > 0 ? (
                <tr className="text-ink-muted">
                  <td className="px-3 py-2 italic">Unallocated ({summary.unallocatedCount})</td>
                  <td className="px-3 py-2 text-right">—</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(summary.unallocatedActual)}</td>
                  <td className="px-3 py-2 text-right">—</td>
                  {canManage ? <td /> : null}
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr className="bg-paper font-semibold">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtINR(summary.totalEstimate)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtINR(summary.totalActual)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${summary.variance < 0 ? "text-red-600" : "text-green-700"}`}>{fmtINR(summary.variance)}</td>
                {canManage ? <td /> : null}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Invoices */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold">Invoices</h3>
          {canUploadInvoice ? (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setShowAddInv((v) => !v)}>
              {showAddInv ? "Cancel" : "+ Invoice"}
            </Button>
          ) : null}
        </div>

        {showAddInv ? (
          <InvoiceForm
            busy={busy}
            budgetItems={budgetItems}
            onCancel={() => setShowAddInv(false)}
            onSubmit={(input, file) => run(async () => {
              await createInvoice(projectId, input, email, file);
              setShowAddInv(false);
            })}
          />
        ) : null}

        {invoices.length === 0 ? (
          <p className="text-sm text-ink-muted">No invoices yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-paper text-left text-xs uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Vendor</th>
                  <th className="px-3 py-2">Invoice #</th>
                  <th className="px-3 py-2">Allocated to</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">File</th>
                  {canManage ? <th className="px-3 py-2" /> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="px-3 py-2 whitespace-nowrap">{inv.invoiceDate ?? "—"}</td>
                    <td className="px-3 py-2">{inv.vendor ?? "—"}</td>
                    <td className="px-3 py-2">{inv.invoiceNo ?? "—"}</td>
                    <td className="px-3 py-2">{itemName(inv.budgetItemId)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtINR(inv.amount)}</td>
                    <td className="px-3 py-2">
                      {inv.fileUrl ? (
                        <a href={inv.fileUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                          {inv.fileName ?? "view"}
                        </a>
                      ) : <span className="text-ink-muted">—</span>}
                    </td>
                    {canManage ? (
                      <td className="px-3 py-2 text-right">
                        <button className="text-xs text-red-600 hover:underline disabled:opacity-50" disabled={busy} onClick={() => void run(() => deleteInvoice(inv.id))}>Delete</button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: "red" | "green" }) {
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`mt-0.5 font-display text-lg font-bold ${tone === "red" ? "text-red-600" : tone === "green" ? "text-green-700" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function BudgetItemForm({
  busy, initial, onCancel, onSubmit,
}: {
  busy: boolean;
  initial?: ProjectBudgetItem;
  onCancel: () => void;
  onSubmit: (input: { name: string; category: string | null; estimate: number; notes: string | null }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [estimate, setEstimate] = useState(initial ? String(initial.estimate) : "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  return (
    <div className="mb-3 grid grid-cols-1 gap-2 rounded-lg border border-line bg-paper p-3 sm:grid-cols-12">
      <div className="sm:col-span-4">
        <Input placeholder="Item name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="sm:col-span-3">
        <Input placeholder="Category (optional)" value={category} onChange={(e) => setCategory(e.target.value)} />
      </div>
      <div className="sm:col-span-2">
        <Input type="number" placeholder="Estimate" value={estimate} onChange={(e) => setEstimate(e.target.value)} />
      </div>
      <div className="sm:col-span-3 flex gap-2">
        <Input placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="sm:col-span-12 flex justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button
          size="sm"
          disabled={busy || !name.trim()}
          onClick={() => onSubmit({
            name: name.trim(),
            category: category.trim() || null,
            estimate: Number(estimate) || 0,
            notes: notes.trim() || null,
          })}
        >
          {initial ? "Save" : "Add"}
        </Button>
      </div>
    </div>
  );
}

function InvoiceForm({
  busy, budgetItems, onCancel, onSubmit,
}: {
  busy: boolean;
  budgetItems: ProjectBudgetItem[];
  onCancel: () => void;
  onSubmit: (
    input: { budgetItemId: string | null; vendor: string | null; invoiceNo: string | null; invoiceDate: string | null; amount: number; notes: string | null },
    file: File | null,
  ) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [vendor, setVendor] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [amount, setAmount] = useState("");
  const [budgetItemId, setBudgetItemId] = useState("");
  const [fileName, setFileName] = useState("");

  return (
    <div className="mb-3 grid grid-cols-1 gap-2 rounded-lg border border-line bg-paper p-3 sm:grid-cols-12">
      <div className="sm:col-span-3"><Input placeholder="Vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} /></div>
      <div className="sm:col-span-2"><Input placeholder="Invoice #" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></div>
      <div className="sm:col-span-2"><Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></div>
      <div className="sm:col-span-2"><Input type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <div className="sm:col-span-3">
        <Select value={budgetItemId} onChange={(e) => setBudgetItemId(e.target.value)}>
          <option value="">Unallocated</option>
          {budgetItems.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
      </div>
      <div className="sm:col-span-9 flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
        />
        <Button size="sm" variant="secondary" type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
          {fileName ? "Change file" : "Attach bill"}
        </Button>
        {fileName ? <span className="truncate text-xs text-ink-muted">{fileName}</span> : null}
      </div>
      <div className="sm:col-span-3 flex justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button
          size="sm"
          disabled={busy || !amount}
          onClick={() => onSubmit(
            {
              budgetItemId: budgetItemId || null,
              vendor: vendor.trim() || null,
              invoiceNo: invoiceNo.trim() || null,
              invoiceDate: invoiceDate || null,
              amount: Number(amount) || 0,
              notes: null,
            },
            fileRef.current?.files?.[0] ?? null,
          )}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
