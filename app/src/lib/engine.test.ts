// ============================================================================
// Engine unit tests.
//
// These exercise the locked DCR math against hand-derived values so we
// notice immediately if the TS port drifts from the legacy JS engine.
//
// A separate parity harness (engine.parity.test.ts) that loads the legacy
// JS in a Node VM and diffs against this engine on identical inputs is
// queued as a follow-up — it's the only way to truly prove parity. Until
// then, these tests cover the foundational identities + one end-to-end
// scenario derived from defaultState().
// ============================================================================

import { describe, expect, it } from "vitest";

import {
  N,
  breakdown,
  cardById,
  computeEntry,
  computeFund,
  computeShallow,
  daysBetween,
  entryRepBatta,
  isNight,
  r2,
  realShowCount,
  repBattaFor,
  screenById,
  screenClasses,
  sharedScreenMovie,
} from "./engine";
import type { AppState, Entry, TaxConfig } from "./types";

// ── shared fixtures ────────────────────────────────────────────────────

/** Mirrors defaultState() from admin/dcr/js/01-box-office.js exactly. */
function makeDefaultState(): AppState {
  const cR = { id: "cls_royale", name: "Royale", gstPct: 18 };
  const cL = { id: "cls_lounge", name: "Lounge", gstPct: 18 };
  const cP = { id: "cls_prime",  name: "Prime",  gstPct: 18 };
  const card = (
    id: string,
    name: string,
    r: number,
    l: number,
    p: number,
  ) => ({ id, name, prices: { [cR.id]: r, [cL.id]: l, [cP.id]: p } });
  return {
    cinema: { name: "ABHINAYA CINEMAS, CHANGANACHERRY", gstin: "32AACFA8850G1ZP" },
    tax: {
      threshold: 105,
      above: { etaxPct: 8.5, gstPct: 18 },
      below: { etaxPct: 5,   gstPct: 5  },
      tmc: 2, cess: 3,
      repDay: 100, repNight: 100,
      rep1: 250, rep2: 400, rep5: 600,
    },
    classes: [cR, cL, cP],
    screens: [
      {
        id: "scr_abhinaya",
        name: "Abhinaya",
        classes: [
          { classId: cR.id, seats: 199 },
          { classId: cL.id, seats: 387 },
          { classId: cP.id, seats: 26 },
        ],
        priceCards: [
          card("pc_1", "Card 1", 290, 180, 150),
          card("pc_2", "Card 2", 350, 180, 150),
          card("pc_3", "Card 3", 350, 180, 160),
          card("pc_4", "Card 4", 390, 180, 160),
        ],
      },
    ],
    movies: [
      { id: "mov_empuraan", name: "Empuraan", distributor: "Ashirvad Cinemas", release: "2025-03-27", share: 60, status: "now_showing" },
    ],
    distributors: [],
    serialStarts: [
      {
        id: "ss_1",
        screenId: "scr_abhinaya",
        date: "2025-04-01",
        starts: { cls_royale: 1, cls_lounge: 1, cls_prime: 1 },
      },
    ],
    openings: [],
    entries: [],
    fbEntries: [],
    fbProducts: [],
    draft: null,
  };
}

const defaultTax: TaxConfig = makeDefaultState().tax;

// ── helpers ────────────────────────────────────────────────────────────

describe("N()", () => {
  it("coerces obvious numbers", () => {
    expect(N(0)).toBe(0);
    expect(N(42)).toBe(42);
    expect(N(-3.14)).toBe(-3.14);
    expect(N("17")).toBe(17);
  });
  it("treats empty / null / undefined / NaN as 0", () => {
    expect(N("")).toBe(0);
    expect(N(null)).toBe(0);
    expect(N(undefined)).toBe(0);
    expect(N("abc")).toBe(0);
    expect(N(NaN)).toBe(0);
  });
});

describe("r2()", () => {
  it("rounds half away from zero in line with Math.round", () => {
    expect(r2(1.005)).toBe(1.01);
    expect(r2(1.014)).toBe(1.01);
    expect(r2(1.015)).toBe(1.02);
    expect(r2(123.456)).toBe(123.46);
  });
});

