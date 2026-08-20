// ============================================================================
// Picture Ending engine tests.
//
// Two halves:
//   • pictureEndingTotals — the credit/debit cascade, asserted to the rupee
//     against hand-derived values (pure arithmetic, no tax engine).
//   • summarizeWeeks / computeHoldOverDate / buildPictureEnding — run-week
//     grouping and the hold-over trigger, on a tiny single-class fixture.
// ============================================================================

import { describe, expect, it } from "vitest";

import {
  autoTaxKind,
  gstStateCode,
  buildPictureEnding,
  computeHoldOverDate,
  defaultPictureEndingInputs,
  movieScreens,
  pictureEndingTotals,
  publicityBaseFor,
  resolveHoldOverDate,
  summarizeWeeks,
  type PictureEndingInputs,
  type PictureEndingWeek,
} from "./pictureEnding";
import { firstSundayOnOrAfter } from "./dates";
import type { AppState, Entry, HoldOverRule } from "./types";

// ── tax-kind detection ─────────────────────────────────────────────────────

describe("gstStateCode / autoTaxKind", () => {
  it("reads the two-digit state code", () => {
    expect(gstStateCode("32AABFC4215E1Z9")).toBe("32");
    expect(gstStateCode("")).toBeNull();
    expect(gstStateCode(undefined)).toBeNull();
    expect(gstStateCode("AB")).toBeNull();
  });
  it("intra when state codes match, inter when they differ", () => {
    expect(autoTaxKind("32AACFA8850G1ZP", "32AABFC4215E1Z9")).toBe("intra");
    expect(autoTaxKind("32AACFA8850G1ZP", "29ABCD...")).toBe("inter");
  });
  it("defaults to intra when either GSTIN is unknown", () => {
    expect(autoTaxKind("32AACFA8850G1ZP", undefined)).toBe("intra");
    expect(autoTaxKind(undefined, undefined)).toBe("intra");
  });
});

// ── the cascade ─────────────────────────────────────────────────────────────

const WEEKS: PictureEndingWeek[] = [
  { week: 1, from: "2025-03-27", to: "2025-04-02", days: 7, net: 60000, exShare: 24000, sharePct: 60, share: 36000 },
  { week: 2, from: "2025-04-03", to: "2025-04-09", days: 7, net: 40000, exShare: 16000, sharePct: 60, share: 24000 },
];

function inputs(over: Partial<PictureEndingInputs> = {}): PictureEndingInputs {
  return {
    statementDate: "2025-04-20",
    taxKind: "intra",
    gstPct: 18,
    publicityPct: 2,
    tdsPct: 2,
    flexCharge: 500,
    holdOverAmount: 0,
    holdOverDateOverride: null,
    advances: [{ paidOn: "2025-03-29", amount: 10000 }],
    roundOffMode: "auto",
    roundOff: 0,
    ...over,
  };
}

describe("pictureEndingTotals — intra-state", () => {
  const t = pictureEndingTotals(WEEKS, inputs());

  it("sums the weekly base figures", () => {
    expect(t.net).toBe(100000);
    expect(t.exShare).toBe(40000);
    expect(t.share).toBe(60000);
  });
  it("splits 18% GST on the share into SGST+CGST", () => {
    expect(t.shareSgst).toBe(5400);
    expect(t.shareCgst).toBe(5400);
    expect(t.shareIgst).toBe(0);
    expect(t.shareGst).toBe(10800);
  });
  it("publicity defaults to 2% of the full-run ex-share when no base is given", () => {
    expect(t.publicityExShare).toBe(40000); // whole run (no hold-over base supplied)
    expect(t.publicityDays).toBe(14);       // 7 + 7
    expect(t.publicityBase).toBe(800);      // 2% of 40000
    expect(t.publicityGst).toBe(144);       // 18% of 800
    expect(t.publicity).toBe(944);
  });
  it("credits publicity alongside the share — both are payable to the distributor", () => {
    expect(t.credit).toBe(71744); // share 60000 + share GST 10800 + publicity 944
  });
  it("TDS = 2% of (share + publicity base)", () => {
    expect(t.tdsBase).toBe(60800);
    expect(t.tds).toBe(1216);
  });
  it("debit, balance and round-off close the account", () => {
    // debit = tds 1216 + flex 500 + holdOver 0 + advances 10000
    expect(t.debit).toBe(11716);
    expect(t.balanceBeforeRound).toBe(60028); // 71744 - 11716
    expect(t.roundOff).toBe(0);
    expect(t.balance).toBe(60028);
  });
});

