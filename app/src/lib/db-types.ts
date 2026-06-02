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
  serialStarts?: unknown;
  openings?: unknown;
}

/** `public.authorized_users` — access allowlist + role. */
export interface AuthorizedUserRow {
  email: string;
  role: "owner" | "manager" | "daily_manager" | "accountant";
  full_name: string | null;
  /** Set when the user signs in via username + PIN. Null for Google users. */
  username: string | null;
}

/** `public.fb_entries` — one row per date. Single-screen cinema, no
 *  screen_id. `summary` and `items` are JSONB blobs (see types.ts for
 *  the typed reads). */
export interface FbEntryRow {
  id: string;
  entry_date: string;
  summary: Record<string, unknown> | null;
  items: Array<Record<string, unknown>> | null;
  notes: string | null;
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

/** A pre-aggregated summary row (Phase D will materialize these). Not used yet. */
export interface DailySummaryRow extends CumulativeRow {
  entry_date: string;
  movie_id: string;
  screen_id: string;
}

// ── Normalized catalog tables (Phase 3) ──────────────────────────────────
//
// Mirror the columns defined in migrations/catalog-normalization/*.sql.
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
  distributor:    string | null;
  release_date:   string | null;       // YYYY-MM-DD
  share_pct:      number;
  language:       string | null;
  genre:          string | null;
  certification:  string | null;
  archived_at:    string | null;
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
