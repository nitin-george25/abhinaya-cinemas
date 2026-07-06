// ============================================================================
// invoiceDocs — console-uploaded purchase invoices that live OUTSIDE the Zoho
// register: PM project-expense invoices (project_invoices) and unified-payment
// invoices (payment_requests.invoice_url). The Finance → Invoices page shows
// these alongside the Zoho Bills so the accountant sees every payable document
// in one place, regardless of where it was uploaded.
// ============================================================================

import { getSupabase } from "./supabase";

export interface ConsoleInvoice {
  id:        string;
  source:    "Project" | "Payment";
  party:     string;          // vendor / payee
  reference: string | null;   // invoice no
  date:      string | null;
  amount:    number | null;
  fileUrl:   string | null;
  context:   string | null;   // project name / payment type
}

interface ProjectInvoiceRow {
  id: string; vendor: string | null; invoice_no: string | null;
  invoice_date: string | null; total: number | string | null; amount: number | string | null;
  file_url: string | null; uploaded_at: string | null;
  projects: { name: string | null } | null;
}

interface PaymentInvoiceRow {
  id: string; payee_name: string; invoice_url: string | null; amount: number | string;
  needed_by: string | null; created_at: string | null;
  payment_types: { name: string | null } | null;
}

/** Project + payment invoices for the cinema, newest first. */
export async function listConsoleInvoices(
  cinemaId: string | null,
  unitIds: string[],
): Promise<ConsoleInvoice[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const out: ConsoleInvoice[] = [];

  // 1) PM project-expense invoices.
  if (cinemaId) {
    const { data, error } = await sb
      .from("project_invoices")
      .select("id, vendor, invoice_no, invoice_date, total, amount, file_url, uploaded_at, projects!inner(name, cinema_id)")
      .eq("projects.cinema_id", cinemaId)
      .order("uploaded_at", { ascending: false });
    if (error) console.warn("[invoiceDocs] project_invoices", error.message);
    for (const r of ((data ?? []) as unknown as ProjectInvoiceRow[])) {
      out.push({
        id: r.id, source: "Project", party: r.vendor ?? "—",
        reference: r.invoice_no, date: r.invoice_date ?? r.uploaded_at,
        amount: r.total != null ? Number(r.total) : (r.amount != null ? Number(r.amount) : null),
        fileUrl: r.file_url, context: r.projects?.name ?? null,
      });
    }
  }

  // 2) Unified-payment invoices (typed payments that carry an uploaded file).
  if (unitIds.length > 0) {
    const { data, error } = await sb
      .from("payment_requests")
      .select("id, payee_name, invoice_url, amount, needed_by, created_at, payment_types(name)")
      .in("operating_unit_id", unitIds)
      .not("invoice_url", "is", null)
      .not("payment_type_id", "is", null)
      .order("created_at", { ascending: false });
    if (error) console.warn("[invoiceDocs] payment_requests", error.message);
    for (const r of ((data ?? []) as unknown as PaymentInvoiceRow[])) {
      out.push({
        id: r.id, source: "Payment", party: r.payee_name,
        reference: null, date: r.needed_by ?? r.created_at,
        amount: Number(r.amount), fileUrl: r.invoice_url,
        context: r.payment_types?.name ?? null,
      });
    }
  }

  out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return out;
}
