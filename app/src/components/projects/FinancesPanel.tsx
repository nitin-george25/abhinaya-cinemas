// ============================================================================
// FinancesPanel — budget vs paid + the expense approval/payment flow.
//
// A budget line carries an ESTIMATE. Spends are raised as EXPENSES under a
// line and move through a controlled lifecycle:
//   quoting → quote_approved → invoiced → payment_requested → paid
//
//   • budget lines:  owner / project manager           (isPM)
//   • raise expense, add quotations, upload invoice:    assigned member (isMember)
//   • approve / reject a quotation:                     owner (isOwner)
//   • request payment (Slack), mark paid (OTP):         accountant (isAccountant)
//
// A line's "Paid" = sum of its PAID expenses; the owner authorises payment
// out-of-band on Slack #payments and the accountant enters the OTP at mark-paid.
// ============================================================================

import { useMemo, useRef, useState } from "react";

import { Button } from "../ui/Button";
import { Input, Select } from "../ui/Input";
import { fmtINR } from "../../lib/dashboard";
import {
  createBudgetItem, createBudgetItemsBulk, deleteBudgetItem, updateBudgetItem,
  createExpense, cancelExpense, addQuotation, deleteQuotation, approveQuotation,
  rejectQuotations, recordExpenseInvoice, requestExpensePayment, markExpensePaid,
  expenseFinanceSummary, EXPENSE_STATUS_LABEL,
  type BudgetItemInput, type ProjectBudgetItem, type ProjectInvoice,
  type ProjectExpense, type ProjectQuotation, type ExpenseStatus,
} from "../../lib/projects";

// ── CSV import (budget lines) ───────────────────────────────────────────────
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

function parseBudgetCsv(text: string): { rows: BudgetItemInput[]; error?: string } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { rows: [], error: "The file is empty." };
  const first = parseCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const hasHeader = first.includes("name") || first.includes("estimate");
  const col = (name: string, fallback: number) => (hasHeader ? first.indexOf(name) : fallback);
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

// ── status chip ─────────────────────────────────────────────────────────────
const STATUS_TONE: Record<ExpenseStatus, string> = {
  quoting:           "bg-indigo-50 text-indigo-700",
  quote_approved:    "bg-amber-50 text-amber-800",
  invoiced:          "bg-sky-50 text-sky-700",
  payment_requested: "bg-teal-50 text-teal-700",
  paid:              "bg-green-50 text-green-700",
  rejected:          "bg-zinc-100 text-zinc-600",
  cancelled:         "bg-zinc-100 text-zinc-600",
};