describe("isNight()", () => {
  it("flags 23:00 and after, or before 09:00", () => {
    expect(isNight("23:00")).toBe(true);
    expect(isNight("23:30")).toBe(true);
    expect(isNight("00:15")).toBe(true);
    expect(isNight("08:59")).toBe(true);
  });
  it("treats 09:00 through 22:59 as day", () => {
    expect(isNight("09:00")).toBe(false);
    expect(isNight("13:30")).toBe(false);
    expect(isNight("21:45")).toBe(false);
    expect(isNight("22:59")).toBe(false);
  });
  it("returns false for missing input", () => {
    expect(isNight(undefined)).toBe(false);
    expect(isNight("")).toBe(false);
  });
});

describe("daysBetween()", () => {
  it("returns inclusive day difference", () => {
    expect(daysBetween("2025-03-27", "2025-03-27")).toBe(0);
    expect(daysBetween("2025-03-27", "2025-03-28")).toBe(1);
    expect(daysBetween("2025-03-01", "2025-03-31")).toBe(30);
  });
});

// ── tax math ───────────────────────────────────────────────────────────

describe("breakdown()", () => {
  it("returns zeros for a zero-priced ticket", () => {
    const b = breakdown(0, defaultTax);
    expect(b).toEqual({
      gross: 0, poa: 0, etax: 0, gst: 0,
      tmc: 2, cess: 3, etaxPct: 0, gstPct: 0,
    });
  });

  it("uses the BELOW slab when gross <= threshold (₹150 ticket)", () => {
    // ₹150 <= ₹105 is FALSE → wait: ₹150 > ₹105 → uses ABOVE slab.
    // Pick ₹100 to actually hit the below slab.
    const b = breakdown(100, defaultTax);
    // below: etaxPct=5, gstPct=5; tmc=2, cess=3, fixed=5
    // poa = round2((100*100/(100+5) - 5) / (1 + 5/100))
    //     = round2((9523.809524.../105 ... wait recompute)
    // 100 * 100 / 105 = 95.238095...
    // 95.238095 - 5 = 90.238095
    // 90.238095 / 1.05 = 85.94104...
    // r2 → 85.94
    expect(b.poa).toBeCloseTo(85.94, 2);
    expect(b.etax).toBeCloseTo(r2(85.94 * 0.05), 2);
    expect(b.gst).toBeCloseTo(r2((85.94 + b.etax + 5) * 0.05), 2);
    expect(b.gstPct).toBe(5);
    expect(b.etaxPct).toBe(5);
  });

  it("uses the ABOVE slab when gross > threshold (₹150 ticket)", () => {
    const b = breakdown(150, defaultTax);
    // above: etaxPct=8.5, gstPct=18; fixed=5
    // poa = r2((150 * 100 / 118 - 5) / 1.085)
    //     = r2((127.118644... - 5) / 1.085)
    //     = r2(122.118644 / 1.085)
    //     = r2(112.551746...)
    //     = 112.55
    expect(b.poa).toBeCloseTo(112.55, 2);
    expect(b.etax).toBeCloseTo(r2(112.55 * 0.085), 2);
    expect(b.gst).toBeCloseTo(r2((112.55 + b.etax + 5) * 0.18), 2);
    expect(b.gstPct).toBe(18);
    expect(b.etaxPct).toBe(8.5);
  });

  it("invariant: POA + eTax + TMC + Cess + GST reconstructs gross (within 1 paise)", () => {
    for (const gross of [50, 100, 150, 180, 290, 350, 390]) {
      const b = breakdown(gross, defaultTax);
      const sum = b.poa + b.etax + b.tmc + b.cess + b.gst;
      expect(Math.abs(sum - gross)).toBeLessThan(0.01);
    }
  });

  it("treats threshold as a strict boundary (<= goes to below)", () => {
    const at = breakdown(105, defaultTax);
    const just_above = breakdown(105.01, defaultTax);
    expect(at.gstPct).toBe(5);
    expect(just_above.gstPct).toBe(18);
  });
});

// ── rep batta ──────────────────────────────────────────────────────────

