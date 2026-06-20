import { describe, it, expect } from "vitest";

import { planFbSync } from "./fbSync";
import { fbEntrySignature } from "./mappers";
import type { FbEntry } from "./types";

function mk(date: string, opts: Partial<FbEntry> = {}): FbEntry {
  return {
    id: `id-${date}`,
    date,
    summary: opts.summary ?? { grossSales: 100 },
    items: opts.items ?? [],
    notes: opts.notes,
    source: opts.source,
  };
}

describe("planFbSync — manual days (client-owned)", () => {
  it("upserts a manual day whose content changed", () => {
    const e = mk("2026-06-01", { summary: { grossSales: 200 } });
    const plan = planFbSync([e], { "2026-06-01": "stale-sig" }, new Set());
    expect(plan.upserts.map((x) => x.date)).toEqual(["2026-06-01"]);
    expect(plan.deletes).toEqual([]);
  });

  it("does not upsert an unchanged manual day", () => {
    const e = mk("2026-06-01");
    const plan = planFbSync([e], { "2026-06-01": fbEntrySignature(e) }, new Set());
    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it("reaps a manual day the client no longer holds", () => {
    const plan = planFbSync([], { "2026-06-01": "sig" }, new Set());
    expect(plan.deletes).toEqual(["2026-06-01"]);
    expect(plan.upserts).toEqual([]);
  });
});

describe("planFbSync — Zoho days (server-owned, must be untouchable)", () => {
  it("never upserts a Zoho-sourced day present in local state", () => {
    const e = mk("2026-06-02", { source: "zoho" });
    const plan = planFbSync([e], {}, new Set(["2026-06-02"]));
    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it("never reaps a Zoho-owned day even if it leaked into the synced cache", () => {
    // Defense in depth: zohoDates wins over a stray synced.fb entry.
    const plan = planFbSync([], { "2026-06-02": "sig" }, new Set(["2026-06-02"]));
    expect(plan.deletes).toEqual([]);
  });

  it("hard-skips a stale MANUAL draft for a date Zoho now owns (no clobber)", () => {
    const stale = mk("2026-06-02", { source: "manual", summary: { grossSales: 999 } });
    const plan = planFbSync([stale], {}, new Set(["2026-06-02"]));
    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });
});

describe("planFbSync — mixed day set", () => {
  it("reaps a stale manual day while leaving a Zoho day untouched and pushing a changed manual day", () => {
    const changedManual = mk("2026-06-01", { summary: { grossSales: 500 } });
    const zoho = mk("2026-06-02", { source: "zoho" });
    const synced = {
      "2026-06-01": "old-sig",   // changed → upsert
      "2026-06-03": "to-delete", // gone from local → reap
    };
    const zohoDates = new Set(["2026-06-02"]);
    const plan = planFbSync([changedManual, zoho], synced, zohoDates);
    expect(plan.upserts.map((x) => x.date)).toEqual(["2026-06-01"]);
    expect(plan.deletes).toEqual(["2026-06-03"]);
  });
});
