// ============================================================================
// Local-time date helpers.
//
// Every date in the DCR tool is a LOCAL calendar date (IST), not a UTC
// timestamp. toISOString().slice(0,10) returns the UTC date, which shifts
// back a day in IST any time after ~18:30 local — that's the bug we hunted
// down in the legacy app last week. Use the helpers here instead.
// ============================================================================

import type { DateISO } from "./types";

/** Today's local-time YYYY-MM-DD. */
export function todayIso(): DateISO {
  const d = new Date();
  return localIso(d);
}

/** Convert a JS Date to local-time YYYY-MM-DD. */
export function localIso(d: Date): DateISO {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Add N calendar days to a local YYYY-MM-DD string, returning a local
 * YYYY-MM-DD. Parsed as a local date (not UTC) so month/year rollover and
 * IST stay correct. Used for T+N settlement projections.
 */
export function addDaysIso(iso: DateISO, n: number): DateISO {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return localIso(new Date(y, m - 1, d + n));
}

/** Whole calendar days from isoA to isoB (b − a). Anchored to UTC midnights so
 *  the result is DST-proof and independent of the browser timezone. */
export function daysBetweenIso(isoA: DateISO, isoB: DateISO): number {
  const [ay, am, ad] = isoA.split("-").map(Number);
  const [by, bm, bd] = isoB.split("-").map(Number);
  if (!ay || !am || !ad || !by || !bm || !bd) return 0;
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// ── IST wall-clock helpers ─────────────────────────────────────────────────
//
// The schedule→entry unlock gate compares a show's IST start time against "now".
// The helpers above treat local == IST, which only holds when the browser is
// set to IST. These derive the IST calendar date + minutes-into-day from any
// instant regardless of the device timezone (via Intl), so the +30-min unlock
// fires at the correct moment even on a non-IST laptop.

const IST_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});

export interface IstParts {
  date: DateISO;   // YYYY-MM-DD in IST
  minutes: number; // minutes since IST midnight (0..1439)
}

/** IST calendar date + minutes-since-midnight for an instant (default: now). */
export function istParts(at: Date = new Date()): IstParts {
  const parts = IST_FMT.formatToParts(at);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  let hh = Number(get("hour"));
  if (hh === 24) hh = 0; // some engines emit "24" at midnight
  return { date, minutes: hh * 60 + Number(get("minute")) };
}

/** Today's IST calendar date — correct on any-timezone browsers. */
export function todayIstIso(at: Date = new Date()): DateISO {
  return istParts(at).date;
}

/** Parse "HH:MM" → minutes since midnight; null on malformed input. */
export function hhmmToMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Format minutes-since-midnight → "HH:MM" (24h), wrapping past midnight. */
export function minutesToHHMM(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Minutes elapsed since a scheduled show started, in IST wall-clock space.
 * Positive once the show has begun, negative before it; correct across the
 * IST-midnight boundary. Returns null if showtime is malformed.
 *
 * @param scheduleDate IST calendar date the show belongs to (YYYY-MM-DD)
 * @param showtime     "HH:MM" IST start time
 * @param now          instant to evaluate against (default: current)
 */
export function minutesSinceShowtime(
  scheduleDate: DateISO,
  showtime: string,
  now: Date = new Date(),
): number | null {
  const showMin = hhmmToMinutes(showtime);
  if (showMin == null) return null;
  const cur = istParts(now);
  const dayDelta = daysBetweenIso(scheduleDate, cur.date);
  return dayDelta * 1440 + (cur.minutes - showMin);
}