describe("pictureEndingTotals — inter-state", () => {
  it("routes share GST to IGST", () => {
    const t = pictureEndingTotals(WEEKS, inputs({ taxKind: "inter" }));
    expect(t.shareIgst).toBe(10800);
    expect(t.shareSgst).toBe(0);
    expect(t.shareCgst).toBe(0);
    expect(t.publicityIgst).toBe(144);
    expect(t.credit).toBe(71744);
  });
});

describe("pictureEndingTotals — manual round-off", () => {
  it("applies the supplied round-off instead of nearest-rupee", () => {
    const t = pictureEndingTotals(WEEKS, inputs({ roundOffMode: "manual", roundOff: -0.4 }));
    expect(t.roundOff).toBe(-0.4);
    expect(t.balance).toBe(60027.6);
  });
});

describe("pictureEndingTotals — publicity charged till hold-over", () => {
  // Only 24000 of the 40000 ex-share was earned before hold-over (7 of 14 days).
  const t = pictureEndingTotals(WEEKS, inputs(), { exShare: 24000, days: 7 });

  it("charges 2% on the till-hold-over ex-share, not the full run", () => {
    expect(t.publicityExShare).toBe(24000);
    expect(t.publicityDays).toBe(7);
    expect(t.publicityBase).toBe(480);   // 2% of 24000 (vs 800 on the full run)
    expect(t.publicityGst).toBe(86.4);   // 18% of 480
    expect(t.publicity).toBe(566.4);
  });
  it("flows the smaller publicity through TDS and both totals", () => {
    expect(t.tdsBase).toBe(60480);       // share 60000 + publicity base 480
    expect(t.tds).toBe(1209.6);          // 2% of 60480
    // credit = share 60000 + share GST 10800 + publicity 566.4
    expect(t.credit).toBe(71366.4);
    // debit = tds 1209.6 + flex 500 + advances 10000
    expect(t.debit).toBe(11709.6);
  });
});

describe("publicityBaseFor — ex-share up to the hold-over day", () => {
  // Full house = 100 × ₹100 = ₹10,000.
  const state = fixture([
    entry("2025-03-27", [100, 100, 100]), // strong, above hold-over
    entry("2025-03-28", [30, 30, 30]),    // best-3 ₹9,000 < full house → HOLD-OVER
    entry("2025-03-29", [10, 10, 10]),    // after hold-over
  ]);

  it("sums ex-share only up to & including the cutoff date", () => {
    const full = publicityBaseFor(state, "mov", "scr", null);
    const till = publicityBaseFor(state, "mov", "scr", "2025-03-28");
    expect(full.days).toBe(3);
    expect(till.days).toBe(2);                       // 27 + 28 only
    expect(till.exShare).toBeGreaterThan(0);
    expect(till.exShare).toBeLessThan(full.exShare); // 29 Mar excluded
  });

  it("buildPictureEnding charges publicity on the till-hold-over base", () => {
    const built = buildPictureEnding(state, "mov", "scr", inputs({ advances: [] }))!;
    const till = publicityBaseFor(state, "mov", "scr", "2025-03-28");
    expect(built.holdOverDate).toBe("2025-03-28");
    expect(built.totals.publicityDays).toBe(2);
    expect(built.totals.publicityExShare).toBe(till.exShare);
    expect(built.totals.publicityBase).toBeCloseTo(till.exShare * 0.02, 2);
  });

  it("falls back to the full run when the film never held over", () => {
    const strong = fixture([
      entry("2025-03-27", [100, 100, 100]),
      entry("2025-03-28", [95, 95, 95]),
    ]);
    const built = buildPictureEnding(strong, "mov", "scr", inputs({ advances: [] }))!;
    expect(built.holdOverDate).toBeNull();
    expect(built.totals.publicityDays).toBe(2); // both days
    const full = publicityBaseFor(strong, "mov", "scr", null);
    expect(built.totals.publicityExShare).toBe(full.exShare);
  });
});

