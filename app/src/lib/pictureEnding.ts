// ============================================================================
// Picture Ending Statement — settlement engine.
//
// At the end of a film's run we hand the distributor a "Picture Ending
// Statement": a credit/debit account that settles the distributor's share of
// the box office. This module turns a movie's DCR entries into that statement.
//
// The weekly NET / SHARE figures reuse the SAME math as the DCR engine
// (computeShallow → netShare / distShare / exShare), so a Picture Ending
// always reconciles with the daily reports it is built from. NET is already
// net of GST, eTax, TMC, cess, fund AND representative batta — so batta is NOT
// a separate expense line here (it is inside NET by the cinema's convention).
//
// The credit/debit cascade (mirrors the physical statement):
//   CREDIT  = distributor share (Σ distShare)  +  GST on share (SGST+CGST | IGST)
//   DEBIT   = publicity (% of ex-share) + its GST
//           + TDS (% of share + publicity)
//           + flex display charge
//           + hold-over amount (usually ₹0 — hold-over is an informational date)
//           + advances already paid
//   BALANCE PAYABLE = CREDIT − DEBIT  (+ round-off)
//
// SGST+CGST vs IGST is auto-derived from the GST state code (first two digits)
// of the cinema's vs the distributor's GSTIN, and overridable per statement.
// ============================================================================

import {
  N,
  r2,
  daysBetween,
  computeShallow,
  screenById,
  screenClasses,
  cardById,
} from "./engine";
import { todayIso, addDaysIso } from "./dates";
import type { AppState, DateISO, Distributor, Movie, Show, UUID } from "./types";

// ── tax-kind detection ────────────────────────────────────────────────────

/** First two chars of a GSTIN = the GST state code (e.g. "32" = Kerala). */
export function gstStateCode(gstin?: string | null): string | null {
  if (!gstin) return null;
  const code = gstin.trim().slice(0, 2);
  return /^\d{2}$/.test(code) ? code : null;
}

/**
 * SGST+CGST (intra-state) vs IGST (inter-state), from the two GSTINs.
 * Defaults to 'intra' when either state code is unknown (the common case for
 * a Kerala cinema settling with a Kerala distributor).
 */
export function autoTaxKind(
  cinemaGstin?: string | null,
  distributorGstin?: string | null,
): "intra" | "inter" {
  const a = gstStateCode(cinemaGstin);
  const b = gstStateCode(distributorGstin);
  if (!a || !b) return "intra";
  return a === b ? "intra" : "inter";
}

// ── statement inputs (the editable half of the document) ──────────────────

export interface PictureEndingAdvance {
  /** Optional id of the backing distributor_payments row (when persisted). */
  id?: string;
  paidOn: DateISO;
  amount: number;
  mode?: string;        // rtgs | neft | cheque | cash | ...
  ref?: string;         // cheque no / UTR
  bank?: string;        // bank + account label
  note?: string;
}

export interface PictureEndingInputs {
  statementDate: DateISO;
  /** Free-text language/format tag printed beside the title, e.g. "M-2D". */
  movieFormat?: string;
  /** "NAME OF THEATRE" line — defaults to the cinema name. */
  theatreName?: string;
  representative?: string;
  taxKind: "intra" | "inter";
  gstPct: number;          // GST on share / publicity, e.g. 18
  publicityPct: number;    // of ex-share, e.g. 2
  tdsPct: number;          // of (share + publicity), e.g. 2
  flexCharge: number;
  holdOverAmount: number;  // usually 0
  advances: PictureEndingAdvance[];
  /** 'auto' rounds the balance to the nearest rupee; 'manual' uses roundOff. */
  roundOffMode: "auto" | "manual";
  roundOff: number;
}

/** Sensible defaults for a fresh statement (rates from the sample format). */
export function defaultPictureEndingInputs(
  cinemaGstin: string | null | undefined,
  distributor: Distributor | undefined,
  opts: { theatreName?: string; advances?: PictureEndingAdvance[] } = {},
): PictureEndingInputs {
  return {
    statementDate: todayIso(),
    movieFormat: "",
    theatreName: opts.theatreName ?? "",
    representative: distributor?.pocName ?? "",
    taxKind: autoTaxKind(cinemaGstin, distributor?.gstin),
    gstPct: 18,
    publicityPct: 2,
    tdsPct: 2,
    flexCharge: 0,
    holdOverAmount: 0,
    advances: opts.advances ?? [],
    roundOffMode: "auto",
    roundOff: 0,
  };
}

