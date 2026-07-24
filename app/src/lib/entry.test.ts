import { describe, it, expect } from "vitest";

import {
  ensureScheduledShow,
  findEntry,
  showIdxForSchedule,
} from "./entry";
import type { AppState, Entry, ShowSchedule } from "./types";

// ── fixtures ───────────────────────────────────────────────────────────
// Minimal state: one screen, one class, one price card — enough for
// blankShow/entryClasses inside ensureScheduledShow.

function makeState(entries: Entry[] = []): AppState {
  return {
    cinema: { name: "Test", gstin: "" },
    tax: {
      threshold: 105,
      above: { etaxPct: 8.5, gstPct: 18 },
      below: { etaxPct: 5, gstPct: 5 },
      tmc: 2, cess: 3,
      repDay: 100, repNight: 100,
      rep1: 250, rep2: 400, rep5: 600,
    },
    classes: [{ id: "cls_a", name: "A", gstPct: 18 }],
    screens: [
      {
        id: "scr_1",
        name: "Audi 1",
        classes: [{ classId: "cls_a", seats: 100 }],
        priceCards: [{ id: "pc_1", name: "Card 1", prices: { cls_a: 200 } }],
      },
    ],
    movies: [],
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

const sched = (id: string, showtime: string): ShowSchedule => ({
  id,
  cinemaId: "cin_1",
  date: "2026-07-14",
  screenId: "scr_1",
  movieId: "mov_1",
  priceCardId: "pc_1",
  showtime,
  position: 0,
  cancelled: false,
});

/** An entry whose one show was materialized from schedule id `sid`. */
const entryLinkedTo = (sid: string, showtime = "18:30", tickets = 57): Entry => ({
  id: "ent_1",
  date: "2026-07-14",
  movieId: "mov_1",
  screenId: "scr_1",
  share: null,
  shows: [{ showtime, scheduleId: sid, priceCardId: "pc_1", rows: { cls_a: { tickets } } }],
});

// ── showIdxForSchedule ─────────────────────────────────────────────────

describe("showIdxForSchedule", () => {
  it("matches by scheduleId first", () => {
    const e = entryLinkedTo("sch_1");
    expect(showIdxForSchedule(e, sched("sch_1", "18:30"))).toBe(0);
  });

  it("falls back to the snapshotted showtime when the id is orphaned (programme replaced by copy-forward / re-import)", () => {
    const e = entryLinkedTo("sch_old");
    // Same slot, fresh id — as produced by copyScheduleForward / applyImport.
    expect(showIdxForSchedule(e, sched("sch_new", "18:30"))).toBe(0);
  });

  it("does not showtime-match a different slot, an empty showtime, or a missing entry", () => {
    const e = entryLinkedTo("sch_old");
    expect(showIdxForSchedule(e, sched("sch_new", "21:45"))).toBe(-1);
    expect(showIdxForSchedule(entryLinkedTo("sch_old", ""), sched("sch_new", ""))).toBe(-1);
    expect(showIdxForSchedule(undefined, sched("sch_1", "18:30"))).toBe(-1);
  });

  it("prefers the id match over a showtime collision", () => {
    // Two shows: the right one linked by id at index 1.
    const e: Entry = {
      ...entryLinkedTo("sch_other", "18:30"),
      shows: [
        { showtime: "18:30", scheduleId: "sch_other", priceCardId: "pc_1", rows: {} },
        { showtime: "21:45", scheduleId: "sch_1", priceCardId: "pc_1", rows: {} },
      ],
    };
    expect(showIdxForSchedule(e, sched("sch_1", "18:30"))).toBe(1);
  });
});

// ── ensureScheduledShow ────────────────────────────────────────────────

describe("ensureScheduledShow", () => {
  it("reuses the orphaned show (no duplicate) and heals its scheduleId", () => {
    const state = makeState([entryLinkedTo("sch_old")]);
    const s2 = sched("sch_new", "18:30");
    const { state: next, entry, showIdx } = ensureScheduledShow(state, s2);
    expect(showIdx).toBe(0);
    expect(entry.shows).toHaveLength(1);
    // Tickets survive; the link now points at the live schedule row.
    expect(entry.shows![0]!.rows!.cls_a!.tickets).toBe(57);
    expect(entry.shows![0]!.scheduleId).toBe("sch_new");
    // And the healed entry is what got upserted into state.
    expect(findEntry(next, "2026-07-14", "mov_1", "scr_1")!.shows![0]!.scheduleId).toBe("sch_new");
  });

  it("still materializes a fresh show for a genuinely new slot", () => {
    const state = makeState([entryLinkedTo("sch_old", "18:30")]);
    const { entry, showIdx } = ensureScheduledShow(state, sched("sch_new", "21:45"));
    expect(entry.shows).toHaveLength(2);
    expect(showIdx).toBe(1);
    expect(entry.shows![1]!.scheduleId).toBe("sch_new");
    expect(entry.shows![1]!.showtime).toBe("21:45");
  });

  it("is idempotent for an intact link", () => {
    const state = makeState([entryLinkedTo("sch_1")]);
    const { entry, showIdx } = ensureScheduledShow(state, sched("sch_1", "18:30"));
    expect(showIdx).toBe(0);
    expect(entry.shows).toHaveLength(1);
    expect(entry).toEqual(state.entries[0]); // untouched — no needless churn
  });
});
