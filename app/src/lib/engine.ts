// ============================================================================
// DCR engine — TypeScript port of the locked math in
//   admin/dcr/js/01-box-office.js  (lines 96–220)
//
// LOCK RULES (from ARCHITECTURE.md + standing project guidance):
//   • Formulas, rounding, slab thresholds, and field names must remain
//     bit-identical to the legacy JS engine. The DCR PDFs are legal
//     documents and any drift breaks audit trail.
//   • Refactor for readability is allowed ONLY if it leaves outputs
//     unchanged for every input the legacy engine accepts.
//   • ONE owner-approved exception (Nitin, 2026-06-06): when the same movie
//     plays on more than one screen on the same date, entry-wide rep batta
//     switches from the rep1/rep2/rep5 step lookup to per-show day/night
//     batta summed per screen — see entryRepBatta(). Single-screen days
//     remain bit-identical to the legacy engine.
//
// Differences from the legacy JS engine (intentional, behavior-preserving):
//   • Pure functions: every entrypoint takes `state: AppState` instead of
//     reading a module-level `S`. Makes the engine trivially testable and
//     usable from React hooks without globals.
//   • Strict TypeScript types instead of duck-typed objects. Same shapes.
//
// A parity harness (loads the legacy JS in a Node VM context and diffs
// against this engine on identical inputs) is queued as the next step
// after this lands — see engine.parity.test.ts (TODO).
// ============================================================================

import type {
  AppState,
  ClassDef,
  ComputedEntry,
  ComputedEntryGrand,
  ComputedShow,
  ComputedShowRow,
  CumulativeRow,
  Entry,
  Movie,
  PriceCard,
  ResolvedClass,
  Screen,
  SerialRange,
  SerialStart,
  Show,
  ShowRow,
  TaxBreakdown,
  TaxConfig,
  UUID,
} from "./types";

// ── small helpers ───────────────────────────────────────────────────────

