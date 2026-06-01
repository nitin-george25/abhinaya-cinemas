// ============================================================================
// Activity Log — fetches recent changes from Supabase, merges them into one
// chronological feed.
//
// Port of admin/dcr/js/09-backup-changes.js (fetchAll). Doesn't touch
// AppState — these are activity events, not editable records, so we query
// Supabase directly and let the page render whatever comes back.
//
// Phase D will likely replace these 4 parallel selects with a single
// `activity` view; the shape of ActivityEvent stays the same.
// ============================================================================

import { getSupabase } from "./supabase";
import type { AppState, DateISO, UUID } from "./types";

export type ActivityType = "bo" | "fb" | "cfg" | "cat";

export interface ActivityEvent {
  type: ActivityType;
  /** ISO timestamp (Postgres `timestamptz` as a string). */
  when: string;
  /** Email of the user who made the change, or a fallback label. */
  who: string;
  /** "Cinema name" — placeholder for multi-location later. */
  location: string;
  /** Screen name, or "—" for events that don't have one. */
  screen: string;
  /** Movie name, or "—" for non-BO events. */
  movie: string;
  /** Entry date (YYYY-MM-DD), or empty for non-day-scoped events. */
  date: DateISO | "";
  /** Human-readable description of the change. */
  text: string;
}

export interface ActivityFilters {
  user: string;
  type: ActivityType | "";
  from: DateISO | "";
  to: DateISO | "";
}

export const TYPE_LABELS: Record<ActivityType, string> = {
  bo:  "BO DCR",
  fb:  "F&B day",
  cfg: "Cinema config",
  cat: "Catalog",
};

/** Tailwind tone for the Badge primitive — keep in sync with TYPE_LABELS. */
export const TYPE_TONES: Record<ActivityType, "blue" | "amber" | "neutral" | "green"> = {
  bo:  "blue",
  fb:  "amber",
  cfg: "neutral",
  cat: "green",
};

const cinemaName = (state: AppState): string => state.cinema?.name || "Cinema";
const movieName  = (state: AppState, id: UUID): string =>
  state.movies.find((m) => m.id === id)?.name ?? "?";
const screenName = (state: AppState, id: UUID): string =>
  state.screens.find((s) => s.id === id)?.name ?? "?";

/**
 * Fetch the most recent changes across entries, fb_entries, config, and
 * fb_products. Merged, sorted desc by `when`. Resolves to [] on error
 * (errors logged) so the page can render the empty state cleanly.
 */
export async function fetchActivity(
  state: AppState,
  limit = { entries: 200, fb: 200, products: 50 },
): Promise<ActivityEvent[]> {
  const sb = getSupabase();
  const loc = cinemaName(state);

  try {
    const [entriesRes, fbRes, cfgRes, productsRes] = await Promise.all([
      sb.from("entries")
        .select("entry_date,movie_id,screen_id,updated_by,updated_at")
        .order("updated_at", { ascending: false })
        .limit(limit.entries),
      sb.from("fb_entries")
        .select("entry_date,updated_by,updated_at")
        .order("updated_at", { ascending: false })
        .limit(limit.fb),
      sb.from("config")
        .select("updated_by,updated_at")
        .limit(1),
      sb.from("fb_products")
        .select("name,updated_at")
        .order("updated_at", { ascending: false })
        .limit(limit.products),
    ]);

    const events: ActivityEvent[] = [];

    for (const r of (entriesRes.data ?? []) as Array<{
      entry_date: string; movie_id: UUID; screen_id: UUID;
      updated_by: string | null; updated_at: string | null;
    }>) {
      if (!r.updated_at) continue;
      const movie = movieName(state, r.movie_id);
      const screen = screenName(state, r.screen_id);
      events.push({
        type: "bo",
        when: r.updated_at,
        who: r.updated_by || "?",
        location: loc,
        screen,
        movie,
        date: (r.entry_date as DateISO) || "",
        text: `${movie} on ${screen} (${r.entry_date || ""})`,
      });
    }

    for (const r of (fbRes.data ?? []) as Array<{
      entry_date: string; updated_by: string | null; updated_at: string | null;
    }>) {
      if (!r.updated_at) continue;
      events.push({
        type: "fb",
        when: r.updated_at,
        who: r.updated_by || "?",
        location: loc,
        screen: "—",
        movie: "—",
        date: (r.entry_date as DateISO) || "",
        text: `F&B sales for ${r.entry_date || ""}`,
      });
    }

    for (const r of (cfgRes.data ?? []) as Array<{
      updated_by: string | null; updated_at: string | null;
    }>) {
      if (!r.updated_at) continue;
      events.push({
        type: "cfg",
        when: r.updated_at,
        who: r.updated_by || "?",
        location: loc,
        screen: "—",
        movie: "—",
        date: "",
        text: "Cinema configuration updated (rates / screens / cards / movies / openings / serials)",
      });
    }

    for (const r of (productsRes.data ?? []) as Array<{
      name: string | null; updated_at: string | null;
    }>) {
      if (!r.updated_at) continue;
      events.push({
        type: "cat",
        when: r.updated_at,
        who: "(catalog edit)",
        location: loc,
        screen: "—",
        movie: "—",
        date: "",
        text: `Catalog product: ${r.name || "?"}`,
      });
    }

    events.sort((a, b) => b.when.localeCompare(a.when));
    return events;
  } catch (err) {
    console.error("activity fetch failed", err);
    return [];
  }
}

// ── filtering ──────────────────────────────────────────────────────────

export function applyActivityFilters(
  items: ActivityEvent[],
  f: ActivityFilters,
): ActivityEvent[] {
  return items.filter((it) => {
    if (f.user && it.who !== f.user) return false;
    if (f.type && it.type !== f.type) return false;
    if (f.from || f.to) {
      const d = it.when.slice(0, 10);
      if (f.from && d < f.from) return false;
      if (f.to && d > f.to) return false;
    }
    return true;
  });
}

/** Distinct users in the event list, sorted. For the user dropdown. */
export function uniqueUsers(items: ActivityEvent[]): string[] {
  const set = new Set<string>();
  items.forEach((it) => { if (it.who) set.add(it.who); });
  return [...set].sort();
}

// ── time formatting ─────────────────────────────────────────────────────

export function relTime(iso: string | undefined): string {
  if (!iso) return "";
  const then = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - then.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const d = Math.floor(diff / 86400);
  if (d < 30) return `${d}d ago`;
  // Local date components — toISOString returns UTC which would show
  // "2026-05-30" for a 1 AM IST May 31 event (off-by-one in IST).
  const y = then.getFullYear();
  const m = String(then.getMonth() + 1).padStart(2, "0");
  const dd = String(then.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function absTime(iso: string | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IN", {
    dateStyle: "short",
    timeStyle: "short",
  });
}
