import { describe, it, expect } from "vitest";

import { planScheduleSync } from "./scheduleSync";
import { showScheduleSignature } from "./mappers/schedule";
import type { ShowSchedule } from "./types";

function mk(id: string, opts: Partial<ShowSchedule> = {}): ShowSchedule {
  return {
    id,
    cinemaId: "cin",
    date: "2026-06-25",
    screenId: "scr",
    movieId: "mov",
    showtime: "13:00",
    position: 0,
    cancelled: false,
    ...opts,
  };
}

describe("planScheduleSync", () => {
  it("upserts a row whose content changed", () => {
    const e = mk("s1", { showtime: "16:00" });
    const plan = planScheduleSync([e], { s1: "stale-sig" });
    expect(plan.upserts.map((x) => x.id)).toEqual(["s1"]);
    expect(plan.deletes).toEqual([]);
  });

  it("does not upsert an unchanged row", () => {
    const e = mk("s1");
    const plan = planScheduleSync([e], { s1: showScheduleSignature(e) });
    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it("reaps a row the client no longer holds", () => {
    const plan = planScheduleSync([], { s1: "sig" });
    expect(plan.deletes).toEqual(["s1"]);
    expect(plan.upserts).toEqual([]);
  });

  it("never reaps a just-created (not-yet-synced) row", () => {
    const fresh = mk("s-new");
    const plan = planScheduleSync([fresh], {});
    expect(plan.deletes).toEqual([]);
    expect(plan.upserts.map((x) => x.id)).toEqual(["s-new"]);
  });

  it("does not push an incomplete row (no movie picked), but holds it (no reap)", () => {
    const incomplete = mk("s1", { movieId: "" });
    const plan = planScheduleSync([incomplete], { s1: "sig" });
    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([]); // held — a mid-edit row isn't reaped
  });

  it("does not push a row with no showtime", () => {
    const incomplete = mk("s2", { showtime: "" });
    const plan = planScheduleSync([incomplete], {});
    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it("handles a mixed set: change + reap + fresh", () => {
    const changed = mk("s1", { showtime: "18:00" });
    const fresh = mk("s3");
    const plan = planScheduleSync([changed, fresh], {
      s1: "old-sig",
      s2: "to-delete",
    });
    expect(plan.upserts.map((x) => x.id).sort()).toEqual(["s1", "s3"]);
    expect(plan.deletes).toEqual(["s2"]);
  });
});
