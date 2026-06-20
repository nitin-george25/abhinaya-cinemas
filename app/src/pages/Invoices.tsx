// ============================================================================
// /invoices — purchase invoices (Zoho Bills) imported into the console.
//
// Read-only register: rows are written by the Zoho Edge functions. Owner can
// delete a row (rare escape hatch). Clicking a row opens the full bill with its
// line items + CGST/SGST/IGST split. Zoho Books remains the system of record;
// this is the operational view of accounts-payable.
// ============================================================================

import { useEffect, useMemo, useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Field, Input, Select } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { useSync } from "../lib/hooks/SyncContext";
import { fmtINR } from "../lib/dashboard";
import { money } from "../lib/format";
import {
  deleteInvoice,
  getInvoiceLines,
  listInvoices,
  type Invoice,
  type InvoiceLine,
} from "../lib/invoices";

type Tone = "neutral" | "amber" | "green" | "red" | "blue";

function statusTone(status: string | null): Tone {
  const s = (status ?? "").toLowerCase();
  if (s === "paid") return "green";
  if (s === "overdue") return "red";
  if (s === "open" || s === "partially_paid" || s === "sent") return "amber";
  return "neutral";
}

function statusLabel(status: string | null): string {
  if (!status) return "—";
  return status.replace(/_/g, " ");
}

