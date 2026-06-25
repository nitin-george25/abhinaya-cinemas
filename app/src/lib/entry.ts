// ============================================================================
// Entry mutation helpers — pure functions returning fresh AppState.
//
// The Entry editor calls setAppState(...) with the result of these. The sync
// hook handles the rest (delta detection + debounced push to Supabase).
// ============================================================================

import { entryClasses, screenById } from "./engine";
import { uid } from "./mappers";
import type {
  AppState,
  DateISO,
  Entry,
  Show,
  ShowRow,
  ShowSchedule,
  UUID,
} from "./types";

// ── lookup ─────────────────────────────────────────────────────────────

export function findEntry(
  state: AppState,
  date: DateISO,
  movieId: UUID,
  screenId: UUID,
): Entry | undefined {
  return state.entries.find(
    (e) => e.date === date && e.movieId === movieId && e.screenId === screenId,
  );
}

// ── create ─────────────────────────────────────────────────────────────

/**
 * Make a fresh Entry with one empty show. Class rows are pre-populated with
 * 0 tickets for every class on the chosen screen so the editor has a stable
 * shape to render. The default price card is whatever the screen lists
 * first.
 */
export function blankEntry(
  state: AppState,
  date: DateISO,
  movieId: UUID,
  screenId: UUID,
): Entry {
  const screen = screenById(state, screenId);
  const firstCardId = screen?.priceCards?.[0]?.id;
  return {
    id: uid(),
    date,
    movieId,
    screenId,
    // No per-day override on a fresh day: share stays null so resolveShare
    // inherits the movie's week rate (else its base %). A deliberate per-day
    // deal is set explicitly in the header.
    share: null,
    shows: [blankShow(state, screenId, firstCardId)],
  };
}

/** A new show row with 0 tickets in every class on the screen. */
export function blankShow(
  state: AppState,
  screenId: UUID,
  priceCardId?: UUID,
): Show {
  const screen = screenById(state, screenId);
  // Active classes only — new shows must not pre-seed rows for
  // historical-era classes.
  const cls = entryClasses(state, screen);
  const rows: Record<UUID, ShowRow> = {};
  cls.forEach((c) => {
    rows[c.classId] = { tickets: 0 };
  });
  return {
    showtime: "",
    priceCardId: priceCardId ?? screen?.priceCards?.[0]?.id,
    rows,
  };
}

// ── upsert / delete ────────────────────────────────────────────────────

/**
 * Replace any existing entry that shares this (date, movie, screen) key,
 * or append. Always returns a new AppState (no in-place mutation).
 */
export function upsertEntry(state: AppState, entry: Entry): AppState {
  const others = state.entries.filter(
    (e) =>
      !(
        e.date === entry.date &&
        e.movieId === entry.movieId &&
        e.screenId === entry.screenId
      ),
  );
  return { ...state, entries: [...others, entry] };
}

export function deleteEntry(
  state: AppState,
  date: DateISO,
  movieId: UUID,
  screenId: UUID,
): AppState {
  return {
    ...state,
    entries: state.entries.filter(
      (e) =>
        !(e.date === date && e.movieId === movieId && e.screenId === screenId),
    ),
  };
}

// ── show-level immutable updates ───────────────────────────────────────

export function updateShow(entry: Entry, idx: number, patch: Partial<Show>): Entry {
  const shows = (entry.shows ?? []).slice();
  const sh = shows[idx];
  if (!sh) return entry;
  shows[idx] = { ...sh, ...patch };
  return { ...entry, shows };
}

export function updateShowRow(
  entry: Entry,
  showIdx: number,
  classId: UUID,
  patch: Partial<ShowRow>,
): Entry {
  const shows = (entry.shows ?? []).slice();
  const sh = shows[showIdx];
  if (!sh) return entry;
  const rows = { ...(sh.rows ?? {}) };
  rows[classId] = { ...(rows[classId] ?? {}), ...patch };
  shows[showIdx] = { ...sh, rows };
  return { ...entry, shows };
}

export function addShow(state: AppState, entry: Entry): Entry {
  return {
    ...entry,
    shows: [...(entry.shows ?? []), blankShow(state, entry.screenId)],
  };
}

export function removeShow(entry: Entry, idx: number): Entry {
  const shows = (entry.shows ?? []).slice();
  shows.splice(idx, 1);
  return { ...entry, shows };
}

// ── schedule → entry ───────────────────────────────────────────────────
//
// In the schedule-driven workflow, an entered Show is created lazily from a
// scheduled show (show_schedules row) the first time tickets are entered, and
// linked back via Show.scheduleId. These helpers keep the entry's shows[] in
// step with the programme without the engine ever seeing a phantom show.

/** Index of the Show materialized from `scheduleId` within an entry, or -1. */
export function showIdxForSchedule(
  entry: Entry | undefined,
  scheduleId: UUID,
): number {
  if (!entry?.shows) return -1;
  return entry.shows.findIndex((s) => s.scheduleId === scheduleId);
}

/**
 * Ensure the (date, movie, screen) entry exists and holds a Show for this
 * scheduled show, snapshotting the schedule's showtime + price card onto it.
 * Returns the next AppState plus the materialized entry and the show's index.
 * Idempotent — if the show already exists nothing new is created.
 */
export function ensureScheduledShow(
  state: AppState,
  sched: ShowSchedule,
): { state: AppState; entry: Entry; showIdx: number } {
  let entry =
    findEntry(state, sched.date, sched.movieId, sched.screenId) ??
    {
      id: uid(),
      date: sched.date,
      movieId: sched.movieId,
      screenId: sched.screenId,
      share: null,
      shows: [],
    };
  let idx = showIdxForSchedule(entry, sched.id);
  if (idx === -1) {
    const sh = blankShow(state, sched.screenId, sched.priceCardId);
    sh.showtime = sched.showtime;
    sh.scheduleId = sched.id;
    entry = { ...entry, shows: [...(entry.shows ?? []), sh] };
    idx = (entry.shows ?? []).length - 1;
  }
  return { state: upsertEntry(state, entry), entry, showIdx: idx };
}