// ── computed shapes ───────────────────────────────────────────────────────

export interface PictureEndingWeek {
  week: number;        // 1-based run week
  from: DateISO;
  to: DateISO;
  days: number;        // count of distinct dates that collected in the week
  net: number;         // Σ netShare (the share base)
  exShare: number;     // Σ exShare (cinema's portion — publicity base)
  /** Effective share %; equals the flat weekly rate when uniform. */
  sharePct: number;
  share: number;       // Σ distShare
}

export interface PictureEndingTotals {
  net: number;
  exShare: number;        // full-run exhibitor share (reference)

  share: number;          // taxable value (CREDIT)
  shareSgst: number;
  shareCgst: number;
  shareIgst: number;
  shareGst: number;       // sgst + cgst + igst
  credit: number;         // share + shareGst

  /** Exhibitor share publicity is charged on = ex-share up to & including the
   *  hold-over day (full run when the film never held over). */
  publicityExShare: number;
  /** Collecting days counted in publicityExShare (the "N days" on the PUB line). */
  publicityDays: number;
  publicityBase: number;  // publicityPct% of publicityExShare (DEBIT, taxable value)
  publicitySgst: number;
  publicityCgst: number;
  publicityIgst: number;
  publicityGst: number;
  publicity: number;      // base + gst

  tdsBase: number;        // share + publicityBase
  tds: number;            // tdsPct% of base

  flexCharge: number;
  holdOverAmount: number;
  advances: number;

  debit: number;          // publicity + tds + flex + holdOver + advances
  balanceBeforeRound: number;
  roundOff: number;
  balance: number;        // payable to the distributor
}

export interface PictureEndingComputed {
  movie: Movie;
  distributor: Distributor | undefined;
  screens: { id: UUID; name: string }[];
  runFrom?: DateISO;
  runTo?: DateISO;
  totalDays: number;
  weeks: PictureEndingWeek[];
  /** Auto-detected hold-over date (best-3 shows < one full house). */
  holdOverDate: DateISO | null;
  inputs: PictureEndingInputs;
  totals: PictureEndingTotals;
}

// ── hold-over date ────────────────────────────────────────────────────────

/** Gross counter collection of one show (Σ tickets × printed price). */
function showCollection(state: AppState, screenId: UUID, sh: Show): number {
  const screen = screenById(state, screenId);
  if (!screen) return 0;
  const card = cardById(state, screenId, sh.priceCardId);
  if (!card) return 0;
  let coll = 0;
  for (const cl of screenClasses(state, screen)) {
    const tickets = N(((sh.rows || {})[cl.classId] || {}).tickets);
    coll += N(card.prices[cl.classId]) * tickets;
  }
  return coll;
}

/** What one fully-sold show would collect at the given card's prices. */
function fullHouseCollection(
  state: AppState,
  screenId: UUID,
  cardId: UUID | undefined,
): number {
  const screen = screenById(state, screenId);
  const card = cardById(state, screenId, cardId);
  if (!screen || !card) return 0;
  let total = 0;
  for (const cl of screenClasses(state, screen)) {
    if (!cl.active) continue; // current layout defines a "full house"
    total += N(card.prices[cl.classId]) * cl.seats;
  }
  return total;
}

/**
 * The hold-over date: the earliest day a movie's best 3 shows on a screen
 * together collect LESS than one 100% (full-house) show, valued at that day's
 * top-show price card. Per (date, screen); returns the earliest across the run.
 * null when the threshold is never crossed (or there's no usable price data).
 *
 * Only days that actually COLLECTED are considered. A day with ₹0 collection —
 * a saved-but-empty placeholder DCR (opened, never filled) or a scheduled-then-
 * pulled day — has best-3 = ₹0, which is always below a full house. Letting such
 * a day set the hold-over date would wrongly truncate the publicity base (now
 * charged only up to the hold-over day), so zero-collection days are skipped.
 */
export function computeHoldOverDate(
  state: AppState,
  movieId: UUID,
): DateISO | null {
  const days = state.entries
    .filter((e) => e.movieId === movieId && e.date && (e.shows || []).length)
    .slice()
    .sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0));

  for (const e of days) {
    const colls = (e.shows || []).map((sh) => ({
      coll: showCollection(state, e.screenId, sh),
      cardId: sh.priceCardId,
    }));
    // Skip a day that took ₹0 at the counter — it never really played, so it
    // is not a hold-over signal (and must not truncate the publicity base).
    if (colls.reduce((s, c) => s + c.coll, 0) <= 0) continue;
    const first = colls[0];
    if (!first) continue;
    // The day's reference card = the top-collecting show's card.
    const top = colls.reduce((b, c) => (c.coll > b.coll ? c : b), first);
    const fullHouse = fullHouseCollection(state, e.screenId, top.cardId);
    if (fullHouse <= 0) continue;
    const best3 = colls
      .map((c) => c.coll)
      .sort((a, b) => b - a)
      .slice(0, 3)
      .reduce((a, b) => a + b, 0);
    if (best3 < fullHouse) return e.date!;
  }
  return null;
}