/** Coerce anything to a number; treats `''`, null, undefined, NaN as 0. */
export const N = (v: unknown): number => {
  if (v === "" || v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
};

/** Round to 2 decimals (Excel-style, half away from zero via Math.round). */
export const r2 = (x: number): number =>
  Math.round((x + Number.EPSILON) * 100) / 100;

/** A show is a "night show" if it starts at 23:00 or earlier than 09:00. */
export const isNight = (t?: string): boolean => {
  if (!t) return false;
  const h = Number(t.split(":")[0]);
  return h >= 23 || h < 9;
};

/** Inclusive day difference between two YYYY-MM-DD dates. */
export const daysBetween = (a: string, b: string): number =>
  Math.round(
    (new Date(b + "T00:00:00").getTime() -
      new Date(a + "T00:00:00").getTime()) / 86_400_000,
  );

// ── catalog / screen lookups ────────────────────────────────────────────

export const catClass = (state: AppState, id: UUID): ClassDef | undefined =>
  state.classes.find((c) => c.id === id);

export const screenById = (state: AppState, id: UUID): Screen | undefined =>
  state.screens.find((s) => s.id === id);

/**
 * Resolved class list for a screen, in master-catalog order.
 * Filters out assignments whose class no longer exists in the catalog.
 */
export function screenClasses(
  state: AppState,
  screen: Screen | undefined,
): ResolvedClass[] {
  if (!screen) return [];
  const order = state.classes.map((c) => c.id);
  return (screen.classes || [])
    .map((a): ResolvedClass | null => {
      const c = catClass(state, a.classId);
      return c
        ? {
            classId: a.classId,
            name: c.name,
            gstPct: N(c.gstPct),
            seats: N(a.seats),
            active: a.active !== false,
          }
        : null;
    })
    .filter((x): x is ResolvedClass => x !== null)
    .sort((x, y) => order.indexOf(x.classId) - order.indexOf(y.classId));
}

/**
 * Classes relevant to a specific entry (or a new one when `entry` is omitted):
 * the screen's ACTIVE assignments plus any inactive (historical-era) class
 * that actually has tickets somewhere in this entry. Historical entries keep
 * their era classes; new entries only see the current layout.
 *
 * Output-safe: excluded classes are zero-ticket by definition, so every money
 * total computed over this list is identical to computing over all classes.
 */
export function entryClasses(
  state: AppState,
  screen: Screen | undefined,
  entry?: Entry | null,
): ResolvedClass[] {
  const all = screenClasses(state, screen);
  if (!entry) return all.filter((c) => c.active);
  const hasTickets = (cid: UUID): boolean =>
    (entry.shows || []).some(
      (sh) => N(((sh.rows || {})[cid] || ({} as ShowRow)).tickets) > 0,
    );
  return all.filter((c) => c.active || hasTickets(c.classId));
}

export const cardsOf = (state: AppState, screenId: UUID): PriceCard[] => {
  const s = screenById(state, screenId);
  return s ? (s.priceCards || []) : [];
};

export const cardById = (
  state: AppState,
  screenId: UUID,
  cid: UUID | undefined,
): PriceCard | undefined =>
  cardsOf(state, screenId).find((c) => c.id === cid);

// ── CALC ENGINE ────────────────────────────────────────────────────────

/**
 * Split a gross printed ticket price into POA / eTax / GST / TMC / Cess.
 *
 * The slab used (`above` vs `below`) is decided by the GROSS price itself,
 * not by POA — this matches legacy Excel and the existing JS engine.
 */
export function breakdown(gross: unknown, tax: TaxConfig): TaxBreakdown {
  const g = N(gross);
  const fixed = N(tax.tmc) + N(tax.cess);
  if (!g) {
    return {
      gross: 0, poa: 0, etax: 0, gst: 0,
      tmc: N(tax.tmc), cess: N(tax.cess), etaxPct: 0, gstPct: 0,
    };
  }
  const rates = g > N(tax.threshold) ? tax.above : tax.below;
  const poa = r2((g * 100 / (100 + N(rates.gstPct)) - fixed) / (1 + N(rates.etaxPct) / 100));
  const etax = r2(poa * N(rates.etaxPct) / 100);
  const gst = r2((poa + etax + fixed) * N(rates.gstPct) / 100);
  return {
    gross: g, poa, etax, gst,
    tmc: N(tax.tmc), cess: N(tax.cess),
    etaxPct: N(rates.etaxPct), gstPct: N(rates.gstPct),
  };
}

/** Entry-wide representative-batta lookup. Step function on real-show count. */
export const repBattaFor = (n: unknown, tax: TaxConfig): number => {
  const k = N(n);
  if (k <= 0) return 0;
  if (k === 1) return N(tax.rep1);
  if (k <= 4) return N(tax.rep2);
  return N(tax.rep5);
};

/** Persisted entries with the in-flight draft merged in (added or replaced). */
export function mergedEntries(state: AppState, draft: Entry | null): Entry[] {
  if (!draft) return state.entries.slice();
  // Identity is (date, movieId, screenId) — the same key findEntry/upsertEntry
  // and the DB's unique constraint use. Matching on `id` is unsafe because
  // rowToEntry assigns a fresh uid() on every read, so the same persisted row
  // has different ids across fetches (e.g. pullAll vs the History page fetch).
  // Keying on id let a viewed/edited entry be pushed as a phantom duplicate,
  // double-counting its shows in the serial roll. Match on the slot instead.
  const sameSlot = (e: Entry) =>
    e.date === draft.date &&
    e.movieId === draft.movieId &&
    e.screenId === draft.screenId;
  const list = state.entries.map((e) => (sameSlot(e) ? draft : e));
  if (!state.entries.some(sameSlot)) list.push(draft);
  return list;
}

interface ChronoShow {
  entryId: UUID;
  screenId: UUID;
  date: string;
  showIdx: number;
  showtime: string;
  rows: Record<UUID, ShowRow>;
}

/** Every show across every entry, sorted chronologically by (date, time, idx). */
function chronoShows(entries: Entry[]): ChronoShow[] {
  const list: ChronoShow[] = [];
  entries.forEach((e) =>
    (e.shows || []).forEach((sh: Show, idx: number) =>
      list.push({
        entryId: e.id,
        screenId: e.screenId,
        date: e.date || "",
        showIdx: idx,
        showtime: sh.showtime || "",
        rows: sh.rows || {},
      }),
    ),
  );
  list.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.showtime.localeCompare(b.showtime) ||
      a.showIdx - b.showIdx,
  );
  return list;
}

