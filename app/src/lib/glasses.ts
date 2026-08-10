// ============================================================================
// 3D glasses rental — reporting aggregation.
//
// The rental is CINEMA-ONLY income: collected on top of the printed ticket
// price, never part of Gross Collection, never split with the distributor.
// It is deliberately absent from the DCR — that document is the box-office
// record a distributor is settled against. This module is where the money is
// reported instead: Reports → Box Office, the Entry page summary, and the
// per-movie popup on History.
//
// DELIBERATELY NOT computeEntry(). That function builds the full ticket-serial
// roll across every entry on the screen, which is far too heavy to run over
// years of history for a report. Ticket counts are all this lane needs, and
// they are a cheap sum over each show's rows — so this file walks the raw
// entries directly and calls the same showGlasses() the engine does. The two
// paths agree because both resolve an auto quantity to the show's paid ticket
// count, and classes with no tickets contribute nothing either way.
// ============================================================================

import { N, glasses3dConfig, showGlasses } from "./engine";
import type {
  AppState,
  DateISO,
  Entry,
  GlassesLine,
  Show,
  UUID,
} from "./types";

/** Paid tickets across every class in a show. Free passes are not in `rows`. */
export function showTicketCount(sh: Show): number {
  return Object.values(sh.rows ?? {}).reduce(
    (a, r) => a + N(r && r.tickets),
    0,
  );
}

/** One day of glasses income for a (date, movie, screen). */
export interface GlassesDayRow {
  date: DateISO;
  movieId: UUID;
  movieName: string;
  screenId: UUID;
  screenName: string;
  /** Shows that day carrying a glasses charge (qty > 0). */
  shows: number;
  qty: number;
  amount: number;
  taxable: number;
  gst: number;
}

/** A movie's whole run, rolled up. */
export interface GlassesMovieRow {
  movieId: UUID;
  movieName: string;
  firstDay: DateISO;
  lastDay: DateISO;
  days: number;
  qty: number;
  amount: number;
  taxable: number;
  gst: number;
}

export interface GlassesTotals {
  qty: number;
  amount: number;
  taxable: number;
  gst: number;
}

export const EMPTY_GLASSES_TOTALS: GlassesTotals = {
  qty: 0, amount: 0, taxable: 0, gst: 0,
};

/** Round to 2dp. Local copy so this module stays independent of engine internals. */
const r2 = (x: number): number => Math.round((x + Number.EPSILON) * 100) / 100;

/**
 * Per-day glasses rows for the given entries, newest first.
 *
 * Entries with no 3D show at all are skipped, so the result is only ever as
 * long as the cinema's actual 3D history — cheap even over every entry.
 */
export function glassesDayRows(
  state: AppState,
  entries: Entry[],
): GlassesDayRow[] {
  const cfg = glasses3dConfig(state);
  const out: GlassesDayRow[] = [];

  for (const entry of entries) {
    const lines: GlassesLine[] = [];
    for (const sh of entry.shows ?? []) {
      // Short-circuit before counting tickets: most shows are 2D, and this
      // walks every show of every entry the cinema has ever had.
      if (sh.glasses3d == null) continue;
      const line = showGlasses(sh, showTicketCount(sh), cfg);
      // A 3D show that sold nothing bills nothing and is not a reportable row.
      if (line && line.qty > 0) lines.push(line);
    }
    if (lines.length === 0) continue;

    const movie = state.movies.find((m) => m.id === entry.movieId);
    const screen = state.screens.find((s) => s.id === entry.screenId);
    out.push({
      date: entry.date ?? "",
      movieId: entry.movieId,
      movieName: movie?.name ?? entry.movieId,
      screenId: entry.screenId,
      screenName: screen?.name ?? entry.screenId,
      shows: lines.length,
      qty: lines.reduce((a, l) => a + l.qty, 0),
      amount: r2(lines.reduce((a, l) => a + l.amount, 0)),
      taxable: r2(lines.reduce((a, l) => a + l.taxable, 0)),
      gst: r2(lines.reduce((a, l) => a + l.gst, 0)),
    });
  }

  return out.sort(
    (a, b) => b.date.localeCompare(a.date) || a.movieName.localeCompare(b.movieName),
  );
}

/** Narrow day rows to an inclusive date window. Blank bounds mean unbounded. */
export function filterByDate(
  rows: GlassesDayRow[],
  from?: DateISO,
  to?: DateISO,
): GlassesDayRow[] {
  return rows.filter(
    (r) => (!from || r.date >= from) && (!to || r.date <= to),
  );
}

/** Roll day rows up per movie, highest earning first. */
export function glassesByMovie(rows: GlassesDayRow[]): GlassesMovieRow[] {
  const byId = new Map<UUID, GlassesMovieRow>();
  for (const r of rows) {
    const cur = byId.get(r.movieId);
    if (cur) {
      cur.firstDay = r.date < cur.firstDay ? r.date : cur.firstDay;
      cur.lastDay = r.date > cur.lastDay ? r.date : cur.lastDay;
      cur.days += 1;
      cur.qty += r.qty;
      cur.amount = r2(cur.amount + r.amount);
      cur.taxable = r2(cur.taxable + r.taxable);
      cur.gst = r2(cur.gst + r.gst);
    } else {
      byId.set(r.movieId, {
        movieId: r.movieId,
        movieName: r.movieName,
        firstDay: r.date,
        lastDay: r.date,
        days: 1,
        qty: r.qty,
        amount: r.amount,
        taxable: r.taxable,
        gst: r.gst,
      });
    }
  }
  return [...byId.values()].sort((a, b) => b.amount - a.amount);
}

/** Sum any set of rows carrying the four money fields. */
export function glassesTotals(
  rows: Array<Pick<GlassesTotals, "qty" | "amount" | "taxable" | "gst">>,
): GlassesTotals {
  return rows.reduce<GlassesTotals>(
    (a, r) => ({
      qty: a.qty + r.qty,
      amount: r2(a.amount + r.amount),
      taxable: r2(a.taxable + r.taxable),
      gst: r2(a.gst + r.gst),
    }),
    { ...EMPTY_GLASSES_TOTALS },
  );
}

/**
 * Everything the History popup needs for one movie: its day-by-day glasses
 * income across the whole run, plus the run total. Reads the full local entry
 * set, so it is not limited to the History page's current page of results.
 */
export function glassesForMovie(
  state: AppState,
  movieId: UUID,
): { rows: GlassesDayRow[]; total: GlassesTotals } {
  const rows = glassesDayRows(
    state,
    state.entries.filter((e) => e.movieId === movieId),
  );
  return { rows, total: glassesTotals(rows) };
}

/** True if any show in the entry carries a glasses charge — drives the
 *  History row's CTA, so it must be as cheap as the row render itself. */
export function entryHasGlasses(entry: Entry): boolean {
  return (entry.shows ?? []).some(
    (sh) => sh.glasses3d != null && showTicketCount(sh) > 0,
  );
}
