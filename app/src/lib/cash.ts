// ============================================================================
// Cash management — domain types + Supabase DAL.
//
// Mirrors migrations/cash-management/*.sql. Talks directly to Supabase
// (no dual-write blob); the catalog dual-write only exists for legacy
// migration, cash management is normalized-only from day 1.
// ============================================================================

import { getSupabase } from "./supabase";
import type {
  BankAccountRow,
  BankLedgerEntryRow,
  CashClosingDenominationRow,
  CashClosingPaymentMethodRow,
  CashDepositRow,
  CashDepositStatus,
  ClosingShift,
  ClosingStatus,
  DailyCashClosingRow,
  LedgerSourceKind,
  OperatingUnitRow,
  PartyRow,
  PartyType,
  PaymentFlowType,
  PaymentMethodRow,
  PaymentRequestMode,
  PaymentRequestRow,
  PaymentRequestStatus,
  PettyExpenseRow,
  PettyExpenseStatus,
  PosCounterRow,
  PosSettlementClosingRow,
  PosSettlementRow,
  PosSettlementStatus,
} from "./db-types";
import type { DateISO } from "./types";

// Re-export the snake-case enum unions so consumers of this module don't
// have to reach into db-types.
export type {
  CashDepositStatus,
  ClosingShift,
  ClosingStatus,
  LedgerSourceKind,
  PartyType,
  PaymentFlowType,
  PaymentRequestMode,
  PaymentRequestStatus,
  PettyExpenseStatus,
  PosSettlementStatus,
} from "./db-types";

// ── Domain types (camelCase) ────────────────────────────────────────────

export interface OperatingUnit {
  id:                  string;
  cinemaId:            string;
  name:                string;
  kind:                "box_office" | "food_beverage" | "other";
  displayOrder:        number;
  archivedAt:          string | null;
  /** Recommended cash float to retain in till. Migration 10. */
  defaultFloatAmount:  number;
}

/** POS counter (till) inside an operating unit. Migration 18. */
export interface PosCounter {
  id:               string;
  cinemaId:         string;
  operatingUnitId:  string;
  name:             string;
  displayOrder:     number;
  archivedAt:       string | null;
}

export interface BankAccount {
  id:                  string;
  cinemaId:            string;
  operatingUnitId:     string;
  name:                string;
  bankName:            string | null;
  accountNumberLast4:  string | null;
  openingBalance:      number;
  openingDate:         DateISO;
  isPrimary:           boolean;
  archivedAt:          string | null;
}

export interface PaymentMethod {
  id:                 string;
  cinemaId:           string;
  code:               string;
  displayName:        string;
  flowType:           PaymentFlowType;
  receivesIntoBank:   string | null;
  displayOrder:       number;
  archivedAt:         string | null;
}

export interface CashDenomination {
  denomination: number;
  count:        number;
}

export interface CashClosingPaymentMethod {
  paymentMethodId: string;
  /** POS-reported amount for this mode. */
  amount:          number;
  /** Actual settled amount (EDC machine / UPI app total). Autofilled
   *  from `amount` by the closing form; edited when they differ.
   *  Null/undefined = not recorded (pre-cash_17 rows). */
  actualAmount?:   number | null;
}

export interface DailyCashClosing {
  id:                      string;
  operatingUnitId:         string;
  /** POS counter this closing belongs to. Migration 18. */
  posCounterId:            string;
  businessDate:            DateISO;
  shift:                   ClosingShift;
  cashierEmail:            string | null;
  closedByEmail:           string;

  posTotalSales:           number;
  posNonCashTotal:         number;
  posCashExpected:         number;

  cashCounted:             number;
  pettyExpensesPaid:       number;
  cashDeposited:           number;
  /** Sum of actual settlements across non-cash modes (cash_19). */
  nonCashActualTotal:      number;
  /** cash counted + petty paid + non-cash actual (generated, cash_19). */
  actualTotal:             number;
  /** actualTotal - posTotalSales (generated, cash_19). */
  discrepancy:             number;

  notes:                   string | null;
  status:                  ClosingStatus;
  cashierSignedAt:         string | null;
  cashierSignedByEmail:    string | null;
  managerSignedByEmail:    string | null;
  signedAt:                string | null;

  edcSlipUrl:              string | null;

  denominations:           CashDenomination[];
  paymentMethods:          CashClosingPaymentMethod[];
}

export interface CashDeposit {
  id:                  string;
  closingId:           string | null;
  operatingUnitId:     string;
  bankAccountId:       string;
  depositDate:         DateISO;
  depositedAmount:     number;
  retainedAmount:      number;
  slipUrl:             string | null;
  slipReference:       string | null;
  depositedByEmail:    string;
  status:              CashDepositStatus;
  notes:               string | null;
  createdAt:           string | null;
}

export interface PosSettlement {
  id:                  string;
  cinemaId:            string;
  paymentMethodId:     string;
  bankAccountId:       string;
  settlementDate:      DateISO;
  expectedAmount:      number;
  receivedAmount:      number;
  feeAmount:           number;
  bankReference:       string | null;
  slipUrl:             string | null;
  notes:               string | null;
  status:              PosSettlementStatus;
  receivedByEmail:     string | null;
  receivedAt:          string | null;
  /** IDs of closings this settlement covers. Populated from the join
   *  table by listPosSettlements / getPosSettlement. */
  closingIds:          string[];
  createdAt:           string | null;
}

export interface Party {
  id:           string;
  cinemaId:     string;
  name:         string;
  partyType:    PartyType;
  category:     string | null;
  contactName:  string | null;
  phone:        string | null;
  email:        string | null;
  gstin:        string | null;
  pan:          string | null;
  accountLast4: string | null;
  ifsc:         string | null;
  notes:        string | null;
  archivedAt:   string | null;
}

export interface PettyExpense {
  id:                   string;
  operatingUnitId:      string;
  /** POS counter the expense was paid from. Required from migration 18. */
  posCounterId:         string;
  expenseDate:          DateISO;
  amount:               number;
  category:             string | null;
  description:          string;
  paidTo:               string | null;
  requestedByEmail:     string;
  approvedByEmail:      string | null;
  approvedAt:           string | null;
  rejectedReason:       string | null;
  receiptUrl:           string | null;
  /** Required when receiptUrl is null. CHECK constraint server-side. */
  noReceiptReason:      string | null;
  status:               PettyExpenseStatus;
  reconciledClosingId:  string | null;
  createdAt:            string | null;
}