/**
 * Build a map of ticket serial ranges keyed by `${entryId}__${showIdx}__${classId}`.
 *
 * Walks shows chronologically per (screen, class), advancing a counter that
 * starts from the latest applicable SerialStart on or before each show's date.
 * When a show has 0 tickets the range is `{from: <counter>, to: 'NA'}` and the
 * counter is NOT advanced — matches legacy behavior so empty shows still
 * surface "where it would have started" in the UI.
 */
export function computeSerials(
  state: AppState,
  entries: Entry[],
): Record<string, SerialRange> {
  const map: Record<string, SerialRange> = {};
  const shows = chronoShows(entries);
  state.screens.forEach((scr) => {
    screenClasses(state, scr).forEach((cl) => {
      const cid = cl.classId;
      const starts = (state.serialStarts || [])
        .filter(
          (s) =>
            s.screenId === scr.id &&
            s.starts &&
            s.starts[cid] != null &&
            (s.starts[cid] as unknown as string) !== "",
        )
        .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      let counter: number | null = null;
      let regime: SerialStart | null = null;
      shows
        .filter((sw) => sw.screenId === scr.id)
        .forEach((sw) => {
          let r: SerialStart | null = null;
          for (const st of starts) {
            if ((st.date || "") <= (sw.date || "")) r = st;
            else break;
          }
          if (r !== regime) {
            regime = r;
            counter = r ? N(r.starts[cid]) : null;
          }
          const tickets = N((sw.rows[cid] || {}).tickets);
          const key = `${sw.entryId}__${sw.showIdx}__${cid}`;
          if (counter != null && tickets > 0) {
            map[key] = { from: counter, to: counter + tickets - 1 };
            counter += tickets;
          } else if (counter != null) {
            map[key] = { from: counter, to: "NA" };
          } else {
            map[key] = { from: "", to: "" };
          }
        });
    });
  });
  return map;
}

/** A "real" show has either a showtime or at least one class with tickets > 0. */
export const isRealShow = (sh: Show): boolean =>
  Boolean(sh.showtime && sh.showtime !== "") ||
  Object.values(sh.rows || {}).some((r) => N(r && r.tickets) > 0);

export function realShowCount(e: Entry): number {
  return (e.shows || []).filter(isRealShow).length;
}

/**
 * Cross-screen pooling check: true when this entry's movie also has real
 * shows on ANOTHER screen on the same date. Draft is merged the same way
 * computeFund does, so an in-flight entry on screen B is seen by screen A.
 */
export function sharedScreenMovie(
  state: AppState,
  entry: Entry,
  draft: Entry | null = state.draft,
): boolean {
  if (!entry || !entry.date || !entry.movieId || !entry.screenId) return false;
  return mergedEntries(state, draft).some(
    (e) =>
      e.date === entry.date &&
      e.movieId === entry.movieId &&
      e.screenId !== entry.screenId &&
      realShowCount(e) > 0,
  );
}

/**
 * Entry-wide rep batta.
 *
 *  • Movie on ONE screen that day → step lookup (rep1/rep2/rep5).
 *    Bit-identical to the locked legacy engine.
 *  • Movie on MORE THAN ONE screen that day → the SAME step lookup applied to
 *    the COMBINED real-show count across every screen, then split between the
 *    screens in proportion to each screen's real shows, rounded to the nearest
 *    ₹100. The screen with the most real shows absorbs the rounding remainder
 *    (ties broken by screen name) so the per-screen shares always sum back to
 *    the pooled step total:
 *      1+1 (=2) → ₹400 → 200/200,  3+2 (=5) → ₹600 → 400/200,
 *      4+1 (=5) → ₹600 → 500/100,  2+3 (=5) → ₹600 → 200/400.
 *
 * Owner-directed math (Nitin): single-screen days stay bit-identical to the
 * legacy engine; multi-screen days pool to the step total and split it. This
 * supersedes the 2026-06-06 ₹100-per-show interim rule, so repDay/repNight no
 * longer affect rep batta.
 */
