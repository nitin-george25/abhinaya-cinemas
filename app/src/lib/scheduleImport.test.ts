import { describe, it, expect } from "vitest";

import {
  parseVistaTime,
  parseVistaDate,
  parseVistaWorkbook,
  normalizeName,
  matchByName,
  matchPriceCard,
  extractPriceTokens,
  buildScheduleRows,
  priceCardKey,
} from "./scheduleImport";

// A faithful slice of the real Vista export decoded from the sample .xls.
const GRID: string[][] = [
  ["Date:", "25 Jun 2026", "Conc Gross (Rs.)  0"],
  [],
  ["Screen", "Film", "Session Id", "Show", "Showing", "Interval", "Finishing", "Price Card", "Sold"],
  ["ANU"],
  ["", "Balan:The Boy", "24711", "1", "11:00 am", "", "12:30 pm", "ANU SPE (25) 150/140/105", "47"],
  ["", "Balan:The Boy", "24712", "2", "2:00 pm", "", "3:30 pm", "ANU SPE (25) 150/140/105", "5"],
  ["", "Balan:The Boy", "24713", "3", "6:00 pm", "", "7:30 pm", "ANU SPE (25) 150/140/105", "8"],
  ["", "Balan:The Boy", "24714", "4", "9:00 pm", "", "10:30 pm", "ANU SPE (25) 150/140/105", "23"],
  ["", "", "", "", "", "", "", "", "83"],
  [],
  ["Total :", "", "", "4", "", "", "", "", "83"],
];

describe("parseVistaTime", () => {
  it("converts 12-hour am/pm to 24h", () => {
    expect(parseVistaTime("11:00 am")).toBe("11:00");
    expect(parseVistaTime("2:00 pm")).toBe("14:00");
    expect(parseVistaTime("9:00 PM")).toBe("21:00");
    expect(parseVistaTime("12:00 am")).toBe("00:00");
    expect(parseVistaTime("12:30 pm")).toBe("12:30");
    expect(parseVistaTime("23:15")).toBe("23:15"); // already 24h
  });
  it("returns null on junk", () => {
    expect(parseVistaTime("")).toBeNull();
    expect(parseVistaTime("matinee")).toBeNull();
  });
});

describe("parseVistaDate", () => {
  it("reads the Vista 'DD Mon YYYY' format", () => {
    expect(parseVistaDate("25 Jun 2026")).toBe("2026-06-25");
  });
  it("reads ISO and day-first numeric", () => {
    expect(parseVistaDate("2026-06-25")).toBe("2026-06-25");
    expect(parseVistaDate("25/06/2026")).toBe("2026-06-25");
  });
  it("returns null on junk", () => {
    expect(parseVistaDate("sometime")).toBeNull();
  });
});

describe("parseVistaWorkbook", () => {
  const parsed = parseVistaWorkbook(GRID);

  it("extracts the date", () => {
    expect(parsed.date).toBe("2026-06-25");
  });

  it("extracts the 4 show rows (skips subtotal + total)", () => {
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.rows.map((r) => r.showtime)).toEqual(["11:00", "14:00", "18:00", "21:00"]);
  });

  it("carries the screen group header down to each show", () => {
    expect(parsed.rows.every((r) => r.screen === "ANU")).toBe(true);
    expect(parsed.rows.every((r) => r.film === "Balan:The Boy")).toBe(true);
    expect(parsed.rows[0]?.priceCard).toBe("ANU SPE (25) 150/140/105");
    expect(parsed.rows[0]?.sold).toBe(47);
    expect(parsed.rows[0]?.sessionId).toBe("24711");
  });

  it("warns and skips a row with an unreadable time", () => {
    const bad = GRID.map((r) => r.slice());
    bad[5]![4] = "later"; // the 2:00 pm show's time
    const p = parseVistaWorkbook(bad);
    expect(p.rows).toHaveLength(3);
    expect(p.warnings.some((w) => /unreadable show time/i.test(w))).toBe(true);
  });
});

describe("matchByName / normalizeName", () => {
  const screens = [{ id: "scr1", name: "ANU" }, { id: "scr2", name: "Abhinaya" }];
  it("matches case/space/punctuation-insensitively", () => {
    expect(normalizeName("ANU SPE (25)")).toBe("anuspe25");
    expect(matchByName("anu", screens)).toBe("scr1");
    expect(matchByName("Abhinaya ", screens)).toBe("scr2");
    expect(matchByName("Screen 3", screens)).toBeNull();
  });
});

describe("matchPriceCard (by printed prices)", () => {
  const cards: Array<{ id: string; name: string; prices: Record<string, number> }> = [
    { id: "pcA", name: "Card 1", prices: { royale: 150, lounge: 140, prime: 105 } },
    { id: "pcB", name: "Card 2", prices: { royale: 200, lounge: 180, prime: 120 } },
    { id: "pcC", name: "Weekend", prices: { royale: 150, lounge: 140, prime: 105, club: 0 } },
  ];

  it("extracts only the slash-separated price run, ignoring the seat code", () => {
    expect(extractPriceTokens("ANU SPE (25) 150/140/105")).toEqual([150, 140, 105]);
    expect(extractPriceTokens("Rs.200 / 180 / 120")).toEqual([200, 180, 120]);
    expect(extractPriceTokens("No prices here (25)")).toEqual([]);
  });

  it("matches the card whose price set equals the label's prices (order-independent)", () => {
    expect(matchPriceCard("ANU SPE (25) 150/140/105", cards)).toBe("pcA");
    expect(matchPriceCard("X 120/200/180", cards)).toBe("pcB"); // different order
  });

  it("ignores zero-priced classes when comparing", () => {
    // pcC has the same three real prices plus a 0 — still a 3-price match…
    const only = [cards[2]!];
    expect(matchPriceCard("150/140/105", only)).toBe("pcC");
  });

  it("returns null when no price set matches and no name match", () => {
    expect(matchPriceCard("999/888", cards)).toBeNull();
  });

  it("falls back to name match when the label has no price tokens", () => {
    expect(matchPriceCard("Weekend", cards)).toBe("pcC");
  });
});

describe("buildScheduleRows", () => {
  const parsed = parseVistaWorkbook(GRID);
  const mapping = {
    screens: { ANU: "scr1" },
    films: { "Balan:The Boy": "mov1" },
    priceCards: { [priceCardKey("ANU", "ANU SPE (25) 150/140/105")]: "pc1" },
  };

  it("builds chronological rows for mapped screen/film", () => {
    const { rows, skipped } = buildScheduleRows(parsed, "2026-06-25", mapping, "cin1");
    expect(skipped).toHaveLength(0);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.showtime)).toEqual(["11:00", "14:00", "18:00", "21:00"]);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3]);
    expect(rows.every((r) => r.screenId === "scr1" && r.movieId === "mov1")).toBe(true);
    expect(rows[0]?.priceCardId).toBe("pc1");
    expect(rows.every((r) => r.cinemaId === "cin1" && r.date === "2026-06-25")).toBe(true);
  });

  it("skips rows whose film isn't mapped", () => {
    const { rows, skipped } = buildScheduleRows(parsed, "2026-06-25", { ...mapping, films: {} }, "cin1");
    expect(rows).toHaveLength(0);
    expect(skipped).toHaveLength(4);
  });
});
