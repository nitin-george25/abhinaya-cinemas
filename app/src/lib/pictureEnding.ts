// ============================================================================
// Picture Ending Statement — settlement engine.
//
// At the end of a film's run we hand the distributor a "Picture Ending
// Statement": a credit/debit account that settles the distributor's share of
// the box office. This module turns a movie's DCR entries into that statement.
//
// SCOPE: one statement settles ONE SCREEN × ONE MOVIE. Every function here
// takes a screenId and looks only at that screen's entries — a film that played
// two screens is settled with two statements, each with its own run span, run
// weeks, hold-over date and publicity base. Terms (share %, publicity, TDS) are
// per film, so the two statements share their rates but never their money.
//
// The weekly NET / SHARE figures reuse the SAME math as the DCR engine
// (computeShallow → netShare / distShare / exShare), so a Picture Ending
// always reconciles with the daily reports it is built from. NET is already
// net of GST, eTax, TMC, cess, fund AND representative batta — so batta is NOT
// a separate expense line here (it is inside NET by the cinema's convention).
//
// The credit/debit cascade (mirrors the physical statement):
//   CREDIT  = distributor share (Σ distShare)  +  GST on share (SGST+CGST | IGST)
//           + publicity (% of ex-share) + its GST
//   DEBIT   = TDS (% of share + publicity)
//           + flex display charge
//           + hold-over amount (usually ₹0 — hold-over is an informational date)
//           + advances already paid
//   BALANCE PAYABLE = CREDIT − DEBIT  (+ round-off)
//
// Publicity is a CREDIT: the cinema pays the distributor 2% of its own
// (exhibitor) share towards publicity, so it is owed to them alongside the film
// hire — which is also why TDS is withheld on (share + publicity), the full
// amount payable to the distributor.
//
// Publicity is charged on the ex-share earned up to the HOLD-OVER DATE. That
// date is detected from the collection pattern (computeHoldOverDate), then run
// through resolveHoldOverDate, which applies the distributor's standing rule and
// any per-statement override. Only the resolved date reaches the printed
// statement; the detected one is kept alongside it for the screen and the audit
// trail.
//
// SGST+CGST vs IGST is auto-derived from the GST state code (first two digits)
// of the cinema's vs the distributor's GSTIN, and overridable per statement.
// ============================================================================

import {
  N,
  r2,
  daysBetween,
  computeShallow,
  resolveShare,
  screenById,
  screenClasses,
  cardById,
} from "./engine";
import { todayIso, addDaysIso, firstSundayOnOrAfter } from "./dates";
import type {
  AppState, DateISO, Distributor, HoldOverRule, Movie, Representative, Show, UUID,
} from "./types";

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
  /**
   * Preparer's explicit hold-over date for this statement. Wins over both the
   * auto-detected date and the distributor's standing rule. null = no override.
   * This is a DATE (the publicity cutoff), not to be confused with the rupee
   * `holdOverAmount` line above.
   */
  holdOverDateOverride: DateISO | null;
  advances: PictureEndingAdvance[];
  /** 'auto' rounds the balance to the nearest rupee; 'manual' uses roundOff. */
  roundOffMode: "auto" | "manual";
  roundOff: number;
}

/** Sensible defaults for a fresh statement (rates from the sample format). */
export function defaultPictureEndingInputs(
  cinemaGstin: string | null | undefined,
  distributor: Distributor | undefined,
  opts: {
    theatreName?: string;
    advances?: PictureEndingAdvance[];
    /** The distributor's reps (Settings → Box Office). A lone rep is
     *  preselected; with several, the preparer picks. */
    representatives?: Representative[];
  } = {},
): PictureEndingInputs {
  const reps = opts.representatives ?? [];
  const soleRep = reps.length === 1 ? reps[0]?.name : undefined;
  return {
    statementDate: todayIso(),
    movieFormat: "",
    theatreName: opts.theatreName ?? "",
    // Falls back to the point-of-contact, which is what this field held before
    // representatives became a catalog.
    representative: soleRep ?? distributor?.pocName ?? "",
    taxKind: autoTaxKind(cinemaGstin, distributor?.gstin),
    gstPct: 18,
    publicityPct: 2,
    tdsPct: 2,
    flexCharge: 0,
    holdOverAmount: 0,
    holdOverDateOverride: null,
    advances: opts.advances ?? [],
    roundOffMode: "auto",
    roundOff: 0,
  };
}

