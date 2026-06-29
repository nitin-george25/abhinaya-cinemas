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
import { uploadPaymentReceipt } from "./cash";
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