// ── weekly roll-up + cascade ──────────────────────────────────────────────

interface WeekAcc {
  week: number;
  dates: Set<string>;
  net: number;
  exShare: number;
  share: number;
}

/** Roll a movie's collecting DCR days into per-run-week settlement rows. */
export function summarizeWeeks(state: AppState, movieId: UUID): PictureEndingWeek[] {
  const movie = state.movies.find((m) => m.id === movieId);
  const collecting = state.entries
    .filter((e) => e.movieId === movieId && e.date)
    .map((e) => ({ e, cs: computeShallow(state, e, null) }))
    .filter(({ cs }) => cs.audience > 0 || cs.netShare !== 0);

  const firstCollecting = collecting[0];
  if (!firstCollecting) return [];

  // Anchor run weeks to the release date; fall back to the first collecting day.
  const minDate = collecting.reduce(
    (m, { e }) => (e.date! < m ? e.date! : m),
    firstCollecting.e.date!,
  );
  const anchor = movie?.release || minDate;

  // Last day that actually collected — clamps the final week's window so it
  // never claims days past the end of the run.
  const lastPlay = collecting.reduce(
    (m, { e }) => (e.date! > m ? e.date! : m),
    firstCollecting.e.date!,
  );

  const byWeek = new Map<number, WeekAcc>();
  for (const { e, cs } of collecting) {
    const diff = daysBetween(anchor, e.date!); // 0-based; may be <0 before release
    const week = Math.max(1, Math.floor(diff / 7) + 1);
    let acc = byWeek.get(week);
    if (!acc) {
      acc = { week, dates: new Set(), net: 0, exShare: 0, share: 0 };
      byWeek.set(week, acc);
    }
    acc.dates.add(e.date!);
    acc.net += cs.netShare;
    acc.exShare += cs.exShare;
    acc.share += cs.distShare;
  }

  return [...byWeek.values()]
    .sort((a, b) => a.week - b.week)
    .map((a) => {
      // Each week is a fixed 7-day window anchored to the release date:
      // week n = [anchor + 7(n-1), anchor + 7n - 1]. The display dates are
      // the window edges (not the first/last show), clamped to the run end.
      const from = addDaysIso(anchor, 7 * (a.week - 1));
      const winEnd = addDaysIso(anchor, 7 * a.week - 1);
      const to = winEnd < lastPlay ? winEnd : lastPlay;
      return {
        week: a.week,
        from,
        to,
        days: a.dates.size,
        net: r2(a.net),
        exShare: r2(a.exShare),
        sharePct: a.net !== 0 ? r2((a.share / a.net) * 100) : 0,
        share: r2(a.share),
      };
    });
}

/**
 * Apply the credit/debit cascade to weekly rows + the editable inputs.
 *
 * `publicity` is the exhibitor-share base publicity is charged on — ex-share
 * up to & including the hold-over day, with its collecting-day count. When
 * omitted it defaults to the full-run ex-share (correct when the film never
 * held over). buildPictureEnding always supplies the till-hold-over figure.
 */
