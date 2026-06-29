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
  rejectedReason:       string | null;
  approvedByEmail:      string | null;
  approvedBySlackUser:  string | null;
  approvedAt:           string | null;
  paidAt:               string | null;
  createdAt:            string | null;
}

interface PaymentDetailRow {
  id: string; operating_unit_id: string; payment_type_id: string | null;
  payee_name: string; amount: number | string; paid_amount: number | string | null;
  status: string; is_advance: boolean; purpose: string | null; needed_by: string | null;
  invoice_url: string | null; proforma_url: string | null; bank_account_id: string | null;
  paid_via_bank_account_id: string | null; bank_reference: string | null;
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
    payeeName: r.payee_name, amount: Number(r.amount),
    paidAmount: r.paid_amount == null ? null : Number(r.paid_amount),
    status: r.status, isAdvance: !!r.is_advance, purpose: r.purpose, neededBy: r.needed_by,
    invoiceUrl: r.invoice_url, proformaUrl: r.proforma_url,
    bankAccountId: r.bank_account_id, paidViaBankAccountId: r.paid_via_bank_account_id,
    bankReference: r.bank_reference, rejectedReason: r.rejected_reason,
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
