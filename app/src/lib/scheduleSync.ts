// ============================================================================
// Show-schedule sync planner — the pure decision behind pushDeltas' schedule
// block. Mirrors planFbSync (without the Zoho carve-out: the client fully owns
// the programme).
//
// Delta key is the row id (schedule rows have a real PK), so:
//  • A just-created local row whose id is not yet in the synced cache is only
//    ever an upsert — it can never be wrongly reaped.
//  • Reap candidates are exactly the ids present in the cache but no longer
//    held locally (deleted on this device).
// ============================================================================

import {
  isCompleteSchedule,
  showScheduleKey,
  showScheduleSignature,
} from "./mappers/schedule";
import type { ShowSchedule } from "./types";

export interface ScheduleSyncPlan {
  /** Schedules whose content changed vs. the synced cache — upsert these. */
  upserts: ShowSchedule[];
  /** Schedule ids the client no longer holds — reap (delete) these. */
  deletes: string[];
}

/**
 * Decide which schedule rows to push and which to reap.
 *
 * @param local   the client's current in-memory showSchedules
 * @param synced  id → signature cache of rows last seen in the cloud
 */
export function planScheduleSync(
  local: ShowSchedule[],
  synced: Record<string, string>,
): ScheduleSyncPlan {
  const held = new Set<string>();
  const upserts: ShowSchedule[] = [];

  for (const s of local) {
    const k = showScheduleKey(s);
    // Held regardless of completeness, so a temporarily-incomplete row (movie
    // cleared mid-edit) is not reaped from the cloud…
    held.add(k);
    // …but only complete rows are written, so we never push a phantom show.
    if (!isCompleteSchedule(s)) continue;
    if (synced[k] !== showScheduleSignature(s)) upserts.push(s);
  }

  const deletes: string[] = [];
  for (const k of Object.keys(synced)) {
    if (!held.has(k)) deletes.push(k);
  }

  return { upserts, deletes };
}
