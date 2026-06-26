// ============================================================================
// DB row ↔ domain converters for `show_schedules` (the programme).
//
// Mirrors the entryKey / entrySignature delta-detection shape in mappers.ts so
// the sync loop reads identically. Schedule rows have a real PK, so the delta
// key is the id (unlike entries, which key on a composite).
// ============================================================================

import type { ShowScheduleRow } from "../db-types";
import type { ShowSchedule } from "../types";
import { uid } from "../mappers";

/** Coerce a `show_schedules` row → domain `ShowSchedule`.
 *  Postgres `time` comes back as "HH:MM:SS"; the app works in HH:MM. */
export function rowToShowSchedule(r: ShowScheduleRow): ShowSchedule {
  return {
    id: r.id,
    cinemaId: r.cinema_id,
    date: r.schedule_date,
    screenId: r.screen_id,
    movieId: r.movie_id,
    priceCardId: r.price_card_id ?? undefined,
    showtime: (r.showtime ?? "").slice(0, 5),
    position: r.position ?? 0,
    cancelled: r.cancelled ?? false,
    notes: r.notes ?? undefined,
  };
}

/** Domain `ShowSchedule` → DB row payload for insert/upsert. cinemaId is
 *  required (NOT NULL); callers should skip the write if it's null. */
export function showScheduleToRow(
  s: ShowSchedule,
  updatedBy: string,
  cinemaId: string | null,
): Omit<ShowScheduleRow, "created_at" | "created_by" | "updated_at"> & {
  updated_at: string;
} {
  return {
    id: s.id,
    cinema_id: cinemaId ?? s.cinemaId,
    schedule_date: s.date,
    screen_id: s.screenId,
    movie_id: s.movieId,
    price_card_id: s.priceCardId ?? null,
    // Send HH:MM; Postgres `time` accepts it.
    showtime: s.showtime,
    position: s.position ?? 0,
    cancelled: s.cancelled ?? false,
    notes: s.notes ?? null,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  };
}

/** A fresh client-side ShowSchedule (new id), used when adding a row. */
export function newShowSchedule(
  init: Omit<ShowSchedule, "id">,
): ShowSchedule {
  return { id: uid(), ...init };
}

/** A row is pushable once it names both a movie and a valid HH:MM showtime.
 *  In-progress rows (just-added, movie not picked) stay local until complete,
 *  so we never write a phantom movie-less / time-less show to the cloud. */
export const isCompleteSchedule = (s: ShowSchedule): boolean =>
  !!s.movieId && /^\d{1,2}:\d{2}/.test(s.showtime ?? "");

/** Stable delta key — the row id (schedule rows have a real PK). */
export const showScheduleKey = (s: ShowSchedule): string => s.id;

/** Cheap content signature for delta detection (matches entrySignature style). */
export const showScheduleSignature = (s: ShowSchedule): string =>
  JSON.stringify({
    date: s.date,
    screenId: s.screenId,
    movieId: s.movieId,
    priceCardId: s.priceCardId ?? null,
    showtime: s.showtime,
    position: s.position ?? 0,
    cancelled: s.cancelled ?? false,
    notes: s.notes ?? "",
  });
