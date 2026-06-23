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
  pictureEndingTotals,
  summarizeWeeks,
  type PictureEndingInputs,
  type PictureEndingWeek,
} from "./pictureEnding";
import type { AppState, Entry } from "./types";

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
    expect(t.credit).toBe(70800); // 60000 + 10800
  });
  it("publicity = 2% of ex-share, plus its GST", () => {
    expect(t.publicityBase).toBe(800); // 2% of 40000
    expect(t.publicityGst).toBe(144);  // 18% of 800
    expect(t.publicity).toBe(944);
  });
  it("TDS = 2% of (share + publicity base)", () => {
    expect(t.tdsBase).toBe(60800);
    expect(t.tds).toBe(1216);
  });
  it("debit, balance and round-off close the account", () => {
    // debit = publicity 944 + tds 1216 + flex 500 + holdOver 0 + advances 10000
    expect(t.debit).toBe(12660);
    expect(t.balanceBeforeRound).toBe(58140); // 70800 - 12660
    expect(t.roundOff).toBe(0);
    expect(t.balance).toBe(58140);
  });
});

describe("pictureEndingTotals — inter-state", () => {
  it("routes share GST to IGST", () => {
    const t = pictureEndingTotals(WEEKS, inputs({ taxKind: "inter" }));
    expect(t.shareIgst).toBe(10800);
    expect(t.shareSgst).toBe(0);
    expect(t.shareCgst).toBe(0);
    expect(t.publicityIgst).toBe(144);
    expect(t.credit).toBe(70800);
  });
});

describe("pictureEndingTotals — manual round-off", () => {
  it("applies the supplied round-off instead of nearest-rupee", () => {
    const t = pictureEndingTotals(WEEKS, inputs({ roundOffMode: "manual", roundOff: -0.4 }));
    expect(t.roundOff).toBe(-0.4);
    expect(t.balance).toBe(58139.6);
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
    serialStarts: [],
    openings: [],
    entries,
    fbEntries: [],
    fbProducts: [],
    draft: null,
  };
}

describe("summarizeWeeks", () => {
  // Week 1: 27,28,29 Mar (3 days). Week 2: 3,4 Apr (2 days).
  const state = fixture([
    entry("2025-03-27", [100, 100, 100]),
    entry("2025-03-28", [80, 70, 60]),
    entry("2025-03-29", [50, 40, 30]),
    entry("2025-04-03", [40, 30]),
    entry("2025-04-04", [20, 10]),
  ]);
  const weeks = summarizeWeeks(state, "mov");

  it("groups collecting days into release-anchored 7-day weeks", () => {
    expect(weeks.map((w) => w.week)).toEqual([1, 2]);
    expect(weeks[0]!.days).toBe(3); // actual collecting days, not window length
    expect(weeks[1]!.days).toBe(2);
    // Window edges = release + 7(n-1) .. release + 7n - 1, NOT first/last show.
    expect(weeks[0]!.from).toBe("2025-03-27");          // release
    expect(weeks[0]!.to).toBe("2025-04-02");            // release + 6
    expect(weeks[1]!.from).toBe("2025-04-03");          // release + 7
    expect(weeks[1]!.to).toBe("2025-04-04");            // clamped to last play
  });
  it("carries the flat 60% share rate through unchanged", () => {
    expect(weeks[0]!.sharePct).toBe(60);
    expect(weeks[1]!.sharePct).toBe(60);
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
  const weeks = summarizeWeeks(state, "mov");

  it("applies the movie's declining per-week share rates", () => {
    expect(weeks.map((w) => w.week)).toEqual([1, 2, 3]);
    expect(weeks.map((w) => w.sharePct)).toEqual([60, 55, 50]);
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
    expect(computeHoldOverDate(state, "mov")).toBe("2025-03-28");
  });
  it("returns null while the run stays above one full house", () => {
    const state = fixture([
      entry("2025-03-27", [100, 100, 100]),
      entry("2025-03-28", [90, 90, 90]),
    ]);
    expect(computeHoldOverDate(state, "mov")).toBeNull();
  });
});

describe("buildPictureEnding", () => {
  it("assembles weeks, screens, run span and hold-over together", () => {
    const state = fixture([
      entry("2025-03-27", [100, 100, 100]),
      entry("2025-03-28", [30, 30, 30]),
    ]);
    const built = buildPictureEnding(state, "mov", inputs({ advances: [] }));
    expect(built).not.toBeNull();
    expect(built!.movie.name).toBe("Test Film");
    expect(built!.screens).toEqual([{ id: "scr", name: "Screen 1" }]);
    expect(built!.runFrom).toBe("2025-03-27");
    expect(built!.runTo).toBe("2025-03-28");
    expect(built!.holdOverDate).toBe("2025-03-28");
    expect(built!.totals.balance).toBeGreaterThan(0);
  });
  it("returns null for an unknown movie", () => {
    expect(buildPictureEnding(fixture([]), "nope", inputs())).toBeNull();
  });
});
