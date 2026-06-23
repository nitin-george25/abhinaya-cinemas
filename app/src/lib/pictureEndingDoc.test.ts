// ============================================================================
// Picture Ending document smoke tests — the PDF + CSV renderers must build a
// real statement without throwing (catches jsPDF API typos, bad column math).
// ============================================================================

import { describe, expect, it } from "vitest";

import { buildPictureEnding, defaultPictureEndingInputs } from "./pictureEnding";
import { buildPictureEndingPdf } from "./pictureEndingPdf";
import { pictureEndingCsvRows } from "./pictureEndingCsv";
import type { CinemaProfile } from "./cinemaProfile";
import type { AppState, Entry } from "./types";

const CINEMA: CinemaProfile = {
  id: "cin", name: "ABHINAYA CINEMAS", location: "Changanacherry",
  gstin: "32AACFA8850G1ZP", pan: "AACFA8850G", arn: "AA320000000", tan: "CHNA00000A",
  addressLine1: "MC Road", city: "Changanacherry", state: "Kerala", pincode: "686101",
  phone: "0481-0000000", email: "accounts@abhinayacinemas.com",
};

function entry(date: string, t: number[]): Entry {
  return {
    id: "e_" + date, date, movieId: "mov", screenId: "scr", share: 60,
    shows: t.map((n) => ({ showtime: "18:00", priceCardId: "pc", rows: { A: { tickets: n } } })),
  };
}

function fixture(): AppState {
  return {
    cinema: { name: "ABHINAYA", gstin: "32AACFA8850G1ZP" },
    tax: { threshold: 105, above: { etaxPct: 8.5, gstPct: 18 }, below: { etaxPct: 5, gstPct: 5 },
      tmc: 2, cess: 3, repDay: 100, repNight: 100, rep1: 250, rep2: 400, rep5: 600 },
    classes: [{ id: "A", name: "A", gstPct: 18 }],
    screens: [{ id: "scr", name: "Screen 1", classes: [{ classId: "A", seats: 100 }],
      priceCards: [{ id: "pc", name: "Card", prices: { A: 100 } }] }],
    movies: [{ id: "mov", name: "Sarvam Maya", distributor: "Central Pictures",
      distributorId: "dist", release: "2025-03-27", share: 60 }],
    distributors: [{ id: "dist", name: "Central Pictures", gstin: "32AABFC4215E1Z9",
      pan: "AABFC4215E", pocName: "Jose Alex", pocEmail: "x@y.com" }],
    serialStarts: [], openings: [],
    entries: [entry("2025-03-27", [100, 90, 80]), entry("2025-03-28", [30, 20, 10]),
      entry("2025-04-03", [40, 30])],
    fbEntries: [], fbProducts: [], draft: null,
  };
}

describe("picture ending document renderers", () => {
  const state = fixture();
  const inputs = defaultPictureEndingInputs("32AACFA8850G1ZP", state.distributors[0], {
    theatreName: "Sridhar Cinemas",
  });
  inputs.flexCharge = 500;
  inputs.advances = [{ paidOn: "2025-03-29", amount: 10000, mode: "rtgs", bank: "ICICI", ref: "001571" }];
  const computed = buildPictureEnding(state, "mov", inputs)!;

  it("builds a PDF with at least one page", () => {
    const doc = buildPictureEndingPdf(computed, { cinema: CINEMA, statementNo: 1 });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(doc.output("arraybuffer").byteLength).toBeGreaterThan(0);
  });

  it("builds CSV rows including the cascade", () => {
    const rows = pictureEndingCsvRows(computed, CINEMA, 1);
    expect(rows.length).toBeGreaterThan(10);
    const flat = rows.map((r) => r.join("|")).join("\n");
    expect(flat).toContain("PICTURE ENDING STATEMENT");
    expect(flat).toContain("BALANCE PAYABLE TO DISTRIBUTOR");
  });
});
