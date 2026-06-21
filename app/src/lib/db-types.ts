// ============================================================================
// Database row shapes — what Supabase actually returns / accepts.
//
// Mirrors the columns defined in the Supabase schema. snake_case here, then
// mappers.ts converts to/from the camelCase Entry shape used by the engine.
// Keep this file in lockstep with the schema; type-only changes, no logic.
// ============================================================================

import type { CumulativeRow, Show } from "./types";

/** `public.entries` — one row per (date, movie, screen). */
export interface EntryRow {
  entry_date: string;        // YYYY-MM-DD
  movie_id: string;          // UUID (text in the schema)
  screen_id: string;
  share: number | null;
  shows: Show[] | null;
  /** cash_20 — shows scheduled but cancelled that day (status engine input). */
  cancelled_shows: number | null;
  updated_by: string | null;
  updated_at: string | null; // ISO timestamp
}

/** `public.config` — singleton row id=1 holding all catalog data. */
export interface ConfigRow {
  id: number;
  data: ConfigPayload;
  updated_by: string | null;
  updated_at: string | null;
}

/** The JSON blob inside config.data — the catalog half of AppState. */
export interface ConfigPayload {
  cinema?: unknown;
  tax?: unknown;
  classes?: unknown;
  screens?: unknown;
  movies?: unknown;
  distributors?: unknown;
  serialStarts?: unknown;
  openings?: unknown;
}

/** `public.authorized_users` — access allowlist + role. */
export interface AuthorizedUserRow {
  email: string;
  role: "owner" | "manager" | "daily_manager" | "accountant" | "cashier";
  full_name: string | null;
  /** Set when the user signs in via username + PIN. Null for Google users. */
  username: string | null;
  /** True when the PIN was issued by the owner/manager and the user
   *  hasn't replaced it yet. The app blocks on a Change-PIN screen
   *  while true. Always false for Google users. */
  must_change_pin: boolean;
}

/** `public.fb_entries` — one row per date. Single-screen cinema, no
 *  screen_id. `summary` and `items` are JSONB blobs (see types.ts for
 *  the typed reads). */
