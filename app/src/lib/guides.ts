// ============================================================================
// Guides — in-app help content shown on the /guides page (book icon, top-right).
//
// Categories are a fixed set defined here (the tab strip). The guides
// themselves live in the `public.guides` table so owners/managers can add new
// ones from the UI and everyone sees them — see migration guides_00_schema.
//
// Normalized-only, same shape as lib/roster.ts: reads warn + return a safe
// default, writes throw. Each guide embeds a hosted walkthrough (Scribe) via
// its /embed/ URL.
// ============================================================================

import { getSupabase } from "./supabase";
import type { GuideRow } from "./db-types";

export interface Guide {
  id: string;
  categoryId: string;
  title: string;
  description: string | null;
  /** Embeddable walkthrough URL (e.g. a Scribe /embed/ link). */
  embedUrl: string;
}

export interface GuideCategoryDef {
  id: string;
  label: string;
}

export interface GuideCategory extends GuideCategoryDef {
  guides: Guide[];
}

/**
 * The fixed category tabs. Kept in lockstep with the category_id CHECK in
 * migration guides_00_schema.sql — add a category in both places.
 */
export const GUIDE_CATEGORY_DEFS: GuideCategoryDef[] = [
  { id: "box-office", label: "Box Office" },
  { id: "fb", label: "F&B" },
  { id: "cash", label: "Cash" },
  { id: "finance", label: "Finance" },
  { id: "operations", label: "Operations" },
];

export const GUIDE_CATEGORY_IDS = GUIDE_CATEGORY_DEFS.map((c) => c.id);

/** First category slug — a safe fallback when nothing is selected yet. */
export const DEFAULT_GUIDE_CATEGORY_ID = GUIDE_CATEGORY_DEFS[0]!.id;

// ── mapper ──────────────────────────────────────────────────────────────────

function toGuide(r: GuideRow): Guide {
  return {
    id: r.id,
    categoryId: r.category_id,
    title: r.title,
    description: r.description,
    embedUrl: r.embed_url,
  };
}

// ── read (warn + safe default, never throws) ────────────────────────────────

/**
 * Every guide for a cinema, in display order. Returns [] (and warns) on error
 * so the page still renders its category tabs.
 */
export async function listGuides(cinemaId: string): Promise<Guide[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("guides")
    .select("*")
    .eq("cinema_id", cinemaId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[guides] listGuides", error.message);
    return [];
  }
  return ((data as GuideRow[] | null) ?? []).map(toGuide);
}

/**
 * Group a flat guide list into the fixed category tabs. Categories with no
 * guides come back with an empty array (the page shows a "coming soon" state).
 */
export function groupGuides(guides: Guide[]): GuideCategory[] {
  return GUIDE_CATEGORY_DEFS.map((def) => ({
    ...def,
    guides: guides.filter((g) => g.categoryId === def.id),
  }));
}

// ── write (throws on error) ─────────────────────────────────────────────────

export interface NewGuideInput {
  categoryId: string;
  title: string;
  description: string;
  embedUrl: string;
}

/**
 * Add a guide. Owner/manager only (enforced by RLS). New guides sort after the
 * existing ones in their category. Returns the created guide.
 */
export async function addGuide(
  cinemaId: string,
  input: NewGuideInput,
  createdBy: string,
): Promise<Guide> {
  const sb = getSupabase();

  // Append: one past the current max sort_order in this category.
  const { data: maxRow } = await sb
    .from("guides")
    .select("sort_order")
    .eq("cinema_id", cinemaId)
    .eq("category_id", input.categoryId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = ((maxRow as { sort_order: number } | null)?.sort_order ?? -1) + 1;

  const { data, error } = await sb
    .from("guides")
    .insert({
      cinema_id: cinemaId,
      category_id: input.categoryId,
      title: input.title.trim(),
      description: input.description.trim() || null,
      embed_url: input.embedUrl.trim(),
      sort_order: nextSort,
      created_by: createdBy,
      updated_by: createdBy,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return toGuide(data as GuideRow);
}