describe("repBattaFor()", () => {
  it("steps from 0 → rep1 → rep2 → rep5", () => {
    expect(repBattaFor(0, defaultTax)).toBe(0);
    expect(repBattaFor(1, defaultTax)).toBe(250);
    expect(repBattaFor(2, defaultTax)).toBe(400);
    expect(repBattaFor(3, defaultTax)).toBe(400);
    expect(repBattaFor(4, defaultTax)).toBe(400);
    expect(repBattaFor(5, defaultTax)).toBe(600);
    expect(repBattaFor(6, defaultTax)).toBe(600);
    expect(repBattaFor(10, defaultTax)).toBe(600);
  });
});

// ── lookups ────────────────────────────────────────────────────────────

describe("catalog lookups", () => {
  const s = makeDefaultState();

  it("screenById finds existing and misses missing", () => {
    expect(screenById(s, "scr_abhinaya")?.name).toBe("Abhinaya");
    expect(screenById(s, "missing")).toBeUndefined();
  });

  it("cardById finds within a specific screen", () => {
    expect(cardById(s, "scr_abhinaya", "pc_3")?.name).toBe("Card 3");
    expect(cardById(s, "scr_abhinaya", "missing")).toBeUndefined();
  });

  it("screenClasses returns resolved classes in catalog order", () => {
    const cls = screenClasses(s, screenById(s, "scr_abhinaya"));
    expect(cls.map((c) => c.classId)).toEqual(["cls_royale", "cls_lounge", "cls_prime"]);
    expect(cls.find((c) => c.classId === "cls_royale")?.seats).toBe(199);
  });
});

// ── show classification ────────────────────────────────────────────────

describe("realShowCount()", () => {
  const baseEntry = (shows: Entry["shows"]): Entry => ({
    id: "e1", date: "2025-04-15", movieId: "mov_empuraan",
    screenId: "scr_abhinaya", share: 60, shows,
  });

  it("counts shows with a showtime, even if zero tickets", () => {
    const e = baseEntry([{ showtime: "13:00", rows: {} }]);
    expect(realShowCount(e)).toBe(1);
  });

  it("counts shows with tickets, even if no showtime", () => {
    const e = baseEntry([{ rows: { cls_royale: { tickets: 5 } } }]);
    expect(realShowCount(e)).toBe(1);
  });

  it("does not count placeholder/empty shows", () => {
    const e = baseEntry([{ rows: { cls_royale: { tickets: 0 } } }]);
    expect(realShowCount(e)).toBe(0);
  });
});

// ── fund split ─────────────────────────────────────────────────────────

describe("computeFund()", () => {
  function withEntries(entries: Entry[]): AppState {
    const s = makeDefaultState();
    s.entries = entries;
    s.movies = [
      ...s.movies,
      { id: "mov_b", name: "Bahubali", share: 60, status: "now_showing" },
      { id: "mov_c", name: "Chhaava",  share: 60, status: "now_showing" },
    ];
    return s;
  }
  const realShow = { showtime: "13:00", rows: {} as Record<string, { tickets: number }> };

  it("gives 2 units to the sole movie with the most real shows", () => {
    const e1: Entry = {
      id: "e1", date: "2025-04-15", movieId: "mov_empuraan",
      screenId: "scr_abhinaya", share: 60,
      shows: [realShow, realShow, realShow],
    };
    const e2: Entry = {
      id: "e2", date: "2025-04-15", movieId: "mov_b",
      screenId: "scr_abhinaya", share: 60,
      shows: [realShow],
    };
    const s = withEntries([e1, e2]);
    expect(computeFund(s, e1)).toBe(2);
    expect(computeFund(s, e2)).toBe(0);
  });

  it("splits 1+1 to the two alphabetically-first movies on a 3-way tie", () => {
    const mkEntry = (id: string, movieId: string): Entry => ({
      id, date: "2025-04-15", movieId,
      screenId: "scr_abhinaya", share: 60,
      shows: [realShow, realShow],
    });
    const e1 = mkEntry("e1", "mov_empuraan"); // "Empuraan"
    const e2 = mkEntry("e2", "mov_b");        // "Bahubali"
    const e3 = mkEntry("e3", "mov_c");        // "Chhaava"
    const s = withEntries([e1, e2, e3]);
    // Sorted by name: Bahubali, Chhaava, Empuraan → top 2 are Bahubali + Chhaava
    expect(computeFund(s, e2)).toBe(1);  // Bahubali
    expect(computeFund(s, e3)).toBe(1);  // Chhaava
    expect(computeFund(s, e1)).toBe(0);  // Empuraan loses tiebreak
  });

  it("returns 0 when the entry has no real shows", () => {
    const e1: Entry = {
      id: "e1", date: "2025-04-15", movieId: "mov_empuraan",
      screenId: "scr_abhinaya", share: 60,
      shows: [{ rows: { cls_royale: { tickets: 0 } } }],
    };
    const s = withEntries([e1]);
    expect(computeFund(s, e1)).toBe(0);
  });
});

