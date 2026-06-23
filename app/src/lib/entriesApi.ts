// ============================================================================
// entriesApi — server-side paginated reads of public.entries.
//
// The global sync (useSupabaseSync.pullAll) still pulls the whole entries
// table for the engine's delta cache; that's fine for day-to-day operating
// data but History browses the full 2019-26 backfill, so it queries its
// own page directly instead of mapping thousands of in-memory rows.
//
// PostgREST `count: "exact"` gives the total matching rows so the pager
// can render "Showing x–y of N" without fetching everything.
// ============================================================================

import { getSupabase } from "./supabase";
import { rowToEntry } from "./mappers";
import type { EntryRow } from "./db-types";
import type { DateISO, Entry, UUID } from "./types";

export interface EntriesPageFilter {
  from?:     DateISO | "";
  to?:       DateISO | "";
  movieId?:  UUID | "";
  screenId?: UUID | "";
}

export interface EntriesPage {
  entries: Entry[];
  /** Total rows matching the filter (across all pages). */
  total:   number;
}

export async function fetchEntriesPage(
  filter: EntriesPageFilter,
  page: number,
  pageSize: number,
): Promise<EntriesPage> {
  const sb = getSupabase();
  if (!sb) return { entries: [], total: 0 };

  const fromIdx = (page - 1) * pageSize;
  const toIdx   = fromIdx + pageSize - 1;

  let q = sb
    .from("entries")
    .select("*", { count: "exact" })
    .order("entry_date", { ascending: false })
    .order("movie_id")
    .order("screen_id")
    .range(fromIdx, toIdx);

  if (filter.from)     q = q.gte("entry_date", filter.from);
  if (filter.to)       q = q.lte("entry_date", filter.to);
  if (filter.movieId)  q = q.eq("movie_id", filter.movieId);
  if (filter.screenId) q = q.eq("screen_id", filter.screenId);

  const { data, error, count } = await q;
  if (error) {
    console.warn("[entriesApi] fetchEntriesPage", error.message);
    return { entries: [], total: 0 };
  }
  return {
    entries: ((data as EntryRow[] | null) ?? []).map(rowToEntry),
    total:   count ?? 0,
  };
}

/**
 * Clear the per-day distributor-share override (entries.share → NULL) on a
 * movie's DCRs on the given dates, so they fall back to the weekly share rate
 * (resolveShare precedence: per-day override → weekShares → base). Returns the
 * number of rows actually changed.
 *
 * One atomic UPDATE that touches ONLY the share column (+ audit), filtered to
 * rows that currently HAVE an override (share > 0). Share-only is what lets it
 * pass the 2-day edit-lock trigger for owner/manager on locked DCRs
 * (enforce_entry_edit_lock). Owner/manager only — other roles are rejected
 * server-side.
 */
export async function clearEntryShareOverrides(
  movieId: UUID,
  dates: DateISO[],
  email: string,
): Promise<number> {
  const sb = getSupabase();
  if (!sb || !dates.length) return 0;
  const { data, error } = await sb
    .from("entries")
    .update({ share: null, updated_by: email, updated_at: new Date().toISOString() })
    .eq("movie_id", movieId)
    .in("entry_date", [...new Set(dates)])
    .gt("share", 0)
    .select("entry_date");
  if (error) throw new Error(error.message);
  return (data as unknown[] | null)?.length ?? 0;
}
