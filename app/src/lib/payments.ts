// ============================================================================
// Unified Payments module — domain types + Supabase DAL (phase 1).
//
// Mirrors the migrations payments_01..03. Talks directly to Supabase, the same
// way lib/cash.ts does. The typed "Make a Payment" form writes a row into the
// existing public.payment_requests (extended with type/payee/advance/asset
// columns), created in the 'draft' status. The full §6 lifecycle + inbox land
// in phase 2; file uploads reuse the payment-receipts bucket from cash.ts.
// ============================================================================

import { getSupabase } from "./supabase";
import { uploadPaymentReceipt, listPettyExpenses } from "./cash";
import type { PaymentRequestMode } from "./db-types";
import type { DateISO } from "./types";

// ── Taxonomy ──────────────────────────────────────────────────────────────

export type PaymentInvoiceRule = "required" | "exempt" | "settlement";

export type PaymentPayeeCategory =
  | "distributor" | "vendor" | "landlord" | "employee"
  | "government" | "bank" | "internal" | "other";

/** Human labels for the normalized payee-category token (read-only chip). */
export const PAYEE_CATEGORY_LABEL: Record<PaymentPayeeCategory, string> = {
  distributor: "Distributor",
  vendor:      "Vendor",
  landlord:    "Landlord",
  employee:    "Employee",
  government:  "Government / statutory",
  bank:        "Bank / financial",
  internal:    "Internal (own till)",
  other:       "Other",
};

export interface PaymentType {
  id:                string;
  cinemaId:          string;
  name:              string;
  payeeCategory:     PaymentPayeeCategory;
  invoiceRule:       PaymentInvoiceRule;
  isAsset:           boolean;
  requiresQuotation: boolean;
  quoteSkipFloor:    number;
  accountingHead:    string;
  zohoPush:          boolean;
  active:            boolean;
  sortOrder:         number;
}

interface PaymentTypeRow {
  id:                 string;
  cinema_id:          string;
  name:               string;
  payee_category:     PaymentPayeeCategory;
  invoice_rule:       PaymentInvoiceRule;
  is_asset:           boolean;
  requires_quotation: boolean;
  quote_skip_floor:   number | string;
  accounting_head:    string;
  zoho_push:          boolean;
  active:             boolean;
  sort_order:         number;
}

function mapPaymentType(r: PaymentTypeRow): PaymentType {
  return {
    id:                r.id,
    cinemaId:          r.cinema_id,
    name:              r.name,
    payeeCategory:     r.payee_category,
    invoiceRule:       r.invoice_rule,
    isAsset:           r.is_asset,
    requiresQuotation: r.requires_quotation,
    quoteSkipFloor:    Number(r.quote_skip_floor ?? 0),
    accountingHead:    r.accounting_head,
    zohoPush:          r.zoho_push,
    active:            r.active,
    sortOrder:         r.sort_order,
  };
}

/** Whether this type needs a payee picked from the distributors catalog. */
export function usesDistributorPayee(t: PaymentType): boolean {
  return t.payeeCategory === "distributor";
}

/** Internal (petty-cash top-up) types pay our own till — no external payee. */
export function usesNoPayee(t: PaymentType): boolean {
  return t.payeeCategory === "internal";
}

