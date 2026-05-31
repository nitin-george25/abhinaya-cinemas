// ============================================================================
// DB row ↔ engine type converters.
//
// Single source of truth for crossing the snake_case ↔ camelCase boundary
// between Supabase and the engine. Tested via mappers.test.ts (TODO).
// ============================================================================

import type { ConfigPayload, EntryRow } from "./db-types";
import type { AppState, Entry, Show } from "./types";

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
  };
}

/** Engine `Entry` → DB `entries` row payload for insert/upsert. */
export function entryToRow(
  e: Entry,
  updatedBy: string,
): Omit<EntryRow, "updated_at"> & { updated_at: string } {
  return {
    entry_date: e.date ?? "",
    movie_id: e.movieId,
    screen_id: e.screenId,
    share: e.share === undefined || (e.share as unknown) === "" ? null : e.share,
    shows: e.shows ?? [],
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
    serialStarts: state.serialStarts,
    openings: state.openings,
  };
}

/** Stable key for an entry — used for delta detection in the sync loop. */
export const entryKey = (e: Entry): string =>
  `${e.date ?? ""}|${e.movieId}|${e.screenId}`;

/** Cheap content signature for delta detection (matches legacy entSig). */
export const entrySignature = (e: Entry): string =>
  JSON.stringify({ share: e.share, shows: e.shows ?? [] });