// ── full computeEntry — single show, hand-derived totals ───────────────

describe("computeEntry() — single matinee, 10 Royale tickets at ₹290", () => {
  const state = makeDefaultState();
  const entry: Entry = {
    id: "e1",
    date: "2025-04-15",
    movieId: "mov_empuraan",
    screenId: "scr_abhinaya",
    share: 60,
    shows: [
      {
        showtime: "13:00",
        priceCardId: "pc_1",
        rows: {
          cls_royale: { tickets: 10 },
          cls_lounge: { tickets: 0 },
          cls_prime:  { tickets: 0 },
        },
      },
    ],
  };
  const c = computeEntry(state, entry);
  // Hand math for ₹290 ticket, above slab (etaxPct 8.5, gstPct 18; fixed 5):
  //   poa  = r2((290 * 100 / 118 - 5) / 1.085) = r2((245.7627 - 5)/1.085) = r2(221.9012) = 221.90
  //   etax = r2(221.90 * 0.085) = r2(18.8615) = 18.86
  //   gst  = r2((221.90 + 18.86 + 5) * 0.18) = r2(245.76 * 0.18) = r2(44.2368) = 44.24
  // Per ticket: 221.90 + 18.86 + 2 + 3 + 44.24 = 290.00  ✓
  it("row-level breakdown matches the ₹290 above-slab math", () => {
    const r = c.shows[0]?.rows[0];
    expect(r?.cls).toBe("Royale");
    expect(r?.poa).toBeCloseTo(221.9, 2);
    expect(r?.etax).toBeCloseTo(18.86, 2);
    expect(r?.gst).toBeCloseTo(44.24, 2);
    expect(r?.tickets).toBe(10);
    expect(r?.grossColl).toBeCloseTo(2900, 2);
    expect(r?.tmc).toBeCloseTo(20, 2);
    expect(r?.cess).toBeCloseTo(30, 2);
    expect(r?.etax).toBeCloseTo(18.86, 2);
  });

  it("grand totals match show totals (single show)", () => {
    expect(c.grand.tickets).toBe(10);
    expect(c.grand.grossColl).toBeCloseTo(2900, 2);
    expect(c.grand.gst).toBeCloseTo(442.4, 2);
    expect(c.grand.tmc).toBeCloseTo(20, 2);
    expect(c.grand.cess).toBeCloseTo(30, 2);
    expect(c.grand.etax).toBeCloseTo(188.6, 2);
  });

  it("uses entry-wide rep batta (1 real show → rep1 = 250)", () => {
    expect(c.grand.repBatta).toBe(250);
  });

  it("today.netShare = gross − gst − tmc − cess − fund − repBatta − etax", () => {
    const t = c.today;
    const expected =
      t.grossColl - t.gst - t.tmc - t.cess - t.fund - t.repBatta - t.etax;
    expect(t.netShare).toBeCloseTo(expected, 6);
  });

  it("today.distShare and exShare split netShare by the entry's share %", () => {
    expect(c.today.distShare).toBeCloseTo(c.today.netShare * 0.6, 6);
    expect(c.today.exShare).toBeCloseTo(c.today.netShare * 0.4, 6);
  });

  it("fund is 2 (only movie running that day on that screen)", () => {
    expect(c.fund).toBe(2);
  });

  it("previous is all zeros (first entry for this movie+screen)", () => {
    for (const v of Object.values(c.previous)) expect(v).toBe(0);
  });

  it("total = previous + today", () => {
    expect(c.total.grossColl).toBeCloseTo(c.today.grossColl, 6);
    expect(c.total.netShare).toBeCloseTo(c.today.netShare, 6);
  });

  it("runningDay = days from release + 1", () => {
    // release 2025-03-27, date 2025-04-15 → 19 days diff → day 20
    expect(c.runningDay).toBe(20);
  });

  it("computeShallow produces the same `today` row as computeEntry", () => {
    const shallow = computeShallow(state, entry);
    const t = c.today;
    expect(shallow.grossColl).toBeCloseTo(t.grossColl, 6);
    expect(shallow.gst).toBeCloseTo(t.gst, 6);
    expect(shallow.tmc).toBeCloseTo(t.tmc, 6);
    expect(shallow.cess).toBeCloseTo(t.cess, 6);
    expect(shallow.etax).toBeCloseTo(t.etax, 6);
    expect(shallow.audience).toBe(t.audience);
    expect(shallow.fund).toBe(t.fund);
    expect(shallow.repBatta).toBe(t.repBatta);
    expect(shallow.netShare).toBeCloseTo(t.netShare, 6);
    expect(shallow.distShare).toBeCloseTo(t.distShare, 6);
    expect(shallow.exShare).toBeCloseTo(t.exShare, 6);
  });
});