export async function listPaymentTypes(
  cinemaId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<PaymentType[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb
    .from("payment_types")
    .select("*")
    .eq("cinema_id", cinemaId)
    .order("sort_order");
  if (opts.activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) {
    console.warn("[payments] listPaymentTypes", error.message);
    return [];
  }
  return (data as PaymentTypeRow[] | null ?? []).map(mapPaymentType);
}

// ── Taxonomy editor (owner-only; Settings → Payment Types) ─────────────────

export interface PaymentTypeDraft {
  cinemaId:        string;
  name:            string;
  payeeCategory:   PaymentPayeeCategory;
  invoiceRule:     PaymentInvoiceRule;
  isAsset:         boolean;
  quoteSkipFloor?: number;
  accountingHead:  string;
  zohoPush?:       boolean;
  sortOrder?:      number;
}

export async function createPaymentType(d: PaymentTypeDraft, updatedBy: string): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { data, error } = await sb
    .from("payment_types")
    .insert({
      cinema_id:          d.cinemaId,
      name:               d.name,
      payee_category:     d.payeeCategory,
      invoice_rule:       d.invoiceRule,
      is_asset:           d.isAsset,
      requires_quotation: d.isAsset,
      quote_skip_floor:   d.quoteSkipFloor ?? 0,
      accounting_head:    d.accountingHead,
      zoho_push:          d.zohoPush ?? false,
      sort_order:         d.sortOrder ?? 999,
      updated_by:         updatedBy,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "createPaymentType failed");
  return (data as { id: string }).id;
}

export interface PaymentTypePatch {
  name?:            string;
  payeeCategory?:   PaymentPayeeCategory;
  invoiceRule?:     PaymentInvoiceRule;
  isAsset?:         boolean;
  quoteSkipFloor?:  number;
  accountingHead?:  string;
  zohoPush?:        boolean;
  active?:          boolean;
}

export async function updatePaymentType(
  id: string,
  patch: PaymentTypePatch,
  updatedBy: string,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const row: Record<string, unknown> = { updated_by: updatedBy };
  if (patch.name           !== undefined) row.name             = patch.name;
  if (patch.payeeCategory  !== undefined) row.payee_category   = patch.payeeCategory;
  if (patch.invoiceRule    !== undefined) row.invoice_rule     = patch.invoiceRule;
  if (patch.isAsset        !== undefined) {
    row.is_asset = patch.isAsset;
    row.requires_quotation = patch.isAsset;
  }
  if (patch.quoteSkipFloor !== undefined) row.quote_skip_floor = patch.quoteSkipFloor;
  if (patch.accountingHead !== undefined) row.accounting_head  = patch.accountingHead;
  if (patch.zohoPush       !== undefined) row.zoho_push        = patch.zohoPush;
  if (patch.active         !== undefined) row.active           = patch.active;
  const { error } = await sb.from("payment_types").update(row).eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Proformas (vendor advances) ────────────────────────────────────────────

export interface ProformaDraft {
  cinemaId:  string;
  partyId?:  string | null;
  fileUrl?:  string | null;
  amount?:   number | null;
  notes?:    string | null;
  createdBy: string;
}

export async function createProforma(d: ProformaDraft): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { data, error } = await sb
    .from("payment_proformas")
    .insert({
      cinema_id:  d.cinemaId,
      party_id:   d.partyId ?? null,
      file_url:   d.fileUrl ?? null,
      amount:     d.amount ?? null,
      notes:      d.notes ?? null,
      created_by: d.createdBy,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "createProforma failed");
  return (data as { id: string }).id;
}

/** Upload an invoice / proforma / quote. Reuses the payment-receipts bucket. */
export async function uploadPaymentFile(file: File, uploaderEmail: string): Promise<string> {
  return uploadPaymentReceipt(file, uploaderEmail);
}

// ── Create a typed payment (writes a payment_requests draft) ───────────────

export interface CreatePaymentInput {
  operatingUnitId:     string;
  paymentTypeId:       string;
  bankAccountId?:      string | null;          // intended "paid from" account
  payeeName:           string;
  payeePartyId?:       string | null;
  payeeDistributorId?: string | null;
  payeeAccountLast4?:  string | null;
  payeeIfsc?:          string | null;
  amount:              number;
  mode?:               PaymentRequestMode;       // defaults to bank_transfer
  invoiceUrl?:         string | null;
  isAdvance?:          boolean;
  advanceMovieId?:     string | null;
  advanceProformaId?:  string | null;
  advancePartyId?:     string | null;
  proformaUrl?:        string | null;
  // asset invoice split (phase 4 fills these; kept here for completeness)
  subtotal?:           number | null;
  gst?:                number | null;
  freight?:            number | null;
  total?:              number | null;
  neededBy?:           DateISO | null;
  note?:               string | null;            // free-text → purpose
  typeName?:           string | null;            // fallback purpose
  requestedByEmail:    string;
  status?:             "draft" | "pending";       // defaults to 'draft'
}

export async function createPayment(d: CreatePaymentInput): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  if (!(d.amount > 0)) throw new Error("Enter a positive amount.");
  if (!d.payeeName.trim()) throw new Error("Pick or enter a payee.");

  const purpose = (d.note && d.note.trim())
    || (d.typeName && d.typeName.trim())
    || "Payment";

  const { data, error } = await sb
    .from("payment_requests")
    .insert({
      operating_unit_id:    d.operatingUnitId,
      payment_type_id:      d.paymentTypeId,
      bank_account_id:      d.bankAccountId ?? null,
      needed_by:            d.neededBy ?? null,
      payee_name:           d.payeeName,
      payee_party_id:       d.payeePartyId ?? null,
      payee_distributor_id: d.payeeDistributorId ?? null,
      payee_account_last4:  d.payeeAccountLast4 ?? null,
      payee_ifsc:           d.payeeIfsc ?? null,
      amount:               d.amount,
      mode:                 d.mode ?? "bank_transfer",
      purpose,
      invoice_url:          d.invoiceUrl ?? null,
      is_advance:           d.isAdvance ?? false,
      advance_movie_id:     d.advanceMovieId ?? null,
      advance_proforma_id:  d.advanceProformaId ?? null,
      advance_party_id:     d.advancePartyId ?? null,
      proforma_url:         d.proformaUrl ?? null,
      subtotal:             d.subtotal ?? null,
      gst:                  d.gst ?? null,
      freight:              d.freight ?? null,
      total:                d.total ?? null,
      requested_by_email:   d.requestedByEmail,
      status:               d.status ?? "draft",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "createPayment failed");
  return (data as { id: string }).id;
}

// ── Inbox (phase 2) ─────────────────────────────────────────────────────────

export type PaymentKind = "payment" | "project" | "petty";
export type PaymentLane = "draft" | "awaiting" | "approved" | "paid" | "petty" | "other";

/** Group a status (+ origin) into one of the inbox lanes. */
export function laneOf(status: string, kind: PaymentKind): PaymentLane {
  if (kind === "petty") return "petty";
  switch (status) {
    case "draft":
      return "draft";
    case "pending":
    case "awaiting_approval":
    case "awaiting_payment_approval":
    case "quoting":
    case "quote_approved":
    case "invoiced":
    case "payment_requested":           // project-expense ready-to-pay
      return "awaiting";
    case "approved":
      return "approved";
    case "paid":
    case "posted":
      return "paid";
    default:
      return "other";                    // rejected / cancelled
  }
}

export interface PaymentInboxRow {
  id:             string;
  kind:           PaymentKind;
  payee:          string;
  typeLabel:      string;
  accountingHead: string | null;
  amount:         number;
  source:         string;                // "General" | "Project · X" | "Petty"
  status:         string;
  lane:           PaymentLane;
  isAdvance:      boolean;
  neededBy:       string | null;
  createdAt:      string | null;
  readonly:       boolean;
}

interface InboxPaymentRow {
  id: string; payee_name: string; amount: number | string; status: string;
  is_advance: boolean; needed_by: string | null; created_at: string | null;
  payment_types: { name: string | null; accounting_head: string | null } | null;
}

interface InboxProjectRow {
  id: string; title: string; approved_vendor: string | null;
  approved_amount: number | string | null; paid_amount: number | string | null;
  status: string; created_at: string | null;
  projects: { name: string | null } | null;
}

/**
 * The unified worklist — general payments (the money-out engine) plus the
 * read-only feeders the accountant expects to *see* but not action here:
 * PM project expenses that are ready/paid, and petty till expenses.
 */
export async function listInbox(
  unitIds: string[],
  cinemaId: string | null,
): Promise<PaymentInboxRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const rows: PaymentInboxRow[] = [];

  // 1) General payments (incl. the typed ones from the create form).
  if (unitIds.length > 0) {
    const { data, error } = await sb
      .from("payment_requests")
      .select("id, payee_name, amount, status, is_advance, needed_by, created_at, payment_types(name, accounting_head)")
      .in("operating_unit_id", unitIds)
      .order("created_at", { ascending: false });
    if (error) console.warn("[payments] listInbox/payments", error.message);
    for (const r of (data as InboxPaymentRow[] | null ?? [])) {
      rows.push({
        id: r.id, kind: "payment", payee: r.payee_name,
        typeLabel: r.payment_types?.name ?? "Payment",
        accountingHead: r.payment_types?.accounting_head ?? null,
        amount: Number(r.amount), source: "General",
        status: r.status, lane: laneOf(r.status, "payment"),
        isAdvance: !!r.is_advance, neededBy: r.needed_by, createdAt: r.created_at,
        readonly: false,
      });
    }
  }

  // 2) PM project expenses ready/paid — read-only window onto the same object.
  if (cinemaId) {
    const { data, error } = await sb
      .from("project_expenses")
      .select("id, title, approved_vendor, approved_amount, paid_amount, status, created_at, projects!inner(name, cinema_id)")
      .eq("projects.cinema_id", cinemaId)
      .in("status", ["payment_requested", "paid"])
      .order("created_at", { ascending: false });
    if (error) console.warn("[payments] listInbox/project", error.message);
    for (const r of (data as InboxProjectRow[] | null ?? [])) {
      rows.push({
        id: r.id, kind: "project",
        payee: r.approved_vendor ?? r.title,
        typeLabel: r.title,
        accountingHead: "Project capex",
        amount: Number(r.paid_amount ?? r.approved_amount ?? 0),
        source: `Project · ${r.projects?.name ?? "—"}`,
        status: r.status, lane: laneOf(r.status, "project"),
        isAdvance: false, neededBy: null, createdAt: r.created_at,
        readonly: true,
      });
    }
  }

  // 3) Petty till expenses — always read-only here.
  try {
    const petty = await listPettyExpenses();
    for (const p of petty) {
      rows.push({
        id: p.id, kind: "petty",
        payee: p.paidTo ?? p.description,
        typeLabel: p.category ?? "Petty expense",
        accountingHead: "Petty cash",
        amount: p.amount, source: "Petty",
        status: p.status === "approved" ? "paid" : p.status,
        lane: "petty",
        isAdvance: false, neededBy: null, createdAt: p.createdAt,
        readonly: true,
      });
    }
  } catch (e) { console.warn("[payments] listInbox/petty", (e as Error).message); }

  rows.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return rows;
}

// ── Detail + audit ──────────────────────────────────────────────────────────

export interface PaymentDetail {
  id:                   string;
  operatingUnitId:      string;
  paymentTypeId:        string | null;
  typeName:             string | null;
  accountingHead:       string | null;
  invoiceRule:          PaymentInvoiceRule | null;
  isAsset:              boolean;
  payeeName:            string;
  payeePartyId:         string | null;
  amount:               number;
  paidAmount:           number | null;
  status:               string;
  isAdvance:            boolean;
  purpose:              string | null;
  neededBy:             string | null;
  invoiceUrl:           string | null;
  proformaUrl:          string | null;
  bankAccountId:        string | null;
  paidViaBankAccountId: string | null;
  bankReference:        string | null;
  quoteLockedVendor:    string | null;
  quoteLockedAmount:    number | null;
  rejectedReason:       string | null;
  approvedByEmail:      string | null;
  approvedBySlackUser:  string | null;
  approvedAt:           string | null;
  paidAt:               string | null;
  createdAt:            string | null;
}

interface PaymentDetailRow {
  id: string; operating_unit_id: string; payment_type_id: string | null;
  payee_name: string; payee_party_id: string | null; amount: number | string; paid_amount: number | string | null;
  status: string; is_advance: boolean; purpose: string | null; needed_by: string | null;
  invoice_url: string | null; proforma_url: string | null; bank_account_id: string | null;
  paid_via_bank_account_id: string | null; bank_reference: string | null;
  quote_locked_vendor: string | null; quote_locked_amount: number | string | null;
  rejected_reason: string | null; approved_by_email: string | null;
  approved_by_slack_user: string | null; approved_at: string | null;
  paid_at: string | null; created_at: string | null;
  payment_types: { name: string | null; accounting_head: string | null;
                   invoice_rule: PaymentInvoiceRule | null; is_asset: boolean } | null;
}

export async function getPaymentDetail(id: string): Promise<PaymentDetail | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("payment_requests")
    .select("*, payment_types(name, accounting_head, invoice_rule, is_asset)")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  const r = data as PaymentDetailRow;
  return {
    id: r.id, operatingUnitId: r.operating_unit_id, paymentTypeId: r.payment_type_id,
    typeName: r.payment_types?.name ?? null,
    accountingHead: r.payment_types?.accounting_head ?? null,
    invoiceRule: r.payment_types?.invoice_rule ?? null,
    isAsset: !!r.payment_types?.is_asset,
    payeeName: r.payee_name, payeePartyId: r.payee_party_id, amount: Number(r.amount),
    paidAmount: r.paid_amount == null ? null : Number(r.paid_amount),
    status: r.status, isAdvance: !!r.is_advance, purpose: r.purpose, neededBy: r.needed_by,
    invoiceUrl: r.invoice_url, proformaUrl: r.proforma_url,
    bankAccountId: r.bank_account_id, paidViaBankAccountId: r.paid_via_bank_account_id,
    bankReference: r.bank_reference,
    quoteLockedVendor: r.quote_locked_vendor,
    quoteLockedAmount: r.quote_locked_amount == null ? null : Number(r.quote_locked_amount),
    rejectedReason: r.rejected_reason,
    approvedByEmail: r.approved_by_email, approvedBySlackUser: r.approved_by_slack_user,
    approvedAt: r.approved_at, paidAt: r.paid_at, createdAt: r.created_at,
  };
}

