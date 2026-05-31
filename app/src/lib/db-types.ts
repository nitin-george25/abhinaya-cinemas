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
  role: "owner" | "manager" | "accountant";
  full_name: string | null;
}

/** `public.fb_entries` — daily F&B summary, one row per (date, screen). */
export interface FbEntryRow {
  entry_date: string;
  screen_id: string;
  gross: number | null;
  net: number | null;
  discounts: number | null;
  tax: number | null;
  bills: number | null;
  guests: number | null;
  // Phase 1.6 analytics-ready columns:
  items_sold: number | null;
  // Free-form payload for bits we want to preserve but don't have columns for:
  raw: Record<string, unknown> | null;
  updated_at: string | null;
}

/** A pre-aggregated summary row (Phase D will materialize these). Not used yet. */
export interface DailySummaryRow extends CumulativeRow {
  entry_date: string;
  movie_id: string;
  screen_id: string;
}
