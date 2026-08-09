// ============================================================================
// Entry mutation helpers — pure functions returning fresh AppState.
//
// The Entry editor calls setAppState(...) with the result of these. The sync
// hook handles the rest (delta detection + debounced push to Supabase).
// ============================================================================

import { entryClasses, glasses3dConfig, screenById } from "./engine";
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

/**
 * Index of the Show materialized from this scheduled show within an entry,
 * or -1.
 *
 * Primary match is `Show.scheduleId`. But copy-forward and re-import REPLACE a
 * day's programme with fresh ids (copyScheduleForward / applyImport), which
 * orphans every already-entered show's link — the Entry page then rendered
 * blank 0-ticket cards over intact data, and editing materialized duplicate
 * shows. So when the id misses, fall back to the showtime snapshotted onto the
 * Show at materialization: the programme guarantees showtimes are unique per
 * (date, screen) (hasShowtimeClash + DB unique constraint), so within one
 * entry's shows the match is unambiguous.
 */
export function showIdxForSchedule(
  entry: Entry | undefined,
  sched: Pick<ShowSchedule, "id" | "showtime">,
): number {
  if (!entry?.shows) return -1;
  const byId = entry.shows.findIndex((s) => s.scheduleId === sched.id);
  if (byId !== -1) return byId;
  if (!sched.showtime) return -1;
  return entry.shows.findIndex((s) => s.showtime === sched.showtime);
}

/**
 * Ensure the (date, movie, screen) entry exists and holds a Show for this
 * scheduled show, snapshotting the schedule's showtime + price card onto it.
 * Returns the next AppState plus the materialized entry and the show's index.
 * Idempotent — if the show already exists nothing new is created. A show found
 * via the showtime fallback (orphaned link after a programme replace) is
 * healed: its scheduleId is re-pointed at the current schedule row.
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
  let idx = showIdxForSchedule(entry, sched);
  if (idx === -1) {
    const sh = blankShow(state, sched.screenId, sched.priceCardId);
    sh.showtime = sched.showtime;
    sh.scheduleId = sched.id;
    // A 3D programme row seeds the glasses-rental line. The rate is snapshotted
    // here, at materialization, so a later rate change never re-prices a filed
    // DCR. qty stays auto (= the show's paid tickets) until overridden.
    if (sched.is3d) sh.glasses3d = { ...glasses3dConfig(state) };
    entry = { ...entry, shows: [...(entry.shows ?? []), sh] };
    idx = (entry.shows ?? []).length - 1;
  } else if (entry.shows?.[idx]?.scheduleId !== sched.id) {
    // Matched by showtime — repair the orphaned link in place.
    entry = updateShow(entry, idx, { scheduleId: sched.id });
  }
  return { state: upsertEntry(state, entry), entry, showIdx: idx };
}
