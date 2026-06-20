// ============================================================================
// Invoices DAL — direct-table reads for the unified `invoices` store.
//
// Rows are written server-side by the Zoho Edge functions (zoho-webhook /
// zoho-sync); the client only READS them (plus an owner-only delete escape
// hatch). This mirrors the project_invoices DAL in projects.ts — load-on-mount,
// no sync-engine wiring, fresh on reload. RLS scopes every query to the
// caller's cinemas + accountant/owner role, so we never pass cinema filters
// for security — only as an optional UI convenience.
// ============================================================================

import { getSupabase } from "./supabase";
import type { InvoiceLineItemRow, InvoiceRow } from "./db-types";
import type { DateISO } from "./types";

export type InvoiceType = "purchase" | "sales";

export interface InvoiceLine {
  id: string;
  invoiceId: string;
  lineNo: number;
  zohoLineId: string | null;
  name: string | null;
  description: string | null;
  hsnOrSac: string | null;
  quantity: number;
  rate: number;
  itemTotal: number;
  taxPercentage: number;
  cgst: number;
  sgst: number;
  igst: number;
  account: string | null;
}

export interface Invoice {
  id: string;
  cinemaId: string;
  type: InvoiceType;
  source: "zoho" | "manual";
  category: string | null;
  zohoOrgId: string | null;
  zohoBranchId: string | null;
  zohoId: string | null;
  partyName: string | null;
  invoiceNo: string | null;
  invoiceDate: DateISO | null;
  dueDate: DateISO | null;
  status: string | null;
  currency: string;
  subTotal: number;
  taxTotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  balance: number;
  gstTreatment: string | null;
  placeOfSupply: string | null;
  gstin: string | null;
  notes: string | null;
  rawUrl: string | null;     // a Zoho deep-link if present in raw
  zohoLastModified: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

const num = (x: unknown): number => {
  const n = Number(x ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function rawLink(raw: Record<string, unknown> | null): string | null {
  // Zoho includes a hosted "invoice_url" / "bill_url" on some payloads.
  const r = (raw ?? {}) as any;
  return (r.invoice_url as string) ?? (r.bill_url as string) ?? null;
}

export const toInvoice = (r: InvoiceRow): Invoice => ({
  id: r.id,
  cinemaId: r.cinema_id,
  type: r.type,
  source: r.source,
  category: r.category ?? null,
  zohoOrgId: r.zoho_org_id ?? null,
  zohoBranchId: r.zoho_branch_id ?? null,
  zohoId: r.zoho_id ?? null,
  partyName: r.party_name ?? null,
  invoiceNo: r.invoice_no ?? null,
  invoiceDate: r.invoice_date ?? null,
  dueDate: r.due_date ?? null,
  status: r.status ?? null,
  currency: r.currency ?? "INR",
  subTotal: num(r.sub_total),
  taxTotal: num(r.tax_total),
  cgst: num(r.cgst),
  sgst: num(r.sgst),
  igst: num(r.igst),
  total: num(r.total),
  balance: num(r.balance),
  gstTreatment: r.gst_treatment ?? null,
  placeOfSupply: r.place_of_supply ?? null,
  gstin: r.gstin ?? null,
  notes: r.notes ?? null,
  rawUrl: rawLink(r.raw),
  zohoLastModified: r.zoho_last_modified ?? null,
  createdAt: r.created_at ?? null,
  updatedAt: r.updated_at ?? null,
});

export const toInvoiceLine = (r: InvoiceLineItemRow): InvoiceLine => ({
  id: r.id,
  invoiceId: r.invoice_id,
  lineNo: r.line_no ?? 0,
  zohoLineId: r.zoho_line_id ?? null,
  name: r.name ?? null,
  description: r.description ?? null,
  hsnOrSac: r.hsn_or_sac ?? null,
  quantity: num(r.quantity),
  rate: num(r.rate),
  itemTotal: num(r.item_total),
  taxPercentage: num(r.tax_percentage),
  cgst: num(r.cgst),
  sgst: num(r.sgst),
  igst: num(r.igst),
  account: r.account ?? null,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface ListInvoicesOpts {
  /** Defaults to 'purchase' (the Invoices page). */
  type?: InvoiceType;
  /** Optional cinema filter (UI convenience; RLS already scopes). */
  cinemaId?: string;
  /** Inclusive invoice_date lower / upper bounds (YYYY-MM-DD). */
  from?: DateISO;
  to?: DateISO;
  /** Cap the result set (newest first). Default 500. */
  limit?: number;
}

export async function listInvoices(opts: ListInvoicesOpts = {}): Promise<Invoice[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb
    .from("invoices")
    .select("*")
    .eq("type", opts.type ?? "purchase")
    .order("invoice_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 500);
  if (opts.cinemaId) q = q.eq("cinema_id", opts.cinemaId);
  if (opts.from) q = q.gte("invoice_date", opts.from);
  if (opts.to) q = q.lte("invoice_date", opts.to);
  const { data, error } = await q;
  if (error) { console.warn("[invoices] listInvoices", error.message); return []; }
  return ((data as InvoiceRow[]) ?? []).map(toInvoice);
}

export async function getInvoiceLines(invoiceId: string): Promise<InvoiceLine[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("invoice_line_items")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("line_no", { ascending: true });
  if (error) { console.warn("[invoices] getInvoiceLines", error.message); return []; }
  return ((data as InvoiceLineItemRow[]) ?? []).map(toInvoiceLine);
}

/** Owner-only at the RLS layer — a rare manual escape hatch. */
export async function deleteInvoice(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.from("invoices").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
