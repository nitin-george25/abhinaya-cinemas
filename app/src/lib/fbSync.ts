// ============================================================================
// F&B sync planner — the pure decision behind pushDeltas' F&B block.
//
// Zoho Books is the source of truth for F&B sales. The client delta-sync
// engine is authoritative ONLY over manual rows: it upserts changed manual
// days and reaps (deletes) manual days it no longer holds. It must NEVER
// upsert or delete a Zoho-owned day, or a debounced push after an unrelated
// edit would silently clobber/delete imported sales.
//
// This logic is the single most data-loss-sensitive piece of the Zoho
// integration, so it lives here as a pure function with full test coverage
// (fbSync.test.ts) rather than inline in the hook.
// ============================================================================

import { fbEntrySignature } from "./mappers";
import type { FbEntry } from "./types";

export interface FbSyncPlan {
  /** Manual entries whose content changed vs. the synced cache — upsert these. */
  upserts: FbEntry[];
  /** Manual dates the client no longer holds — reap (delete) these. */
  deletes: string[];
}

/**
 * Decide which F&B days to push and which to reap.
 *
 * @param local      the client's current in-memory fbEntries
 * @param syncedFb   date → signature cache of MANUAL rows last seen in the cloud
 * @param zohoDates  dates whose cloud row is Zoho-owned (source='zoho')
 *
 * Invariants:
 *  • A Zoho-owned day (by entry.source OR by membership in `zohoDates`) is
 *    never upserted and never deleted.
 *  • Only dates present in `syncedFb` are reap candidates, and a date in
 *    `zohoDates` is excluded even if it somehow appears in `syncedFb`.
 */
export function planFbSync(
  local: FbEntry[],
  syncedFb: Record<string, string>,
  zohoDates: Set<string>,
): FbSyncPlan {
  const held = new Set<string>();
  const upserts: FbEntry[] = [];

  for (const e of local) {
    const k = e.date;
    // Never let the client own a Zoho day — neither the in-memory source flag
    // nor the pulled zoho-date set may be present.
    if (e.source === "zoho" || zohoDates.has(k)) continue;
    held.add(k);
    if (syncedFb[k] !== fbEntrySignature(e)) upserts.push(e);
  }

  const deletes: string[] = [];
  for (const k of Object.keys(syncedFb)) {
    if (held.has(k)) continue;
    if (zohoDates.has(k)) continue; // defense in depth
    deletes.push(k);
  }

  return { upserts, deletes };
}
