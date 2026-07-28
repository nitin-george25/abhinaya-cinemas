#!/usr/bin/env node
// ============================================================================
// scripts/seed-sops.mjs — bulk-load the branded SOP PDFs into the library.
//
// One-time (and repeatable) loader for Operations → Standard Operating
// Procedures. Reads a folder of SOP PDFs named "<CODE> <Title>.pdf", uploads
// each to the `sop-documents` bucket, and inserts a row in `public.sops` for
// every cinema.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=… node scripts/seed-sops.mjs staging "C:/path/to/SOPs"
//   SUPABASE_SERVICE_ROLE_KEY=… node scripts/seed-sops.mjs prod    "C:/path/to/SOPs" --force
//
// Flags:
//   --force   re-upload and overwrite SOPs whose code already exists.
//             Without it, existing codes are left alone and reported as skips.
//   --dry     parse and print the plan without touching Supabase.
//
// The service-role key is required because the bucket and table are
// owner/manager-gated by RLS and this runs outside a user session. Get it from
// the Supabase dashboard → Project Settings → API. Never commit it.
//
// Filename contract: "BO-01 Counter Opening & Cash Float Set-up.pdf"
//   • the code before the first space is stored verbatim — it is what is
//     printed on the document header, so the console can never disagree with
//     the PDF a manager is holding;
//   • the two/three-letter prefix picks the area (see AREA_BY_PREFIX).
// ============================================================================

import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const PROJECTS = {
  staging: "https://lctkvmpzijaspaytunkm.supabase.co",
  prod: "https://xkmjygegtpmmwwnyoufn.supabase.co",
};

const BUCKET = "sop-documents";

// Code prefix → area slug. Kept in lockstep with SOP_AREA_DEFS in
// app/src/lib/sops.ts. "PRJ" is here because the v1 projection documents were
// issued with that prefix rather than the master plan's "PR".
const AREA_BY_PREFIX = {
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

// The "linked daily check / metric" from PART A of the master plan — the
// bridge from the written standard to the monthly audit. Keyed by the code as
// delivered. Anything not listed here loads with no description.
const METRIC_BY_CODE = {
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

// ── args ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--"));
const [target, folder] = positional;

const force = flags.has("--force");
const dry = flags.has("--dry");

if (!target || !PROJECTS[target] || !folder) {
  console.error(
    "Usage: SUPABASE_SERVICE_ROLE_KEY=… node scripts/seed-sops.mjs <staging|prod> <folder> [--force] [--dry]",
  );
  process.exit(1);
}

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey && !dry) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is not set.");
  process.exit(1);
}

// ── parse the folder ────────────────────────────────────────────────────────

/** "BO-01 Counter Opening & Cash Float Set-up.pdf" → {code, title, areaId}. */
function parseName(fileName) {
  const stem = basename(fileName, ".pdf");
  const m = /^([A-Za-z]{2,3})-(\d{1,3})\s+(.+)$/.exec(stem);
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  const areaId = AREA_BY_PREFIX[prefix];
  if (!areaId) return null;
  return {
    code: `${prefix}-${m[2]}`,
    title: m[3].trim(),
    areaId,
  };
}

const entries = (await readdir(folder))
  .filter((f) => f.toLowerCase().endsWith(".pdf"))
  .sort();

const parsed = [];
const unparsed = [];
for (const f of entries) {
  const p = parseName(f);
  if (p) parsed.push({ ...p, fileName: f });
  else unparsed.push(f);
}

console.log(`Found ${entries.length} PDF(s) in ${folder}`);
if (unparsed.length) {
  console.warn(
    `  ${unparsed.length} skipped — name does not match "<CODE> <Title>.pdf":`,
  );
  for (const f of unparsed) console.warn(`    · ${f}`);
}
for (const p of parsed) {
  console.log(`  ${p.code.padEnd(7)} ${p.areaId.padEnd(20)} ${p.title}`);
}

if (dry) {
  console.log("\n--dry: nothing uploaded.");
  process.exit(0);
}

// ── load ────────────────────────────────────────────────────────────────────

const sb = createClient(PROJECTS[target], serviceKey, {
  auth: { persistSession: false },
});

const { data: cinemas, error: cinemaErr } = await sb.from("cinemas").select("id, name");
if (cinemaErr) {
  console.error(`Could not read cinemas: ${cinemaErr.message}`);
  process.exit(1);
}
if (!cinemas?.length) {
  console.error("No cinemas found — nothing to seed.");
  process.exit(1);
}

let added = 0;
let replaced = 0;
let skipped = 0;
let failed = 0;

for (const cinema of cinemas) {
  console.log(`\n→ ${cinema.name ?? cinema.id}`);

  const { data: existingRows } = await sb
    .from("sops")
    .select("id, area_id, code, storage_path")
    .eq("cinema_id", cinema.id);
  const existing = new Map(
    (existingRows ?? []).map((r) => [`${r.area_id}/${r.code}`, r]),
  );

  for (const [i, p] of parsed.entries()) {
    const key = `${p.areaId}/${p.code}`;
    const prior = existing.get(key);
    if (prior && !force) {
      skipped++;
      console.log(`   skip    ${p.code} (already loaded)`);
      continue;
    }

    try {
      const bytes = await readFile(join(folder, p.fileName));
      const safeName = p.fileName.replace(/[^\w.\-]+/g, "_");
      const path = `${cinema.id}/${p.areaId}/${crypto.randomUUID()}_${safeName}`;

      const up = await sb.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: "application/pdf", upsert: false });
      if (up.error) throw new Error(up.error.message);

      const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);

      const row = {
        cinema_id: cinema.id,
        area_id: p.areaId,
        code: p.code,
        title: p.title,
        description: METRIC_BY_CODE[p.code] ?? null,
        doc_url: pub.publicUrl,
        storage_path: path,
        version: "v1.0",
        sort_order: i,
        updated_by: "seed-sops",
      };

      if (prior) {
        const { error } = await sb.from("sops").update(row).eq("id", prior.id);
        if (error) throw new Error(error.message);
        // Old object is only removed once the row points at the new one.
        if (prior.storage_path) {
          await sb.storage.from(BUCKET).remove([prior.storage_path]);
        }
        replaced++;
        console.log(`   replace ${p.code} ${p.title}`);
      } else {
        const { error } = await sb
          .from("sops")
          .insert({ ...row, created_by: "seed-sops" });
        if (error) throw new Error(error.message);
        added++;
        console.log(`   add     ${p.code} ${p.title}`);
      }
    } catch (e) {
      failed++;
      console.error(`   FAIL    ${p.code} — ${e.message}`);
    }
  }
}

console.log(
  `\nDone. ${added} added, ${replaced} replaced, ${skipped} skipped, ${failed} failed.`,
);
process.exit(failed > 0 ? 1 : 0);