describe("computeHoldOverDate ignores zero-collection days", () => {
  // Regression: a saved-but-empty placeholder day collects ₹0, so its best-3 is
  // below a full house. It must NOT set the hold-over date (which would truncate
  // the publicity base that is charged only up to the hold-over day).
  it("an empty placeholder between strong days cannot trigger hold-over", () => {
    const state = fixture([
      entry("2025-03-27", [100, 100, 100]), // strong
      emptyEntry("2025-03-28"),             // blank placeholder — ₹0
      entry("2025-03-29", [95, 95, 95]),    // strong
    ]);
    expect(computeHoldOverDate(state, "mov", "scr")).toBeNull();
  });

  it("an empty release-day placeholder does not zero the publicity base", () => {
    const state = fixture([
      emptyEntry("2025-03-27"),              // would wrongly be hold-over before the fix
      entry("2025-03-28", [100, 100, 100]),  // the real collecting day
    ]);
    const built = buildPictureEnding(state, "mov", "scr", inputs({ advances: [] }))!;
    expect(built.holdOverDate).toBeNull();
    expect(built.totals.publicityDays).toBe(1);              // only 28 Mar collected
    expect(built.totals.publicityExShare).toBeGreaterThan(0);
    expect(built.totals.publicityBase).toBeGreaterThan(0);   // not silently waived
  });

  it("a genuine low-collection day still triggers hold-over", () => {
    const state = fixture([
      entry("2025-03-27", [100, 100, 100]), // strong
      emptyEntry("2025-03-28"),             // ignored
      entry("2025-03-29", [30, 30, 30]),    // best-3 ₹9,000 < full house ₹10,000
    ]);
    expect(computeHoldOverDate(state, "mov", "scr")).toBe("2025-03-29");
  });
});

// ── weekly grouping + hold-over, on a single-class fixture ──────────────────

function entry(date: string, ticketsPerShow: number[]): Entry {
  return {
    id: `e_${date}`,
    date,
    movieId: "mov",
    screenId: "scr",
    share: 60,
    shows: ticketsPerShow.map((t, i) => ({
      showtime: ["11:00", "14:00", "18:00", "21:00"][i] ?? "23:00",
      priceCardId: "pc",
      rows: { A: { tickets: t } },
    })),
  };
}

/** A saved-but-empty placeholder day: a blank show (no showtime, 0 tickets). */
function emptyEntry(date: string): Entry {
  return {
    id: `empty_${date}`,
    date,
    movieId: "mov",
    screenId: "scr",
    share: null,
    shows: [{ showtime: "", priceCardId: "pc", rows: { A: { tickets: 0 } } }],
  };
}

function fixture(entries: Entry[]): AppState {
  return {
    cinema: { name: "ABHINAYA", gstin: "32AACFA8850G1ZP" },
    tax: {
      threshold: 105,
      above: { etaxPct: 8.5, gstPct: 18 },
      below: { etaxPct: 5, gstPct: 5 },
      tmc: 2, cess: 3,
      repDay: 100, repNight: 100,
      rep1: 250, rep2: 400, rep5: 600,
    },
    classes: [{ id: "A", name: "A", gstPct: 18 }],
    screens: [
      {
        id: "scr",
        name: "Screen 1",
        classes: [{ classId: "A", seats: 100 }],
        priceCards: [{ id: "pc", name: "Card", prices: { A: 100 } }],
      },
    ],
    movies: [{ id: "mov", name: "Test Film", release: "2025-03-27", share: 60 }],
    distributors: [],
    movieFormats: [],
    representatives: [],
    serialStarts: [],
    openings: [],
    entries,
    showSchedules: [],
    fbEntries: [],
    fbProducts: [],
    draft: null,
  };
}

