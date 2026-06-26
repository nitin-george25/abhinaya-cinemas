import { describe, it, expect } from "vitest";

import {
  UNLOCK_GRACE_MIN,
  showUnlockState,
  copyScheduleForward,
  isGateEditable,
  lastScheduledShowtime,
  isLastScheduledShow,
  isLastShowOfDay,
} from "./schedule";
import type { AppState, Entry } from "./types";
import {
  istParts,
  todayIstIso,
  minutesSinceShowtime,
  hhmmToMinutes,
  minutesToHHMM,
  daysBetweenIso,
} from "./dates";
import type { ShowSchedule } from "./types";

// IST is UTC+5:30 (no DST). All `now` instants below are fixed UTC moments, so
// these tests are correct regardless of the machine's timezone — which is
// exactly the non-IST-browser guarantee the gate relies on.

describe("IST date helpers", () => {
  it("istParts maps a UTC instant to IST date + minutes", () => {
    const at = new Date("2026-06-25T08:00:00.000Z"); // 13:30 IST
    expect(istParts(at)).toEqual({ date: "2026-06-25", minutes: 13 * 60 + 30 });
  });

  it("todayIstIso rolls to the next day after 18:30 UTC (00:00 IST)", () => {
    expect(todayIstIso(new Date("2026-06-25T18:29:00Z"))).toBe("2026-06-25"); // 23:59 IST
    expect(todayIstIso(new Date("2026-06-25T18:31:00Z"))).toBe("2026-06-26"); // 00:01 IST
  });

  it("minutesSinceShowtime works across the IST midnight boundary", () => {
    const at = new Date("2026-06-25T19:00:00Z"); // 2026-06-26 00:30 IST
    // 90 min after a 23:00 show dated the previous IST day.
    expect(minutesSinceShowtime("2026-06-25", "23:00", at)).toBe(90);
    // 30 min after a 00:00 show dated today.
    expect(minutesSinceShowtime("2026-06-26", "00:00", at)).toBe(30);
  });

  it("hhmmToMinutes / minutesToHHMM round-trip and wrap", () => {
    expect(hhmmToMinutes("13:30")).toBe(810);
    expect(hhmmToMinutes("bad")).toBeNull();
    expect(minutesToHHMM(810)).toBe("13:30");
    expect(minutesToHHMM(1470)).toBe("00:30"); // wraps past midnight
  });

  it("daysBetweenIso is calendar-day accurate", () => {
    expect(daysBetweenIso("2026-06-25", "2026-06-27")).toBe(2);
    expect(daysBetweenIso("2026-06-27", "2026-06-25")).toBe(-2);
  });
});

describe("showUnlockState", () => {
  const base = { scheduleDate: "2026-06-25", role: "manager" as const, twoDayLockActive: false };

  it("is upcoming before showtime + 30 min", () => {
    const g = showUnlockState({ ...base, showtime: "13:00", now: new Date("2026-06-25T07:59:00Z") }); // 13:29 IST
    expect(g.state).toBe("upcoming");
    if (g.state === "upcoming") {
      expect(g.opensInMin).toBe(1);
      expect(g.opensAtHHMM).toBe("13:30");
    }
  });

  it("opens exactly at showtime + 30 min", () => {
    const g = showUnlockState({ ...base, showtime: "13:00", now: new Date("2026-06-25T08:00:00Z") }); // 13:30 IST
    expect(g.state).toBe("open");
    expect(isGateEditable(g)).toBe(true);
  });

  it("treats each show independently (per-show unlock)", () => {
    const now = new Date("2026-06-25T08:00:00Z"); // 13:30 IST
    const matinee = showUnlockState({ ...base, showtime: "13:00", now });
    const evening = showUnlockState({ ...base, showtime: "13:30", now });
    expect(matinee.state).toBe("open");
    expect(evening.state).toBe("upcoming"); // its tickets haven't closed yet
  });

  it("past the 2-day lock: non-owner is locked, owner stays editable", () => {
    const now = new Date("2026-06-25T08:00:00Z");
    const old = { scheduleDate: "2026-06-20", showtime: "13:00", now, twoDayLockActive: true };
    expect(showUnlockState({ ...old, role: "manager" }).state).toBe("past-locked");
    expect(showUnlockState({ ...old, role: "owner" }).state).toBe("owner-open");
    expect(isGateEditable(showUnlockState({ ...old, role: "owner" }))).toBe(true);
  });

  it("the +30 grace applies to the owner too (no early entry)", () => {
    const g = showUnlockState({
      scheduleDate: "2026-06-25",
      showtime: "13:00",
      now: new Date("2026-06-25T07:00:00Z"), // 12:30 IST — before start
      role: "owner",
      twoDayLockActive: false,
    });
    expect(g.state).toBe("upcoming");
  });

  it("UNLOCK_GRACE_MIN is 30", () => {
    expect(UNLOCK_GRACE_MIN).toBe(30);
  });
});