export interface PaymentRequest {
  id:                     string;
  operatingUnitId:        string;
  neededBy:               DateISO | null;
  payeeName:              string;
  payeeAccountLast4:      string | null;
  payeeIfsc:              string | null;
  amount:                 number;
  mode:                   PaymentRequestMode;
  purpose:                string;
  invoiceUrl:             string | null;
  requestedByEmail:       string;
  approvedByEmail:        string | null;
  approvedAt:             string | null;
  rejectedReason:         string | null;
  paidAt:                 string | null;
  paidViaBankAccountId:   string | null;
  bankReference:          string | null;
  status:                 PaymentRequestStatus;
  createdAt:              string | null;
}

export interface BankLedgerEntry {
  id:              string;
  bankAccountId:   string;
  entryDate:       DateISO;
  narration:       string;
  receiptAmount:   number;
  paymentAmount:   number;
  sourceKind:      LedgerSourceKind;
  sourceId:        string | null;
  bankReference:   string | null;
  reconciledAt:    string | null;
  notes:           string | null;
  partyId:         string | null;
}

// ── Row → domain mappers ────────────────────────────────────────────────

export function mapOperatingUnit(r: OperatingUnitRow): OperatingUnit {
  return {
    id: r.id,
    cinemaId: r.cinema_id,
    name: r.name,
    kind: r.kind,
    displayOrder: r.display_order,
    archivedAt: r.archived_at,
    defaultFloatAmount: Number(r.default_float_amount ?? 0),
  };
}

export function mapPosCounter(r: PosCounterRow): PosCounter {
  return {
    id: r.id,
    cinemaId: r.cinema_id,
    operatingUnitId: r.operating_unit_id,
    name: r.name,
    displayOrder: r.display_order,
    archivedAt: r.archived_at,
  };
}