describe("summarizeWeeks", () => {
  // 27,28,29 Mar + 3,4 Apr — five collecting days, all on the movie's 60%.
  const state = fixture([
    entry("2025-03-27", [100, 100, 100]),
    entry("2025-03-28", [80, 70, 60]),
    entry("2025-03-29", [50, 40, 30]),
    entry("2025-04-03", [40, 30]),
    entry("2025-04-04", [20, 10]),
  ]);
  const weeks = summarizeWeeks(state, "mov", "scr");

  it("clubs a flat-rate run into a single period", () => {
    expect(weeks).toHaveLength(1);
    expect(weeks[0]!.week).toBe(1);      // the run week the period opens in
    expect(weeks[0]!.days).toBe(5);      // actual collecting days, not span
    expect(weeks[0]!.from).toBe("2025-03-27");  // first collecting day
    expect(weeks[0]!.to).toBe("2025-04-04");    // last collecting day
    expect(weeks[0]!.sharePct).toBe(60);
  });
  it("keeps net positive and share = 60% of net", () => {
    for (const w of weeks) {
      expect(w.net).toBeGreaterThan(0);
      expect(w.share).toBeCloseTo(w.net * 0.6, 1);
    }
  });
});

describe("summarizeWeeks — stepped weekly rates", () => {
  // Real days (blankEntry) carry share=null, so the movie's per-week rates
  // apply. This is the declining 60 → 55 → 50 case the statement is built for.
  function nullEntry(date: string, ticketsPerShow: number[]): Entry {
    return {
      id: `n_${date}`, date, movieId: "mov", screenId: "scr", share: null,
      shows: ticketsPerShow.map((t) => ({ showtime: "18:00", priceCardId: "pc", rows: { A: { tickets: t } } })),
    };
  }
  const state = fixture([]);
  state.movies[0]!.weekShares = { 1: 60, 2: 55, 3: 50 };
  state.entries = [
    nullEntry("2025-03-27", [100, 90, 80]),
    nullEntry("2025-04-03", [70, 60, 50]),
    nullEntry("2025-04-10", [40, 30, 20]),
  ];
  const weeks = summarizeWeeks(state, "mov", "scr");

  it("applies the movie's declining per-week share rates", () => {
    expect(weeks.map((w) => w.week)).toEqual([1, 2, 3]);
    expect(weeks.map((w) => w.sharePct)).toEqual([60, 55, 50]);
  });
});