// ── cumulatives: a 2-day run rolls into `previous` correctly ───────────

describe("computeEntry() — second day rolls previous forward", () => {
  const s = makeDefaultState();
  const day1: Entry = {
    id: "e_day1",
    date: "2025-04-15",
    movieId: "mov_empuraan",
    screenId: "scr_abhinaya",
    share: 60,
    shows: [
      {
        showtime: "13:00",
        priceCardId: "pc_1",
        rows: { cls_royale: { tickets: 10 }, cls_lounge: { tickets: 0 }, cls_prime: { tickets: 0 } },
      },
    ],
  };
  s.entries = [day1];
  const day2: Entry = {
    id: "e_day2",
    date: "2025-04-16",
    movieId: "mov_empuraan",
    screenId: "scr_abhinaya",
    share: 60,
    shows: [
      {
        showtime: "13:00",
        priceCardId: "pc_1",
        rows: { cls_royale: { tickets: 5 }, cls_lounge: { tickets: 0 }, cls_prime: { tickets: 0 } },
      },
    ],
  };
  const c2 = computeEntry(s, day2);

  it("previous totals = day1 cumulatives", () => {
    expect(c2.previous.audience).toBe(10);
    expect(c2.previous.grossColl).toBeCloseTo(2900, 2);
  });

  it("total = previous + today", () => {
    expect(c2.total.audience).toBe(c2.previous.audience + c2.today.audience);
    expect(c2.total.grossColl).toBeCloseTo(c2.previous.grossColl + c2.today.grossColl, 6);
  });
});

// ── serials: two consecutive shows advance the counter ─────────────────

describe("computeSerials via computeEntry — ticket-serial bookkeeping", () => {
  const s = makeDefaultState();
  // SerialStart for 2025-04-01 begins all classes at 1.
  const e: Entry = {
    id: "e_serials",
    date: "2025-04-15",
    movieId: "mov_empuraan",
    screenId: "scr_abhinaya",
    share: 60,
    shows: [
      {
        showtime: "13:00",
        priceCardId: "pc_1",
        rows: { cls_royale: { tickets: 10 }, cls_lounge: { tickets: 0 }, cls_prime: { tickets: 0 } },
      },
      {
        showtime: "16:00",
        priceCardId: "pc_1",
        rows: { cls_royale: { tickets: 5 }, cls_lounge: { tickets: 0 }, cls_prime: { tickets: 0 } },
      },
    ],
  };
  // No earlier entries — but the serial counter starts from `1` regardless.
  // With NO prior entries, the Royale counter on 2025-04-15 = 1 (latest start
  // on/before this date). Show 1 takes 1–10; show 2 takes 11–15.
  const c = computeEntry(s, e);

  it("show 1 Royale row uses serials 1–10", () => {
    const r = c.shows[0]?.rows.find((x) => x.cls === "Royale");
    expect(r?.from).toBe(1);
    expect(r?.to).toBe(10);
  });
  it("show 2 Royale row uses serials 11–15", () => {
    const r = c.shows[1]?.rows.find((x) => x.cls === "Royale");
    expect(r?.from).toBe(11);
    expect(r?.to).toBe(15);
  });
  it('show 1 empty classes emit { from: <counter>, to: "NA" }', () => {
    const r = c.shows[0]?.rows.find((x) => x.cls === "Lounge");
    expect(r?.from).toBe(1);
    expect(r?.to).toBe("NA");
  });
});