export interface PaymentAuditEntry {
  id: string; fromStatus: string | null; toStatus: string | null;
  actorEmail: string | null; actorSlackUser: string | null;
  note: string | null; createdAt: string;
}

export async function listPaymentAudit(id: string): Promise<PaymentAuditEntry[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("payment_audit")
    .select("*")
    .eq("payment_id", id)
    .order("created_at", { ascending: true });
  if (error) { console.warn("[payments] listPaymentAudit", error.message); return []; }
  return (data as Array<{
    id: string; from_status: string | null; to_status: string | null;
    actor_email: string | null; actor_slack_user: string | null;
    note: string | null; created_at: string;
  }> | null ?? []).map((r) => ({
    id: r.id, fromStatus: r.from_status, toStatus: r.to_status,
    actorEmail: r.actor_email, actorSlackUser: r.actor_slack_user,
    note: r.note, createdAt: r.created_at,
  }));
}

// ── Transitions (SECURITY DEFINER RPCs) ─────────────────────────────────────

export async function submitPayment(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.rpc("fn_payment_submit", { p_payment_id: id });
  if (error) throw new Error(error.message);
}

export async function approvePayment(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.rpc("fn_payment_approve", { p_payment_id: id });
  if (error) throw new Error(error.message);
}

export async function rejectPayment(id: string, reason: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.rpc("fn_payment_reject", { p_payment_id: id, p_reason: reason });
  if (error) throw new Error(error.message);
}