describe("summarizeWeeks — rate changes redraw the period", () => {
  /** share=null → the movie's per-week rate applies; a number overrides the day. */
  function day(date: string, tickets: number[], share: number | null = null): Entry {
    return {
      id: `d_${date}`, date, movieId: "mov", screenId: "scr", share,
      shows: tickets.map((t, i) => ({
        showtime: ["11:00", "14:00", "18:00"][i] ?? "21:00",
        priceCardId: "pc",
        rows: { A: { tickets: t } },
      })),
    };
  }

  // Week 1 (27 Mar – 2 Apr) at 55%. Week 2 opens 3 Apr still on 55% (set by
  // hand), then drops to the movie's 50% on 4 Apr — the run's last day.
  const state = fixture([]);
  state.movies[0]!.weekShares = { 1: 55, 2: 50 };
  state.entries = [
    day("2025-03-27", [100, 90, 80]),
    day("2025-03-28", [80, 70, 60]),
    day("2025-04-03", [60, 50, 40], 55),  // manual: carries on at last week's rate
    day("2025-04-04", [30, 20, 10]),      // back to the week-2 rate
  ];
  const weeks = summarizeWeeks(state, "mov", "scr");

  it("extends week 1 to the continuing day instead of averaging week 2", () => {
    expect(weeks).toHaveLength(2);
    expect(weeks[0]!.from).toBe("2025-03-27");
    expect(weeks[0]!.to).toBe("2025-04-03");   // week 1 runs on to the 55% day
    expect(weeks[0]!.days).toBe(3);
    expect(weeks[0]!.sharePct).toBe(55);
    expect(weeks[1]!.from).toBe("2025-04-04"); // the split week opens mid-window
    expect(weeks[1]!.to).toBe("2025-04-04");
    expect(weeks[1]!.days).toBe(1);
    expect(weeks[1]!.sharePct).toBe(50);       // never a blended average
  });

  it("keeps every rupee — the rows still add up to the run", () => {
    const all = summarizeWeeks(state, "mov", "scr");
    for (const w of all) expect(w.share).toBeCloseTo((w.net * w.sharePct) / 100, 1);
  });

  it("splits a week in place when the lead rate does not continue the week before", () => {
    const s2 = fixture([]);
    s2.movies[0]!.weekShares = { 1: 55, 2: 50 };
    s2.entries = [
      day("2025-03-27", [100, 90, 80]),
      day("2025-04-03", [60, 50, 40]),        // week-2 rate, 50%
      day("2025-04-04", [30, 20, 10], 45),    // dropped again mid-week
    ];
    const w = summarizeWeeks(s2, "mov", "scr");
    expect(w.map((x) => x.sharePct)).toEqual([55, 50, 45]);
    expect(w[1]!.from).toBe("2025-04-03");    // week 2 still opens on its window
    expect(w[1]!.to).toBe("2025-04-03");
    expect(w[2]!.from).toBe("2025-04-04");
  });

  // The mirror direction: the week-2 rate (55%) agreed to start a day EARLY,
  // on the last day of week 1's window — that day is pinned at 55 by hand.
  it("starts the next period on a last-day rate change instead of leaving a stub", () => {
    const s4 = fixture([]);
    s4.movies[0]!.weekShares = { 1: 60, 2: 55 };
    s4.entries = [
      day("2025-03-27", [100, 90, 80]),
      day("2025-03-28", [90, 80, 70]),
      day("2025-03-29", [80, 70, 60]),
      day("2025-03-30", [80, 70, 60]),
      day("2025-03-31", [70, 60, 50]),
      day("2025-04-01", [70, 60, 50]),
      day("2025-04-02", [60, 50, 40], 55), // manual: week 2's rate, a day early
      day("2025-04-03", [50, 40, 30]),
      day("2025-04-04", [40, 30, 20]),
    ];
    const w = summarizeWeeks(s4, "mov", "scr");
    expect(w).toHaveLength(2);
    expect(w[0]!.from).toBe("2025-03-27");
    expect(w[0]!.to).toBe("2025-04-01");   // week 1 now ends where 60% ended
    expect(w[0]!.days).toBe(6);
    expect(w[0]!.sharePct).toBe(60);
    expect(w[1]!.from).toBe("2025-04-02"); // week 2 absorbs the changed day
    expect(w[1]!.to).toBe("2025-04-04");   // clamped to last play
    expect(w[1]!.days).toBe(3);
    expect(w[1]!.sharePct).toBe(55);       // one true rate — never an average
    for (const x of w) expect(x.share).toBeCloseTo((x.net * x.sharePct) / 100, 1);
  });

  it("keeps the stub when the next week opens at a different rate", () => {
    const s5 = fixture([]);
    s5.movies[0]!.weekShares = { 1: 60, 2: 55 };
    s5.entries = [
      day("2025-03-27", [100, 90, 80]),
      day("2025-04-02", [60, 50, 40], 45), // one-off day deal, matches nothing
      day("2025-04-03", [50, 40, 30]),
    ];
    const w = summarizeWeeks(s5, "mov", "scr");
    expect(w.map((x) => x.sharePct)).toEqual([60, 45, 55]);
    expect(w[1]!.from).toBe("2025-04-02");
    expect(w[1]!.to).toBe("2025-04-02");
  });

  it("clubs consecutive weeks billed at one flat rate into a single period", () => {
    const s3 = fixture([]);
    s3.entries = [
      day("2025-03-27", [100, 90, 80]),
      day("2025-04-03", [60, 50, 40]),
    ];
    const w = summarizeWeeks(s3, "mov", "scr"); // both weeks on the movie's 60%
    expect(w).toHaveLength(1);
    expect(w[0]!.week).toBe(1);
    expect(w[0]!.from).toBe("2025-03-27");
    expect(w[0]!.to).toBe("2025-04-03");
    expect(w[0]!.sharePct).toBe(60);
  });
});

describe("computeHoldOverDate", () => {
  it("flags the first day best-3 shows fall below one full house", () => {
    // Full house = 100 seats × ₹100 = ₹10,000.
    // 27 Mar: 3 × full house (best-3 = ₹30,000) → above.
    // 28 Mar: 3 shows × 30 tickets = ₹3,000 each → best-3 ₹9,000 < ₹10,000 → HOLD-OVER.
    const state = fixture([
      entry("2025-03-27", [100, 100, 100]),
      entry("2025-03-28", [30, 30, 30]),
      entry("2025-03-29", [10, 10, 10]),
    ]);
    expect(computeHoldOverDate(state, "mov", "scr")).toBe("2025-03-28");
  });
  it("returns null while the run stays above one full house", () => {
    const state = fixture([
      entry("2025-03-27", [100, 100, 100]),
      entry("2025-03-28", [90, 90, 90]),
    ]);
    expect(computeHoldOverDate(state, "mov", "scr")).toBeNull();
  });
});

