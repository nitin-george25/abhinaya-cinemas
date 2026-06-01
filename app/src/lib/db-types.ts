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
