// ============================================================================
// Schedule helpers — the programme half of the schedule→entry workflow.
//
// Pure functions only (no React): the per-show unlock gate, copy-forward, and
// AppState mutation helpers. Tested in schedule.test.ts. The DCR engine never
// imports any of this — schedules are UI/workflow state, not DCR inputs.
// ============================================================================

import { uid } from "./mappers";
import { showIdxForSchedule } from "./entry";
import { glasses3dConfig } from "./engine";
import { minutesSinceShowtime, minutesToHHMM, hhmmToMinutes } from "./dates";
import type { Role } from "./hooks/useSupabaseSync";
import type { AppState, DateISO, Entry, Show, ShowSchedule, TimeHHMM, UUID } from "./types";

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

/** Remove a programme row only — leaves entries alone. Callers that delete a
 *  show the operator can see should use `removeSchedule` instead, which also
 *  drops the entered show so nothing is orphaned into the DCR. */
export function removeScheduleRowOnly(state: AppState, id: UUID): AppState {
  return { ...state, showSchedules: state.showSchedules.filter((x) => x.id !== id) };
}

/**
 * Remove a schedule row AND the show it materialized in the entry.
 *
 * Deleting only the programme row used to leave the entered show stranded in
 * `entries[].shows[]`: invisible on the Entry page (which renders from the
 * programme) but still counted by the engine, so its tickets kept showing up in
 * the DCR, the CSVs and every cumulative total. One delete, both halves.
 */
export function removeSchedule(state: AppState, id: UUID): AppState {
  const sched = state.showSchedules.find((x) => x.id === id);
  const next = removeScheduleRowOnly(state, id);
  if (!sched) return next;

  const hit = enteredShowForSchedule(state, sched);
  if (!hit) return next;

  const shows = (hit.entry.shows ?? []).slice();
  shows.splice(hit.showIdx, 1);
  const pruned: Entry = { ...hit.entry, shows };
  return {
    ...next,
    entries: next.entries.map((e) => (e === hit.entry ? pruned : e)),
  };
}

/** Tickets entered against one show (0 when nothing was keyed in). */
export function showTicketCount(show: Show | undefined): number {
  if (!show?.rows) return 0;
  return Object.values(show.rows).reduce((a, r) => a + (r?.tickets ?? 0), 0);
}

/**
 * The entered show a programme row produced, if any. Matches on `scheduleId`
 * first and falls back to showtime, exactly like `showIdxForSchedule` — legacy
 * and copy-forward shows link by time only.
 */
export function enteredShowForSchedule(
  state: AppState,
  sched: ShowSchedule,
): { entry: Entry; showIdx: number; tickets: number } | null {
  const entry = state.entries.find(
    (e) =>
      e.date === sched.date &&
      e.movieId === sched.movieId &&
      e.screenId === sched.screenId,
  );
  const idx = showIdxForSchedule(entry, sched);
  if (!entry || idx < 0) return null;
  return { entry, showIdx: idx, tickets: showTicketCount(entry.shows?.[idx]) };
}

/**
 * Indices of entered shows in `entry` that no longer correspond to any
 * programme row — the show was deleted from the Schedule (or the day was
 * replaced by a copy-forward / Vista import) after tickets were entered.
 *
 * Only meaningful on days that HAVE a programme for that screen: a day with no
 * schedule at all is the off-programme workflow, where every show is legitimate
 * (this also keeps pre-schedule-era history from being flagged).
 */
export function orphanShowIdxs(state: AppState, entry: Entry): number[] {
  const shows = entry.shows ?? [];
  if (shows.length === 0 || !entry.date) return [];
  const dayRows = schedulesForDay(state, entry.date, entry.screenId);
  if (dayRows.length === 0) return [];

  const matched = new Set<number>();
  for (const sched of dayRows) {
    if (sched.movieId !== entry.movieId) continue;
    const idx = showIdxForSchedule(entry, sched);
    if (idx >= 0) matched.add(idx);
  }
  return shows.map((_, i) => i).filter((i) => !matched.has(i));
}

/** Patch a schedule row immutably. Programme only — does NOT touch the entered
 *  show. Use `updateScheduleAndEntry` for operator edits; this stays for
 *  callers that deliberately want the programme half alone. */
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

// ── schedule → entry propagation ────────────────────────────────────────
//
// The programme is the SOURCE OF TRUTH for the fields it owns. Ticket entry
// snapshots them onto the Show at materialization, and until now a later
// Schedule edit changed only the programme: the entered show kept the old
// snapshot, so the DCR silently went on pricing at the old card. Operators had
// to fix the same thing twice, and the second place (the Entry page) shows
// these fields read-only for scheduled shows — so in practice it could not be
// fixed at all.
//
// These edits move real money: the price card drives breakdown() → gross →
// taxes → distributor share. So propagation is gated by the SAME 2-day rule
// the entries table enforces (see trg_entries_edit_lock) — past the window,
// owner only.