export function pictureEndingTotals(
  weeks: PictureEndingWeek[],
  inputs: PictureEndingInputs,
  pubBase?: { exShare: number; days: number },
): PictureEndingTotals {
  const net = r2(weeks.reduce((s, w) => s + w.net, 0));
  const exShare = r2(weeks.reduce((s, w) => s + w.exShare, 0));
  const share = r2(weeks.reduce((s, w) => s + w.share, 0));

  // Publicity is 2% of the exhibitor share earned TILL the hold-over day, not
  // the whole run. Falls back to the full run when no hold-over base is given.
  const publicityExShare = r2(pubBase ? pubBase.exShare : exShare);
  const publicityDays = pubBase ? pubBase.days : weeks.reduce((s, w) => s + w.days, 0);

  const splitGst = (base: number) => {
    const total = r2((base * inputs.gstPct) / 100);
    if (inputs.taxKind === "inter") {
      return { sgst: 0, cgst: 0, igst: total, total };
    }
    const half = r2(total / 2);
    return { sgst: half, cgst: r2(total - half), igst: 0, total };
  };

  const sg = splitGst(share);
  const credit = r2(share + sg.total);

  const publicityBase = r2((publicityExShare * inputs.publicityPct) / 100);
  const pg = splitGst(publicityBase);
  const publicity = r2(publicityBase + pg.total);

  const tdsBase = r2(share + publicityBase);
  const tds = r2((tdsBase * inputs.tdsPct) / 100);

  const flexCharge = r2(inputs.flexCharge);
  const holdOverAmount = r2(inputs.holdOverAmount);
  const advances = r2(inputs.advances.reduce((s, a) => s + N(a.amount), 0));

  const debit = r2(publicity + tds + flexCharge + holdOverAmount + advances);
  const balanceBeforeRound = r2(credit - debit);

  let roundOff: number;
  let balance: number;
  if (inputs.roundOffMode === "manual") {
    roundOff = r2(inputs.roundOff);
    balance = r2(balanceBeforeRound + roundOff);
  } else {
    balance = Math.round(balanceBeforeRound);
    roundOff = r2(balance - balanceBeforeRound);
  }

  return {
    net,
    exShare,
    share,
    shareSgst: sg.sgst,
    shareCgst: sg.cgst,
    shareIgst: sg.igst,
    shareGst: sg.total,
    credit,
    publicityExShare,
    publicityDays,
    publicityBase,
    publicitySgst: pg.sgst,
    publicityCgst: pg.cgst,
    publicityIgst: pg.igst,
    publicityGst: pg.total,
    publicity,
    tdsBase,
    tds,
    flexCharge,
    holdOverAmount,
    advances,
    debit,
    balanceBeforeRound,
    roundOff,
    balance,
  };
}

/**
 * Exhibitor share + collecting-day count earned up to & including `throughDate`
 * (the whole run when `throughDate` is null). This is the base publicity is
 * charged on — 2% of ex-share TILL the hold-over day.
 *
 * Multi-screen note: the cutoff is a single DATE across every screen, and the
 * hold-over date is the earliest a screen dips below its own full house. For the
 * single-screen cinema this is exact. If a film ever runs on two screens at once
 * and one screen holds over before the other, the stronger screen's later
 * ex-share past that date is excluded here — revisit (pool best-3 across screens,
 * or make the cutoff per-screen) before relying on this for multi-screen runs.
 */
export function publicityBaseFor(
  state: AppState,
  movieId: UUID,
  throughDate: DateISO | null,
): { exShare: number; days: number } {
  const dates = new Set<string>();
  let exShare = 0;
  for (const e of state.entries) {
    if (e.movieId !== movieId || !e.date) continue;
    if (throughDate && e.date > throughDate) continue; // inclusive of hold-over day
    const cs = computeShallow(state, e, null);
    if (cs.audience <= 0 && cs.netShare === 0) continue;
    exShare += cs.exShare;
    dates.add(e.date);
  }
  return { exShare: r2(exShare), days: dates.size };
}

/** Build the full computed statement for a movie. Returns null if unknown. */
export function buildPictureEnding(
  state: AppState,
  movieId: UUID,
  inputs: PictureEndingInputs,
): PictureEndingComputed | null {
  const movie = state.movies.find((m) => m.id === movieId);
  if (!movie) return null;
  const distributor = state.distributors.find((d) => d.id === movie.distributorId);

  const weeks = summarizeWeeks(state, movieId);
  const holdOverDate = computeHoldOverDate(state, movieId);
  // Publicity base = ex-share till the hold-over day (full run if it never held over).
  const publicity = publicityBaseFor(state, movieId, holdOverDate);
  const totals = pictureEndingTotals(weeks, inputs, publicity);

  const screenIds = [
    ...new Set(
      state.entries.filter((e) => e.movieId === movieId).map((e) => e.screenId),
    ),
  ];
  const screens = screenIds.map((id) => ({
    id,
    name: screenById(state, id)?.name ?? "—",
  }));

  const runFrom = weeks[0]?.from;
  const runTo = weeks[weeks.length - 1]?.to;
  const totalDays = weeks.reduce((s, w) => s + w.days, 0);

  return {
    movie,
    distributor,
    screens,
    runFrom,
    runTo,
    totalDays,
    weeks,
    holdOverDate,
    inputs,
    totals,
  };
}
