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

// ── DSR (Daily Sales Report) CSV parser ────────────────────────────────
//
// Direct port of admin/dcr/js/03-fb.js parseDSR + parseCSV + normDate.
// Single-day POS export only — the multi-day bulk PDF parser is the
// future C6.3.

export interface ParsedDsr {
  date: DateISO;
  items: ParsedDsrItem[];
  summary: FbSummary & {
    takeAway?: number;
    netSalesWithoutTax?: number;
    discount?: number;
    complimentary?: number;
    promotional?: number;
    avgPerCover?: number;
    apt?: number;
  };
}

export interface ParsedDsrItem {
  sl: number;
  superCategory: string;
  category: string;
  name: string;
  qty: number;
  rate: number;
  discount: number;
  complimentary: number;
  promotional: number;
  netAmount: number;
  tax: number;
  totalAmount: number;
}

/** CSV parser that handles quoted fields containing commas + escaped "". */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0, cell = "", row: string[] = [], inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (c === '"') { inQ = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === '"')  { inQ = true; i++; continue; }
    if (c === ",")  { row.push(cell); cell = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; continue; }
    cell += c; i++;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Normalize a date string from various formats to YYYY-MM-DD. Returns '' if unrecognized. */
export function normDate(d: string): DateISO | "" {
  const s = (d || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s as DateISO;
  let m = s.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}` as DateISO;
  m = s.match(/^(\d{4})[\/](\d{2})[\/](\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}` as DateISO;
  m = s.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}` as DateISO;
  return "";
}

const cleanNum = (v: unknown): number => N(String(v ?? "0").replace(/,/g, ""));

/**
 * Parse a single-day DSR CSV into a date + items + summary. Refuses CSVs
 * that span more than one day; tell the user to upload one day at a time.
 *
 * Throws Error with a human-readable message on bad input.
 */
export function parseDsr(text: string): ParsedDsr {
  const rows = parseCsv(text);
  let fromDate: DateISO | "" = "", toDate: DateISO | "" = "";
  let headerIdx = -1;
  let headerRow: string[] | null = null;

  // 1) find the From/To date row + the column-header row.
  for (let i = 0; i < rows.length; i++) {
    const r = (rows[i] ?? []).map((x) => (x || "").trim());
    if (!fromDate) {
      for (let j = 0; j < r.length - 1; j++) {
        if (r[j]?.toLowerCase() === "from" && r[j + 2] && r[j + 2]!.toLowerCase() === "to") {
          fromDate = normDate(r[j + 1] || "");
          toDate = normDate(r[j + 3] || "");
          break;
        }
      }
    }
    if (headerIdx < 0 && (r[0] ?? "").toLowerCase().indexOf("sl. no") === 0) {
      headerIdx = i;
      headerRow = r;
    }
  }
  if (!fromDate) throw new Error("Could not find the From/To date row in the CSV.");
  if (toDate && fromDate !== toDate) {
    throw new Error(`CSV covers a range (${fromDate} to ${toDate}). Please upload one day at a time.`);
  }
  if (headerIdx < 0 || !headerRow) {
    throw new Error("Could not find the item table header (Sl. No., Super Category, ...).");
  }

  const H = headerRow.map((h) => (h || "").trim().toLowerCase());
  const col = (name: string) => H.indexOf(name.toLowerCase());
  const iSl   = col("sl. no.");
  const iSup  = col("super category");
  const iCat  = col("category");
  const iName = col("item name");
  const iQty  = col("quantity");
  const iRate = col("rate");
  const iDisc = col("discount");
  const iComp = col("complimentary");
  const iProm = col("promotional");
  const iNet  = col("net amount");
  const iTax  = col("tax");
  const iTot  = col("total amount");
  if (iName < 0 || iQty < 0) {
    throw new Error("Items table is missing required columns (Item Name, Quantity).");
  }

  const items: ParsedDsrItem[] = [];
  let k = headerIdx + 1;
  for (; k < rows.length; k++) {
    const rr = rows[k] ?? [];
    const first = (rr[0] ?? "").trim();
    const name = iName >= 0 ? (rr[iName] ?? "").trim() : "";
    if (!first && !name) break;       // blank separator
    if (!name) continue;              // skip rows without an item name
    items.push({
      sl:            iSl   >= 0 ? cleanNum(rr[iSl])  : items.length + 1,
      superCategory: iSup  >= 0 ? (rr[iSup] ?? "").trim() : "",
      category:      iCat  >= 0 ? (rr[iCat] ?? "").trim() : "",
      name,
      qty:           cleanNum(rr[iQty]),
      rate:          iRate >= 0 ? cleanNum(rr[iRate]) : 0,
      discount:      iDisc >= 0 ? cleanNum(rr[iDisc]) : 0,
      complimentary: iComp >= 0 ? cleanNum(rr[iComp]) : 0,
      promotional:   iProm >= 0 ? cleanNum(rr[iProm]) : 0,
      netAmount:     iNet  >= 0 ? cleanNum(rr[iNet])  : 0,
      tax:           iTax  >= 0 ? cleanNum(rr[iTax])  : 0,
      totalAmount:   iTot  >= 0 ? cleanNum(rr[iTot])  : 0,
    });
  }

  // 2) footer key/value rows after the items table
  const summary: ParsedDsr["summary"] = {};
  for (; k < rows.length; k++) {
    const rr = rows[k] ?? [];
    const key = (rr[0] ?? "").trim().toLowerCase();
    const val = (rr[1] ?? "").trim();
    if (!key) continue;
    if      (key === "bills")                        summary.bills              = cleanNum(val);
    else if (key === "take away")                    summary.takeAway           = cleanNum(val);
    else if (key === "gross sales")                  summary.grossSales         = cleanNum(val);
    else if (key === "complimentary")                summary.complimentary      = cleanNum(val);
    else if (key === "discount")                     summary.discount           = cleanNum(val);
    else if (key.indexOf("average per cover") === 0) summary.avgPerCover        = cleanNum(val);
    else if (key.indexOf("apt") === 0)               summary.apt                = cleanNum(val);
    else if (key.indexOf("promotional") === 0)       summary.promotional        = cleanNum(val);
    else if (key === "food sales")                   summary.foodSales          = cleanNum(val);
    else if (key === "beverages sales")              summary.beveragesSales     = cleanNum(val);
    else if (key === "net sales without tax")        summary.netSalesWithoutTax = cleanNum(val);
    else if (key === "add tax")                      summary.addTax             = cleanNum(val);
    else if (key === "net sales with tax")           summary.netSalesWithTax    = cleanNum(val);
  }

  // 3) fall back to computing from items when the footer is missing
  if (summary.grossSales === undefined) {
    summary.grossSales = round2(items.reduce((a, it) => a + it.totalAmount, 0));
  }
  if (summary.netSalesWithoutTax === undefined) {
    summary.netSalesWithoutTax = round2(items.reduce((a, it) => a + it.netAmount, 0));
  }
  if (summary.addTax === undefined) {
    summary.addTax = round2(items.reduce((a, it) => a + it.tax, 0));
  }
  if (summary.netSalesWithTax === undefined) {
    summary.netSalesWithTax = round2((summary.netSalesWithoutTax ?? 0) + (summary.addTax ?? 0));
  }
  if (summary.foodSales === undefined && summary.beveragesSales === undefined) {
    // No food/bev split in footer — treat the entire net as the "gross"
    // figure (matches the legacy fallback).
    summary.foodSales = summary.netSalesWithoutTax;
    summary.beveragesSales = 0;
  }

  return { date: fromDate as DateISO, items, summary };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Convert a ParsedDsr into the FbEntry shape the rest of the app uses. */
export function dsrToFbEntry(parsed: ParsedDsr): FbEntry {
  return {
    id: uid(),
    date: parsed.date,
    summary: parsed.summary,
    items: parsed.items.map((it) => ({
      name: it.name,
      qty: it.qty,
      netAmount: it.netAmount,
      category: it.category || it.superCategory || undefined,
    })),
    notes: "",
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