// ── regression: a viewed entry whose id differs from the persisted copy ──
//
// rowToEntry assigns a fresh uid() on every DB read, so the SAME persisted
// row carries different ids in state.entries (pullAll) vs the History page
// fetch. computeEntry must still recognise the viewed entry as that persisted
// row and NOT double-count its shows in the serial roll. mergedEntries keys on
// (date, movieId, screenId) to make this safe. Before the fix this produced
// show 1 = 11–20 / show 2 = 21–25 (each show counted twice).

describe("computeSerials — viewed entry with a mismatched id is not duplicated", () => {
  const s = makeDefaultState();
  const slot = { date: "2025-04-15", movieId: "mov_empuraan", screenId: "scr_abhinaya" };
  const shows = [
    { showtime: "13:00", priceCardId: "pc_1", rows: { cls_royale: { tickets: 10 }, cls_lounge: { tickets: 0 }, cls_prime: { tickets: 0 } } },
    { showtime: "16:00", priceCardId: "pc_1", rows: { cls_royale: { tickets: 5 },  cls_lounge: { tickets: 0 }, cls_prime: { tickets: 0 } } },
  ];
  // Persisted copy (as loaded by pullAll) carries id "persisted_id".
  s.entries = [{ id: "persisted_id", share: 60, ...slot, shows }];
  // The History page re-fetched the same row, giving it a different id.
  const viewed: Entry = { id: "viewed_different_id", share: 60, ...slot, shows };
  const c = computeEntry(s, viewed);

  it("show 1 Royale uses serials 1–10 (not doubled to 11–20)", () => {
    const r = c.shows[0]?.rows.find((x) => x.cls === "Royale");
    expect(r?.from).toBe(1);
    expect(r?.to).toBe(10);
  });
  it("show 2 Royale uses serials 11–15 (continuous, not 21–25)", () => {
    const r = c.shows[1]?.rows.find((x) => x.cls === "Royale");
    expect(r?.from).toBe(11);
    expect(r?.to).toBe(15);
  });
});

// ── cross-screen rep batta pooling (owner-approved change, 2026-06-06) ──
//
// When the SAME movie has real shows on more than one screen on the same
// date, each screen's entry-wide rep batta = per-show day/night batta
// (₹100) × its own real shows, replacing the rep1/rep2/rep5 step lookup.
// Combined total = 100 × total shows: 1+1 → 200, 1+2 → 300, 1+3 → 400.
// Single-screen days must remain bit-identical to the legacy step lookup.