describe("buildPictureEnding", () => {
  it("assembles weeks, screen, run span and hold-over together", () => {
    const state = fixture([
      entry("2025-03-27", [100, 100, 100]),
      entry("2025-03-28", [30, 30, 30]),
    ]);
    const built = buildPictureEnding(state, "mov", "scr", inputs({ advances: [] }));
    expect(built).not.toBeNull();
    expect(built!.movie.name).toBe("Test Film");
    expect(built!.screen).toEqual({ id: "scr", name: "Screen 1" });
    expect(built!.runFrom).toBe("2025-03-27");
    expect(built!.runTo).toBe("2025-03-28");
    expect(built!.holdOverDate).toBe("2025-03-28");
    expect(built!.totals.balance).toBeGreaterThan(0);
  });
  it("returns null for an unknown movie", () => {
    expect(buildPictureEnding(fixture([]), "nope", "scr", inputs())).toBeNull();
  });
  it("returns null for an unknown screen", () => {
    expect(buildPictureEnding(fixture([]), "mov", "nope", inputs())).toBeNull();
  });
});

// ── screen × movie: one film, two screens, two statements ──────────────────

describe("screen scoping", () => {
  /** Same fixture plus a second, smaller audi (50 seats at the same price). */
  function twoScreens(entries: Entry[]): AppState {
    const s = fixture(entries);
    return {
      ...s,
      screens: [
        ...s.screens,
        {
          id: "scr2",
          name: "Screen 2",
          classes: [{ classId: "A", seats: 50 }],
          priceCards: [{ id: "pc", name: "Card", prices: { A: 100 } }],
        },
      ],
    };
  }
  /** A day on the second screen. */
  function entry2(date: string, ticketsPerShow: number[]): Entry {
    return { ...entry(date, ticketsPerShow), id: `e2_${date}`, screenId: "scr2" };
  }

  // Screen 1 (100 seats, full house ₹10,000) holds over on 28 Mar.
  // Screen 2 (50 seats, full house ₹5,000) keeps filling — it never holds over.
  const state = twoScreens([
    entry("2025-03-27", [100, 100, 100]),
    entry("2025-03-28", [30, 30, 30]),
    entry("2025-03-29", [20, 20, 20]),
    entry2("2025-03-27", [50, 50, 50]),
    entry2("2025-03-28", [50, 50, 50]),
    entry2("2025-03-29", [50, 50, 50]),
  ]);

  it("lists only the screens the film played", () => {
    expect(movieScreens(state, "mov")).toEqual([
      { id: "scr", name: "Screen 1" },
      { id: "scr2", name: "Screen 2" },
    ]);
    expect(movieScreens(state, "nope")).toEqual([]);
  });

  it("detects hold-over against each screen's own full house", () => {
    expect(computeHoldOverDate(state, "mov", "scr")).toBe("2025-03-28");
    expect(computeHoldOverDate(state, "mov", "scr2")).toBeNull();
  });

  it("rolls up only the chosen screen's days", () => {
    const one = summarizeWeeks(state, "mov", "scr");
    const two = summarizeWeeks(state, "mov", "scr2");
    const both = one[0]!.net + two[0]!.net;
    expect(one[0]!.days).toBe(3);
    expect(two[0]!.days).toBe(3);
    // Neither statement sees the other's money.
    expect(one[0]!.net).toBeLessThan(both);
    expect(two[0]!.net).toBeLessThan(both);
  });

  it("charges publicity on each screen's own days, not the earliest cutoff", () => {
    const one = buildPictureEnding(state, "mov", "scr", inputs({ advances: [] }))!;
    const two = buildPictureEnding(state, "mov", "scr2", inputs({ advances: [] }))!;

    expect(one.screen.name).toBe("Screen 1");
    expect(two.screen.name).toBe("Screen 2");
    // Screen 1 stops at its hold-over; screen 2 never held over, so all 3 days
    // count — the old pooled behaviour truncated both at 28 Mar.
    expect(one.totals.publicityDays).toBe(2);
    expect(two.totals.publicityDays).toBe(3);
    expect(two.holdOverDate).toBeNull();
  });
});