export function mapCashDeposit(r: CashDepositRow): CashDeposit {
  return {
    id: r.id,
    closingId: r.closing_id,
    operatingUnitId: r.operating_unit_id,
    bankAccountId: r.bank_account_id,
    depositDate: r.deposit_date,
    depositedAmount: Number(r.deposited_amount ?? 0),
    retainedAmount: Number(r.retained_amount ?? 0),
    slipUrl: r.slip_url,
    slipReference: r.slip_reference,
    depositedByEmail: r.deposited_by_email,
    status: r.status,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

export function mapPosSettlement(
  r: PosSettlementRow,
  closings: PosSettlementClosingRow[] = [],
): PosSettlement {
  return {
    id: r.id,
    cinemaId: r.cinema_id,
    paymentMethodId: r.payment_method_id,
    bankAccountId: r.bank_account_id,
    settlementDate: r.settlement_date,
    expectedAmount: Number(r.expected_amount ?? 0),
    receivedAmount: Number(r.received_amount ?? 0),
    feeAmount: Number(r.fee_amount ?? 0),
    bankReference: r.bank_reference,
    slipUrl: r.slip_url,
    notes: r.notes,
    status: r.status,
    receivedByEmail: r.received_by_email,
    receivedAt: r.received_at,
    closingIds: closings
      .filter((c) => c.settlement_id === r.id)
      .map((c) => c.closing_id),
    createdAt: r.created_at,
  };
}

export function mapBankAccount(r: BankAccountRow): BankAccount {
  return {
    id: r.id,
    cinemaId: r.cinema_id,
    operatingUnitId: r.operating_unit_id,
    name: r.name,
    bankName: r.bank_name,
    accountNumberLast4: r.account_number_last4,
    openingBalance: Number(r.opening_balance ?? 0),
    openingDate: r.opening_date,
    isPrimary: !!r.is_primary,
    archivedAt: r.archived_at,
  };
}

export function mapPaymentMethod(r: PaymentMethodRow): PaymentMethod {
  return {
    id: r.id,
    cinemaId: r.cinema_id,
    code: r.code,
    displayName: r.display_name,
    flowType: r.flow_type,
    receivesIntoBank: r.receives_into_bank,
    displayOrder: r.display_order,
    archivedAt: r.archived_at,
  };
}

export function mapClosing(
  r: DailyCashClosingRow,
  denoms: CashClosingDenominationRow[] = [],
  pms: CashClosingPaymentMethodRow[] = [],
): DailyCashClosing {
  return {
    id: r.id,
    operatingUnitId: r.operating_unit_id,
    posCounterId: r.pos_counter_id,
    businessDate: r.business_date,
    shift: r.shift,
    cashierEmail: r.cashier_email,
    closedByEmail: r.closed_by_email,
    posTotalSales: Number(r.pos_total_sales ?? 0),
    posNonCashTotal: Number(r.pos_non_cash_total ?? 0),
    posCashExpected: Number(r.pos_cash_expected ?? 0),
    cashCounted: Number(r.cash_counted ?? 0),
    pettyExpensesPaid: Number(r.petty_expenses_paid ?? 0),
    cashDeposited: Number(r.cash_deposited ?? 0),
    nonCashActualTotal: Number(r.non_cash_actual_total ?? 0),
    actualTotal: Number(r.actual_total ?? 0),
    discrepancy: Number(r.discrepancy ?? 0),
    notes: r.notes,
    status: r.status,
    cashierSignedAt: r.cashier_signed_at,
    cashierSignedByEmail: r.cashier_signed_by_email,
    managerSignedByEmail: r.manager_signed_by_email,
    signedAt: r.signed_at,
    edcSlipUrl: r.edc_slip_url,
    denominations: denoms
      .filter((d) => d.closing_id === r.id)
      .map((d) => ({ denomination: Number(d.denomination), count: d.count })),
    paymentMethods: pms
      .filter((p) => p.closing_id === r.id)
      .map((p) => ({
        paymentMethodId: p.payment_method_id,
        amount: Number(p.amount),
        actualAmount: p.actual_amount == null ? null : Number(p.actual_amount),
      })),
  };
}

export function mapParty(r: PartyRow): Party {
  return {
    id: r.id,
    cinemaId: r.cinema_id,
    name: r.name,
    partyType: r.party_type,
    category: r.category,
    contactName: r.contact_name,
    phone: r.phone,
    email: r.email,
    gstin: r.gstin,
    pan: r.pan,
    accountLast4: r.account_last4,
    ifsc: r.ifsc,
    notes: r.notes,
    archivedAt: r.archived_at,
  };
}

export function mapPettyExpense(r: PettyExpenseRow): PettyExpense {
  return {
    id: r.id,
    operatingUnitId: r.operating_unit_id,
    posCounterId: r.pos_counter_id,
    expenseDate: r.expense_date,
    amount: Number(r.amount ?? 0),
    category: r.category,
    description: r.description,
    paidTo: r.paid_to,
    requestedByEmail: r.requested_by_email,
    approvedByEmail: r.approved_by_email,
    approvedAt: r.approved_at,
    rejectedReason: r.rejected_reason,
    receiptUrl: r.receipt_url,
    noReceiptReason: r.no_receipt_reason,
    status: r.status,
    reconciledClosingId: r.reconciled_closing_id,
    createdAt: r.created_at,
  };
}

export function mapPaymentRequest(r: PaymentRequestRow): PaymentRequest {
  return {
    id: r.id,
    operatingUnitId: r.operating_unit_id,
    neededBy: r.needed_by,
    payeeName: r.payee_name,
    payeeAccountLast4: r.payee_account_last4,
    payeeIfsc: r.payee_ifsc,
    amount: Number(r.amount ?? 0),
    mode: r.mode,
    purpose: r.purpose,
    invoiceUrl: r.invoice_url,
    requestedByEmail: r.requested_by_email,
    approvedByEmail: r.approved_by_email,
    approvedAt: r.approved_at,
    rejectedReason: r.rejected_reason,
    paidAt: r.paid_at,
    paidViaBankAccountId: r.paid_via_bank_account_id,
    bankReference: r.bank_reference,
    status: r.status,
    createdAt: r.created_at,
  };
}

export function mapLedgerEntry(r: BankLedgerEntryRow): BankLedgerEntry {
  return {
    id: r.id,
    bankAccountId: r.bank_account_id,
    entryDate: r.entry_date,
    narration: r.narration,
    receiptAmount: Number(r.receipt_amount ?? 0),
    paymentAmount: Number(r.payment_amount ?? 0),
    sourceKind: r.source_kind,
    sourceId: r.source_id,
    bankReference: r.bank_reference,
    reconciledAt: r.reconciled_at,
    notes: r.notes,
    partyId: r.party_id,
  };
}

// ── DAL — reads ─────────────────────────────────────────────────────────

export async function listOperatingUnits(cinemaId: string): Promise<OperatingUnit[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("operating_units")
    .select("*")
    .eq("cinema_id", cinemaId)
    .is("archived_at", null)
    .order("display_order");
  if (error) {
    console.warn("[cash] listOperatingUnits", error.message);
    return [];
  }
  return (data as OperatingUnitRow[] | null ?? []).map(mapOperatingUnit);
}

/** Active POS counters for the cinema, ordered for dropdowns. Filter by
 *  operating unit client-side (`c.operatingUnitId === unitId`). */
export async function listPosCounters(cinemaId: string): Promise<PosCounter[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("pos_counters")
    .select("*")
    .eq("cinema_id", cinemaId)
    .is("archived_at", null)
    .order("display_order")
    .order("created_at");
  if (error) {
    console.warn("[cash] listPosCounters", error.message);
    return [];
  }
  return (data as PosCounterRow[] | null ?? []).map(mapPosCounter);
}

export interface PosCounterDraft {
  cinemaId:         string;
  operatingUnitId:  string;
  name:             string;
  displayOrder?:    number;
}

/** Owner-only per RLS — mirrors operating_units write policy. */
export async function createPosCounter(d: PosCounterDraft, updatedBy: string): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { data, error } = await sb
    .from("pos_counters")
    .insert({
      cinema_id:         d.cinemaId,
      operating_unit_id: d.operatingUnitId,
      name:              d.name,
      display_order:     d.displayOrder ?? 10,
      updated_by:        updatedBy,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "createPosCounter failed");
  return (data as { id: string }).id;
}

export async function renamePosCounter(id: string, name: string, updatedBy: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb
    .from("pos_counters")
    .update({ name, updated_at: new Date().toISOString(), updated_by: updatedBy })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Soft-delete. Closings/expenses keep their FK; the counter just stops
 *  showing up in dropdowns. */
export async function archivePosCounter(id: string, updatedBy: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb
    .from("pos_counters")
    .update({
      archived_at: new Date().toISOString(),
      updated_at:  new Date().toISOString(),
      updated_by:  updatedBy,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listBankAccounts(cinemaId: string): Promise<BankAccount[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("bank_accounts")
    .select("*")
    .eq("cinema_id", cinemaId)
    .is("archived_at", null)
    .order("is_primary", { ascending: false })
    .order("created_at");
  if (error) {
    console.warn("[cash] listBankAccounts", error.message);
    return [];
  }
  return (data as BankAccountRow[] | null ?? []).map(mapBankAccount);
}

export async function listPaymentMethods(cinemaId: string): Promise<PaymentMethod[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("payment_methods")
    .select("*")
    .eq("cinema_id", cinemaId)
    .is("archived_at", null)
    .order("display_order");
  if (error) {
    console.warn("[cash] listPaymentMethods", error.message);
    return [];
  }
  return (data as PaymentMethodRow[] | null ?? []).map(mapPaymentMethod);
}

/**
 * Payment methods scoped to one operating unit.
 *
 * Reads the operating_unit_payment_methods join (added in migration 11).
 * If the unit has no mappings yet (legacy data), falls back to ALL
 * cinema-level methods so the closing form never goes empty.
 */
export async function listPaymentMethodsForUnit(
  cinemaId: string,
  operatingUnitId: string,
): Promise<PaymentMethod[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("operating_unit_payment_methods")
    .select("payment_method_id, display_order")
    .eq("operating_unit_id", operatingUnitId)
    .order("display_order");
  if (error) {
    console.warn("[cash] listPaymentMethodsForUnit", error.message);
    // Fall back to full cinema list on RLS / network errors so the form
    // is still usable. The mapping is an opt-in scoping mechanism, not a
    // hard requirement.
    return listPaymentMethods(cinemaId);
  }
  const ids = (data as Array<{ payment_method_id: string; display_order: number }> | null ?? [])
    .map((r) => r.payment_method_id);
  if (ids.length === 0) {
    // No mapping → fall back so legacy / unconfigured units stay usable.
    return listPaymentMethods(cinemaId);
  }
  const all = await listPaymentMethods(cinemaId);
  // Preserve the mapping's display order, not the global one.
  const orderById = new Map(
    (data as Array<{ payment_method_id: string; display_order: number }>).map(
      (r) => [r.payment_method_id, r.display_order] as const,
    ),
  );
  return all
    .filter((m) => orderById.has(m.id))
    .sort((a, b) => (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0));
}

/**
 * Assign / unassign a payment method to an operating unit.
 * Owner-only per migration 11 RLS.
 */
export async function setOperatingUnitMethods(
  operatingUnitId: string,
  methodIds: string[],
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  // Read-then-diff. Simpler than an upsert + delete for a small list.
  const { data, error: e1 } = await sb
    .from("operating_unit_payment_methods")
    .select("payment_method_id")
    .eq("operating_unit_id", operatingUnitId);
  if (e1) throw new Error(e1.message);
  const current = new Set(
    (data as Array<{ payment_method_id: string }> | null ?? []).map((r) => r.payment_method_id),
  );
  const next = new Set(methodIds);
  const toAdd = methodIds.filter((id) => !current.has(id));
  const toRemove = Array.from(current).filter((id) => !next.has(id));

  if (toAdd.length > 0) {
    const { error } = await sb
      .from("operating_unit_payment_methods")
      .insert(toAdd.map((id, i) => ({
        operating_unit_id: operatingUnitId,
        payment_method_id: id,
        display_order: (i + 1) * 10,
      })));
    if (error) throw new Error(error.message);
  }
  if (toRemove.length > 0) {
    const { error } = await sb
      .from("operating_unit_payment_methods")
      .delete()
      .eq("operating_unit_id", operatingUnitId)
      .in("payment_method_id", toRemove);
    if (error) throw new Error(error.message);
  }
}

export interface ClosingListFilter {
  operatingUnitId?: string;
  posCounterId?: string;
  from?: DateISO;
  to?: DateISO;
  status?: ClosingStatus;
}

export async function listClosings(filter: ClosingListFilter = {}): Promise<DailyCashClosing[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb.from("daily_cash_closings").select("*").order("business_date", { ascending: false });
  if (filter.operatingUnitId) q = q.eq("operating_unit_id", filter.operatingUnitId);
  if (filter.posCounterId) q = q.eq("pos_counter_id", filter.posCounterId);
  if (filter.from) q = q.gte("business_date", filter.from);
  if (filter.to) q = q.lte("business_date", filter.to);
  if (filter.status) q = q.eq("status", filter.status);
  const { data, error } = await q;
  if (error) {
    console.warn("[cash] listClosings", error.message);
    return [];
  }
  const rows = (data as DailyCashClosingRow[] | null) ?? [];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [denoms, pms] = await Promise.all([
    sb.from("cash_closing_denominations").select("*").in("closing_id", ids),
    sb.from("cash_closing_payment_methods").select("*").in("closing_id", ids),
  ]);
  const dRows = (denoms.data as CashClosingDenominationRow[] | null) ?? [];
  const pRows = (pms.data as CashClosingPaymentMethodRow[] | null) ?? [];
  return rows.map((r) => mapClosing(r, dRows, pRows));
}

export async function getClosing(id: string): Promise<DailyCashClosing | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const [row, dq, pq] = await Promise.all([
    sb.from("daily_cash_closings").select("*").eq("id", id).maybeSingle(),
    sb.from("cash_closing_denominations").select("*").eq("closing_id", id),
    sb.from("cash_closing_payment_methods").select("*").eq("closing_id", id),
  ]);
  const r = row.data as DailyCashClosingRow | null;
  if (!r) return null;
  return mapClosing(
    r,
    (dq.data as CashClosingDenominationRow[] | null) ?? [],
    (pq.data as CashClosingPaymentMethodRow[] | null) ?? [],
  );
}

export interface PettyFilter {
  operatingUnitId?: string;
  posCounterId?:     string;
  status?:           PettyExpenseStatus;
  requestedByEmail?: string;
  from?:             DateISO;
  to?:               DateISO;
}

export async function listPettyExpenses(filter: PettyFilter = {}): Promise<PettyExpense[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb.from("petty_expenses").select("*").order("expense_date", { ascending: false });
  if (filter.operatingUnitId) q = q.eq("operating_unit_id", filter.operatingUnitId);
  if (filter.posCounterId) q = q.eq("pos_counter_id", filter.posCounterId);
  if (filter.status) q = q.eq("status", filter.status);
  if (filter.requestedByEmail) q = q.eq("requested_by_email", filter.requestedByEmail);
  if (filter.from) q = q.gte("expense_date", filter.from);
  if (filter.to) q = q.lte("expense_date", filter.to);
  const { data, error } = await q;
  if (error) {
    console.warn("[cash] listPettyExpenses", error.message);
    return [];
  }
  return (data as PettyExpenseRow[] | null ?? []).map(mapPettyExpense);
}

export interface PaymentRequestFilter {
  operatingUnitId?: string;
  status?:          PaymentRequestStatus;
  from?:            DateISO;
  to?:              DateISO;
}

export async function listPaymentRequests(filter: PaymentRequestFilter = {}): Promise<PaymentRequest[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb.from("payment_requests").select("*").order("created_at", { ascending: false });
  if (filter.operatingUnitId) q = q.eq("operating_unit_id", filter.operatingUnitId);
  if (filter.status) q = q.eq("status", filter.status);
  if (filter.from) q = q.gte("created_at", filter.from);
  if (filter.to) q = q.lte("created_at", filter.to);
  const { data, error } = await q;
  if (error) {
    console.warn("[cash] listPaymentRequests", error.message);
    return [];
  }
  return (data as PaymentRequestRow[] | null ?? []).map(mapPaymentRequest);
}

export async function listLedgerEntries(
  bankAccountId: string,
  from?: DateISO,
  to?: DateISO,
): Promise<BankLedgerEntry[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb
    .from("bank_ledger_entries")
    .select("*")
    .eq("bank_account_id", bankAccountId)
    .order("entry_date")
    .order("created_at");
  if (from) q = q.gte("entry_date", from);
  if (to) q = q.lte("entry_date", to);
  const { data, error } = await q;
  if (error) {
    console.warn("[cash] listLedgerEntries", error.message);
    return [];
  }
  return (data as BankLedgerEntryRow[] | null ?? []).map(mapLedgerEntry);
}

/** Compute the running balance for a sequence of ledger rows. Pure. */
export function runningBalance(
  openingBalance: number,
  entries: BankLedgerEntry[],
): Array<BankLedgerEntry & { balance: number }> {
  let bal = openingBalance;
  return entries.map((e) => {
    bal += e.receiptAmount - e.paymentAmount;
    return { ...e, balance: bal };
  });
}

// ── DAL — writes ────────────────────────────────────────────────────────

export interface ClosingDraft {
  operatingUnitId:     string;
  /** Required — closings are per POS counter from migration 18. */
  posCounterId:        string;
  businessDate:        DateISO;
  shift:               ClosingShift;
  cashierEmail?:       string | null;
  closedByEmail:       string;
  posTotalSales:       number;
  posNonCashTotal:     number;
  /** Sum of actual settlements across non-cash modes (cash_19). */
  nonCashActualTotal:  number;
  cashCounted:         number;
  cashDeposited:       number;
  notes?:              string | null;
  /** Optional same-day EDC settlement slip URL. Migration 10. */
  edcSlipUrl?:         string | null;
  denominations:       CashDenomination[];
  paymentMethods:      CashClosingPaymentMethod[];
}

/**
 * Upsert a closing + its children. Treats (pos_counter_id, business_date,
 * shift) as the natural key (migration 18) — uses the unique constraint
 * to dedupe.
 */
export async function upsertClosing(d: ClosingDraft): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  if (!d.posCounterId) throw new Error("Pick the POS counter being closed.");

  // 1) Upsert the parent.
  const { data, error } = await sb
    .from("daily_cash_closings")
    .upsert({
      operating_unit_id:    d.operatingUnitId,
      pos_counter_id:       d.posCounterId,
      business_date:        d.businessDate,
      shift:                d.shift,
      cashier_email:        d.cashierEmail ?? null,
      closed_by_email:      d.closedByEmail,
      pos_total_sales:      d.posTotalSales,
      pos_non_cash_total:   d.posNonCashTotal,
      non_cash_actual_total: d.nonCashActualTotal,
      cash_counted:         d.cashCounted,
      cash_deposited:       d.cashDeposited,
      notes:                d.notes ?? null,
      edc_slip_url:         d.edcSlipUrl ?? null,
      updated_at:           new Date().toISOString(),
    }, { onConflict: "pos_counter_id,business_date,shift" })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "upsertClosing failed");
  const id = (data as { id: string }).id;

  // 2) Replace children.
  await sb.from("cash_closing_denominations").delete().eq("closing_id", id);
  if (d.denominations.length > 0) {
    await sb.from("cash_closing_denominations").insert(
      d.denominations.map((x) => ({
        closing_id: id,
        denomination: x.denomination,
        count: x.count,
      })),
    );
  }
  await sb.from("cash_closing_payment_methods").delete().eq("closing_id", id);
  if (d.paymentMethods.length > 0) {
    await sb.from("cash_closing_payment_methods").insert(
      d.paymentMethods.map((x) => ({
        closing_id: id,
        payment_method_id: x.paymentMethodId,
        amount: x.amount,
        actual_amount: x.actualAmount ?? null,
      })),
    );
  }
  return id;
}

/**
 * Manager sign — the first signature. Shift manager fills in the POS
 * report + cash count, then signs to lock the numbers and surface them
 * to the cashier. Status moves draft → counted.
 *
 * The closing is not yet final: the ledger trigger only fires on the
 * cashier's confirmation (counted → signed). This two-step ordering is
 * what the user described: "once signed by shift manager, cashier should
 * be able to sign from their session".
 */
export async function signClosing(id: string, managerEmail: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb
    .from("daily_cash_closings")
    .update({
      status: "counted",
      signed_at: new Date().toISOString(),
      manager_signed_by_email: managerEmail,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Cashier confirm — the second and final signature. Status moves
 * counted → signed. The fn_closing_to_ledger trigger fires on this
 * transition and writes the matching bank-ledger row.
 *
 * Only the cashier named on the closing row may confirm. Server-side
 * RLS doesn't enforce this yet; UI gating in [[project-cash-management]]
 * is the operational check.
 */
export async function cashierSignClosing(id: string, cashierEmail: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb
    .from("daily_cash_closings")
    .update({
      status: "signed",
      cashier_signed_at: new Date().toISOString(),
      cashier_signed_by_email: cashierEmail,
      cashier_email: cashierEmail,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Owner-only delete. RLS lets only owner DELETE; the BEFORE-DELETE trigger
 * `fn_closing_delete_cleanup` removes the matching bank_ledger_entries
 * row so the bank balance stays correct. Children cascade.
 */
export async function deleteClosing(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.from("daily_cash_closings").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function disputeClosing(id: string, notes: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb
    .from("daily_cash_closings")
    .update({ status: "disputed", notes })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export interface PettyDraft {
  operatingUnitId:    string;
  /** Required — petty expenses are per POS counter from migration 18. */
  posCounterId:       string;
  expenseDate:        DateISO;
  amount:             number;
  category?:          string | null;
  description:        string;
  paidTo?:            string | null;
  requestedByEmail:   string;
  receiptUrl?:        string | null;
  /** Required by DB CHECK whenever receiptUrl is missing. */
  noReceiptReason?:   string | null;
}

export async function createPettyExpense(d: PettyDraft): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  // Client-side guard so the user gets a clean message instead of the
  // raw CHECK constraint violation. Server still enforces.
  const hasReceipt = !!d.receiptUrl;
  const hasReason  = !!d.noReceiptReason && d.noReceiptReason.trim().length > 0;
  if (!hasReceipt && !hasReason) {
    throw new Error("Attach a receipt or explain why one isn't available.");
  }
  if (!d.posCounterId) {
    throw new Error("Pick the POS counter this expense was paid from.");
  }
  const { data, error } = await sb
    .from("petty_expenses")
    .insert({
      operating_unit_id:  d.operatingUnitId,
      pos_counter_id:     d.posCounterId,
      expense_date:       d.expenseDate,
      amount:             d.amount,
      category:           d.category ?? null,
      description:        d.description,
      paid_to:            d.paidTo ?? null,
      requested_by_email: d.requestedByEmail,
      receipt_url:        d.receiptUrl ?? null,
      no_receipt_reason:  hasReason ? d.noReceiptReason : null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "createPettyExpense failed");
  return (data as { id: string }).id;
}

export async function approvePettyExpense(id: string, approverEmail: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb
    .from("petty_expenses")
    .update({
      status: "approved",
      approved_by_email: approverEmail,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function rejectPettyExpense(
  id: string,
  approverEmail: string,
  reason: string,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb
    .from("petty_expenses")
    .update({
      status: "rejected",
      approved_by_email: approverEmail,
      approved_at: new Date().toISOString(),
      rejected_reason: reason,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export interface PaymentRequestDraft {
  operatingUnitId:   string;
  neededBy?:         DateISO | null;
  payeeName:         string;
  payeeAccountLast4?: string | null;
  payeeIfsc?:        string | null;
  amount:            number;
  mode:              PaymentRequestMode;
  purpose:           string;
  /** Required from migration 08 forward. The form must upload before submit. */
  invoiceUrl:        string;
  requestedByEmail:  string;
}

export async function createPaymentRequest(d: PaymentRequestDraft): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  if (!d.invoiceUrl || d.invoiceUrl.trim().length === 0) {
    throw new Error("Attach a receipt or invoice before submitting.");
  }
  const { data, error } = await sb
    .from("payment_requests")
    .insert({
      operating_unit_id:    d.operatingUnitId,
      needed_by:            d.neededBy ?? null,
      payee_name:           d.payeeName,
      payee_account_last4:  d.payeeAccountLast4 ?? null,
      payee_ifsc:           d.payeeIfsc ?? null,
      amount:               d.amount,
      mode:                 d.mode,
      purpose:              d.purpose,
      invoice_url:          d.invoiceUrl,
      requested_by_email:   d.requestedByEmail,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "createPaymentRequest failed");
  return (data as { id: string }).id;
}

/**
 * Upload a payment-receipt PDF or image to the `payment-receipts` bucket.
 * Returns the public URL so the caller can persist it on the request row.
 * Splits the upload from the DB write so the form can show validation
 * errors before consuming an upload slot.
 */
export async function uploadPaymentReceipt(
  file: File,
  uploaderEmail: string,
): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `${uploaderEmail}/${Date.now()}.${ext}`;
  const { error } = await sb.storage
    .from("payment-receipts")
    .upload(path, file, { upsert: false });
  if (error) throw new Error(error.message);
  const { data } = sb.storage.from("payment-receipts").getPublicUrl(path);
  return data.publicUrl;
}

export async function approvePaymentRequest(id: string, approverEmail: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb
    .from("payment_requests")
    .update({
      status: "approved",
      approved_by_email: approverEmail,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function rejectPaymentRequest(
  id: string,
  approverEmail: string,
  reason: string,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb
    .from("payment_requests")
    .update({
      status: "rejected",
      approved_by_email: approverEmail,
      approved_at: new Date().toISOString(),
      rejected_reason: reason,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function markPaymentRequestPaid(
  id: string,
  bankAccountId: string,
  bankReference: string | null,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb
    .from("payment_requests")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      paid_via_bank_account_id: bankAccountId,
      bank_reference: bankReference,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Used by the inter-unit transfer composer — writes two ledger rows. */
export interface InterUnitTransferDraft {
  fromBankAccountId: string;
  toBankAccountId:   string;
  amount:            number;
  entryDate:         DateISO;
  narration:         string;
  reference?:        string | null;
  createdBy:         string;
}

export async function createInterUnitTransfer(d: InterUnitTransferDraft): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const groupId = crypto.randomUUID();
  const rows = [
    {
      bank_account_id: d.fromBankAccountId,
      entry_date:      d.entryDate,
      narration:       d.narration,
      receipt_amount:  0,
      payment_amount:  d.amount,
      source_kind:     "inter_unit_transfer",
      source_id:       groupId,
      bank_reference:  d.reference ?? null,
      created_by:      d.createdBy,
    },
    {
      bank_account_id: d.toBankAccountId,
      entry_date:      d.entryDate,
      narration:       d.narration,
      receipt_amount:  d.amount,
      payment_amount:  0,
      source_kind:     "inter_unit_transfer",
      source_id:       groupId,
      bank_reference:  d.reference ?? null,
      created_by:      d.createdBy,
    },
  ];
  const { error } = await sb.from("bank_ledger_entries").insert(rows);
  if (error) throw new Error(error.message);
}

// ── Parties (vendors / customers) ───────────────────────────────────────

export async function listParties(cinemaId: string): Promise<Party[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("parties")
    .select("*")
    .eq("cinema_id", cinemaId)
    .is("archived_at", null)
    .order("name");
  if (error) {
    console.warn("[cash] listParties", error.message);
    return [];
  }
  return (data as PartyRow[] | null ?? []).map(mapParty);
}

export interface PartyDraft {
  cinemaId:      string;
  name:          string;
  partyType:     PartyType;
  category?:     string | null;
  contactName?:  string | null;
  phone?:        string | null;
  email?:        string | null;
  gstin?:        string | null;
  pan?:          string | null;
  accountLast4?: string | null;
  ifsc?:         string | null;
  notes?:        string | null;
}

export async function createParty(d: PartyDraft, updatedBy: string): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { data, error } = await sb
    .from("parties")
    .insert({
      cinema_id:     d.cinemaId,
      name:          d.name,
      party_type:    d.partyType,
      category:      d.category ?? null,
      contact_name:  d.contactName ?? null,
      phone:         d.phone ?? null,
      email:         d.email ?? null,
      gstin:         d.gstin ?? null,
      pan:           d.pan ?? null,
      account_last4: d.accountLast4 ?? null,
      ifsc:          d.ifsc ?? null,
      notes:         d.notes ?? null,
      updated_by:    updatedBy,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "createParty failed");
  return (data as { id: string }).id;
}

// ── Manual ledger entries ───────────────────────────────────────────────

export interface ManualLedgerEntryDraft {
  bankAccountId:  string;
  entryDate:      DateISO;
  narration:      string;
  amount:         number;             // positive = receipt; negative = payment
  partyId?:       string | null;
  bankReference?: string | null;
  createdBy:      string;
}

export async function createManualLedgerEntry(d: ManualLedgerEntryDraft): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const isReceipt = d.amount >= 0;
  const { error } = await sb.from("bank_ledger_entries").insert({
    bank_account_id: d.bankAccountId,
    entry_date:      d.entryDate,
    narration:       d.narration,
    receipt_amount:  isReceipt ?  d.amount : 0,
    payment_amount:  isReceipt ? 0 : -d.amount,
    source_kind:     isReceipt ? "manual_income" : "manual_expense",
    party_id:        d.partyId ?? null,
    bank_reference:  d.bankReference ?? null,
    created_by:      d.createdBy,
  });
  if (error) throw new Error(error.message);
}

// ── Authorized users — cashier dropdown ─────────────────────────────────

export interface AuthorizedUserSummary {
  email:    string;
  fullName: string | null;
}

export async function listCashierUsers(): Promise<AuthorizedUserSummary[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("authorized_users")
    .select("email, full_name")
    .eq("role", "cashier")
    .order("full_name");
  if (error) {
    console.warn("[cash] listCashierUsers", error.message);
    return [];
  }
  return (data as Array<{ email: string; full_name: string | null }> | null ?? []).map((r) => ({
    email: r.email,
    fullName: r.full_name,
  }));
}

/**
 * Lookup table for all authorized users in the cinema. Used to render
 * signoff names ("Manager: Nitin George") instead of raw emails in the
 * closings list. RLS lets every role read this table.
 */
export async function listAuthorizedUsers(): Promise<AuthorizedUserSummary[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("authorized_users")
    .select("email, full_name")
    .order("full_name");
  if (error) {
    console.warn("[cash] listAuthorizedUsers", error.message);
    return [];
  }
  return (data as Array<{ email: string; full_name: string | null }> | null ?? []).map((r) => ({
    email: r.email,
    fullName: r.full_name,
  }));
}

// ── Pure helpers ────────────────────────────────────────────────────────

/** Default INR denominations used in the closing form, biggest first.
 *  50 paise is no longer in active circulation — operators report it
 *  causes more typos than it captures, so we exclude it. */
export const INR_DENOMINATIONS: number[] = [
  500, 200, 100, 50, 20, 10, 5, 2, 1,
];

/** Sum a denominations grid in rupees. */
export function totalFromDenominations(rows: CashDenomination[]): number {
  return rows.reduce((sum, r) => sum + r.denomination * (r.count || 0), 0);
}

/**
 * Pure helpers mirroring the cash_19 generated columns. Server-side these
 * are generated; client-side we recompute to preview while the user types.
 *
 *   actual total = cash counted + petty paid + non-cash actual settlements
 *   discrepancy  = actual total - POS report total
 */
export function computeActualTotal(
  cashCounted: number,
  pettyExpensesPaid: number,
  nonCashActualTotal: number,
): number {
  return cashCounted + pettyExpensesPaid + nonCashActualTotal;
}

export function computeDiscrepancy(
  posTotalSales: number,
  cashCounted: number,
  pettyExpensesPaid: number,
  nonCashActualTotal: number,
): number {
  return computeActualTotal(cashCounted, pettyExpensesPaid, nonCashActualTotal)
       - posTotalSales;
}

/**
 * Sum of all method amounts. Should equal pos_total_sales when the daily
 * manager has finished entering the POS report.
 */
export function totalFromPaymentMethods(rows: CashClosingPaymentMethod[]): number {
  return rows.reduce((sum, r) => sum + (r.amount || 0), 0);
}

/**
 * Sum amounts whose method has flow_type "cash". Used by the closing form
 * to back-fill pos_non_cash_total (= total − cash).
 */
export function cashTotalFromMethods(
  rows: CashClosingPaymentMethod[],
  methods: PaymentMethod[],
): number {
  const cashIds = new Set(methods.filter((m) => m.flowType === "cash").map((m) => m.id));
  return rows.filter((r) => cashIds.has(r.paymentMethodId))
             .reduce((sum, r) => sum + (r.amount || 0), 0);
}

/**
 * Sum of actual settlements across non-cash modes, falling back to the
 * POS-reported amount when no actual was recorded. Used by the closing
 * form to materialize non_cash_actual_total (cash_19).
 */
export function nonCashActualFromMethods(
  rows: CashClosingPaymentMethod[],
  methods: PaymentMethod[],
): number {
  const cashIds = new Set(methods.filter((m) => m.flowType === "cash").map((m) => m.id));
  return rows.filter((r) => !cashIds.has(r.paymentMethodId))
             .reduce((sum, r) => sum + (r.actualAmount ?? r.amount ?? 0), 0);
}

// ── Cash deposits ───────────────────────────────────────────────────────

/**
 * Upload a cash-deposit or settlement slip to the `cash-slips` bucket.
 * One helper for both cases since they share the bucket + RLS.
 */
export async function uploadCashSlip(
  file: File,
  uploaderEmail: string,
): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `${uploaderEmail}/${Date.now()}.${ext}`;
  const { error } = await sb.storage
    .from("cash-slips")
    .upload(path, file, { upsert: false });
  if (error) throw new Error(error.message);
  const { data } = sb.storage.from("cash-slips").getPublicUrl(path);
  return data.publicUrl;
}

export interface CashDepositFilter {
  operatingUnitId?: string;
  closingId?:       string;
  status?:          CashDepositStatus;
  from?:            DateISO;
  to?:              DateISO;
}

export async function listCashDeposits(filter: CashDepositFilter = {}): Promise<CashDeposit[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb.from("cash_deposits").select("*").order("deposit_date", { ascending: false });
  if (filter.operatingUnitId) q = q.eq("operating_unit_id", filter.operatingUnitId);
  if (filter.closingId) q = q.eq("closing_id", filter.closingId);
  if (filter.status) q = q.eq("status", filter.status);
  if (filter.from) q = q.gte("deposit_date", filter.from);
  if (filter.to) q = q.lte("deposit_date", filter.to);
  const { data, error } = await q;
  if (error) {
    console.warn("[cash] listCashDeposits", error.message);
    return [];
  }
  return (data as CashDepositRow[] | null ?? []).map(mapCashDeposit);
}

export interface CashDepositDraft {
  closingId?:         string | null;
  operatingUnitId:    string;
  bankAccountId:      string;
  depositDate:        DateISO;
  depositedAmount:    number;
  retainedAmount?:    number;
  slipUrl?:           string | null;
  slipReference?:     string | null;
  depositedByEmail:   string;
  /** Default 'pending'. Set 'completed' to insert + immediately write
   *  the ledger row (the insert trigger handles that path). */
  status?:            CashDepositStatus;
  notes?:             string | null;
}

export async function createCashDeposit(d: CashDepositDraft): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  if (!d.depositedAmount || d.depositedAmount <= 0) {
    throw new Error("Deposit amount must be greater than zero.");
  }
  const { data, error } = await sb
    .from("cash_deposits")
    .insert({
      closing_id:          d.closingId ?? null,
      operating_unit_id:   d.operatingUnitId,
      bank_account_id:     d.bankAccountId,
      deposit_date:        d.depositDate,
      deposited_amount:    d.depositedAmount,
      retained_amount:     d.retainedAmount ?? 0,
      slip_url:            d.slipUrl ?? null,
      slip_reference:      d.slipReference ?? null,
      deposited_by_email:  d.depositedByEmail,
      status:              d.status ?? "pending",
      notes:               d.notes ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "createCashDeposit failed");
  return (data as { id: string }).id;
}

/**
 * Flip a pending deposit to completed. The DB trigger writes the
 * matching bank_ledger_entries row on this transition.
 */
export async function markCashDepositCompleted(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb
    .from("cash_deposits")
    .update({ status: "completed", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function cancelCashDeposit(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb
    .from("cash_deposits")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ── POS settlements ─────────────────────────────────────────────────────

export interface PosSettlementFilter {
  status?:           PosSettlementStatus;
  paymentMethodId?:  string;
  from?:             DateISO;
  to?:               DateISO;
}

export async function listPosSettlements(filter: PosSettlementFilter = {}): Promise<PosSettlement[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb.from("pos_settlements").select("*").order("settlement_date", { ascending: false });
  if (filter.status) q = q.eq("status", filter.status);
  if (filter.paymentMethodId) q = q.eq("payment_method_id", filter.paymentMethodId);
  if (filter.from) q = q.gte("settlement_date", filter.from);
  if (filter.to) q = q.lte("settlement_date", filter.to);
  const { data, error } = await q;
  if (error) {
    console.warn("[cash] listPosSettlements", error.message);
    return [];
  }
  const rows = (data as PosSettlementRow[] | null) ?? [];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const { data: links } = await sb
    .from("pos_settlement_closings")
    .select("*")
    .in("settlement_id", ids);
  const linkRows = (links as PosSettlementClosingRow[] | null) ?? [];
  return rows.map((r) => mapPosSettlement(r, linkRows));
}

export interface PosSettlementDraft {
  cinemaId:          string;
  paymentMethodId:   string;
  bankAccountId:     string;
  settlementDate:    DateISO;
  expectedAmount:    number;
  receivedAmount?:   number;
  feeAmount?:        number;
  bankReference?:    string | null;
  slipUrl?:          string | null;
  notes?:            string | null;
  /** Closings this settlement covers (m:n). */
  closingIds:        string[];
}

export async function createPosSettlement(d: PosSettlementDraft): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { data, error } = await sb
    .from("pos_settlements")
    .insert({
      cinema_id:          d.cinemaId,
      payment_method_id:  d.paymentMethodId,
      bank_account_id:    d.bankAccountId,
      settlement_date:    d.settlementDate,
      expected_amount:    d.expectedAmount,
      received_amount:    d.receivedAmount ?? 0,
      fee_amount:         d.feeAmount ?? 0,
      bank_reference:     d.bankReference ?? null,
      slip_url:           d.slipUrl ?? null,
      notes:              d.notes ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "createPosSettlement failed");
  const id = (data as { id: string }).id;
  if (d.closingIds.length > 0) {
    await sb.from("pos_settlement_closings").insert(
      d.closingIds.map((closingId) => ({ settlement_id: id, closing_id: closingId })),
    );
  }
  return id;
}

/**
 * Flip a pending settlement to received with the actual numbers + slip.
 * The DB trigger writes the matching bank_ledger_entries row.
 */
export async function markPosSettlementReceived(
  id: string,
  receivedByEmail: string,
  patch: {
    receivedAmount: number;
    feeAmount?:     number;
    bankReference?: string | null;
    slipUrl?:       string | null;
  },
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb
    .from("pos_settlements")
    .update({
      status:              "received",
      received_amount:     patch.receivedAmount,
      fee_amount:          patch.feeAmount ?? 0,
      bank_reference:      patch.bankReference ?? null,
      slip_url:            patch.slipUrl ?? null,
      received_by_email:   receivedByEmail,
      received_at:         new Date().toISOString(),
      updated_at:          new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Settings helpers ────────────────────────────────────────────────────

/**
 * Update the operating unit's default float amount — what we suggest the
 * shift manager keep behind in the till after a deposit.
 */
export async function updateOperatingUnitFloat(
  id: string,
  amount: number,
  updatedBy: string,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb
    .from("operating_units")
    .update({
      default_float_amount: amount,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Set the bank account a payment method settles into. Used by Settings →
 * Cash → Payment methods to pre-fill the bank picker on POS settlements.
 */
export async function updatePaymentMethodBank(
  methodId: string,
  bankAccountId: string | null,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb
    .from("payment_methods")
    .update({ receives_into_bank: bankAccountId })
    .eq("id", methodId);
  if (error) throw new Error(error.message);
}
