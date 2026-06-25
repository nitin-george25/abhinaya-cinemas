// ============================================================================
// Schedule helpers — the programme half of the schedule→entry workflow.
//
// Pure functions only (no React): the per-show unlock gate, copy-forward, and
// AppState mutation helpers. Tested in schedule.test.ts. The DCR engine never
// imports any of this — schedules are UI/workflow state, not DCR inputs.
// ============================================================================

import { uid } from "./mappers";
import { minutesSinceShowtime, minutesToHHMM, hhmmToMinutes } from "./dates";
import type { Role } from "./hooks/useSupabaseSync";
import type { AppState, DateISO, Entry, ShowSchedule, TimeHHMM, UUID } from "./types";

/** Minutes after a show's start before its ticket entry unlocks (tickets close). */
export const UNLOCK_GRACE_MIN = 30;

/**
 * Per-show entry gate:
 *  • upcoming    — tickets haven't closed yet (now < showtime + 30 min).
 *  • open        — editable now.
 *  • past-locked — non-owner, the day is past the 2-day edit lock.
 *  • owner-open  — owner editing past the 2-day lock (always allowed).
 */
export type ShowGate =
  | { state: "upcoming"; opensInMin: number; opensAtHHMM: TimeHHMM }
  | { state: "open" }
  | { state: "past-locked" }
  | { state: "owner-open" };

export interface UnlockInput {
  /** IST calendar date the show belongs to (YYYY-MM-DD). */
  scheduleDate: DateISO;
  /** "HH:MM" IST start time. */
  showtime: TimeHHMM;
  /** Instant to evaluate against (inject for tests; default current). */
  now?: Date;
  role: Role;
  /** Caller-computed: the entry's date is past the 2-day edit lock for
   *  non-owners (date < todayIST − 2). Owner is exempt server- and client-side. */
  twoDayLockActive: boolean;
}

/**
 * Compute a scheduled show's entry gate. The +30-min grace applies to EVERY
 * role (it's a data-correctness gate — tickets must have closed); the 2-day
 * lock exemption applies to the owner only.
 */
export function showUnlockState(input: UnlockInput): ShowGate {
  const { scheduleDate, showtime, role, twoDayLockActive } = input;
  const now = input.now ?? new Date();
  const elapsed = minutesSinceShowtime(scheduleDate, showtime, now);

  // Malformed / missing showtime: treat as not-yet-open rather than editable.
  if (elapsed == null) {
    return { state: "upcoming", opensInMin: Infinity, opensAtHHMM: showtime };
  }

  const reachedUnlock = elapsed >= UNLOCK_GRACE_MIN;
  if (!reachedUnlock) {
    const showMin = hhmmToMinutes(showtime) ?? 0;
    return {
      state: "upcoming",
      opensInMin: Math.max(0, UNLOCK_GRACE_MIN - elapsed),
      opensAtHHMM: minutesToHHMM(showMin + UNLOCK_GRACE_MIN),
    };
  }

  // Tickets have closed. Now apply the 2-day edit lock (owner exempt).
  if (twoDayLockActive) {
    return role === "owner" ? { state: "owner-open" } : { state: "past-locked" };
  }
  return { state: "open" };
}

/** True once a gate permits ticket editing. */
export const isGateEditable = (g: ShowGate): boolean =>
  g.state === "open" || g.state === "owner-open";

// ── queries ─────────────────────────────────────────────────────────────

/** Programme rows for one (date, screen), ordered by position then showtime. */
export function schedulesForDay(
  state: AppState,
  date: DateISO,
  screenId: UUID,
): ShowSchedule[] {
  return state.showSchedules
    .filter((s) => s.date === date && s.screenId === screenId)
    .sort((a, b) => a.showtime.localeCompare(b.showtime) || a.position - b.position);
}

/** Distinct screen ids that have any programme on a date (for the Entry day view). */
export function screensScheduledOn(state: AppState, date: DateISO): UUID[] {
  const seen = new Set<UUID>();
  for (const s of state.showSchedules) if (s.date === date) seen.add(s.screenId);
  return [...seen];
}

/** Latest scheduled showtime for a movie on a screen that day — "" if none.
 *  Cancelled shows are excluded. This is the show that closes out the day for
 *  that movie+screen (drives auto "last show of day" detection). */