export function entryRepBatta(
  state: AppState,
  entry: Entry,
  tax: TaxConfig,
  draft: Entry | null = state.draft,
): number {
  if (!sharedScreenMovie(state, entry, draft)) {
    return repBattaFor(realShowCount(entry), tax);
  }

  // All real-show entries for this movie on this date, across every screen.
  const sameMovie = mergedEntries(state, draft).filter(
    (e) =>
      e.date === entry.date &&
      e.movieId === entry.movieId &&
      realShowCount(e) > 0,
  );
  const combined = sameMovie.reduce((n, e) => n + realShowCount(e), 0);
  if (combined <= 0) return 0;

  // Pooled total = the SAME step lookup on the combined show count.
  const pooledTotal = repBattaFor(combined, tax);
  const round100 = (x: number): number => Math.round(x / 100) * 100;
  const screenName = (e: Entry): string =>
    (state.screens.find((s) => s.id === e.screenId) || ({} as Screen)).name || "";

  // The busiest screen (ties broken by screen name) absorbs the rounding
  // remainder so the per-screen shares sum exactly to the pooled total.
  const absorber = sameMovie
    .slice()
    .sort(
      (a, b) =>
        realShowCount(b) - realShowCount(a) ||
        screenName(a).localeCompare(screenName(b)),
    )[0]!;

  if (entry.screenId === absorber.screenId) {
    const othersRounded = sameMovie
      .filter((e) => e.screenId !== absorber.screenId)
      .reduce(
        (acc, e) => acc + round100((pooledTotal * realShowCount(e)) / combined),
        0,
      );
    return pooledTotal - othersRounded;
  }
  return round100((pooledTotal * realShowCount(entry)) / combined);
}

/**
 * 1-based run week of an entry: week 1 is the release day through release+6,
 * week 2 is release+7..release+13, etc. Returns null when the movie has no
 * release date (run week is undefined) or the entry pre-dates release.
 */
export function runWeekOf(state: AppState, entry: Entry): number | null {
  const movie = state.movies.find((m) => m.id === entry.movieId);
  if (!movie || !movie.release || !entry.date) return null;
  const runningDay = daysBetween(movie.release, entry.date) + 1; // 1-based
  if (runningDay < 1) return null;
  return Math.floor((runningDay - 1) / 7) + 1;
}

/**
 * Distributor share % used for an entry's DCR.
 *
 * A per-run-week override set on the movie (Settings → Movies) wins: it maps to
 * EVERY entry whose date falls in that run week. Resolved here at compute time
 * — not written onto entries — so editing a week's % reflects across all of
 * that week's DCRs, including locked ones, without touching the entries.
 *
 * When the entry's run week has no override (or the movie has no release date),
 * it falls back to the entry's own `share`, which itself defaults from the
 * movie's base share %. So existing DCRs are unchanged until a week is set.
 */
export function resolveShare(state: AppState, entry: Entry): number {
  const movie = state.movies.find((m) => m.id === entry.movieId);
  const wk = runWeekOf(state, entry);
  if (movie && wk != null && movie.weekShares) {
    const v = movie.weekShares[wk];
    if (v !== undefined && v !== null && v !== ("" as unknown)) return N(v);
  }
  return N(entry.share);
}

/**
 * Fund credited to this entry's movie for the day on this screen.
 *
 * Rules (per Nitin):
 *   • Movie with the most real shows on (date, screen) gets 2 units.
 *   • If two movies tie for the most, the two top-named (alphabetical)
 *     get 1 unit each.
 *   • Everyone else gets 0.
 */
export function computeFund(
  state: AppState,
  entry: Entry,
  draft: Entry | null = state.draft,
): number {
  if (!entry || !entry.date || !entry.screenId || !entry.movieId) return 0;
  const entries = mergedEntries(state, draft);
  const byMovie: Record<UUID, number> = {};
  entries
    .filter((e) => e.date === entry.date && e.screenId === entry.screenId)
    .forEach((e) => {
      byMovie[e.movieId] = (byMovie[e.movieId] || 0) + realShowCount(e);
    });
  const movies = Object.keys(byMovie).filter((m) => (byMovie[m] || 0) > 0);
  if (
    !movies.length ||
    !movies.includes(entry.movieId) ||
    (byMovie[entry.movieId] || 0) <= 0
  ) {
    return 0;
  }
  const max = Math.max(...movies.map((m) => byMovie[m] || 0));
  if ((byMovie[entry.movieId] || 0) !== max) return 0;
  const winners = movies.filter((m) => byMovie[m] === max);
  if (winners.length === 1) return 2;
  const order = winners.slice().sort((a, b) => {
    const na = (state.movies.find((x) => x.id === a) || ({} as Movie)).name || "";
    const nb = (state.movies.find((x) => x.id === b) || ({} as Movie)).name || "";
    return na.localeCompare(nb);
  });
  return order.slice(0, 2).includes(entry.movieId) ? 1 : 0;
}

