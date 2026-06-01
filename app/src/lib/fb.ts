// ============================================================================
// F&B helpers — pure mutators for FbEntry + direct Supabase mutations for
// fb_products (the menu catalog is owner-only and small, so we don't push
// through the delta system — just call upsert/delete directly).
// ============================================================================

import { N } from "./engine";
import { getSupabase } from "./supabase";
import { uid } from "./mappers";
import type {
  AppState,
  DateISO,
  FbEntry,
  FbProduct,
  FbSummary,
  UUID,
} from "./types";

// ── FbEntry mutators ───────────────────────────────────────────────────

export function findFbEntry(state: AppState, date: DateISO): FbEntry | undefined {
  return state.fbEntries.find((e) => e.date === date);
}

export function blankFbEntry(date: DateISO): FbEntry {
  return {
    id: uid(),
    date,
    summary: {
      grossSales: 0,
      foodSales: 0,
      beveragesSales: 0,
      addTax: 0,
      netSalesWithTax: 0,
      bills: 0,
    },
    items: [],
    notes: "",
  };
}

export function upsertFbEntry(state: AppState, entry: FbEntry): AppState {
  const others = state.fbEntries.filter((e) => e.date !== entry.date);
  return { ...state, fbEntries: [...others, entry] };
}

export function deleteFbEntry(state: AppState, date: DateISO): AppState {
  return { ...state, fbEntries: state.fbEntries.filter((e) => e.date !== date) };
}

/**
 * Recompute the totals (grossSales, netSalesWithTax) from food + beverages
 * + tax. Owners type in the per-category figures; the totals are derived
 * so we don't store stale or inconsistent numbers.
 */
export function recomputeFbSummary(summary: FbSummary): FbSummary {
  const food = N(summary.foodSales);
  const bev  = N(summary.beveragesSales);
  const tax  = N(summary.addTax);
  return {
    ...summary,
    foodSales:       food,
    beveragesSales:  bev,
    addTax:          tax,
    grossSales:      food + bev,
    netSalesWithTax: food + bev + tax,
  };
}

// ── fb_products admin (direct Supabase, owner-only via RLS) ───────────

export interface CreateProductPayload {
  name: string;
  category: string;
  defaultRate: number;
  defaultGstPct: number;
  posItemNumber?: string;
}

export const fbProducts = {
  async create(p: CreateProductPayload): Promise<UUID> {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("fb_products")
      .insert({
        name: p.name,
        category: p.category,
        default_rate: p.defaultRate,
        default_gst_pct: p.defaultGstPct,
        pos_item_number: p.posItemNumber ?? null,
        is_active: true,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return (data as { id: UUID }).id;
  },

  async update(id: UUID, patch: Partial<CreateProductPayload> & { isActive?: boolean }): Promise<void> {
    const sb = getSupabase();
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.category !== undefined) row.category = patch.category;
    if (patch.defaultRate !== undefined) row.default_rate = patch.defaultRate;
    if (patch.defaultGstPct !== undefined) row.default_gst_pct = patch.defaultGstPct;
    if (patch.posItemNumber !== undefined) row.pos_item_number = patch.posItemNumber || null;
    if (patch.isActive !== undefined) row.is_active = patch.isActive;
    row.updated_at = new Date().toISOString();
    const { error } = await sb.from("fb_products").update(row).eq("id", id);
    if (error) throw new Error(error.message);
  },

  async remove(id: UUID): Promise<void> {
    const sb = getSupabase();
    const { error } = await sb.from("fb_products").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },
};

/** Distinct categories from the catalog, sorted. For the category dropdown. */
export function fbCategories(products: FbProduct[]): string[] {
  const set = new Set<string>();
  products.forEach((p) => { if (p.category) set.add(p.category); });
  return [...set].sort();
}
