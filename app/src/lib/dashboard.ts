// ============================================================================
// Dashboard aggregations — pure functions over AppState.
//
// Mirrors the BO-side of admin/dcr/js/07-dashboard.js, but the math is now
// expressed against the typed engine + types from C1. No DOM, no chart libs,
// no fetching — just (state, range) → numbers. The dashboard React tree
// renders the output.
//
// When Phase D lands, these functions will be replaced by `select` queries
// against pre-aggregated views. The shape of the return values stays the
// same, so the dashboard UI doesn't change.
// ============================================================================

import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
  subYears,
} from "date-fns";

import { computeEntry, screenClasses, screenById, N } from "./engine";
import type {
  AppState,
  DateISO,
  Entry,
  Movie,
  Screen,
  UUID,
} from "./types";

// ── period selector ────────────────────────────────────────────────────

export type PresetId =
  | "last7"
  | "last30"
  | "last90"
  | "thisMonth"
  | "all"
  | "custom";

export interface Period {
  /** Inclusive YYYY-MM-DD. */
  from: DateISO;
  /** Inclusive YYYY-MM-DD. */
  to: DateISO;
  /** Inclusive day count. */
  days: number;
  /** Same window, exactly one year earlier (year-over-year comparison).
   *  date-fns subYears clamps Feb 29 to Feb 28 in non-leap target years. */
  prevFrom: DateISO;
  prevTo: DateISO;
}

/** Local-date YYYY-MM-DD (avoids the toISOString UTC bug). */
const iso = (d: Date): DateISO => format(d, "yyyy-MM-dd");

export function resolvePeriod(
  preset: PresetId,
  state: AppState,
  custom?: { from: DateISO; to: DateISO },
  today: Date = new Date(),
): Period {
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);

  let from: DateISO;
  let to: DateISO;

  switch (preset) {
    case "last7":
      from = iso(addDays(t, -6));
      to = iso(t);
      break;
    case "last30":
      from = iso(addDays(t, -29));
      to = iso(t);
      break;
    case "last90":
      from = iso(addDays(t, -89));
      to = iso(t);
      break;
    case "thisMonth":
      from = iso(startOfMonth(t));
      to = iso(t < endOfMonth(t) ? t : endOfMonth(t));
      break;
    case "all": {
      const all: DateISO[] = [];
      (state.entries ?? []).forEach((e) => { if (e.date) all.push(e.date); });
      (state.fbEntries ?? []).forEach((e) => { if (e.date) all.push(e.date); });
      if (all.length) {
        all.sort();
        from = all[0]!;
        to = all[all.length - 1]!;
      } else {
        from = iso(t);
        to = iso(t);
      }
      break;
    }
    case "custom": {
      // `||` (not `??`) so an empty string also falls through to today's
      // date — the Custom pill seeds the inputs with "" before the user
      // picks anything, and we don't want NaN dates downstream.
      from = (custom?.from || iso(t)) as DateISO;
      to = (custom?.to || iso(t)) as DateISO;
      break;
    }
  }

  const days = differenceInCalendarDays(parseISO(to), parseISO(from)) + 1;
  // YoY comparison: shift both endpoints back by exactly one year.
  // Cinema attendance is heavily seasonal (festivals, school holidays,
  // monsoon), so same-week-last-year is a more meaningful baseline than
  // the immediately prior equal-length window.
  const prevFrom = iso(subYears(parseISO(from), 1));
  const prevTo   = iso(subYears(parseISO(to), 1));
  return { from, to, days, prevFrom, prevTo };
}

// ── BO aggregation ─────────────────────────────────────────────────────

export interface DailyAggregate {
  audience: number;
  grossColl: number;
  netShare: number;
  distShare: number;
  exShare: number;
  showCount: number;
}

export interface ScreenAggregate {
  screenId: UUID;
  screenName: string;
  audience: number;
  grossColl: number;
  showCount: number;
  /** Total seats available across all played shows in the period. */
  seatsAvailable: number;
}

export interface MovieAggregate {
  movieId: UUID;
  movieName: string;
  audience: number;
  grossColl: number;
  netShare: number;
  daysPlayed: number;
}

export interface PeriodKpis {
  audience: number;
  grossColl: number;
  netShare: number;
  showCount: number;
  seatsAvailable: number;
  /** Average ticket price = grossColl / audience; null if no tickets. */
  atp: number | null;
  /** Occupancy = audience / seatsAvailable; null if no shows played. */
  occupancyPct: number | null;
}