/**
 * Cheap (no serials, no per-row detail) computation used to roll cumulative
 * totals from past entries into the "previous" column of the current entry's
 * DCR. The output shape is the same as `today` — `computeEntry` adds
 * `previous + today` to get `total`.
 */
export function computeShallow(
  state: AppState,
  entry: Entry,
  draft: Entry | null = state.draft,
): CumulativeRow {
  const tax = state.tax;
  const screen = screenById(state, entry.screenId);
  const cls = screenClasses(state, screen);
  let grossColl = 0,
    tmc = 0,
    cess = 0,
    etax = 0,
    gst = 0,
    audience = 0;
  let repBatta = 0;
  for (const sh of entry.shows || []) {
    const card = screen ? cardById(state, screen.id, sh.priceCardId) : undefined;
    // Matches legacy quirk: repBatta is recomputed each iteration to the same
    // value (depends only on `entry`, not `sh`). We preserve the assignment so
    // any future audit diff stays clean.
    repBatta = entryRepBatta(state, entry, tax, draft);
    for (const cl of cls) {
      const tickets = N(((sh.rows || {})[cl.classId] || {}).tickets);
      const b = breakdown(card ? N(card.prices[cl.classId]) : 0, tax);
      grossColl += b.gross * tickets;
      tmc += b.tmc * tickets;
      cess += b.cess * tickets;
      etax += b.etax * tickets;
      gst += b.gst * tickets;
      audience += tickets;
    }
  }
  const fund = computeFund(state, entry, draft);
  const share = resolveShare(state, entry);
  const netShare = grossColl - gst - tmc - cess - fund - repBatta - etax;
  return {
    grossColl,
    tmc,
    cess,
    fund,
    repBatta,
    netShare,
    distShare: (share / 100) * netShare,
    exShare: netShare - (share / 100) * netShare,
    etax,
    gst,
    audience,
  };
}

/**
 * Full computation for one entry. Produces:
 *   • per-show breakdown with row-level POA/eTax/GST + serial ranges
 *   • show totals
 *   • entry "grand" (sum of show totals; repBatta overwritten by lookup)
 *   • `today`     — single-day cumulative-style row
 *   • `previous`  — sum of all earlier entries + matching openings
 *   • `total`     — previous + today
 *   • running day of the movie (1-indexed from release date)
 *
 * This is the function the DCR PDF generator and dashboard both call.
 */