describe("entryRepBatta() — cross-screen pooling", () => {
  function twoScreenState(): AppState {
    const s = makeDefaultState();
    s.screens = [
      ...s.screens,
      {
        id: "scr_tara",
        name: "Tara",
        classes: [{ classId: "cls_royale", seats: 150 }],
        priceCards: [{ id: "pc_t1", name: "Card T1", prices: { cls_royale: 290 } }],
      },
    ];
    s.movies = [
      ...s.movies,
      { id: "mov_b", name: "Bahubali", share: 60, status: "now_showing" },
    ];
    return s;
  }
  const entryOn = (
    id: string,
    screenId: string,
    nShows: number,
    movieId = "mov_empuraan",
    date = "2025-04-15",
  ): Entry => ({
    id, date, movieId, screenId, share: 60,
    // 10:00, 13:00, 16:00, 19:00, 22:00 — all day shows (repDay)
    shows: Array.from({ length: nShows }, (_, i) => ({
      showtime: `${10 + 3 * i}:00`,
      rows: {},
    })),
  });

  it("single screen → legacy step lookup, unchanged", () => {
    const s = twoScreenState();
    const e = entryOn("e1", "scr_abhinaya", 1);
    s.entries = [e];
    expect(sharedScreenMovie(s, e)).toBe(false);
    expect(entryRepBatta(s, e, s.tax)).toBe(250);              // rep1
    s.entries = [entryOn("e1", "scr_abhinaya", 3)];
    expect(entryRepBatta(s, s.entries[0]!, s.tax)).toBe(400);  // rep2
    s.entries = [entryOn("e1", "scr_abhinaya", 5)];
    expect(entryRepBatta(s, s.entries[0]!, s.tax)).toBe(600);  // rep5
  });

  it("1+1 shows → 100/100 (total 200, not 250/250)", () => {
    const s = twoScreenState();
    const a = entryOn("eA", "scr_abhinaya", 1);
    const b = entryOn("eB", "scr_tara", 1);
    s.entries = [a, b];
    expect(sharedScreenMovie(s, a)).toBe(true);
    expect(entryRepBatta(s, a, s.tax)).toBe(100);
    expect(entryRepBatta(s, b, s.tax)).toBe(100);
  });

  it("1+2 shows → 100/200 (total 300)", () => {
    const s = twoScreenState();
    const a = entryOn("eA", "scr_abhinaya", 1);
    const b = entryOn("eB", "scr_tara", 2);
    s.entries = [a, b];
    expect(entryRepBatta(s, a, s.tax)).toBe(100);
    expect(entryRepBatta(s, b, s.tax)).toBe(200);
  });

  it("1+3 shows → 100/300 (total 400)", () => {
    const s = twoScreenState();
    const a = entryOn("eA", "scr_abhinaya", 1);
    const b = entryOn("eB", "scr_tara", 3);
    s.entries = [a, b];
    expect(entryRepBatta(s, a, s.tax)).toBe(100);
    expect(entryRepBatta(s, b, s.tax)).toBe(300);
  });

  it("2+3 shows → 200/300 (total 500, linear past the rep5 step)", () => {
    const s = twoScreenState();
    const a = entryOn("eA", "scr_abhinaya", 2);
    const b = entryOn("eB", "scr_tara", 3);
    s.entries = [a, b];
    expect(entryRepBatta(s, a, s.tax)).toBe(200);
    expect(entryRepBatta(s, b, s.tax)).toBe(300);
  });

  it("different movies on the two screens → no pooling", () => {
    const s = twoScreenState();
    const a = entryOn("eA", "scr_abhinaya", 1);
    const b = entryOn("eB", "scr_tara", 3, "mov_b");
    s.entries = [a, b];
    expect(sharedScreenMovie(s, a)).toBe(false);
    expect(entryRepBatta(s, a, s.tax)).toBe(250);
    expect(entryRepBatta(s, b, s.tax)).toBe(400);
  });

  it("same movie on the other screen but a DIFFERENT date → no pooling", () => {
    const s = twoScreenState();
    const a = entryOn("eA", "scr_abhinaya", 1);
    const b = entryOn("eB", "scr_tara", 3, "mov_empuraan", "2025-04-16");
    s.entries = [a, b];
    expect(sharedScreenMovie(s, a)).toBe(false);
    expect(entryRepBatta(s, a, s.tax)).toBe(250);
  });

  it("other-screen entry with no real shows → no pooling", () => {
    const s = twoScreenState();
    const a = entryOn("eA", "scr_abhinaya", 1);
    const b: Entry = {
      id: "eB", date: "2025-04-15", movieId: "mov_empuraan",
      screenId: "scr_tara", share: 60,
      shows: [{ rows: { cls_royale: { tickets: 0 } } }],
    };
    s.entries = [a, b];
    expect(sharedScreenMovie(s, a)).toBe(false);
    expect(entryRepBatta(s, a, s.tax)).toBe(250);
  });

  it("only real shows are counted on the pooled side", () => {
    const s = twoScreenState();
    const a = entryOn("eA", "scr_abhinaya", 1);
    const b = entryOn("eB", "scr_tara", 2);
    b.shows = [...(b.shows || []), { rows: { cls_royale: { tickets: 0 } } }]; // placeholder
    s.entries = [a, b];
    expect(entryRepBatta(s, b, s.tax)).toBe(200); // not 300
  });

  it("night shows use repNight in the pooled sum", () => {
    const s = twoScreenState();
    s.tax = { ...s.tax, repNight: 150 };
    const a = entryOn("eA", "scr_abhinaya", 1);
    const b: Entry = {
      id: "eB", date: "2025-04-15", movieId: "mov_empuraan",
      screenId: "scr_tara", share: 60,
      shows: [{ showtime: "19:00", rows: {} }, { showtime: "23:15", rows: {} }],
    };
    s.entries = [a, b];
    expect(entryRepBatta(s, b, s.tax)).toBe(250); // 100 day + 150 night
  });

  it("an in-flight draft on the other screen triggers pooling", () => {
    const s = twoScreenState();
    const a = entryOn("eA", "scr_abhinaya", 1);
    s.entries = [a];
    s.draft = entryOn("eB", "scr_tara", 2);
    expect(sharedScreenMovie(s, a)).toBe(true);
    expect(entryRepBatta(s, a, s.tax)).toBe(100);
    expect(entryRepBatta(s, s.draft!, s.tax)).toBe(200);
  });
});