export default function InvoicesPage() {
  const { state } = useSync();
  const isOwner = state.role === "owner";

  const [rows, setRows] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Detail drawer
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);

  async function reload() {
    setLoading(true);
    setErr(null);
    try {
      const r = await listInvoices({
        type: "purchase",
        from: from || undefined,
        to: to || undefined,
      });
      setRows(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  async function openInvoice(inv: Invoice) {
    setSelected(inv);
    setLines([]);
    setLinesLoading(true);
    try {
      setLines(await getInvoiceLines(inv.id));
    } finally {
      setLinesLoading(false);
    }
  }

  async function onDelete(inv: Invoice) {
    if (!confirm(`Delete invoice ${inv.invoiceNo ?? inv.zohoId ?? ""}? This only removes it from the console, not from Zoho Books.`)) return;
    try {
      await deleteInvoice(inv.id);
      setSelected(null);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  // Client-side text/status filter over the (cinema+date) RLS-scoped rows.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (status && (r.status ?? "").toLowerCase() !== status) return false;
      if (!q) return true;
      return (
        (r.partyName ?? "").toLowerCase().includes(q) ||
        (r.invoiceNo ?? "").toLowerCase().includes(q) ||
        (r.category ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, status]);

  const totals = useMemo(() => {
    let payable = 0;
    let outstanding = 0;
    for (const r of filtered) {
      payable += r.total;
      outstanding += r.balance;
    }
    return { payable, outstanding, count: filtered.length };
  }, [filtered]);

  // Status options derived from the data so the filter only offers real values.
  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.status) set.add(r.status.toLowerCase());
    return Array.from(set).sort();
  }, [rows]);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardBody>
            <div className="text-xs uppercase tracking-wide text-ink-muted">Invoices</div>
            <div className="text-2xl font-semibold tabular-nums">{totals.count}</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-xs uppercase tracking-wide text-ink-muted">Total payable</div>
            <div className="text-2xl font-semibold tabular-nums">{fmtINR(totals.payable)}</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-xs uppercase tracking-wide text-ink-muted">Outstanding</div>
            <div className="text-2xl font-semibold tabular-nums">{fmtINR(totals.outstanding)}</div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Purchase invoices</CardTitle>
          <Button variant="secondary" size="sm" onClick={() => void reload()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </CardHeader>
        <CardBody className="space-y-4">
          {/* Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Field label="Search">
              <Input
                placeholder="Vendor, invoice no, category"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Field>
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>{statusLabel(s)}</option>
                ))}
              </Select>
            </Field>
            <Field label="From">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>

          {err ? <div className="text-sm text-red-600">{err}</div> : null}

          {/* Table */}
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-ink-muted">
              {loading ? "Loading…" : "No invoices match. They appear here once Zoho Books pushes a bill."}
            </div>
          ) : (
            <div className="overflow-x-auto -mx-5 sm:mx-0">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-ink-muted border-b border-line">
                    <th className="py-2 px-3 font-medium">Date</th>
                    <th className="py-2 px-3 font-medium">Vendor</th>
                    <th className="py-2 px-3 font-medium">Invoice #</th>
                    <th className="py-2 px-3 font-medium">Status</th>
                    <th className="py-2 px-3 font-medium text-right">Total</th>
                    <th className="py-2 px-3 font-medium text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => void openInvoice(r)}
                      className="border-b border-line/60 hover:bg-paper cursor-pointer"
                    >
                      <td className="py-2 px-3 tabular-nums whitespace-nowrap">{r.invoiceDate ?? "—"}</td>
                      <td className="py-2 px-3">
                        <div className="truncate max-w-[220px]">{r.partyName ?? "—"}</div>
                        {r.category ? (
                          <div className="text-xs text-ink-muted truncate max-w-[220px]">{r.category}</div>
                        ) : null}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">{r.invoiceNo ?? "—"}</td>
                      <td className="py-2 px-3">
                        <Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">{money(r.total)}</td>
                      <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">{money(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Detail */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        maxWidth="max-w-3xl"
        title={selected ? `${selected.partyName ?? "Invoice"} · ${selected.invoiceNo ?? ""}` : ""}
        actions={
          selected ? (
            <div className="flex items-center gap-2">
              {selected.rawUrl ? (
                <a href={selected.rawUrl} target="_blank" rel="noreferrer">
                  <Button variant="secondary" size="sm">Open in Zoho</Button>
                </a>
              ) : null}
              {isOwner ? (
                <Button variant="danger" size="sm" onClick={() => void onDelete(selected)}>Delete</Button>
              ) : null}
            </div>
          ) : null
        }
      >
        {selected ? (
          <div className="space-y-5">
            {/* Header facts */}
            <div className="flex flex-wrap gap-2">
              <Badge tone={statusTone(selected.status)}>{statusLabel(selected.status)}</Badge>
              <Badge tone="blue">{selected.source}</Badge>
              {selected.category ? <Badge>{selected.category}</Badge> : null}
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
              <Fact label="Invoice date" value={selected.invoiceDate} />
              <Fact label="Due date" value={selected.dueDate} />
              <Fact label="GSTIN" value={selected.gstin} />
              <Fact label="Place of supply" value={selected.placeOfSupply} />
              <Fact label="GST treatment" value={selected.gstTreatment} />
              <Fact label="Currency" value={selected.currency} />
            </dl>

            {/* Line items */}
            <div>
              <div className="text-xs uppercase tracking-wide text-ink-muted mb-2">Line items</div>
              {linesLoading ? (
                <div className="text-sm text-ink-muted py-3">Loading line items…</div>
              ) : lines.length === 0 ? (
                <div className="text-sm text-ink-muted py-3">No line items on this invoice.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-ink-muted border-b border-line">
                        <th className="py-2 pr-3 font-medium">Item</th>
                        <th className="py-2 px-3 font-medium">HSN/SAC</th>
                        <th className="py-2 px-3 font-medium text-right">Qty</th>
                        <th className="py-2 px-3 font-medium text-right">Rate</th>
                        <th className="py-2 px-3 font-medium text-right">Tax %</th>
                        <th className="py-2 pl-3 font-medium text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => (
                        <tr key={l.id} className="border-b border-line/60">
                          <td className="py-2 pr-3">
                            <div>{l.name ?? "—"}</div>
                            {l.description ? (
                              <div className="text-xs text-ink-muted">{l.description}</div>
                            ) : null}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">{l.hsnOrSac ?? "—"}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{l.quantity}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{money(l.rate)}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{l.taxPercentage}</td>
                          <td className="py-2 pl-3 text-right tabular-nums">{money(l.itemTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Totals */}
            <div className="ml-auto w-full sm:w-72 space-y-1.5 text-sm">
              <TotalRow label="Subtotal" value={selected.subTotal} />
              {selected.cgst > 0 ? <TotalRow label="CGST" value={selected.cgst} /> : null}
              {selected.sgst > 0 ? <TotalRow label="SGST" value={selected.sgst} /> : null}
              {selected.igst > 0 ? <TotalRow label="IGST" value={selected.igst} /> : null}
              {selected.cgst === 0 && selected.sgst === 0 && selected.igst === 0 && selected.taxTotal > 0 ? (
                <TotalRow label="Tax" value={selected.taxTotal} />
              ) : null}
              <div className="border-t border-line pt-1.5">
                <TotalRow label="Total" value={selected.total} strong />
              </div>
              <TotalRow label="Balance due" value={selected.balance} />
            </div>

            {selected.notes ? (
              <div className="text-sm">
                <div className="text-xs uppercase tracking-wide text-ink-muted mb-1">Notes</div>
                <div className="text-ink-soft whitespace-pre-wrap">{selected.notes}</div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="text-ink">{value || "—"}</dd>
    </div>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${strong ? "font-semibold" : ""}`}>
      <span className={strong ? "text-ink" : "text-ink-muted"}>{label}</span>
      <span className="tabular-nums">{fmtINR(value)}</span>
    </div>
  );
}
