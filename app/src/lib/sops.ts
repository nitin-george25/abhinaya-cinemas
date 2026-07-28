// ============================================================================
// SOPs — the Standard Operating Procedure library shown at
// Operations → Standard Operating Procedures.
//
// The fourteen areas are the fixed tab strip, taken from PART A of the SOP
// Library Master Plan. The SOP documents themselves live in the `public.sops`
// table (one row per document) with the PDF in the `sop-documents` storage
// bucket, so owners/managers can add to the library from the UI without a
// deploy — see migrations sops_00_schema / sops_02_storage.
//
// Normalized-only, same shape as lib/guides.ts: reads warn + return a safe
// default, writes throw.
// ============================================================================

import { getSupabase } from "./supabase";
import type { SopRow } from "./db-types";

export interface Sop {
  id: string;
  areaId: string;
  /** The SOP code exactly as printed on the document, e.g. "BO-01". */
  code: string;
  title: string;
  description: string | null;
  /** Public URL of the PDF. */
  docUrl: string;
  /** Path inside the sop-documents bucket, when the file was uploaded here. */
  storagePath: string | null;
  version: string;
}

export interface SopAreaDef {
  id: string;
  /** Short label for the tab strip. */
  label: string;
  /** The area's full name from the master plan, shown above the list. */
  fullName: string;
  /** The two-letter area prefix used in SOP codes (master plan §B3). */
  prefix: string;
}

export interface SopArea extends SopAreaDef {
  sops: Sop[];
}

/**
 * The fourteen SOP areas, in master-plan order. Kept in lockstep with the
 * area_id CHECK in migration sops_00_schema — add an area in both places.
 *
 * `prefix` is the code prefix the plan assigns to the area. Note that the
 * v1 projection documents were issued with a "PRJ-" prefix rather than the
 * plan's "PR-"; codes are stored as printed on each document, so both read
 * back correctly under this area.
 */
export const SOP_AREA_DEFS: SopAreaDef[] = [
  { id: "box-office",          label: "Box Office",     fullName: "Box Office & Ticketing",                 prefix: "BO" },
  { id: "fb",                  label: "F&B",            fullName: "Food & Beverage / Concessions",          prefix: "FB" },
  { id: "projection",          label: "Projection",     fullName: "Projection & Screening",                 prefix: "PR" },
  { id: "housekeeping",        label: "Housekeeping",   fullName: "Housekeeping & Cleanliness",             prefix: "HK" },
  { id: "front-of-house",      label: "Front of House", fullName: "Front-of-House & Guest Service",         prefix: "FH" },
  { id: "safety",              label: "Safety",         fullName: "Safety, Security & Emergency",           prefix: "SE" },
  { id: "cash",                label: "Cash",           fullName: "Cash, Banking & Daily Close (DCR)",      prefix: "CA" },
  { id: "inventory",           label: "Inventory",      fullName: "Inventory & Purchasing",                 prefix: "IN" },
  { id: "people",              label: "People",         fullName: "People & Shift Management",              prefix: "PE" },
  { id: "open-close",          label: "Open & Close",   fullName: "Site Opening & Closing",                 prefix: "OC" },
  { id: "maintenance",         label: "Maintenance",    fullName: "Maintenance & Facilities",               prefix: "MF" },
  { id: "customer-experience", label: "Experience",     fullName: "Customer Experience & Grievance",        prefix: "CX" },
  { id: "compliance",          label: "Compliance",     fullName: "Compliance & Statutory",                 prefix: "CO" },
  { id: "marketing",           label: "Marketing",      fullName: "Marketing & Local Promotion",            prefix: "MK" },
];

export const SOP_AREA_IDS = SOP_AREA_DEFS.map((a) => a.id);

/** First area slug — a safe fallback when nothing is selected yet. */
export const DEFAULT_SOP_AREA_ID = SOP_AREA_DEFS[0]!.id;