export interface BoAggregate {
  daily: Map<DateISO, DailyAggregate>;
  byScreen: ScreenAggregate[];
  byMovie: MovieAggregate[];
  totals: PeriodKpis;
}

/** Sum of seats across all class assignments on a screen. */
export function screenSeatTotal(state: AppState, screen: Screen | undefined): number {
  return screenClasses(state, screen).reduce((a, c) => a + N(c.seats), 0);
}

/**
 * Walks every entry in the range, runs computeEntry for the typed totals,
 * and rolls per-day / per-screen / per-movie aggregates.
 *
 * O(entries) — fine at current scale; Phase D moves this to a SQL view.
 */
export function aggregateBO(state: AppState, period: Period): BoAggregate {
  const daily = new Map<DateISO, DailyAggregate>();
  const byScreen = new Map<UUID, ScreenAggregate>();
  const byMovie = new Map<UUID, { agg: MovieAggregate; dates: Set<DateISO> }>();

  let audience = 0;
  let grossColl = 0;
  let netShare = 0;
  let showCount = 0;
  let seatsAvailable = 0;

  for (const e of state.entries ?? []) {
    if (!e.date || e.date < period.from || e.date > period.to) continue;
    const c = safeCompute(state, e);
    if (!c) continue;
    const t = c.today;

    // daily
    const d = daily.get(e.date) ?? emptyDaily();
    d.audience += t.audience;
    d.grossColl += t.grossColl;
    d.netShare += t.netShare;
    d.distShare += t.distShare;
    d.exShare += t.exShare;
    d.showCount += (e.shows ?? []).length;
    daily.set(e.date, d);

    // by screen
    const scr = screenById(state, e.screenId);
    const sa = byScreen.get(e.screenId) ?? {
      screenId: e.screenId,
      screenName: scr?.name ?? "—",
      audience: 0,
      grossColl: 0,
      showCount: 0,
      seatsAvailable: 0,
    };
    sa.audience += t.audience;
    sa.grossColl += t.grossColl;
    const showsHere = (e.shows ?? []).length;
    sa.showCount += showsHere;
    sa.seatsAvailable += showsHere * screenSeatTotal(state, scr);
    byScreen.set(e.screenId, sa);

    // by movie
    const movie: Movie | undefined = c.movie;
    const mid = e.movieId;
    const m = byMovie.get(mid);
    if (m) {
      m.agg.audience += t.audience;
      m.agg.grossColl += t.grossColl;
      m.agg.netShare += t.netShare;
      m.dates.add(e.date);
    } else {
      const dates = new Set<DateISO>();
      dates.add(e.date);
      byMovie.set(mid, {
        agg: {
          movieId: mid,
          movieName: movie?.name ?? mid,
          audience: t.audience,
          grossColl: t.grossColl,
          netShare: t.netShare,
          daysPlayed: 0, // finalized below
        },
        dates,
      });
    }

    // totals
    audience += t.audience;
    grossColl += t.grossColl;
    netShare += t.netShare;
    showCount += showsHere;
    seatsAvailable += showsHere * screenSeatTotal(state, scr);
  }

  // Finalize daysPlayed.
  for (const v of byMovie.values()) v.agg.daysPlayed = v.dates.size;

  const totals: PeriodKpis = {
    audience,
    grossColl,
    netShare,
    showCount,
    seatsAvailable,
    atp: audience > 0 ? grossColl / audience : null,
    occupancyPct: seatsAvailable > 0 ? (audience / seatsAvailable) * 100 : null,
  };

  return {
    daily,
    byScreen: [...byScreen.values()].sort((a, b) => b.grossColl - a.grossColl),
    byMovie: [...byMovie.values()]
      .map((v) => v.agg)
      .sort((a, b) => b.grossColl - a.grossColl),
    totals,
  };
}

/** Build the full inclusive list of dates [from..to], one per day. */
export function buildDateList(period: Period): DateISO[] {
  const out: DateISO[] = [];
  let d = parseISO(period.from);
  const end = parseISO(period.to);
  while (d <= end) {
    out.push(iso(d));
    d = addDays(d, 1);
  }
  return out;
}