export function lastScheduledShowtime(
  state: AppState,
  date: DateISO,
  movieId: UUID,
  screenId: UUID,
): TimeHHMM {
  let max = "";
  for (const s of state.showSchedules) {
    if (s.date === date && s.movieId === movieId && s.screenId === screenId &&
        !s.cancelled && s.showtime > max) {
      max = s.showtime;
    }
  }
  return max;
}

/** Whether a scheduled show is the last of its movie's day (latest showtime). */
export function isLastScheduledShow(state: AppState, sched: ShowSchedule): boolean {
  if (sched.cancelled) return false;
  const max = lastScheduledShowtime(state, sched.date, sched.movieId, sched.screenId);
  return !!max && sched.showtime === max;
}

/**
 * Whether the entered show at `showIdx` is the last show of its movie's day —
 * auto-detected from the schedule (its showtime equals the latest scheduled
 * showtime for that movie+screen+day). Single source of truth for the WhatsApp
 * "append day totals" behaviour. Returns false on days with no schedule.
 */
export function isLastShowOfDay(state: AppState, entry: Entry, showIdx: number): boolean {
  const sh = entry.shows?.[showIdx];
  if (!sh?.showtime) return false;
  const max = lastScheduledShowtime(state, entry.date ?? "", entry.movieId, entry.screenId);
  return !!max && sh.showtime === max;
}

// ── mutations (return fresh AppState; sync hook pushes the delta) ──────────

/** Replace the schedule row with the same id, or append. */
export function upsertSchedule(state: AppState, s: ShowSchedule): AppState {
  const others = state.showSchedules.filter((x) => x.id !== s.id);
  return { ...state, showSchedules: [...others, s] };
}

/** Append several new schedule rows (used by copy-forward). */
export function addSchedules(state: AppState, rows: ShowSchedule[]): AppState {
  return { ...state, showSchedules: [...state.showSchedules, ...rows] };
}

/** Remove a schedule row by id. */
export function removeSchedule(state: AppState, id: UUID): AppState {
  return { ...state, showSchedules: state.showSchedules.filter((x) => x.id !== id) };
}

/** Patch a schedule row immutably. */
export function updateSchedule(
  state: AppState,
  id: UUID,
  patch: Partial<ShowSchedule>,
): AppState {
  return {
    ...state,
    showSchedules: state.showSchedules.map((x) =>
      x.id === id ? { ...x, ...patch } : x,
    ),
  };
}

/** A fresh programme row for (date, screen) at the next position. cinemaId is
 *  the resolved cinema from the sync state (the push also stamps it, so "" is
 *  tolerated, but pass it for correctness). */
export function blankSchedule(
  state: AppState,
  date: DateISO,
  screenId: UUID,
  cinemaId: UUID,
  init?: Partial<Omit<ShowSchedule, "id" | "date" | "screenId">>,
): ShowSchedule {
  const nextPos = schedulesForDay(state, date, screenId).length;
  return {
    id: uid(),
    cinemaId,
    date,
    screenId,
    movieId: init?.movieId ?? "",
    priceCardId: init?.priceCardId,
    showtime: init?.showtime ?? "",
    position: init?.position ?? nextPos,
    cancelled: init?.cancelled ?? false,
    notes: init?.notes,
  };
}

/**
 * Clone a list of programme rows onto a new date with fresh ids and a clean
 * (uncancelled) state. Caller passes the source day's rows (typically the
 * non-cancelled ones); copy preserves showtime / movie / price-card / order.
 */
export function copyScheduleForward(
  source: ShowSchedule[],
  toDate: DateISO,
): ShowSchedule[] {
  return source
    .slice()
    .sort((a, b) => a.position - b.position || a.showtime.localeCompare(b.showtime))
    .map((s, i) => ({
      ...s,
      id: uid(),
      date: toDate,
      position: i,
      cancelled: false,
    }));
}

/** True if adding/moving a row to `showtime` would collide with another row
 *  on the same (date, screen). Surfaces the DB unique constraint pre-emptively. */
export function hasShowtimeClash(
  rows: ShowSchedule[],
  showtime: TimeHHMM,
  ignoreId?: UUID,
): boolean {
  if (!showtime) return false;
  return rows.some((r) => r.id !== ignoreId && r.showtime === showtime);
}