// ── computed shapes ───────────────────────────────────────────────────────

/**
 * One printed row of the weekly run table. Normally one run week; a week
 * billed at two rates prints as two rows, and a row can run on past its own
 * week when the days after it continue at the same rate. See `summarizeWeeks`.
 */
export interface PictureEndingWeek {
  /** 1-based run week the row STARTS in. Not unique once a week is split. */
  week: number;
  from: DateISO;
  to: DateISO;
  days: number;        // count of distinct dates that collected in the row
  net: number;         // Σ netShare (the share base)
  exShare: number;     // Σ exShare (cinema's portion — publicity base)
  /** The share % actually billed — uniform across every day in the row. */
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
  credit: number;         // share + shareGst + publicityBase + publicityGst

  /** Exhibitor share publicity is charged on = ex-share up to & including the
   *  hold-over day (full run when the film never held over). */
  publicityExShare: number;
  /** Collecting days counted in publicityExShare (the "N days" on the PUB line). */
  publicityDays: number;
  publicityBase: number;  // publicityPct% of publicityExShare (CREDIT, taxable value)
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

  debit: number;          // tds + flex + holdOver + advances
  balanceBeforeRound: number;
  roundOff: number;
  balance: number;        // payable to the distributor
}

export interface PictureEndingComputed {
  movie: Movie;
  distributor: Distributor | undefined;
  /** The single screen this statement settles. */
  screen: { id: UUID; name: string };
  runFrom?: DateISO;
  runTo?: DateISO;
  totalDays: number;
  weeks: PictureEndingWeek[];
  /** The hold-over date actually APPLIED — the publicity cutoff, after the
   *  distributor's rule and any statement override. This is the only one the
   *  printed statement shows. */
  holdOverDate: DateISO | null;
  /** What the detector alone said (best-3 shows < one full house), before any
   *  rule or override. Shown on the page beside the applied date. */
  detectedHoldOverDate: DateISO | null;
  /** Furthest the cutoff may be pushed — caps the date picker on the page and
   *  clamps any override. See `resolveHoldOverDate`. */
  holdOverCeiling: DateISO | null;
  /** Which layer produced `holdOverDate`. */
  holdOverSource: HoldOverSource;
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
 * The DETECTED hold-over date for one movie ON ONE SCREEN: the earliest day the
 * film's best 3 shows there together collect LESS than one 100% (full-house)
 * show, valued at that day's top-show price card. null when the threshold is
 * never crossed (or there's no usable price data).
 *
 * Screen-scoped because a full house is a property of the screen — the same
 * film can be holding over in the big audi while still filling the small one,
 * and each screen's statement is settled on its own signal.
 *
 * This is the raw signal only. The date actually used as the publicity cutoff
 * comes out of `resolveHoldOverDate`, which layers the distributor's standing
 * rule and any per-statement override on top of this.
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
  screenId: UUID,
): DateISO | null {
  const days = state.entries
    .filter(
      (e) =>
        e.movieId === movieId &&
        e.screenId === screenId &&
        e.date &&
        (e.shows || []).length,
    )
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

// ── hold-over resolution (detected → distributor rule → statement override) ──

/** Which layer decided the applied hold-over date. */
export type HoldOverSource = "detected" | "rule" | "override";

export interface HoldOverResolution {
  detected: DateISO | null;
  /** The furthest the cutoff may be pushed: the end of the opening weekend, or
   *  the detected date when that is already later. null = no cutoff at all (the
   *  film never held over), which is itself the maximum. Bounds the override. */
  ceiling: DateISO | null;
  applied: DateISO | null;
  source: HoldOverSource;
}

/**
 * Resolve the hold-over date actually used as the publicity cutoff.
 *
 * Three layers, most specific first:
 *   1. `override` — the preparer typed a date on this statement. Wins, but is
 *                   CLAMPED to `ceiling`: publicity may be extended to the end
 *                   of the opening weekend and no further. Downwards it is
 *                   unbounded — declining the extension, or waiving publicity
 *                   days outright, is always the cinema's to give away.
 *   2. `rule`     — the distributor's standing term. 'opening-sunday' pushes
 *                   the cutoff out to the ceiling: films release Thu/Fri, so a
 *                   hold-over flagged before that Sunday is premature.
 *   3. detected   — the raw detector output.
 *
 * The ceiling is the LATER of the detected date and the opening Sunday, and is
 * computed regardless of the distributor's rule. So the rule decides the
 * DEFAULT, while any film can still be extended by hand up to that same Sunday
 * — and a hold-over already past it is its own ceiling, never truncated.
 *
 * A film that never held over (`detected` null) already earns publicity on its
 * whole run, so no rule can improve on it and the cutoff stays null.
 *
 * @param runAnchor first day of run week 1 (the release date, or the first
 *                  collecting day when the film has no release date on record)
 */
export function resolveHoldOverDate(
  detected: DateISO | null,
  runAnchor: DateISO | undefined,
  rule: HoldOverRule = "detected",
  override?: DateISO | null,
): HoldOverResolution {
  const sunday = runAnchor ? firstSundayOnOrAfter(runAnchor) : null;
  const ceiling = detected && sunday && sunday > detected ? sunday : detected;

  if (override) {
    // Clamp up-only. A null ceiling means "no cutoff", already the maximum.
    const applied = ceiling && override > ceiling ? ceiling : override;
    return { detected, ceiling, applied, source: "override" };
  }
  if (rule === "opening-sunday" && ceiling !== detected) {
    return { detected, ceiling, applied: ceiling, source: "rule" };
  }
  return { detected, ceiling, applied: detected, source: "detected" };
}

// ── weekly roll-up + cascade ──────────────────────────────────────────────

/** One collecting DATE, with the share rate that actually applied to it. */
interface DayRow {
  date: DateISO;
  week: number;    // run week the date falls in
  pct: number;     // effective share % for the day (override → week rate → base)
  net: number;
  exShare: number;
  share: number;
}

/** A run of consecutive collecting days billed at ONE rate — a printed row. */
interface RowAcc {
  week: number;      // run week the row STARTS in
  endWeek: number;   // run week the row ENDS in (differs once a week is extended)
  pct: number;
  dates: string[];   // ascending
  net: number;
  exShare: number;
  share: number;
}

/**
 * Roll one screen's collecting DCR days for a movie into the statement's rows.
 *
 * Run weeks stay anchored to the RELEASE date, not to the screen's own first
 * day, so week numbers (and therefore the movie's stepped weekly share rates)
 * mean the same thing on every screen. A film moved to a second screen in its
 * third week opens that screen's statement at week 3.
 *
 * A row is normally one run week. Two things bend that, both driven by the
 * rate a day is actually billed at (per-day override → movie's weekly rate →
 * base rate):
 *
 *   • A week billed at more than one rate is SPLIT — one row per rate, so the
 *     statement never prints a blended average nobody agreed to.
 *   • The leading piece of such a split week is FOLDED BACK into the previous
 *     row when it continues at the same rate. A day carried on at last week's
 *     terms belongs to last week's row: the week is extended to that day,
 *     rather than opening a short new week.
 *
 * A week billed at a single rate always keeps its own row, even when that rate
 * matches the week before — consecutive full weeks are never merged away.
 */
export function summarizeWeeks(
  state: AppState,
  movieId: UUID,
  screenId: UUID,
): PictureEndingWeek[] {
  const movie = state.movies.find((m) => m.id === movieId);
  const collecting = state.entries
    .filter((e) => e.movieId === movieId && e.screenId === screenId && e.date)
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

  // One DayRow per collecting date (a date may carry more than one entry).
  const byDate = new Map<string, DayRow>();
  for (const { e, cs } of collecting) {
    let d = byDate.get(e.date!);
    if (!d) {
      const diff = daysBetween(anchor, e.date!); // 0-based; may be <0 before release
      d = {
        date: e.date!,
        week: Math.max(1, Math.floor(diff / 7) + 1),
        pct: r2(resolveShare(state, e)),
        net: 0,
        exShare: 0,
        share: 0,
      };
      byDate.set(e.date!, d);
    }
    d.net += cs.netShare;
    d.exShare += cs.exShare;
    d.share += cs.distShare;
  }
  const days = [...byDate.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );

  // Window edges are still drawn per run WEEK, so a row that starts (or ends)
  // on its week's first (or last) collecting day still prints that week's
  // window date, exactly as an unsplit statement does.
  const weekFirst = new Map<number, string>();
  const weekLast = new Map<number, string>();
  for (const d of days) {
    if (!weekFirst.has(d.week)) weekFirst.set(d.week, d.date);
    weekLast.set(d.week, d.date);
  }

  // Break at every week boundary AND at every rate change.
  const segs: RowAcc[] = [];
  for (const d of days) {
    const cur = segs[segs.length - 1];
    if (cur && cur.endWeek === d.week && cur.pct === d.pct) {
      cur.dates.push(d.date);
      cur.net += d.net;
      cur.exShare += d.exShare;
      cur.share += d.share;
      continue;
    }
    segs.push({
      week: d.week, endWeek: d.week, pct: d.pct,
      dates: [d.date], net: d.net, exShare: d.exShare, share: d.share,
    });
  }

  // Only a week that was split can give its leading piece back to the previous
  // row; a uniform week keeps its own row however its rate compares.
  const segsInWeek = new Map<number, number>();
  for (const s of segs) segsInWeek.set(s.week, (segsInWeek.get(s.week) ?? 0) + 1);

  const rows: RowAcc[] = [];
  for (const s of segs) {
    const prev = rows[rows.length - 1];
    const leadsSplitWeek =
      (segsInWeek.get(s.week) ?? 0) > 1 && weekFirst.get(s.week) === s.dates[0];
    if (prev && leadsSplitWeek && prev.pct === s.pct) {
      prev.dates.push(...s.dates);
      prev.net += s.net;
      prev.exShare += s.exShare;
      prev.share += s.share;
      prev.endWeek = s.week; // the week now runs on into s.week
      continue;
    }
    rows.push({ ...s, dates: [...s.dates] });
  }

  return rows.map((a) => {
    const firstDate = a.dates[0]!;
    const lastDate = a.dates[a.dates.length - 1]!;
    // Week n's window = [anchor + 7(n-1), anchor + 7n - 1], clamped to the run
    // end. A row that opens or closes mid-week shows its own edge date instead.
    const from =
      weekFirst.get(a.week) === firstDate
        ? addDaysIso(anchor, 7 * (a.week - 1))
        : firstDate;
    const winEnd = addDaysIso(anchor, 7 * a.endWeek - 1);
    const to =
      weekLast.get(a.endWeek) === lastDate
        ? (winEnd < lastPlay ? winEnd : lastPlay)
        : lastDate;
    return {
      week: a.week,
      from,
      to,
      days: a.dates.length,
      net: r2(a.net),
      exShare: r2(a.exShare),
      sharePct: r2(a.pct),
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

  const publicityBase = r2((publicityExShare * inputs.publicityPct) / 100);
  const pg = splitGst(publicityBase);
  const publicity = r2(publicityBase + pg.total);

  // Share and publicity are both payable TO the distributor, so both sit on the
  // credit side — and TDS is withheld on the taxable value of the two together.
  const credit = r2(share + sg.total + publicity);

  const tdsBase = r2(share + publicityBase);
  const tds = r2((tdsBase * inputs.tdsPct) / 100);

  const flexCharge = r2(inputs.flexCharge);
  const holdOverAmount = r2(inputs.holdOverAmount);
  const advances = r2(inputs.advances.reduce((s, a) => s + N(a.amount), 0));

  const debit = r2(tds + flexCharge + holdOverAmount + advances);
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
 * Exhibitor share + collecting-day count earned on ONE SCREEN up to & including
 * `throughDate` (that screen's whole run when `throughDate` is null). This is
 * the base publicity is charged on — 2% of ex-share TILL the hold-over day.
 *
 * Both the cutoff and the ex-share it filters are screen-scoped, so a film that
 * holds over early in one audi and keeps running in another earns publicity on
 * each screen's own days.
 */
export function publicityBaseFor(
  state: AppState,
  movieId: UUID,
  screenId: UUID,
  throughDate: DateISO | null,
): { exShare: number; days: number } {
  const dates = new Set<string>();
  let exShare = 0;
  for (const e of state.entries) {
    if (e.movieId !== movieId || e.screenId !== screenId || !e.date) continue;
    if (throughDate && e.date > throughDate) continue; // inclusive of hold-over day
    const cs = computeShallow(state, e, null);
    if (cs.audience <= 0 && cs.netShare === 0) continue;
    exShare += cs.exShare;
    dates.add(e.date);
  }
  return { exShare: r2(exShare), days: dates.size };
}

/**
 * The screens a film actually played on, in catalog order — the choices the
 * statement builder offers. A film with entries on two screens needs two
 * statements, one per screen.
 */
export function movieScreens(
  state: AppState,
  movieId: UUID,
): { id: UUID; name: string }[] {
  const ran = new Set(
    state.entries.filter((e) => e.movieId === movieId).map((e) => e.screenId),
  );
  return state.screens
    .filter((s) => ran.has(s.id))
    .map((s) => ({ id: s.id, name: s.name }));
}

/**
 * Build the full computed statement for ONE movie ON ONE SCREEN.
 * Returns null when the movie or the screen is not in the catalog.
 */
export function buildPictureEnding(
  state: AppState,
  movieId: UUID,
  screenId: UUID,
  inputs: PictureEndingInputs,
): PictureEndingComputed | null {
  const movie = state.movies.find((m) => m.id === movieId);
  if (!movie) return null;
  const screen = screenById(state, screenId);
  if (!screen) return null;
  const distributor = state.distributors.find((d) => d.id === movie.distributorId);

  const weeks = summarizeWeeks(state, movieId, screenId);
  // weeks[0].from IS the run anchor — summarizeWeeks windows week 1 from the
  // release date (or the first collecting day when there is none).
  const ho = resolveHoldOverDate(
    computeHoldOverDate(state, movieId, screenId),
    weeks[0]?.from,
    distributor?.holdOverRule,
    inputs.holdOverDateOverride,
  );
  // Publicity base = ex-share till the hold-over day (full run if it never held over).
  const publicity = publicityBaseFor(state, movieId, screenId, ho.applied);
  const totals = pictureEndingTotals(weeks, inputs, publicity);

  const runFrom = weeks[0]?.from;
  const runTo = weeks[weeks.length - 1]?.to;
  const totalDays = weeks.reduce((s, w) => s + w.days, 0);

  return {
    movie,
    distributor,
    screen: { id: screen.id, name: screen.name },
    runFrom,
    runTo,
    totalDays,
    weeks,
    holdOverDate: ho.applied,
    detectedHoldOverDate: ho.detected,
    holdOverCeiling: ho.ceiling,
    holdOverSource: ho.source,
    inputs,
    totals,
  };
}