export function computeEntry(
  state: AppState,
  entry: Entry,
  draft: Entry | null = state.draft,
): ComputedEntry {
  const movie = state.movies.find((m) => m.id === entry.movieId);
  const screen = screenById(state, entry.screenId);
  // entryClasses (not screenClasses): hides zero-ticket historical-era
  // classes from rows/PDF. Money totals are unchanged — excluded classes
  // have 0 tickets by definition.
  const cls = entryClasses(state, screen, entry);
  const tax = state.tax;
  // Compute serials over (persisted ∪ {this entry as draft}) so the entry
  // sees its own tickets in the chronological roll.
  const serialMap = computeSerials(state, mergedEntries(state, entry));

  const shows: ComputedShow[] = (entry.shows || []).map((sh, idx) => {
    const card = screen ? cardById(state, screen.id, sh.priceCardId) : undefined;
    const rows: ComputedShowRow[] = cls.map((cl) => {
      const r = (sh.rows && sh.rows[cl.classId]) || {};
      const tickets = N(r.tickets);
      const b = breakdown(card ? N(card.prices[cl.classId]) : 0, tax);
      const ser = serialMap[`${entry.id}__${idx}__${cl.classId}`] || { from: "", to: "" };
      const grossColl = b.gross * tickets;
      const totalPOA = b.poa * tickets;
      const tmcA = b.tmc * tickets;
      const cessA = b.cess * tickets;
      const etaxA = b.etax * tickets;
      const gstA = b.gst * tickets;
      return {
        cls: cl.name,
        seats: cl.seats,
        poa: b.poa,
        gross: b.gross,
        from: ser.from,
        to: ser.to,
        tickets,
        grossColl,
        totalPOA,
        tmc: tmcA,
        cess: cessA,
        etax: etaxA,
        total: totalPOA + tmcA + cessA + etaxA,
        gst: gstA,
      };
    });
    const T = rows.reduce(
      (a, r) => ({
        tickets: a.tickets + r.tickets,
        grossColl: a.grossColl + r.grossColl,
        totalPOA: a.totalPOA + r.totalPOA,
        tmc: a.tmc + r.tmc,
        cess: a.cess + r.cess,
        etax: a.etax + r.etax,
        total: a.total + r.total,
        gst: a.gst + r.gst,
      }),
      { tickets: 0, grossColl: 0, totalPOA: 0, tmc: 0, cess: 0, etax: 0, total: 0, gst: 0 },
    );
    return {
      showtime: sh.showtime,
      freePass: sh.freePass,
      card,
      rows,
      totals: T,
      repBatta: isNight(sh.showtime) ? tax.repNight : tax.repDay,
    };
  });

  const G: ComputedEntryGrand = shows.reduce<ComputedEntryGrand>(
    (a, s) => ({
      tickets: a.tickets + s.totals.tickets,
      grossColl: a.grossColl + s.totals.grossColl,
      totalPOA: a.totalPOA + s.totals.totalPOA,
      tmc: a.tmc + s.totals.tmc,
      cess: a.cess + s.totals.cess,
      etax: a.etax + s.totals.etax,
      total: a.total + s.totals.total,
      gst: a.gst + s.totals.gst,
      repBatta: a.repBatta + s.repBatta,
    }),
    { tickets: 0, grossColl: 0, totalPOA: 0, tmc: 0, cess: 0, etax: 0, total: 0, gst: 0, repBatta: 0 },
  );
  // Legacy quirk preserved: per-show repBatta is summed above, then OVERWRITTEN
  // here with the entry-wide value. The sum is effectively discarded.
  // entryRepBatta applies the owner-approved cross-screen pooling rule.
  G.repBatta = entryRepBatta(state, entry, tax, draft);

  const fund = computeFund(state, entry, draft);
  const share = resolveShare(state, entry);
  const netShare = G.grossColl - G.gst - G.tmc - G.cess - fund - G.repBatta - G.etax;
  const distShare = (share / 100) * netShare;
  const exShare = netShare - distShare;

  const tdy: CumulativeRow = {
    grossColl: G.grossColl,
    tmc: G.tmc,
    cess: G.cess,
    fund,
    repBatta: G.repBatta,
    netShare,
    distShare,
    exShare,
    etax: G.etax,
    gst: G.gst,
    audience: G.tickets,
  };

  const cum: CumulativeRow = {
    grossColl: 0, tmc: 0, cess: 0, fund: 0, repBatta: 0,
    netShare: 0, distShare: 0, exShare: 0, etax: 0, gst: 0, audience: 0,
  };
  const keys = Object.keys(cum) as Array<keyof CumulativeRow>;

  state.entries
    .filter(
      (e) =>
        e.movieId === entry.movieId &&
        e.screenId === entry.screenId &&
        (e.date || "") < (entry.date || ""),
    )
    .forEach((e) => {
      const c = computeShallow(state, e, draft);
      keys.forEach((k) => {
        cum[k] += c[k];
      });
    });

  (state.openings || [])
    .filter(
      (o) =>
        o.movieId === entry.movieId &&
        o.screenId === entry.screenId &&
        (o.date || "") < (entry.date || ""),
    )
    .forEach((o) => {
      const v = (o.vals || {}) as Record<string, unknown>;
      keys.forEach((k) => {
        cum[k] += N(v[k]);
      });
    });

  const previous: CumulativeRow = { ...cum };
  const total: CumulativeRow = { ...cum };
  keys.forEach((k) => {
    total[k] += tdy[k];
  });

  const runningDay: number | "" =
    movie && movie.release && entry.date
      ? daysBetween(movie.release, entry.date) + 1
      : "";

  return {
    movie,
    screen,
    entry,
    shows,
    grand: G,
    today: tdy,
    previous,
    total,
    runningDay,
    share,
    fund,
  };
}