// ── representative seeding ─────────────────────────────────────────────────

describe("defaultPictureEndingInputs — representative", () => {
  const dist = { id: "dist", name: "Central Pictures", pocName: "Jose Alex" };

  it("preselects the distributor's only representative", () => {
    const inp = defaultPictureEndingInputs("32AACFA8850G1ZP", dist, {
      representatives: [{ id: "r1", name: "Anil Kumar", distributorId: "dist" }],
    });
    expect(inp.representative).toBe("Anil Kumar");
  });
  it("leaves the choice open when the distributor has several", () => {
    const inp = defaultPictureEndingInputs("32AACFA8850G1ZP", dist, {
      representatives: [
        { id: "r1", name: "Anil Kumar", distributorId: "dist" },
        { id: "r2", name: "Biju Thomas", distributorId: "dist" },
      ],
    });
    expect(inp.representative).toBe("Jose Alex"); // falls back to the POC
  });
  it("falls back to the point-of-contact with no reps on record", () => {
    expect(defaultPictureEndingInputs("32AACFA8850G1ZP", dist).representative).toBe("Jose Alex");
  });
});

// ── hold-over rule: extend to the opening Sunday ───────────────────────────
//
// The fixture film releases Thu 27 Mar 2025, so its opening weekend ends Sun
// 30 Mar — Thu 1, Fri 2, Sat 3, Sun 4, the "3/4 days" of the house rule.

describe("firstSundayOnOrAfter", () => {
  it("finds the end of the opening weekend for Thursday and Friday releases", () => {
    expect(firstSundayOnOrAfter("2025-03-27")).toBe("2025-03-30"); // Thu → +3
    expect(firstSundayOnOrAfter("2025-03-28")).toBe("2025-03-30"); // Fri → +2
  });
  it("handles a midweek release and returns a Sunday release unchanged", () => {
    expect(firstSundayOnOrAfter("2025-03-26")).toBe("2025-03-30"); // Wed → +4
    expect(firstSundayOnOrAfter("2025-03-30")).toBe("2025-03-30"); // Sun → itself
  });
});

describe("resolveHoldOverDate", () => {
  const ANCHOR = "2025-03-27";   // Thursday release
  const SUNDAY = "2025-03-30";

  it("leaves the detected date alone with no rule, but still reports the ceiling", () => {
    const r = resolveHoldOverDate("2025-03-28", ANCHOR);
    expect(r).toEqual({
      detected: "2025-03-28",
      ceiling: SUNDAY,          // extendable by hand even without the rule
      applied: "2025-03-28",
      source: "detected",
    });
  });
  it("extends a hold-over inside the opening weekend to the Sunday", () => {
    const r = resolveHoldOverDate("2025-03-28", ANCHOR, "opening-sunday");
    expect(r.applied).toBe(SUNDAY);
    expect(r.source).toBe("rule");
    expect(r.detected).toBe("2025-03-28"); // detector output preserved
  });
  it("never truncates — a later hold-over is untouched by the rule", () => {
    const r = resolveHoldOverDate("2025-04-10", ANCHOR, "opening-sunday");
    expect(r.applied).toBe("2025-04-10");
    expect(r.source).toBe("detected");
  });
  it("leaves a film that never held over on its full run", () => {
    const r = resolveHoldOverDate(null, ANCHOR, "opening-sunday");
    expect(r.applied).toBeNull();
    expect(r.source).toBe("detected");
  });
  it("lets a statement override beat both the rule and the detector", () => {
    const r = resolveHoldOverDate("2025-03-28", ANCHOR, "opening-sunday", "2025-03-29");
    expect(r.applied).toBe("2025-03-29"); // mid-weekend, inside the ceiling
    expect(r.source).toBe("override");
    expect(r.detected).toBe("2025-03-28");
  });
  it("clamps an override past the opening Sunday down to it", () => {
    const r = resolveHoldOverDate("2025-03-28", ANCHOR, "opening-sunday", "2025-04-06");
    expect(r.ceiling).toBe(SUNDAY);
    expect(r.applied).toBe(SUNDAY);      // not 6 Apr — publicity stops at the weekend
    expect(r.source).toBe("override");
  });
  it("does not clamp downwards — publicity days can always be given away", () => {
    const r = resolveHoldOverDate("2025-03-28", ANCHOR, "opening-sunday", "2025-03-27");
    expect(r.applied).toBe("2025-03-27");
  });
  it("takes a hold-over past the Sunday as its own ceiling", () => {
    const r = resolveHoldOverDate("2025-04-10", ANCHOR, "opening-sunday", "2025-04-20");
    expect(r.ceiling).toBe("2025-04-10");
    expect(r.applied).toBe("2025-04-10");
  });
});