export const SOP_BUCKET = "sop-documents";

// ── mapper ──────────────────────────────────────────────────────────────────

function toSop(r: SopRow): Sop {
  return {
    id: r.id,
    areaId: r.area_id,
    code: r.code,
    title: r.title,
    description: r.description,
    docUrl: r.doc_url,
    storagePath: r.storage_path,
    version: r.version,
  };
}

// ── read (warn + safe default, never throws) ────────────────────────────────

/**
 * Every SOP for a cinema, in display order. Returns [] (and warns) on error so
 * the page still renders its area tabs.
 */
export async function listSops(cinemaId: string): Promise<Sop[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("sops")
    .select("*")
    .eq("cinema_id", cinemaId)
    .order("sort_order", { ascending: true })
    .order("code", { ascending: true });
  if (error) {
    console.warn("[sops] listSops", error.message);
    return [];
  }
  return ((data as SopRow[] | null) ?? []).map(toSop);
}

/**
 * Group a flat SOP list into the fixed area tabs. Areas with nothing written
 * yet come back empty — the page shows a "not written yet" state, which is
 * itself useful: it is the library's own progress bar.
 */
export function groupSops(sops: Sop[]): SopArea[] {
  return SOP_AREA_DEFS.map((def) => ({
    ...def,
    sops: sops.filter((s) => s.areaId === def.id),
  }));
}

// ── write (throws on error) ─────────────────────────────────────────────────

export interface NewSopInput {
  areaId: string;
  code: string;
  title: string;
  description: string;
  /** The SOP PDF. */
  file: File;
  version?: string;
}

/**
 * Upload an SOP document and record it. Owner/manager only (enforced by RLS on
 * both the table and the bucket). New SOPs sort after the existing ones in
 * their area. Returns the created SOP.
 */
export async function addSop(
  cinemaId: string,
  input: NewSopInput,
  createdBy: string,
): Promise<Sop> {
  const sb = getSupabase();
  const code = input.code.trim().toUpperCase();

  // Append: one past the current max sort_order in this area.
  const { data: maxRow } = await sb
    .from("sops")
    .select("sort_order")
    .eq("cinema_id", cinemaId)
    .eq("area_id", input.areaId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = ((maxRow as { sort_order: number } | null)?.sort_order ?? -1) + 1;

  // uuid-prefixed path: stable, unguessable, and never collides on re-upload.
  const safeName = input.file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${cinemaId}/${input.areaId}/${crypto.randomUUID()}_${safeName}`;

  const up = await sb.storage
    .from(SOP_BUCKET)
    .upload(path, input.file, { upsert: false, contentType: "application/pdf" });
  if (up.error) throw new Error(up.error.message);

  const { data: pub } = sb.storage.from(SOP_BUCKET).getPublicUrl(path);

  const { data, error } = await sb
    .from("sops")
    .insert({
      cinema_id: cinemaId,
      area_id: input.areaId,
      code,
      title: input.title.trim(),
      description: input.description.trim() || null,
      doc_url: pub.publicUrl,
      storage_path: path,
      version: (input.version ?? "v1.0").trim() || "v1.0",
      sort_order: nextSort,
      created_by: createdBy,
      updated_by: createdBy,
    })
    .select("*")
    .single();
  if (error) {
    // Don't leave an orphan object behind if the row insert was rejected.
    await sb.storage.from(SOP_BUCKET).remove([path]);
    throw new Error(error.message);
  }
  return toSop(data as SopRow);
}

/**
 * Remove an SOP and its stored document. Owner/manager only (RLS). The object
 * is removed first only if the row delete succeeds, so a failed delete never
 * leaves a row pointing at a missing file.
 */
export async function deleteSop(sop: Sop): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("sops").delete().eq("id", sop.id);
  if (error) throw new Error(error.message);
  if (sop.storagePath) {
    await sb.storage.from(SOP_BUCKET).remove([sop.storagePath]);
  }
}
