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