describe("copyScheduleForward", () => {
  const rows: ShowSchedule[] = [
    { id: "a", cinemaId: "c", date: "2026-06-24", screenId: "s", movieId: "m1", showtime: "18:00", position: 1, cancelled: false, priceCardId: "pc1" },
    { id: "b", cinemaId: "c", date: "2026-06-24", screenId: "s", movieId: "m2", showtime: "10:00", position: 0, cancelled: true },
  ];

  it("clones onto a new date with fresh ids, chronological order, cancelled reset", () => {
    const out = copyScheduleForward(rows, "2026-06-25");
    expect(out).toHaveLength(2);
    // Sorted by showtime: 10:00 then 18:00.
    expect(out.map((r) => r.showtime)).toEqual(["10:00", "18:00"]);
    expect(out.map((r) => r.position)).toEqual([0, 1]);
    expect(out.every((r) => r.date === "2026-06-25")).toBe(true);
    expect(out.every((r) => !r.cancelled)).toBe(true);
    // Fresh ids — none collide with the source.
    expect(out.some((r) => r.id === "a" || r.id === "b")).toBe(false);
    // Preserves movie + price card.
    expect(out.find((r) => r.showtime === "18:00")?.movieId).toBe("m1");
    expect(out.find((r) => r.showtime === "18:00")?.priceCardId).toBe("pc1");
  });

  it("returns empty for an empty source", () => {
    expect(copyScheduleForward([], "2026-06-25")).toEqual([]);
  });
});

describe("auto last-show detection", () => {
  const sched = (id: string, showtime: string, cancelled = false): ShowSchedule => ({
    id, cinemaId: "c", date: "2026-06-25", screenId: "s", movieId: "m",
    showtime, position: 0, cancelled,
  });
  const stateOf = (rows: ShowSchedule[]) => ({ showSchedules: rows }) as unknown as AppState;

  it("lastScheduledShowtime returns the latest non-cancelled showtime", () => {
    const st = stateOf([sched("a", "11:00"), sched("b", "21:00"), sched("c", "18:00")]);
    expect(lastScheduledShowtime(st, "2026-06-25", "m", "s")).toBe("21:00");
  });

  it("excludes a cancelled latest show", () => {
    const st = stateOf([sched("a", "18:00"), sched("b", "21:00", true)]);
    expect(lastScheduledShowtime(st, "2026-06-25", "m", "s")).toBe("18:00");
  });

  it("isLastScheduledShow flags only the latest show", () => {
    const st = stateOf([sched("a", "18:00"), sched("b", "21:00")]);
    expect(isLastScheduledShow(st, sched("b", "21:00"))).toBe(true);
    expect(isLastScheduledShow(st, sched("a", "18:00"))).toBe(false);
  });

  it("isLastShowOfDay matches the entered show against the schedule", () => {
    const st = stateOf([sched("a", "18:00"), sched("b", "21:00")]);
    const entry: Entry = {
      id: "e", date: "2026-06-25", movieId: "m", screenId: "s", share: null,
      shows: [{ showtime: "18:00" }, { showtime: "21:00" }],
    };
    expect(isLastShowOfDay(st, entry, 1)).toBe(true);
    expect(isLastShowOfDay(st, entry, 0)).toBe(false);
  });

  it("returns false on a day with no schedule (no manual flag any more)", () => {
    const st = stateOf([]);
    const entry: Entry = {
      id: "e", date: "2026-06-25", movieId: "m", screenId: "s", share: null,
      shows: [{ showtime: "18:00" }, { showtime: "21:00" }],
    };
    expect(isLastShowOfDay(st, entry, 0)).toBe(false);
    expect(isLastShowOfDay(st, entry, 1)).toBe(false);
  });
});