/** Percent change cur vs prev; null if prev is 0/null/undefined. */
export function pctDelta(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

// ── helpers ────────────────────────────────────────────────────────────

function emptyDaily(): DailyAggregate {
  return {
    audience: 0,
    grossColl: 0,
    netShare: 0,
    distShare: 0,
    exShare: 0,
    showCount: 0,
  };
}

function safeCompute(state: AppState, e: Entry) {
  try {
    return computeEntry(state, e);
  } catch (err) {
    console.warn("computeEntry failed for entry", e.id, err);
    return null;
  }
}

// ── F&B aggregation ────────────────────────────────────────────────────

export interface FbDailyAggregate {
  /** Net F&B sales (legacy `summary.grossSales`, despite the name). */
  net: number;
  /** Net food sales. */
  food: number;
  /** Net beverages sales. */
  beverages: number;
  /** Add-on tax (GST etc). */
  tax: number;
  /** Gross with tax. */
  totalWithTax: number;
  /** Bill count for the day. */
  bills: number | null;
}

export interface FbCategoryAggregate {
  category: string;
  net: number;
  qty: number;
}

export interface FbTotals {
  net: number;
  totalWithTax: number;
  tax: number;
  bills: number;
  /** Sales per head = net / BO audience for the same period. Null when no audience. */
  sph: number | null;
}

export interface FbAggregate {
  daily: Map<DateISO, FbDailyAggregate>;
  byCategory: FbCategoryAggregate[];
  totals: FbTotals;
}

/**
 * Aggregate F&B entries in a period. Legacy field names preserved
 * (`grossSales` is actually net of tax — kept for compatibility with
 * existing data).
 */
export function aggregateFB(
  state: AppState,
  period: Period,
  audience: number,
): FbAggregate {
  const daily = new Map<DateISO, FbDailyAggregate>();
  const byCat = new Map<string, FbCategoryAggregate>();
  let net = 0;
  let totalWithTax = 0;
  let tax = 0;
  let bills = 0;

  for (const e of state.fbEntries ?? []) {
    if (!e.date || e.date < period.from || e.date > period.to) continue;
    const s = e.summary ?? {};
    const dNet      = N(s.grossSales);
    const dFood     = N(s.foodSales);
    const dBev      = N(s.beveragesSales);
    const dTax      = N(s.addTax);
    const dTotal    = N(s.netSalesWithTax);
    const dBills    = s.bills == null ? null : N(s.bills);

    daily.set(e.date, {
      net: dNet,
      food: dFood,
      beverages: dBev,
      tax: dTax,
      totalWithTax: dTotal,
      bills: dBills,
    });

    net += dNet;
    totalWithTax += dTotal;
    tax += dTax;
    if (dBills != null) bills += dBills;

    for (const it of e.items ?? []) {
      const cat = it.category && it.category.trim() ? it.category : "Uncategorised";
      const cur = byCat.get(cat) ?? { category: cat, net: 0, qty: 0 };
      cur.net += N(it.netAmount);
      cur.qty += N(it.qty);
      byCat.set(cat, cur);
    }
  }

  return {
    daily,
    byCategory: [...byCat.values()].sort((a, b) => b.net - a.net),
    totals: {
      net,
      totalWithTax,
      tax,
      bills,
      sph: audience > 0 ? net / audience : null,
    },
  };
}

// ── formatters ─────────────────────────────────────────────────────────

export function fmtINR(n: number | null | undefined, decimals = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return (
    "₹ " +
    n.toLocaleString("en-IN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
}

export function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-IN");
}

export function fmtPct(n: number | null | undefined, decimals = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(decimals) + "%";
}

/**
 * Compact INR for narrow tiles: ₹ 1.2L, ₹ 23.4K, ₹ 5.6Cr.
 * Sub-1000 just returns the rounded rupee figure with the symbol.
 */
export function fmtINRCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_00_00_000) return `${sign}₹ ${(abs / 1_00_00_000).toFixed(abs >= 1_00_00_00_000 ? 0 : 2)}Cr`;
  if (abs >= 1_00_000)    return `${sign}₹ ${(abs / 1_00_000).toFixed(abs >= 10_00_000 ? 1 : 2)}L`;
  if (abs >= 1_000)       return `${sign}₹ ${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return `${sign}₹ ${Math.round(abs)}`;
}

/** Compact int: 1.2K, 23.4K, 1.2M. Falls through to the regular fmtInt below 1k. */
export function fmtIntCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${sign}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return `${sign}${Math.round(abs)}`;
}