describe("computeEntry()/computeShallow() — pooled batta flows into netShare", () => {
  function pooledState(): { s: AppState; a: Entry; b: Entry } {
    const s = makeDefaultState();
    s.screens = [
      ...s.screens,
      {
        id: "scr_tara",
        name: "Tara",
        classes: [{ classId: "cls_royale", seats: 150 }],
        priceCards: [{ id: "pc_t1", name: "Card T1", prices: { cls_royale: 290 } }],
      },
    ];
    const a: Entry = {
      id: "eA", date: "2025-04-15", movieId: "mov_empuraan",
      screenId: "scr_abhinaya", share: 60,
      shows: [{
        showtime: "13:00", priceCardId: "pc_1",
        rows: { cls_royale: { tickets: 10 }, cls_lounge: { tickets: 0 }, cls_prime: { tickets: 0 } },
      }],
    };
    const b: Entry = {
      id: "eB", date: "2025-04-15", movieId: "mov_empuraan",
      screenId: "scr_tara", share: 60,
      shows: [
        { showtime: "10:00", priceCardId: "pc_t1", rows: { cls_royale: { tickets: 5 } } },
        { showtime: "16:00", priceCardId: "pc_t1", rows: { cls_royale: { tickets: 5 } } },
        { showtime: "19:00", priceCardId: "pc_t1", rows: { cls_royale: { tickets: 5 } } },
      ],
    };
    s.entries = [a, b];
    return { s, a, b };
  }

  it("grand.repBatta is the pooled per-screen value (100 / 300)", () => {
    const { s, a, b } = pooledState();
    expect(computeEntry(s, a).grand.repBatta).toBe(100);
    expect(computeEntry(s, b).grand.repBatta).toBe(300);
  });

  it("combined batta across screens = 100 × total shows (400)", () => {
    const { s, a, b } = pooledState();
    const total =
      computeEntry(s, a).grand.repBatta + computeEntry(s, b).grand.repBatta;
    expect(total).toBe(400);
  });

  it("netShare identity still holds with the pooled batta", () => {
    const { s, a } = pooledState();
    const t = computeEntry(s, a).today;
    expect(t.repBatta).toBe(100);
    expect(t.netShare).toBeCloseTo(
      t.grossColl - t.gst - t.tmc - t.cess - t.fund - t.repBatta - t.etax,
      6,
    );
  });

  it("computeShallow agrees with computeEntry on the pooled entry", () => {
    const { s, a, b } = pooledState();
    expect(computeShallow(s, a).repBatta).toBe(computeEntry(s, a).today.repBatta);
    expect(computeShallow(s, b).repBatta).toBe(computeEntry(s, b).today.repBatta);
  });
});
