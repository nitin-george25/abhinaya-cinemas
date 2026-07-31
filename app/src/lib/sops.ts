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

/**
 * Code prefix → area slug, for reading a dropped file's area off its name.
 * "PRJ" is here because the v1 projection documents were issued with that
 * prefix rather than the master plan's "PR" — codes are recorded as printed,
 * so both must resolve to the same area.
 */
const AREA_BY_PREFIX: Record<string, string> = {
  BO: "box-office",
  FB: "fb",
  PR: "projection",
  PRJ: "projection",
  HK: "housekeeping",
  FH: "front-of-house",
  SE: "safety",
  CA: "cash",
  IN: "inventory",
  PE: "people",
  OC: "open-close",
  MF: "maintenance",
  CX: "customer-experience",
  CO: "compliance",
  MK: "marketing",
};

/**
 * The "linked daily check / metric" each SOP feeds, from PART A of the master
 * plan — the bridge from the written standard to the monthly audit. Used to
 * pre-fill the description when a matching code is uploaded; always editable
 * before it is saved. Codes not listed here simply start blank.
 */
const METRIC_BY_CODE: Record<string, string> = {
  "BO-01": "Float verified & signed",
  "BO-02": "Queue wait ≤ 4 min",
  "BO-03": "Valid-scan rate",
  "BO-04": "Change log complete",
  "BO-05": "Refund within policy",
  "BO-06": "Settlement matched",
  "BO-07": "Comp register signed",
  "BO-08": "Board updated",
  "BO-09": "Advance & terms logged",
  "BO-10": "Manual log reconciled",
  "BO-11": "Handover sheet signed",
  "FB-01": "Display & price board ready",
  "FB-02": "Freshness / hold time",
  "FB-03": "Machine hygiene check",
  "FB-04": "Order accuracy ≥ target",
  "FB-05": "Upsell / combo rate",
  "FB-06": "Hygiene score",
  "FB-07": "GRN & FIFO adherence",
  "FB-08": "Temp / expiry log",
  "FB-09": "Wastage % vs target",
  "FB-10": "Cleaning sign-off",
  "FB-11": "Stock variance",
  "HK-01": "Cycle log signed",
  "HK-02": "Cleanliness score ≥ 90%",
  "HK-03": "Deep-clean sign-off",
  "HK-04": "Turnaround within gap",
  "HK-05": "Segregation compliance",
  "PRJ-01": "Start-up log complete",
  "PRJ-02": "Playlist verified",
  "PRJ-03": "Schedule matches board",
  "PRJ-04": "Pre-show check done",
  "PRJ-05": "≥ 98% start within 2 min",
  "PRJ-06": "Compliance reel played",
  "PRJ-07": "Fault-response time",
  "PRJ-08": "Incident logged",
  "PRJ-09": "Hours logged",
  "PRJ-10": "PM calendar met",
  "PRJ-11": "Turnaround within gap",
};

export interface ParsedSopFile {
  areaId: string | null;
  code: string;
  title: string;
  description: string;
}

/**
 * Read an SOP's area, code and title off its file name. The library's naming
 * convention (master plan §B3) is "<CODE> <Title>.pdf", e.g.
 *   "BO-01 Counter Opening & Cash Float Set-up.pdf"
 * so a folder of correctly named documents can be dropped in and filed without
 * anyone retyping thirty-eight titles.
 *
 * Anything that doesn't match comes back with areaId null and the bare file
 * name as the title — the upload form shows those rows for the user to fix
 * rather than guessing.
 */
export function parseSopFileName(fileName: string): ParsedSopFile {
  const stem = fileName.replace(/\.pdf$/i, "");
  const m = /^([A-Za-z]{2,3})-(\d{1,3})\s+(.+)$/.exec(stem);
  if (!m) {
    return { areaId: null, code: "", title: stem.trim(), description: "" };
  }
  const prefix = m[1]!.toUpperCase();
  const code = `${prefix}-${m[2]}`;
  return {
    areaId: AREA_BY_PREFIX[prefix] ?? null,
    code,
    title: m[3]!.trim(),
    description: METRIC_BY_CODE[code] ?? "",
  };
}

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
 * Every SOP for a cinema. Returns [] (and warns) on error so the page still
 * renders its area rail. Display order is settled by groupSops.
 */