/** Fields the programme owns and mirrors onto the entered show. `movieId` is
 *  NOT one of them: entries are keyed by (date, movie, screen), so changing
 *  the movie moves the show to a different entry — see scheduleMovieChangeWarning. */
export type ScheduleOwnedField = "priceCardId" | "showtime" | "is3d";

export interface ScheduleEditGate {
  /** May the programme-owned fields be edited? */
  editable: boolean;
  /** True when a change would rewrite an already-materialized show. */
  rewritesEntry: boolean;
  /** Tickets already keyed against this row. */
  tickets: number;
  /** Set when `editable` is false — shown to the operator. */
  reason?: string;
}

/**
 * Whether this programme row's owned fields may be edited, and what an edit
 * would disturb.
 *
 * A row with no entered show is free to edit at any age — nothing downstream
 * exists to rewrite. Once a show HAS been materialized, an edit rewrites DCR
 * figures, so past the 2-day window it is owner-only, matching the server-side
 * trigger. Without this gate a manager's edit would be accepted by the UI and
 * then silently rejected by the database on push.
 */
export function scheduleEditGate(
  state: AppState,
  sched: ShowSchedule,
  role: Role | null,
  twoDayLockActive: boolean,
): ScheduleEditGate {
  const hit = enteredShowForSchedule(state, sched);
  const rewritesEntry = hit !== null;
  const tickets = hit?.tickets ?? 0;

  if (!rewritesEntry || !twoDayLockActive || role === "owner") {
    return { editable: true, rewritesEntry, tickets };
  }
  return {
    editable: false,
    rewritesEntry,
    tickets,
    reason:
      "This show has box-office entry and the DCR is past the 2-day edit lock. " +
      "Only the owner can change it now.",
  };
}

/**
 * Patch a programme row AND mirror the owned fields onto the show it
 * materialized, so the DCR follows the Schedule.
 *
 * Resolution order matters: the entered show is located BEFORE the patch is
 * applied. showIdxForSchedule falls back to matching on showtime when the
 * scheduleId link is missing (copy-forward / re-import orphans it), so
 * patching the schedule's showtime first would break the very match needed to
 * find the show.
 *
 * Callers must check `scheduleEditGate` first — this function does not gate.
 */
export function updateScheduleAndEntry(
  state: AppState,
  id: UUID,
  patch: Partial<ShowSchedule>,
): AppState {
  const sched = state.showSchedules.find((x) => x.id === id);
  if (!sched) return state;

  // Locate the entered show against the PRE-patch row.
  const hit = enteredShowForSchedule(state, sched);
  const next = updateSchedule(state, id, patch);
  if (!hit) return next;

  const merged = { ...sched, ...patch };
  const shows = (hit.entry.shows ?? []).slice();
  const show = shows[hit.showIdx];
  if (!show) return next;

  const patchedShow: Show = { ...show };
  if ("priceCardId" in patch) patchedShow.priceCardId = merged.priceCardId;
  if ("showtime" in patch) patchedShow.showtime = merged.showtime;
  if ("is3d" in patch) {
    // Turning 3D on snapshots the CURRENT rate, exactly as materialization
    // does. Turning it off drops the line; a hand-set quantity goes with it.
    patchedShow.glasses3d = merged.is3d
      ? (show.glasses3d ?? { ...glasses3dConfig(state) })
      : undefined;
  }
  shows[hit.showIdx] = patchedShow;

  const patchedEntry: Entry = { ...hit.entry, shows };
  return {
    ...next,
    entries: next.entries.map((e) =>
      e.date === patchedEntry.date &&
      e.movieId === patchedEntry.movieId &&
      e.screenId === patchedEntry.screenId
        ? patchedEntry
        : e,
    ),
  };
}

/**
 * Warning text when the operator changes the MOVIE on a row that already has
 * ticket entry, or null when there's nothing to warn about.
 *
 * Movie is deliberately not propagated: `entries` is keyed by (date, movie,
 * screen), so a movie change means moving the show between two entries and
 * re-running the cumulative roll for both films. That is a bigger operation
 * than a field mirror and is not attempted here — the operator is told to
 * delete and re-add instead, which already cleans up both halves.
 */
export function scheduleMovieChangeWarning(
  state: AppState,
  sched: ShowSchedule,
): string | null {
  const hit = enteredShowForSchedule(state, sched);
  if (!hit || hit.tickets === 0) return null;
  return (
    `This show has ${hit.tickets} tickets entered against the current movie. ` +
    "Changing the movie leaves those tickets on the old film — remove the show " +
    "and add it again instead, which clears both the programme row and its entry."
  );
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
    is3d: init?.is3d ?? false,
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
