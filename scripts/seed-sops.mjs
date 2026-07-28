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
//   node scripts/seed-sops.mjs staging "C:/path/to/SOPs"
//   node scripts/seed-sops.mjs prod    "C:/path/to/SOPs" --force
//
// Flags:
//   --force          re-upload and overwrite SOPs whose code already exists.
//                    Without it, existing codes are left alone and reported
//                    as skips.
//   --dry            parse and print the plan without touching Supabase.
//   --user <name>    owner/manager username, otherwise you're prompted.
//
// Auth: the script signs in as a real owner or manager with their username and
// 6-digit PIN — the same credentials they use in the console — and then writes
// through RLS exactly as that user would. It deliberately does NOT take a
// service-role key: nothing here needs to bypass RLS, and a bypass credential
// on a developer's machine is a standing risk. The PIN is prompted for and
// never echoed, never stored, and never passed as an argument (which would
// land it in your shell history).
//
// The anon key below is the public, browser-shipped key already committed in
// app/src/lib/env.ts — it identifies the project, it does not grant anything.
//
// Google-account users can't be used here: OAuth can't be scripted. Use an
// owner or manager who has a username + PIN.
//
// Filename contract: "BO-01 Counter Opening & Cash Float Set-up.pdf"
//   • the code before the first space is stored verbatim — it is what is
//     printed on the document header, so the console can never disagree with
//     the PDF a manager is holding;
//   • the two/three-letter prefix picks the area (see AREA_BY_PREFIX).
// ============================================================================

import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { createClient } from "@supabase/supabase-js";

// URL + anon key per project, mirroring app/src/lib/env.ts. Anon keys are
// public by Supabase's own classification — they ship in the browser bundle.
// If the project's JWT secret is ever rotated these change too: update them
// here and in env.ts together, or sign-in below starts failing.
const PROJECTS = {
  staging: {
    url: "https://lctkvmpzijaspaytunkm.supabase.co",
    anonKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjdGt2bXB6aWphc3BheXR1bmttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNTU0NDgsImV4cCI6MjA5NTYzMTQ0OH0.YeYegXQvX0l0FMABDgljs_bV_t9C66x77Y3kj2YZ55A",
  },
  prod: {
    url: "https://xkmjygegtpmmwwnyoufn.supabase.co",
    anonKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrbWp5Z2VndHBtbXd3bnlvdWZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4ODI2NTEsImV4cCI6MjA5NTQ1ODY1MX0.ILYBoN4OqFGIatTCTJ3hhfbGj6n8Q6e5LAhOVDDuTgo",
  },
};

const BUCKET = "sop-documents";

// Matches LOCAL_DOMAIN in app/src/lib/users.ts — username+PIN accounts are
// real Supabase auth users under a synthetic internal domain.
const LOCAL_DOMAIN = "local.abhinayacinemas.com";

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

// --user takes a value, so it is pulled out before the positionals are read.
const userIdx = argv.indexOf("--user");
const userArg = userIdx >= 0 ? argv[userIdx + 1] : undefined;
const [target, folder] = positional.filter((a) => a !== userArg);

const force = flags.has("--force");
const dry = flags.has("--dry");

if (!target || !PROJECTS[target] || !folder) {
  console.error(
    "Usage: node scripts/seed-sops.mjs <staging|prod> <folder> [--user <name>] [--force] [--dry]",
  );
  process.exit(1);
}

// ── prompts ─────────────────────────────────────────────────────────────────

function ask(question) {
  const rl = createInterface({ input: stdin, output: stdout });
  return new Promise((res) =>
    rl.question(question, (a) => {
      rl.close();
      res(a.trim());
    }),
  );
}

/** Same as ask(), but the typed characters are never echoed. */
function askHidden(question) {
  return new Promise((res) => {
    const rl = createInterface({ input: stdin, output: stdout });
    rl.question(question, (a) => {
      rl.close();
      stdout.write("\n");
      res(a.trim());
    });
    // question() has already printed the prompt; swallow everything after it
    // so the PIN never reaches the screen or the terminal scrollback.
    rl._writeToOutput = () => {};
  });
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

const project = PROJECTS[target];
const sb = createClient(project.url, project.anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Sign in as a real owner/manager. Everything below then goes through RLS as
// that user — the same path the console takes.
const username = userArg ?? (await ask(`${target} owner/manager username: `));
if (!username) {
  console.error("A username is required.");
  process.exit(1);
}
const pin = await askHidden("6-digit PIN (not shown): ");
if (!/^\d{6}$/.test(pin)) {
  console.error("PIN must be exactly 6 digits.");
  process.exit(1);
}

const email = `${username.toLowerCase()}@${LOCAL_DOMAIN}`;
const { error: authErr } = await sb.auth.signInWithPassword({ email, password: pin });
if (authErr) {
  console.error(
    /invalid login/i.test(authErr.message)
      ? "Wrong username or PIN."
      : `Sign-in failed: ${authErr.message}`,
  );
  process.exit(1);
}

// Fail early with a clear message rather than letting RLS reject 38 inserts
// one at a time.
const { data: me, error: meErr } = await sb
  .from("authorized_users")
  .select("email, role")
  .eq("email", email)
  .maybeSingle();
if (meErr || !me) {
  console.error(`${email} is not on the access list.`);
  await sb.auth.signOut();
  process.exit(1);
}
if (me.role !== "owner" && me.role !== "manager") {
  console.error(
    `${username} is a ${me.role}. Loading SOPs needs an owner or manager.`,
  );
  await sb.auth.signOut();
  process.exit(1);
}
console.log(`Signed in as ${username} (${me.role}) on ${target}.`);

// Only the cinemas this user can actually see — RLS does the scoping.
const { data: cinemas, error: cinemaErr } = await sb.from("cinemas").select("id, name");
if (cinemaErr) {
  console.error(`Could not read cinemas: ${cinemaErr.message}`);
  await sb.auth.signOut();
  process.exit(1);
}
if (!cinemas?.length) {
  console.error("No cinemas visible to this user — nothing to seed.");
  await sb.auth.signOut();
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
        updated_by: email,
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
          .insert({ ...row, created_by: email });
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

await sb.auth.signOut();

console.log(
  `\nDone. ${added} added, ${replaced} replaced, ${skipped} skipped, ${failed} failed.`,
);
process.exit(failed > 0 ? 1 : 0);