describe("buildPictureEnding — hold-over rule end to end", () => {
  /** Same fixture, with the film linked to a distributor carrying `rule`. */
  function withRule(entries: Entry[], rule: HoldOverRule): AppState {
    const s = fixture(entries);
    return {
      ...s,
      distributors: [{ id: "dist", name: "Central Pictures", holdOverRule: rule }],
      movies: s.movies.map((m) => ({ ...m, distributorId: "dist" })),
    };
  }
  // Hold-over lands Fri 28 Mar (day 2), inside the opening weekend.
  const days: Entry[] = [
    entry("2025-03-27", [100, 100, 100]),
    entry("2025-03-28", [30, 30, 30]),
    entry("2025-03-29", [20, 20, 20]),
    entry("2025-03-30", [15, 15, 15]),
    entry("2025-03-31", [10, 10, 10]),
  ];

  it("charges publicity to the Sunday, not the detected Friday", () => {
    const plain = buildPictureEnding(withRule(days, "detected"), "mov", "scr", inputs({ advances: [] }))!;
    const ext = buildPictureEnding(withRule(days, "opening-sunday"), "mov", "scr", inputs({ advances: [] }))!;

    expect(plain.holdOverDate).toBe("2025-03-28");
    expect(plain.holdOverSource).toBe("detected");
    expect(ext.holdOverDate).toBe("2025-03-30");
    expect(ext.holdOverSource).toBe("rule");
    // Both keep the detector's own answer on record for the page to show.
    expect(ext.detectedHoldOverDate).toBe("2025-03-28");

    // Two more collecting days (29, 30 Mar) fall inside the publicity base.
    expect(plain.totals.publicityDays).toBe(2);
    expect(ext.totals.publicityDays).toBe(4);
    expect(ext.totals.publicityExShare).toBeGreaterThan(plain.totals.publicityExShare);
    // Publicity is a credit, so extending pays the distributor more.
    expect(ext.totals.credit).toBeGreaterThan(plain.totals.credit);
  });

  it("lets a film opt out of the rule by overriding back to the detected date", () => {
    // "Don't extend" on the page: override = the detected date.
    const built = buildPictureEnding(
      withRule(days, "opening-sunday"),
      "mov",
      "scr",
      inputs({ advances: [], holdOverDateOverride: "2025-03-28" }),
    )!;
    const plain = buildPictureEnding(withRule(days, "detected"), "mov", "scr", inputs({ advances: [] }))!;

    expect(built.holdOverDate).toBe("2025-03-28");
    expect(built.holdOverSource).toBe("override");
    // Identical publicity to a distributor with no rule at all.
    expect(built.totals.publicityDays).toBe(plain.totals.publicityDays);
    expect(built.totals.publicityBase).toBe(plain.totals.publicityBase);
    expect(built.totals.credit).toBe(plain.totals.credit);
  });

  it("clamps an override past the opening Sunday, so the run cannot be over-charged", () => {
    const built = buildPictureEnding(
      withRule(days, "opening-sunday"),
      "mov",
      "scr",
      inputs({ advances: [], holdOverDateOverride: "2025-03-31" }),
    )!;
    expect(built.holdOverCeiling).toBe("2025-03-30");
    expect(built.holdOverDate).toBe("2025-03-30"); // not 31 Mar
    expect(built.totals.publicityDays).toBe(4);    // 27–30 Mar, not the whole run
  });

  it("caps a hand extension at the Sunday even with no distributor rule set", () => {
    const built = buildPictureEnding(
      withRule(days, "detected"),
      "mov",
      "scr",
      inputs({ advances: [], holdOverDateOverride: "2025-03-31" }),
    )!;
    expect(built.holdOverDate).toBe("2025-03-30");
  });
});