export interface FbEntryRow {
  id: string;
  entry_date: string;
  /** cinema scope (NOT NULL in the DB after migration 06). */
  cinema_id: string | null;
  summary: Record<string, unknown> | null;
  items: Array<Record<string, unknown>> | null;
  notes: string | null;
  /** 'manual' = client-owned (operator/DSR); 'zoho' = server-imported and
   *  NEVER reaped/overwritten by the client delta-sync engine. Default
   *  'manual' so every legacy row stays client-owned. */
  source: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

/** `public.fb_products` — the menu catalog. */
export interface FbProductRow {
  id: string;
  pos_item_number: string | null;
  pos_uid: string | null;
  name: string;
  category: string | null;
  super_category: string | null;
  default_rate: number | null;
  default_gst_pct: number | null;
  is_non_veg: boolean | null;
  is_active: boolean | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
}

/** `public.invoices` — unified Zoho store. type='purchase' (Bills) surface in
 *  the Invoices page; type='sales' are rolled up into fb_entries. */
export interface InvoiceRow {
  id: string;
  cinema_id: string;
  type: "purchase" | "sales";
  source: "zoho" | "manual";
  category: string | null;
  zoho_org_id: string | null;
  zoho_branch_id: string | null;
  zoho_id: string | null;
  party_name: string | null;
  invoice_no: string | null;
  invoice_date: string | null;   // YYYY-MM-DD
  due_date: string | null;
  status: string | null;
  currency: string | null;
  sub_total: number | null;
  tax_total: number | null;
  cgst: number | null;
  sgst: number | null;
  igst: number | null;
  total: number | null;
  balance: number | null;
  gst_treatment: string | null;
  place_of_supply: string | null;
  gstin: string | null;
  notes: string | null;
  project_id: string | null;
  budget_item_id: string | null;
  expense_id: string | null;
  raw: Record<string, unknown> | null;
  zoho_last_modified: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

/** `public.invoice_line_items` — one row per Zoho line (HSN + GST split). */
export interface InvoiceLineItemRow {
  id: string;
  invoice_id: string;
  line_no: number | null;
  zoho_line_id: string | null;
  name: string | null;
  description: string | null;
  hsn_or_sac: string | null;
  quantity: number | null;
  rate: number | null;
  item_total: number | null;
  tax_percentage: number | null;
  cgst: number | null;
  sgst: number | null;
  igst: number | null;
  account: string | null;
  raw: Record<string, unknown> | null;
}

/** `public.fb_checklist_runs` — one completed checklist instance.
 *  The bilingual step wording lives in src/lib/fbChecklist.ts, keyed by
 *  sop_code; this row stores who/when + sign-off + cash recon (`extra`). */
export interface FbChecklistRunRow {
  id:                    string;
  cinema_id:             string;
  run_date:              string;        // YYYY-MM-DD
  checklist_type:        "opening" | "midshift" | "closing";
  shift:                 string;
  status:                "in_progress" | "completed";
  staff_name:            string | null;
  staff_email:           string | null;
  manager_signoff_email: string | null;
  manager_signed_at:     string | null;
  notes:                 string | null;
  extra:                 Record<string, unknown> | null;
  created_at:            string | null;
  updated_at:            string | null;
  updated_by:            string | null;
}

/** `public.fb_checklist_items` — one SOP step result inside a run. */
export interface FbChecklistItemRow {
  id:         string;
  run_id:     string;
  sop_code:   string;
  checked:    boolean;
  done_at:    string | null;
  initial:    string | null;
  photo_url:  string | null;
  position:   number;
  created_at: string | null;
}

/** A pre-aggregated summary row (Phase D will materialize these). Not used yet. */
export interface DailySummaryRow extends CumulativeRow {
  entry_date: string;
  movie_id: string;
  screen_id: string;
}

// ── Normalized catalog tables (Phase 3) ──────────────────────────────────
//
// Mirror the columns defined in supabase/migrations-archive/catalog-normalization/*.sql.
// IDs on catalog tables are TEXT (not UUID) so legacy ids like "cls_royale"
// from the JSONB blob round-trip cleanly.

export interface BrandRow {
  id:        string;
  name:      string;
  logo_url:  string | null;
  created_at: string | null;
}

export interface CinemaRow {
  id:             string;
  brand_id:       string | null;
  brand_name:     string;
  location:       string;
  gstin:          string | null;
  pan:            string | null;
  address_line1:  string | null;
  address_line2:  string | null;
  city:           string | null;
  state:          string | null;
  pincode:        string | null;
  country:        string;
  currency_code:  string;
  timezone:       string;
  phone:          string | null;
  email:          string | null;
  archived_at:    string | null;
  created_at:     string | null;
  updated_at:     string | null;
  updated_by:     string | null;
}

export interface TaxConfigRow {
  id:              string;
  cinema_id:       string;
  valid_from:      string;          // YYYY-MM-DD
  valid_to:        string | null;
  threshold:       number;
  above_etax_pct:  number;
  above_gst_pct:   number;
  below_etax_pct:  number;
  below_gst_pct:   number;
  tmc:             number;
  cess:            number;
  rep_day:         number;
  rep_night:       number;
  rep_1:           number;
  rep_2:           number;
  rep_5:           number;
}

export interface ClassRow {
  id:             string;
  cinema_id:      string;
  name:           string;
  gst_pct:        number;
  display_order:  number;
  archived_at:    string | null;
}

export interface ScreenRow {
  id:             string;
  cinema_id:      string;
  name:           string;
  display_order:  number;
  archived_at:    string | null;
}

export interface ScreenClassRow {
  screen_id:  string;
  class_id:   string;
  seats:      number;
  /** False = historical-era assignment kept for old entries; absent/null = active. */
  active?:    boolean | null;
}

export interface PriceCardRow {
  id:             string;
  screen_id:      string;
  name:           string;
  display_order:  number;
  archived_at:    string | null;
}

export interface PriceCardPriceRow {
  price_card_id:  string;
  class_id:       string;
  price:          number;
}

export interface MovieRow {
  id:             string;
  cinema_id:      string;
  name:           string;
  /** Denormalized display name, kept in sync with `distributor_id`. */
  distributor:    string | null;
  /** FK into `public.distributors` (distributors migration). */
  distributor_id: string | null;
  release_date:   string | null;       // YYYY-MM-DD
  share_pct:      number;
  language:       string | null;
  genre:          string | null;
  certification:  string | null;
  /** Public URL in the `movie-posters` bucket. Migration 13. */
  poster_url:     string | null;
  /** Programme lifecycle flag (migration 15). Anon RLS policy gates
   *  public reads on this column. */
  status:         "coming_soon" | "now_showing" | "past";
  /** Owner's manual pin (migration 16). NULL = Auto. */
  status_override: "coming_soon" | "now_showing" | "past" | null;
  /** Trailer link played by the landing hero (migration 16). */
  trailer_url:    string | null;
  /** Drives the landing hero film; at most one true (migration 16). */
  is_featured:    boolean;
  /** Per-run-week distributor share % overrides (JSONB, weekly-share
   *  migration). Keyed by 1-based run week as a string; values are the share %
   *  for that week. `{}` / null = no overrides. */
  week_shares:    Record<string, number> | null;
  archived_at:    string | null;
}

/** `public.distributors` — distributor catalog with point-of-contact. */
export interface DistributorRow {
  id:           string;
  cinema_id:    string;
  name:         string;
  poc_name:     string | null;
  poc_contact:  string | null;
  poc_email:    string | null;
  archived_at:  string | null;
}

export interface SerialStartRow {
  id:          string;
  screen_id:   string;
  start_date:  string;                  // YYYY-MM-DD
}

export interface SerialStartClassRow {
  serial_start_id:  string;
  class_id:         string;
  starting_number:  number;
}

export interface OpeningRow {
  id:         string;
  movie_id:   string;
  screen_id:  string;
  open_date:  string;                   // YYYY-MM-DD
  vals:       Record<string, unknown>;
}

/** A row of public.realtime_version — one per logical layer. */
export interface RealtimeVersionRow {
  layer:      "catalog" | "operational";
  version:    number;
  updated_at: string | null;
}

// ── Cash management tables ───────────────────────────────────────────────
//
// Mirror supabase/migrations-archive/cash-management/*.sql. All UUID PKs.

export interface OperatingUnitRow {
  id:                     string;
  cinema_id:              string;
  name:                   string;
  kind:                   "box_office" | "food_beverage" | "other";
  display_order:          number;
  archived_at:            string | null;
  /** Recommended cash to retain in the till as float. Migration 10. */
  default_float_amount:   number;
  created_at:             string | null;
  updated_at:             string | null;
  updated_by:             string | null;
}

/** POS counter (till) inside an operating unit. Migration 18. Managed by
 *  the owner in Settings → Cash the same way screens are managed. */
export interface PosCounterRow {
  id:                     string;
  cinema_id:              string;
  operating_unit_id:      string;
  name:                   string;
  display_order:          number;
  archived_at:            string | null;
  created_at:             string | null;
  updated_at:             string | null;
  updated_by:             string | null;
}

export interface BankAccountRow {
  id:                    string;
  cinema_id:             string;
  operating_unit_id:     string;
  name:                  string;
  bank_name:             string | null;
  account_number_last4:  string | null;
  opening_balance:       number;
  opening_date:          string;          // YYYY-MM-DD
  is_primary:            boolean;
  archived_at:           string | null;
  created_at:            string | null;
  updated_at:            string | null;
  updated_by:            string | null;
}

export type PaymentFlowType = "cash" | "online_immediate" | "online_settled";

export interface PaymentMethodRow {
  id:                  string;
  cinema_id:           string;
  code:                string;
  display_name:        string;
  flow_type:           PaymentFlowType;
  receives_into_bank:  string | null;
  display_order:       number;
  settlement_days:     number;
  archived_at:         string | null;
  created_at:          string | null;
}

export type ClosingShift  = "morning" | "evening" | "all_day";
export type ClosingStatus = "draft" | "counted" | "signed" | "disputed" | "resolved";

export interface DailyCashClosingRow {
  id:                       string;
  operating_unit_id:        string;
  /** POS counter this closing belongs to. Migration 18 — the natural key
   *  is now (pos_counter_id, business_date, shift). */
  pos_counter_id:           string;
  business_date:            string;          // YYYY-MM-DD
  shift:                    ClosingShift;
  cashier_email:            string | null;
  closed_by_email:          string;