function StatusChip({ status }: { status: ExpenseStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_TONE[status]}`}>
      {EXPENSE_STATUS_LABEL[status]}
    </span>
  );
}

export interface FinancesPanelProps {
  projectId: string;
  projectName: string;
  budgetItems: ProjectBudgetItem[];
  invoices: ProjectInvoice[];
  expenses: ProjectExpense[];
  quotations: ProjectQuotation[];
  email: string;
  isOwner: boolean;
  isPM: boolean;        // owner / project manager — manage budget lines
  isMember: boolean;    // assigned member — raise expenses, add quotes, invoice
  isAccountant: boolean; // accountant / owner — request payment, mark paid
  onChanged: () => void;
  onError: (m: string) => void;
}

export function FinancesPanel(props: FinancesPanelProps) {
  const {
    projectId, projectName, budgetItems, invoices, expenses, quotations, email,
    isOwner, isPM, isMember, isAccountant, onChanged, onError,
  } = props;

  const [busy, setBusy] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);

  const summary = useMemo(() => expenseFinanceSummary(budgetItems, expenses), [budgetItems, expenses]);
  const itemName = (id: string | null) =>
    id ? (budgetItems.find((b) => b.id === id)?.name ?? "—") : "Unallocated";

  const quotesByExpense = useMemo(() => {
    const m = new Map<string, ProjectQuotation[]>();
    for (const q of quotations) {
      const arr = m.get(q.expenseId) ?? [];
      arr.push(q); m.set(q.expenseId, arr);
    }
    return m;
  }, [quotations]);

  const invoiceByExpense = useMemo(() => {
    const m = new Map<string, ProjectInvoice>();
    for (const inv of invoices) if (inv.expenseId) m.set(inv.expenseId, inv);
    return m;
  }, [invoices]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); onChanged(); }
    catch (e) { onError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const overBudget = summary.remaining < 0;
  const liveExpenses = expenses.filter((e) => e.status !== "cancelled" && e.status !== "rejected");
  const sortedExpenses = [...expenses].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Estimate" value={fmtINR(summary.totalEstimate)} />
        <SummaryCard label="Paid" value={fmtINR(summary.totalPaid)} />
        <SummaryCard
          label={overBudget ? "Over budget" : "Remaining"}
          value={fmtINR(Math.abs(summary.remaining))}
          tone={overBudget ? "red" : "green"}
        />
        <SummaryCard label="Spent" value={`${summary.spentPct}%`} />
      </div>

      {/* Budget vs paid table */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold">Budget vs paid</h3>
          {isPM ? (
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
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => csvRef.current?.click()}
                title="CSV columns: name, category, estimate, notes">
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
                <th className="px-3 py-2 text-right">Paid</th>
                <th className="px-3 py-2 text-right">Remaining</th>
                {isPM ? <th className="px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {summary.items.length === 0 ? (
                <tr><td colSpan={isPM ? 5 : 4} className="px-3 py-4 text-ink-muted">No budget lines yet.</td></tr>
              ) : summary.items.map((it) => (
                editId === it.id ? (
                  <tr key={it.id}>
                    <td colSpan={isPM ? 5 : 4} className="px-3 py-2">
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
                      <div className="text-xs text-ink-muted">{it.expenseCount} expense{it.expenseCount === 1 ? "" : "s"}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtINR(it.estimate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtINR(it.paid)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${it.remaining < 0 ? "text-red-600" : "text-green-700"}`}>
                      {fmtINR(it.remaining)}
                    </td>
                    {isPM ? (
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
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(summary.unallocatedPaid)}</td>
                  <td className="px-3 py-2 text-right">—</td>
                  {isPM ? <td /> : null}
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr className="bg-paper font-semibold">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtINR(summary.totalEstimate)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtINR(summary.totalPaid)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${summary.remaining < 0 ? "text-red-600" : "text-green-700"}`}>{fmtINR(summary.remaining)}</td>
                {isPM ? <td /> : null}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Expenses */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold">
            Expenses <span className="font-normal text-ink-muted">({liveExpenses.length})</span>
          </h3>
          {isMember ? (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setShowAddExpense((v) => !v)}>
              {showAddExpense ? "Cancel" : "+ Expense"}
            </Button>
          ) : null}
        </div>

        {showAddExpense ? (
          <ExpenseForm
            busy={busy}
            budgetItems={budgetItems}
            onCancel={() => setShowAddExpense(false)}
            onSubmit={(input) => run(async () => {
              await createExpense(projectId, input, email);
              setShowAddExpense(false);
            })}
          />
        ) : null}

        {sortedExpenses.length === 0 ? (
          <p className="text-sm text-ink-muted">No expenses yet. Raise one to start the quotation → approval → payment flow.</p>
        ) : (
          <div className="space-y-2">
            {sortedExpenses.map((exp) => (
              <ExpenseCard
                key={exp.id}
                expense={exp}
                lineName={itemName(exp.budgetItemId)}
                projectId={projectId}
                projectName={projectName}
                email={email}
                quotes={quotesByExpense.get(exp.id) ?? []}
                invoice={invoiceByExpense.get(exp.id) ?? null}
                isOwner={isOwner}
                isMember={isMember}
                isAccountant={isAccountant}
                busy={busy}
                run={run}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── expense card ────────────────────────────────────────────────────────────
function ExpenseCard({
  expense, lineName, projectId, projectName, email, quotes, invoice,
  isOwner, isMember, isAccountant, busy, run,
}: {
  expense: ProjectExpense;
  lineName: string;
  projectId: string;
  projectName: string;
  email: string;
  quotes: ProjectQuotation[];
  invoice: ProjectInvoice | null;
  isOwner: boolean;
  isMember: boolean;
  isAccountant: boolean;
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [showPaid, setShowPaid] = useState(false);

  const s = expense.status;
  const payable = invoice?.total ?? invoice?.amount ?? expense.approvedAmount ?? 0;

  return (
    <div className="rounded-lg border border-line">
      {/* header */}
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{expense.title}</span>
            <StatusChip status={s} />
          </div>
          <div className="truncate text-xs text-ink-muted">
            {lineName}
            {expense.approvedVendor ? ` · ${expense.approvedVendor}` : ""}
            {expense.approvedAmount != null ? ` · approved ${fmtINR(expense.approvedAmount)}` : ""}
            {s === "paid" && expense.paidAmount != null ? ` · paid ${fmtINR(expense.paidAmount)}` : ""}
          </div>
        </div>
        <span className="text-ink-muted">{open ? "▾" : "▸"}</span>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-line px-3 py-3">
          {expense.description ? <p className="text-sm text-ink-muted">{expense.description}</p> : null}

          {/* Quotations */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Quotations</span>
              {isMember && s === "quoting" ? (
                <button className="text-xs text-blue-700 hover:underline disabled:opacity-50"
                  disabled={busy} onClick={() => setShowQuote((v) => !v)}>
                  {showQuote ? "Cancel" : "+ Quotation"}
                </button>
              ) : null}
            </div>

            {showQuote ? (
              <QuotationForm
                busy={busy}
                onCancel={() => setShowQuote(false)}
                onSubmit={(input, file) => run(async () => {
                  await addQuotation(projectId, expense.id, input, file, email);
                  setShowQuote(false);
                })}
              />
            ) : null}

            {quotes.length === 0 ? (
              <p className="text-xs text-ink-muted">No quotations yet.</p>
            ) : (
              <ul className="divide-y divide-line rounded border border-line">
                {quotes.map((q) => (
                  <li key={q.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{q.vendor}</span>
                      <span className="ml-2 tabular-nums">{fmtINR(q.amount)}</span>
                      {q.status !== "submitted" ? (
                        <span className={`ml-2 text-xs ${q.status === "approved" ? "text-green-700" : "text-zinc-500"}`}>
                          {q.status}
                        </span>
                      ) : null}
                      {q.notes ? <div className="truncate text-xs text-ink-muted">{q.notes}</div> : null}
                    </div>
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      {q.fileUrl ? (
                        <a href={q.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-700 hover:underline">quote</a>
                      ) : null}
                      {isOwner && s === "quoting" ? (
                        <button className="text-xs font-semibold text-green-700 hover:underline disabled:opacity-50"
                          disabled={busy} onClick={() => void run(() => approveQuotation(q.id))}>
                          Approve
                        </button>
                      ) : null}
                      {isMember && s === "quoting" && q.status === "submitted" ? (
                        <button className="text-xs text-red-600 hover:underline disabled:opacity-50"
                          disabled={busy} onClick={() => void run(() => deleteQuotation(q.id))}>
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {isOwner && s === "quoting" && quotes.some((q) => q.status === "submitted") ? (
              <button className="mt-1 text-xs text-red-600 hover:underline disabled:opacity-50"
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt("Reject all quotations — reason (optional):") ?? "";
                  void run(() => rejectQuotations(expense.id, reason));
                }}>
                Reject all
              </button>
            ) : null}
          </div>

          {/* Invoice */}
          {(s === "quote_approved" || s === "invoiced" || s === "payment_requested" || s === "paid") ? (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Invoice</span>
                {isMember && s === "quote_approved" ? (
                  <button className="text-xs text-blue-700 hover:underline disabled:opacity-50"
                    disabled={busy} onClick={() => setShowInvoice((v) => !v)}>
                    {showInvoice ? "Cancel" : "Upload invoice"}
                  </button>
                ) : null}
              </div>

              {showInvoice ? (
                <InvoiceForm
                  busy={busy}
                  approvedAmount={expense.approvedAmount ?? 0}
                  onCancel={() => setShowInvoice(false)}
                  onSubmit={(input, file) => run(async () => {
                    await recordExpenseInvoice(projectId, expense.id, input, file);
                    setShowInvoice(false);
                  })}
                />
              ) : null}

              {invoice ? (
                <div className="rounded border border-line px-2 py-1.5 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span>{invoice.invoiceNo ?? "—"}</span>
                    <span className="text-ink-muted">{invoice.invoiceDate ?? ""}</span>
                    <span className="tabular-nums">subtotal {fmtINR(invoice.subtotal ?? 0)}</span>
                    <span className="tabular-nums">GST {fmtINR(invoice.gst ?? 0)}</span>
                    <span className="tabular-nums">freight {fmtINR(invoice.freight ?? 0)}</span>
                    <span className="font-semibold tabular-nums">total {fmtINR(invoice.total ?? invoice.amount)}</span>
                    {invoice.fileUrl ? (
                      <a href={invoice.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-700 hover:underline">{invoice.fileName ?? "bill"}</a>
                    ) : null}
                  </div>
                  {invoice.deviationReason ? (
                    <div className="mt-0.5 text-xs text-amber-700">⚠ Subtotal differs from approved — {invoice.deviationReason}</div>
                  ) : null}
                </div>
              ) : s !== "quote_approved" ? <p className="text-xs text-ink-muted">No invoice recorded.</p> : null}
            </div>
          ) : null}

          {/* Payment */}
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            {isAccountant && s === "invoiced" ? (
              <Button size="sm" disabled={busy}
                onClick={() => void run(() => requestExpensePayment(expense.id, {
                  projectName,
                  lineItem: lineName === "Unallocated" ? null : lineName,
                  expenseTitle: expense.title,
                  vendor: expense.approvedVendor,
                  amount: payable,
                  invoiceUrl: invoice?.fileUrl ?? null,
                  invoiceFileName: invoice?.fileName ?? null,
                  deepLink: typeof window !== "undefined" ? window.location.href : null,
                }))}>
                Request payment
              </Button>
            ) : null}

            {s === "payment_requested" ? (
              <>
                <span className="text-xs text-teal-700">Requested — awaiting OTP on Slack #payments.</span>
                {isAccountant ? (
                  <Button size="sm" disabled={busy} onClick={() => setShowPaid((v) => !v)}>
                    {showPaid ? "Cancel" : "Mark paid"}
                  </Button>
                ) : null}
              </>
            ) : null}

            {s === "paid" ? (
              <span className="text-xs text-green-700">
                Paid {expense.paidAmount != null ? fmtINR(expense.paidAmount) : ""}
                {expense.paidAt ? ` on ${expense.paidAt.slice(0, 10)}` : ""}
                {expense.paidBy ? ` by ${expense.paidBy}` : ""}.
              </span>
            ) : null}

            {(isMember || isOwner) && s !== "paid" && s !== "cancelled" && s !== "rejected" ? (
              <button className="ml-auto text-xs text-red-600 hover:underline disabled:opacity-50"
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt("Cancel this expense — reason (optional):") ?? "";
                  void run(() => cancelExpense(expense.id, reason));
                }}>
                Cancel expense
              </button>
            ) : null}
          </div>

          {showPaid && s === "payment_requested" ? (
            <MarkPaidForm
              busy={busy}
              defaultAmount={payable}
              onCancel={() => setShowPaid(false)}
              onSubmit={(otp, amount, note) => run(async () => {
                await markExpensePaid(expense.id, otp, amount, note);
                setShowPaid(false);
              })}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── forms ────────────────────────────────────────────────────────────────────
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
      <div className="sm:col-span-4"><Input placeholder="Item name" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="sm:col-span-3"><Input placeholder="Category (optional)" value={category} onChange={(e) => setCategory(e.target.value)} /></div>
      <div className="sm:col-span-2"><Input type="number" placeholder="Estimate" value={estimate} onChange={(e) => setEstimate(e.target.value)} /></div>
      <div className="sm:col-span-3"><Input placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      <div className="sm:col-span-12 flex justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button size="sm" disabled={busy || !name.trim()}
          onClick={() => onSubmit({
            name: name.trim(), category: category.trim() || null,
            estimate: Number(estimate) || 0, notes: notes.trim() || null,
          })}>
          {initial ? "Save" : "Add"}
        </Button>
      </div>
    </div>
  );
}

function ExpenseForm({
  busy, budgetItems, onCancel, onSubmit,
}: {
  busy: boolean;
  budgetItems: ProjectBudgetItem[];
  onCancel: () => void;
  onSubmit: (input: { budgetItemId: string | null; title: string; description: string | null }) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [budgetItemId, setBudgetItemId] = useState("");
  return (
    <div className="mb-3 grid grid-cols-1 gap-2 rounded-lg border border-line bg-paper p-3 sm:grid-cols-12">
      <div className="sm:col-span-4"><Input placeholder="Expense title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="sm:col-span-4">
        <Select value={budgetItemId} onChange={(e) => setBudgetItemId(e.target.value)}>
          <option value="">Unallocated (no budget line)</option>
          {budgetItems.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
      </div>
      <div className="sm:col-span-4"><Input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <div className="sm:col-span-12 flex justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button size="sm" disabled={busy || !title.trim()}
          onClick={() => onSubmit({
            budgetItemId: budgetItemId || null,
            title: title.trim(),
            description: description.trim() || null,
          })}>
          Add
        </Button>
      </div>
    </div>
  );
}

function QuotationForm({
  busy, onCancel, onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: { vendor: string; amount: number; notes: string | null }, file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [fileName, setFileName] = useState("");
  return (
    <div className="mb-2 grid grid-cols-1 gap-2 rounded-lg border border-line bg-paper p-3 sm:grid-cols-12">
      <div className="sm:col-span-4"><Input placeholder="Vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} /></div>
      <div className="sm:col-span-3"><Input type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <div className="sm:col-span-5"><Input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      <div className="sm:col-span-8 flex items-center gap-2">
        <input ref={fileRef} type="file" className="hidden" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} />
        <Button size="sm" variant="secondary" type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
          {fileName ? "Change quote file" : "Attach quote (required)"}
        </Button>
        {fileName ? <span className="truncate text-xs text-ink-muted">{fileName}</span> : null}
      </div>
      <div className="sm:col-span-4 flex justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button size="sm" disabled={busy || !vendor.trim() || !amount || !fileName}
          onClick={() => {
            const f = fileRef.current?.files?.[0];
            if (!f) return;
            onSubmit({ vendor: vendor.trim(), amount: Number(amount) || 0, notes: notes.trim() || null }, f);
          }}>
          Add
        </Button>
      </div>
      {!fileName ? <p className="sm:col-span-12 text-xs text-ink-muted">A quotation file is required.</p> : null}
    </div>
  );
}

function InvoiceForm({
  busy, approvedAmount, onCancel, onSubmit,
}: {
  busy: boolean;
  approvedAmount: number;
  onCancel: () => void;
  onSubmit: (
    input: { invoiceNo: string | null; invoiceDate: string | null; subtotal: number; gst: number; freight: number; deviationReason: string | null },
    file: File,
  ) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [subtotal, setSubtotal] = useState(approvedAmount ? String(approvedAmount) : "");
  const [gst, setGst] = useState("");
  const [freight, setFreight] = useState("");
  const [reason, setReason] = useState("");
  const [fileName, setFileName] = useState("");

  const subN = Number(subtotal) || 0;
  const total = subN + (Number(gst) || 0) + (Number(freight) || 0);
  const deviates = Math.abs(subN - approvedAmount) > 0.5;

  return (
    <div className="mb-2 grid grid-cols-1 gap-2 rounded-lg border border-line bg-paper p-3 sm:grid-cols-12">
      <div className="sm:col-span-3"><Input placeholder="Invoice #" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></div>
      <div className="sm:col-span-3"><Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></div>
      <div className="sm:col-span-2"><Input type="number" placeholder="Subtotal" value={subtotal} onChange={(e) => setSubtotal(e.target.value)} /></div>
      <div className="sm:col-span-2"><Input type="number" placeholder="GST" value={gst} onChange={(e) => setGst(e.target.value)} /></div>
      <div className="sm:col-span-2"><Input type="number" placeholder="Freight" value={freight} onChange={(e) => setFreight(e.target.value)} /></div>
      <div className="sm:col-span-12 text-xs text-ink-muted">
        Approved amount {fmtINR(approvedAmount)} · invoice total {fmtINR(total)}
        {deviates ? <span className="ml-1 text-amber-700">— subtotal differs from approved; a reason is required.</span> : null}
      </div>
      {deviates ? (
        <div className="sm:col-span-12"><Input placeholder="Reason for difference (required)" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      ) : null}
      <div className="sm:col-span-8 flex items-center gap-2">
        <input ref={fileRef} type="file" className="hidden" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} />
        <Button size="sm" variant="secondary" type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
          {fileName ? "Change bill" : "Attach bill (required)"}
        </Button>
        {fileName ? <span className="truncate text-xs text-ink-muted">{fileName}</span> : null}
      </div>
      <div className="sm:col-span-4 flex justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button size="sm" disabled={busy || !subtotal || !fileName || (deviates && !reason.trim())}
          onClick={() => {
            const f = fileRef.current?.files?.[0];
            if (!f) return;
            onSubmit({
              invoiceNo: invoiceNo.trim() || null,
              invoiceDate: invoiceDate || null,
              subtotal: subN,
              gst: Number(gst) || 0,
              freight: Number(freight) || 0,
              deviationReason: deviates ? reason.trim() : null,
            }, f);
          }}>
          Save invoice
        </Button>
      </div>
    </div>
  );
}

function MarkPaidForm({
  busy, defaultAmount, onCancel, onSubmit,
}: {
  busy: boolean;
  defaultAmount: number;
  onCancel: () => void;
  onSubmit: (otp: string, amount: number | null, note: string | null) => void;
}) {
  const [otp, setOtp] = useState("");
  const [amount, setAmount] = useState(defaultAmount ? String(defaultAmount) : "");
  const [note, setNote] = useState("");
  return (
    <div className="grid grid-cols-1 gap-2 rounded-lg border border-line bg-paper p-3 sm:grid-cols-12">
      <div className="sm:col-span-3"><Input placeholder="OTP from owner" value={otp} onChange={(e) => setOtp(e.target.value)} /></div>
      <div className="sm:col-span-3"><Input type="number" placeholder="Paid amount" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <div className="sm:col-span-6"><Input placeholder="Payment note / reference (optional)" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="sm:col-span-12 flex justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button size="sm" disabled={busy || !otp.trim()}
          onClick={() => onSubmit(otp.trim(), amount ? Number(amount) : null, note.trim() || null)}>
          Confirm paid
        </Button>
      </div>
    </div>
  );
}