export interface MarkPaidInput {
  bankAccountId: string;
  reference?:    string | null;
  paidAmount?:   number | null;
  paidReason?:   string | null;
  paidDate?:     DateISO | null;
}

export async function markPaid(id: string, d: MarkPaidInput): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.rpc("fn_payment_mark_paid", {
    p_payment_id:     id,
    p_bank_account_id: d.bankAccountId,
    p_reference:      d.reference ?? null,
    p_paid_amount:    d.paidAmount ?? null,
    p_paid_reason:    d.paidReason ?? null,
    p_paid_date:      d.paidDate ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function cancelPayment(id: string, reason: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.rpc("fn_payment_cancel", { p_payment_id: id, p_reason: reason });
  if (error) throw new Error(error.message);
}

// ── Asset quotations (phase 4) ──────────────────────────────────────────────

export interface PaymentQuotation {
  id:          string;
  paymentId:   string;
  vendor:      string;
  amount:      number;
  fileUrl:     string;
  leadTime:    string | null;
  warranty:    string | null;
  notes:       string | null;
  status:      "submitted" | "approved" | "rejected";
  submittedBy: string | null;
  submittedAt: string;
}

export async function listQuotations(paymentId: string): Promise<PaymentQuotation[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("payment_quotations")
    .select("*")
    .eq("payment_id", paymentId)
    .order("amount", { ascending: true });
  if (error) { console.warn("[payments] listQuotations", error.message); return []; }
  return (data as Array<{
    id: string; payment_id: string; vendor: string; amount: number | string;
    file_url: string; lead_time: string | null; warranty: string | null;
    notes: string | null; status: PaymentQuotation["status"];
    submitted_by: string | null; submitted_at: string;
  }> | null ?? []).map((r) => ({
    id: r.id, paymentId: r.payment_id, vendor: r.vendor, amount: Number(r.amount),
    fileUrl: r.file_url, leadTime: r.lead_time, warranty: r.warranty, notes: r.notes,
    status: r.status, submittedBy: r.submitted_by, submittedAt: r.submitted_at,
  }));
}

export interface QuotationDraft {
  vendor: string; amount: number; fileUrl: string;
  leadTime?: string | null; warranty?: string | null; notes?: string | null;
}

export async function addQuotation(paymentId: string, d: QuotationDraft): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.rpc("fn_quote_add", {
    p_payment_id: paymentId, p_vendor: d.vendor, p_amount: d.amount, p_file_url: d.fileUrl,
    p_lead_time: d.leadTime ?? null, p_warranty: d.warranty ?? null, p_notes: d.notes ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function approveQuotation(quotationId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.rpc("fn_quote_approve", { p_quotation_id: quotationId });
  if (error) throw new Error(error.message);
}

export async function skipQuotation(paymentId: string, reason: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.rpc("fn_quote_skip", { p_payment_id: paymentId, p_reason: reason });
  if (error) throw new Error(error.message);
}

export interface AssetInvoiceInput {
  subtotal: number; gst?: number | null; freight?: number | null;
  fileUrl: string; deviationReason?: string | null;
}

export async function attachAssetInvoice(paymentId: string, d: AssetInvoiceInput): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.rpc("fn_payment_attach_invoice", {
    p_payment_id: paymentId, p_subtotal: d.subtotal, p_gst: d.gst ?? 0, p_freight: d.freight ?? 0,
    p_file_url: d.fileUrl, p_deviation_reason: d.deviationReason ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Asset payments still in the quotation/invoice stages (for the Quotations page). */
export async function listAssetPayments(unitIds: string[]): Promise<PaymentInboxRow[]> {
  const sb = getSupabase();
  if (!sb || unitIds.length === 0) return [];
  const { data, error } = await sb
    .from("payment_requests")
    .select("id, payee_name, amount, status, is_advance, needed_by, created_at, payment_types!inner(name, accounting_head, is_asset)")
    .in("operating_unit_id", unitIds)
    .eq("payment_types.is_asset", true)
    .in("status", ["draft", "quoting", "quote_approved", "invoiced"])
    .order("created_at", { ascending: false });
  if (error) { console.warn("[payments] listAssetPayments", error.message); return []; }
  // The typed client infers the `!inner` embed as an array; at runtime a
  // many-to-one embed is a single object — cast through unknown and read it so.
  return ((data ?? []) as unknown as InboxPaymentRow[]).map((r) => ({
    id: r.id, kind: "payment" as PaymentKind, payee: r.payee_name,
    typeLabel: r.payment_types?.name ?? "Asset", accountingHead: r.payment_types?.accounting_head ?? null,
    amount: Number(r.amount), source: "General", status: r.status, lane: laneOf(r.status, "payment"),
    isAdvance: !!r.is_advance, neededBy: r.needed_by, createdAt: r.created_at, readonly: false,
  }));
}

// ── Advances & netting (phase 5) ────────────────────────────────────────────

export interface OutstandingAdvance {
  id:            string;
  payee:         string;
  kind:          "vendor" | "distributor";
  partyId:       string | null;
  distributorId: string | null;
  paid:          number;
  applied:       number;
  balance:       number;
  createdAt:     string | null;
}

interface AdvanceRow {
  id: string; payee_name: string; amount: number | string;
  advance_party_id: string | null; payee_party_id: string | null;
  payee_distributor_id: string | null; created_at: string | null;
}

/** All paid advances (vendor + distributor) with how much has been netted. */
export async function listOutstandingAdvances(unitIds: string[]): Promise<OutstandingAdvance[]> {
  const sb = getSupabase();
  if (!sb || unitIds.length === 0) return [];
  const { data, error } = await sb
    .from("payment_requests")
    .select("id, payee_name, amount, advance_party_id, payee_party_id, payee_distributor_id, created_at")
    .in("operating_unit_id", unitIds)
    .eq("is_advance", true)
    .in("status", ["paid", "posted"]);
  if (error) { console.warn("[payments] listOutstandingAdvances", error.message); return []; }
  const rows = (data as AdvanceRow[] | null ?? []);
  const ids = rows.map((r) => r.id);
  const applied = await appliedByAdvance(ids);
  return rows.map((r) => {
    const paid = Number(r.amount);
    const used = applied[r.id] ?? 0;
    return {
      id: r.id, payee: r.payee_name,
      kind: r.payee_distributor_id ? "distributor" : "vendor",
      partyId: r.advance_party_id ?? r.payee_party_id,
      distributorId: r.payee_distributor_id,
      paid, applied: used, balance: paid - used, createdAt: r.created_at,
    };
  });
}

/** Sum of amount_applied per advance payment id. */
async function appliedByAdvance(advanceIds: string[]): Promise<Record<string, number>> {
  const sb = getSupabase();
  if (!sb || advanceIds.length === 0) return {};
  const { data } = await sb
    .from("payment_advance_links")
    .select("advance_payment_id, amount_applied")
    .in("advance_payment_id", advanceIds);
  const out: Record<string, number> = {};
  for (const r of (data as Array<{ advance_payment_id: string; amount_applied: number | string }> | null ?? [])) {
    out[r.advance_payment_id] = (out[r.advance_payment_id] ?? 0) + Number(r.amount_applied);
  }
  return out;
}

/** Total advances already applied to a final payment (for the net at mark-paid). */
export async function appliedTotalForPayment(finalPaymentId: string): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;
  const { data } = await sb
    .from("payment_advance_links")
    .select("amount_applied")
    .eq("final_payment_id", finalPaymentId);
  return (data as Array<{ amount_applied: number | string }> | null ?? [])
    .reduce((a, r) => a + Number(r.amount_applied), 0);
}

export interface AdvanceApplication { advanceId: string; amount: number; }

export async function netAdvances(finalPaymentId: string, apps: AdvanceApplication[]): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.rpc("fn_net_advances", {
    p_final_payment_id: finalPaymentId,
    p_advance_ids: apps.map((a) => a.advanceId),
    p_amounts: apps.map((a) => a.amount),
  });
  if (error) throw new Error(error.message);
}

// ── Slack approval card (phase 3) ───────────────────────────────────────────
// Best-effort: a Slack hiccup must never block the underlying transition.

/** Post the interactive #payments approval card after a payment is submitted. */
export async function postPaymentCard(id: string, deepLink?: string | null): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.functions.invoke("notify-slack", {
      body: { kind: "payment_card", paymentId: id, deepLink: deepLink ?? null },
    });
  } catch (e) { console.warn("[payments] postPaymentCard", (e as Error).message); }
}

/** Edit the posted card in place after a console-side decision. */
export async function syncPaymentCard(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.functions.invoke("notify-slack", { body: { kind: "payment_card_decided", paymentId: id } });
  } catch (e) { console.warn("[payments] syncPaymentCard", (e as Error).message); }
}

// ── Zoho F&B push (phase 6) ─────────────────────────────────────────────────

export interface ZohoPushStatus {
  status:        "queued" | "synced" | "failed" | "skipped";
  error:         string | null;
  zohoExpenseId: string | null;
}

/** Best-effort: a Zoho hiccup must never block the payment being paid. */
export async function pushPaymentToZoho(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try { await sb.functions.invoke("payments-zoho-push", { body: { paymentId: id } }); }
  catch (e) { console.warn("[payments] pushPaymentToZoho", (e as Error).message); }
}

export async function getZohoPushStatus(id: string): Promise<ZohoPushStatus | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from("payment_zoho_pushes")
    .select("status, error, zoho_expense_id")
    .eq("payment_id", id)
    .maybeSingle();
  if (!data) return null;
  const d = data as { status: ZohoPushStatus["status"]; error: string | null; zoho_expense_id: string | null };
  return { status: d.status, error: d.error, zohoExpenseId: d.zoho_expense_id };
}