export async function listSops(cinemaId: string): Promise<Sop[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("sops")
    .select("*")
    .eq("cinema_id", cinemaId)
    .order("code", { ascending: true });
  if (error) {
    console.warn("[sops] listSops", error.message);
    return [];
  }
  return ((data as SopRow[] | null) ?? []).map(toSop);
}

const CODE_RE = /^([A-Z]+)[-\s]?(\d+)?(.*)$/;

/**
 * Order SOPs the way their codes read: FB-01, FB-02, … FB-11.
 *
 * Plain text ordering would file FB-11 before FB-2, so the number is compared
 * numerically rather than character by character. Codes are zero-padded today,
 * which hides the problem, but nothing stops someone typing "FB-5" in the
 * upload form and this keeps that in the right place.
 *
 * The letter prefix is compared first, so an area holding more than one prefix
 * stays grouped — Projection currently carries the legacy PRJ-xx documents and
 * would take PR-xx if those are ever reissued.
 */
export function compareSopCodes(a: string, b: string): number {
  const ma = CODE_RE.exec(a.trim().toUpperCase());
  const mb = CODE_RE.exec(b.trim().toUpperCase());
  if (!ma || !mb) return a.localeCompare(b);

  const byPrefix = ma[1]!.localeCompare(mb[1]!);
  if (byPrefix !== 0) return byPrefix;

  // A code with no number at all sorts last rather than as zero.
  const na = ma[2] ? parseInt(ma[2], 10) : Number.MAX_SAFE_INTEGER;
  const nb = mb[2] ? parseInt(mb[2], 10) : Number.MAX_SAFE_INTEGER;
  if (na !== nb) return na - nb;

  // Same number — a suffix like "FB-02a" breaks the tie.
  return (ma[3] ?? "").localeCompare(mb[3] ?? "");
}

/**
 * Group a flat SOP list into the fixed area rail, each area's documents in
 * code order. Areas with nothing written yet come back empty — the page shows
 * a "not written yet" state, which is itself useful: it is the library's own
 * progress bar.
 */
export function groupSops(sops: Sop[]): SopArea[] {
  return SOP_AREA_DEFS.map((def) => ({
    ...def,
    sops: sops
      .filter((s) => s.areaId === def.id)
      .sort((a, b) => compareSopCodes(a.code, b.code)),
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
 * both the table and the bucket). Returns the created SOP.
 *
 * No sort_order is computed: documents display in code order, so an upload
 * lands in its numbered place regardless of when it arrived. The column keeps
 * its default and is left for a future manual override.
 */
export async function addSop(
  cinemaId: string,
  input: NewSopInput,
  createdBy: string,
): Promise<Sop> {
  const sb = getSupabase();
  const code = input.code.trim().toUpperCase();

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
 * Replace an existing SOP's document — the revision path from §B3, where a
 * fix bumps v1.0 to v1.1 and a rewrite becomes v2.0. Uploads the new file,
 * repoints the row, and only then removes the old object, so a failure part-way
 * never leaves the row pointing at a file that is gone.
 */
export async function replaceSopDocument(
  cinemaId: string,
  sop: Sop,
  input: { file: File; title?: string; description?: string; version?: string },
  updatedBy: string,
): Promise<Sop> {
  const sb = getSupabase();

  const safeName = input.file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${cinemaId}/${sop.areaId}/${crypto.randomUUID()}_${safeName}`;

  const up = await sb.storage
    .from(SOP_BUCKET)
    .upload(path, input.file, { upsert: false, contentType: "application/pdf" });
  if (up.error) throw new Error(up.error.message);

  const { data: pub } = sb.storage.from(SOP_BUCKET).getPublicUrl(path);

  const patch: Record<string, string> = {
    doc_url: pub.publicUrl,
    storage_path: path,
    updated_by: updatedBy,
  };
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.description !== undefined) {
    patch.description = input.description.trim();
  }
  if (input.version !== undefined && input.version.trim()) {
    patch.version = input.version.trim();
  }

  const { data, error } = await sb
    .from("sops")
    .update(patch)
    .eq("id", sop.id)
    .select("*")
    .single();
  if (error) {
    await sb.storage.from(SOP_BUCKET).remove([path]);
    throw new Error(error.message);
  }

  // Safe now: the row points at the new object.
  if (sop.storagePath) {
    await sb.storage.from(SOP_BUCKET).remove([sop.storagePath]);
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
