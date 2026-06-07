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