  pos_total_sales:          number;
  pos_non_cash_total:       number;
  pos_cash_expected:        number;          // generated

  cash_counted:             number;
  petty_expenses_paid:      number;
  cash_deposited:           number;
  non_cash_actual_total:    number;          // cash_19 — materialized by the form
  actual_total:             number;          // generated (cash_19)
  discrepancy:              number;          // generated — actual_total - pos_total_sales (cash_19)

  notes:                    string | null;
  status:                   ClosingStatus;

  // Phase 7 — dual signoff
  cashier_signed_at:        string | null;
  cashier_signed_by_email:  string | null;
  manager_signed_by_email:  string | null;
  signed_at:                string | null;    // manager sign timestamp
  resolved_at:              string | null;
  resolved_by_email:        string | null;

  /** Phase 10 — optional URL to a same-day EDC settlement slip. */
  edc_slip_url:             string | null;

  created_at:               string | null;
  updated_at:               string | null;
}

// ── Phase 10 — Cash deposits + POS settlements ──────────────────────────

export type CashDepositStatus = "pending" | "completed" | "cancelled";

export interface CashDepositRow {
  id:                  string;
  closing_id:          string | null;
  operating_unit_id:   string;
  bank_account_id:     string;
  deposit_date:        string;          // YYYY-MM-DD
  deposited_amount:    number;
  retained_amount:     number;
  slip_url:            string | null;
  slip_reference:      string | null;
  deposited_by_email:  string;
  status:              CashDepositStatus;
  notes:               string | null;
  created_at:          string | null;
  updated_at:          string | null;
}

export type PosSettlementStatus = "pending" | "received" | "reconciled" | "disputed";

export interface PosSettlementRow {
  id:                  string;
  cinema_id:           string;
  payment_method_id:   string;
  bank_account_id:     string;
  settlement_date:     string;          // YYYY-MM-DD
  expected_amount:     number;
  received_amount:     number;
  fee_amount:          number;
  bank_reference:      string | null;
  slip_url:            string | null;
  notes:               string | null;
  status:              PosSettlementStatus;
  received_by_email:   string | null;
  received_at:         string | null;
  created_at:          string | null;
  updated_at:          string | null;
}

export interface PosSettlementClosingRow {
  settlement_id: string;
  closing_id:    string;
}

/** cash_20 — m:1 closings → deposit. PK on closing_id. */
export interface CashDepositClosingRow {
  closing_id: string;
  deposit_id: string;
}

export interface CashClosingDenominationRow {
  closing_id:   string;
  denomination: number;
  count:        number;
}

export interface CashClosingPaymentMethodRow {
  closing_id:        string;
  payment_method_id: string;
  /** What the POS reported for this mode. */
  amount:            number;
  /** What the mode actually settled (EDC machine / UPI app total).
   *  Autofilled from `amount` by the closing form; edited when they
   *  differ. Null = saved before migration cash_17. */
  actual_amount:     number | null;
}

export type PettyExpenseStatus = "pending" | "approved" | "rejected";

export interface PettyExpenseRow {
  id:                     string;
  operating_unit_id:      string;
  /** POS counter the expense was paid from. Required from migration 18. */
  pos_counter_id:         string;
  expense_date:           string;        // YYYY-MM-DD
  amount:                 number;
  category:               string | null;
  description:            string;
  paid_to:                string | null;
  requested_by_email:     string;
  approved_by_email:      string | null;
  approved_at:            string | null;
  rejected_reason:        string | null;
  receipt_url:            string | null;
  /** Why no receipt was uploaded. Required when receipt_url is null
   *  (CHECK constraint added in migration 08). */
  no_receipt_reason:      string | null;
  status:                 PettyExpenseStatus;
  reconciled_closing_id:  string | null;
  created_at:             string | null;
  updated_at:             string | null;
}

export type PaymentRequestMode   = "bank_transfer" | "cheque" | "cash" | "upi";
export type PaymentRequestStatus = "pending" | "approved" | "rejected" | "paid";

export interface PaymentRequestRow {
  id:                        string;
  operating_unit_id:         string;
  needed_by:                 string | null;     // YYYY-MM-DD
  payee_name:                string;
  party_id:                  string | null;
  payee_account_last4:       string | null;
  payee_ifsc:                string | null;
  amount:                    number;
  mode:                      PaymentRequestMode;
  purpose:                   string;
  invoice_url:               string | null;
  requested_by_email:        string;
  approved_by_email:         string | null;
  approved_at:               string | null;
  rejected_reason:           string | null;
  paid_at:                   string | null;
  paid_via_bank_account_id:  string | null;
  bank_reference:            string | null;
  status:                    PaymentRequestStatus;
  created_at:                string | null;
  updated_at:                string | null;
}

export type LedgerSourceKind =
  | "opening_balance"
  | "cash_deposit"
  | "payment_request"
  | "inter_unit_transfer"
  | "pos_settlement"
  | "manual"
  | "manual_income"
  | "manual_expense";

export interface BankLedgerEntryRow {
  id:              string;
  bank_account_id: string;
  entry_date:      string;                // YYYY-MM-DD
  narration:       string;
  receipt_amount:  number;
  payment_amount:  number;
  source_kind:     LedgerSourceKind;
  source_id:       string | null;
  bank_reference:  string | null;
  reconciled_at:   string | null;
  notes:           string | null;
  party_id:        string | null;
  created_at:      string | null;
  created_by:      string | null;
}

export type PartyType = "vendor" | "customer" | "employee" | "other";

export interface PartyRow {
  id:             string;
  cinema_id:      string;
  name:           string;
  party_type:     PartyType;
  category:       string | null;
  contact_name:   string | null;
  phone:          string | null;
  email:          string | null;
  gstin:          string | null;
  pan:            string | null;
  account_last4:  string | null;
  ifsc:           string | null;
  notes:          string | null;
  archived_at:    string | null;
  created_at:     string | null;
  updated_at:     string | null;
}

// ── Operations: staff rosters (migration operations-rosters) ────────────────

export type RosterStatus       = "draft" | "published";
export type RosterRequestStatus = "pending" | "approved" | "rejected";

export interface StaffRosterRow {
  id:          string;
  cinema_id:   string;
  staff_type:  string;          // 'daily_manager' for now
  week_start:  string;          // YYYY-MM-DD (a Thursday)
  status:      RosterStatus;
  notes:       string | null;
  created_by:  string | null;
  created_at:  string | null;
  updated_at:  string | null;
  updated_by:  string | null;
}

export interface RosterAssignmentRow {
  id:             string;
  roster_id:      string;
  work_date:      string;       // YYYY-MM-DD
  day_offset:     number;       // 0..6 = Thu..Wed
  assignee_email: string | null;
  shift_start:    string;       // HH:MM:SS
  shift_label:    string;
  created_at:     string | null;
  updated_at:     string | null;
  updated_by:     string | null;
}

export interface RosterSwapRow {
  id:                 string;
  roster_id:          string;
  requested_by:       string;
  from_date:          string;   // YYYY-MM-DD
  to_date:            string;   // YYYY-MM-DD
  counterparty_email: string | null;
  reason:             string;
  status:             RosterRequestStatus;
  decided_by:         string | null;
  decided_at:         string | null;
  decision_note:      string | null;
  created_at:         string | null;
}

export interface RosterEmergencyLeaveRow {
  id:          string;
  roster_id:   string;
  work_date:   string;          // YYYY-MM-DD
  staff_email: string;
  reason:      string;
  status:      RosterRequestStatus;
  cover_email: string | null;
  decided_by:  string | null;
  decided_at:  string | null;
  created_at:  string | null;
}
