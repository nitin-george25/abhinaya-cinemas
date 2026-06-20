// ============================================================================
// DB row ↔ engine type converters.
//
// Single source of truth for crossing the snake_case ↔ camelCase boundary
// between Supabase and the engine. Tested via mappers.test.ts (TODO).
// ============================================================================

import type {
  ConfigPayload,
  EntryRow,
  FbEntryRow,
  FbProductRow,
} from "./db-types";
import type {
  AppState,
  Entry,
  FbEntry,
  FbItem,
  FbProduct,
  Show,
} from "./types";

/** Generate a stable client-side id. Matches the uid() used in the legacy JS. */
export const uid = (): string => Math.random().toString(36).slice(2, 9);

/** Coerce DB `entries` row → engine `Entry`. Assigns a fresh client id. */
export function rowToEntry(r: EntryRow): Entry {
  return {
    id: uid(),
    date: r.entry_date,
    movieId: r.movie_id,
    screenId: r.screen_id,
    share: r.share ?? 0,
    shows: (r.shows ?? []) as Show[],
    cancelledShows: r.cancelled_shows ?? 0,
  };
}

/** Engine `Entry` → DB `entries` row payload for insert/upsert.
 *  cinemaId is required after migration 06 (NOT NULL). Pass null only
 *  on pre-migration databases — callers should skip the write in that
 *  case rather than send null and violate the constraint. */
export function entryToRow(
  e: Entry,
  updatedBy: string,
  cinemaId: string | null,
): Omit<EntryRow, "updated_at"> & { updated_at: string; cinema_id: string | null } {
  return {
    entry_date: e.date ?? "",
    movie_id: e.movieId,
    screen_id: e.screenId,
    cinema_id: cinemaId,
    share: e.share === undefined || (e.share as unknown) === "" ? null : e.share,
    shows: e.shows ?? [],
    cancelled_shows: e.cancelledShows ?? 0,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Merge a `ConfigPayload` (catalog from cloud) into an existing AppState.
 * Only fields present on the payload are overwritten — keeps any local
 * additions intact. Mirrors the CFG_KEYS loop in legacy 02-cloud.js.
 */
export function applyConfigPayload<S extends Partial<AppState>>(
  state: S,
  payload: ConfigPayload | null | undefined,
): S {
  if (!payload) return state;
  const out: S = { ...state };
  const keys: Array<keyof ConfigPayload & keyof AppState> = [
    "cinema",
    "tax",
    "classes",
    "screens",
    "movies",
    "distributors",
    "serialStarts",
    "openings",
  ];
  for (const k of keys) {
    if (payload[k] !== undefined) {
      (out as Record<string, unknown>)[k] = payload[k];
    }
  }
  return out;
}

/** Extract the catalog half of an AppState, ready to push to `config.data`. */
export function cfgPayload(state: AppState): ConfigPayload {
  return {
    cinema: state.cinema,
    tax: state.tax,
    classes: state.classes,
    screens: state.screens,
    movies: state.movies,
    distributors: state.distributors,
    serialStarts: state.serialStarts,
    openings: state.openings,
  };
}

/** Stable key for an entry — used for delta detection in the sync loop. */
export const entryKey = (e: Entry): string =>
  `${e.date ?? ""}|${e.movieId}|${e.screenId}`;

/** Cheap content signature for delta detection (matches legacy entSig). */
export const entrySignature = (e: Entry): string =>
  JSON.stringify({
    share: e.share,
    shows: e.shows ?? [],
    cancelledShows: e.cancelledShows ?? 0,
  });

// ── F&B ────────────────────────────────────────────────────────────────

/** Coerce a JSONB items array to typed FbItems (tolerates missing fields). */
function toFbItems(raw: Array<Record<string, unknown>> | null): FbItem[] {
  if (!raw) return [];
  return raw.map((r) => ({
    name:      String(r["name"] ?? ""),
    qty:       Number(r["qty"]) || 0,
    netAmount: Number(r["netAmount"]) || 0,
    category:  r["category"] != null ? String(r["category"]) : undefined,
  }));
}

/** Convert a `fb_entries` row to the in-memory FbEntry shape. */
export function fbRowToEntry(r: FbEntryRow): FbEntry {
  return {
    id: r.id,
    date: r.entry_date,
    summary: (r.summary ?? {}) as FbEntry["summary"],
    items: toFbItems(r.items),
    notes: r.notes ?? undefined,
    source: r.source === "zoho" ? "zoho" : "manual",
  };
}

/** Engine `FbEntry` → DB `fb_entries` row payload for insert/upsert.
 *  cinemaId is required after migration 06 (NOT NULL). */
export function fbEntryToRow(
  e: FbEntry,
  updatedBy: string,
  cinemaId: string | null,
): Omit<FbEntryRow, "id" | "updated_at"> & { updated_at: string; cinema_id: string | null } {
  // FbItem / FbSummary are strictly-typed interfaces; the DB column types
  // (FbEntryRow) widen them to Record<string, unknown>. TS won't bridge
  // the two without an `unknown` intermediate.
  return {
    entry_date: e.date,
    cinema_id: cinemaId,
    summary: e.summary as unknown as Record<string, unknown>,
    items: e.items as unknown as Array<Record<string, unknown>>,
    notes: e.notes ?? null,
    // The client only ever writes manual rows — Zoho-owned days are skipped in
    // pushDeltas — but default to 'manual' so a client write can never flip a
    // row to 'zoho'.
    source: e.source ?? "manual",
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  };
}

/** Convert a `fb_products` row to the in-memory FbProduct shape. */
export function fbProductRowToProduct(r: FbProductRow): FbProduct {
  return {
    id: r.id,
    name: r.name,
    category: r.category ?? "",
    defaultRate: r.default_rate ?? 0,
    defaultGstPct: r.default_gst_pct ?? 5,
    posItemNumber: r.pos_item_number ?? undefined,
    isActive: r.is_active ?? true,
  };
}

/** Stable key for an FbEntry — used for delta detection in the sync loop. */
export const fbEntryKey = (e: FbEntry): string => e.date;

/** Cheap content signature for FbEntry delta detection. */
export const fbEntrySignature = (e: FbEntry): string =>
  JSON.stringify({ summary: e.summary, items: e.items, notes: e.notes ?? "" });
