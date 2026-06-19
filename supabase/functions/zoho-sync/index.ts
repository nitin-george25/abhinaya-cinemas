// ============================================================================
// zoho-sync — scheduled OAuth pull (reconciliation) + one-time backfill.
//
// Why both this AND zoho-webhook? Workflow-rule webhooks only fire for records
// created/edited AFTER the rule exists, and delivery is best-effort with no
// signature. This pull (a) seeds full history once (?mode=backfill) and
// (b) runs on a cron to catch anything a webhook dropped.
//
// Strategy:
//   • incremental (default): list sorted by last_modified_time DESC; process
//     records newer than the stored watermark; stop at the first older one.
//   • backfill (?mode=backfill): list ASC from the start; process everything;
//     skip records we already hold at >= their last_modified (cheap, so re-runs
//     after a timeout resume safely). Watermark advances only when the full
//     history has been scanned.
// Both share _shared/zoho.ts upsert + the fb_entries recompute for sales.
//
// Auth: verify_jwt=true — the cron sends the project anon key (a valid JWT);
// manual `supabase functions invoke zoho-sync` sends the caller's JWT.
// When Zoho secrets are absent (e.g. staging), it no-ops with 200 so the cron
// never errors.
// ============================================================================

import {
  deadLetter,
  getRecordById,
  mapCinema,
  type Module,
  normalize,
  recomputeSalesDays,
  serviceClient,
  upsertInvoice,
  zohoEnv,
  zohoGet,
  type ZohoEnvT,
} from "../_shared/zoho.ts";

const MODULES: Module[] = ["bills", "invoices"];
const PER_PAGE = 200;
const MAX_PAGES_PER_RUN = 60;      // 60 * 200 = 12k records scanned per invocation
const MAX_UPSERTS_PER_RUN = 120;   // bound new Zoho detail fetches within the time budget

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const olderOrEqual = (a: string | null, b: string | null): boolean =>
  !!a && !!b && new Date(a).getTime() <= new Date(b).getTime();

// deno-lint-ignore no-explicit-any
type Svc = ReturnType<typeof serviceClient>;

async function pullModule(
  svc: Svc,
  env: ZohoEnvT,
  module: Module,
  backfill: boolean,
): Promise<{ scanned: number; upserts: number; recomputed: number; exhausted: boolean }> {
  const listKey = module;                       // 'bills' | 'invoices'
  const idField = module === "bills" ? "bill_id" : "invoice_id";

  // Watermark (org-wide, per module).
  const { data: stateRow } = await svc
    .from("zoho_sync_state").select("last_modified")
    .eq("zoho_org_id", env.orgId).eq("module", module).maybeSingle();
  const watermark = backfill ? null : ((stateRow?.last_modified as string | null) ?? null);

  const affected = new Map<string, Set<string>>();   // cinemaId → sale dates
  const addAffected = (cinemaId: string, d: string | null) => {
    if (!d) return;
    (affected.get(cinemaId) ?? affected.set(cinemaId, new Set()).get(cinemaId)!).add(d);
  };

  let page = 1;
  let scanned = 0;
  let upserts = 0;
  let maxMod: string | null = watermark;
  let stop = false;
  let exhausted = false;
  let hitWatermark = false;   // incremental: stopped because we reached the watermark

  while (!stop && page <= MAX_PAGES_PER_RUN) {
    const j = await zohoGet(env, `/${listKey}`, {
      sort_column: "last_modified_time",
      sort_order: backfill ? "A" : "D",
      per_page: String(PER_PAGE),
      page: String(page),
    });
    // deno-lint-ignore no-explicit-any
    const recs: any[] = j?.[listKey] ?? [];
    const hasMore = !!j?.page_context?.has_more_page;

    for (const rec of recs) {
      scanned++;
      const lm = (rec.last_modified_time as string) ?? null;

      // Incremental DESC: once we reach a record at/older than the watermark,
      // every remaining record is older too — stop the whole pull.
      if (!backfill && watermark && olderOrEqual(lm, watermark)) { stop = true; hitWatermark = true; break; }

      const orgId = (rec.organization_id as string) ?? env.orgId;
      const branchId = (rec.branch_id as string) ?? null;
      const zohoId = String(rec[idField] ?? "");
      if (!zohoId) continue;

      const cinemaId = await mapCinema(svc, orgId, branchId);
      if (!cinemaId) {
        await deadLetter(svc, "sync", module, rec, "no cinema mapping for org/branch", { orgId, branchId, zohoId });
        continue;
      }

      // Already hold this version? (cheap DB check — keeps backfill re-runs fast)
      const { data: ex } = await svc
        .from("invoices").select("zoho_last_modified")
        .eq("cinema_id", cinemaId).eq("zoho_id", zohoId).maybeSingle();
      const have = (ex?.zoho_last_modified as string | null) ?? null;
      if (!(have && lm && olderOrEqual(lm, have))) {
        // Fetch the full record (list views omit line_items) and upsert.
        const full = (await getRecordById(env, module, zohoId)) ?? rec;
        const norm = normalize(module, cinemaId, full);
        if (!norm) {
          await deadLetter(svc, "sync", module, full, "normalize returned null (missing id)", { orgId, branchId, zohoId });
        } else {
          const res = await upsertInvoice(svc, norm);
          // Recompute only days we actually wrote, and count only real writes
          // toward the per-run cap (a guard-skip is cheap).
          if (res.written) {
            if (module === "invoices") {
              addAffected(cinemaId, norm.saleDate);
              addAffected(cinemaId, res.prevDate);
            }
            upserts++;
          }
        }
      }

      // NaN-safe max-modified tracking (invalid dates never advance the watermark).
      const lmMs = lm ? new Date(lm).getTime() : NaN;
      if (!Number.isNaN(lmMs)) {
        const maxMs = maxMod ? new Date(maxMod).getTime() : NaN;
        if (Number.isNaN(maxMs) || lmMs > maxMs) maxMod = lm;
      }
      if (upserts >= MAX_UPSERTS_PER_RUN) { stop = true; break; }
    }

    if (!hasMore) { exhausted = true; break; }
    page++;
  }

  // Recompute every affected sales day from the now-current invoices table.
  let recomputed = 0;
  for (const [cinemaId, dates] of affected) {
    await recomputeSalesDays(svc, cinemaId, [...dates]);
    recomputed += dates.size;
  }

  // Advance the watermark only at a CLEAN stop, so a run capped by
  // MAX_UPSERTS_PER_RUN never skips records it didn't reach:
  //   • backfill    → only when the whole history was scanned (exhausted).
  //   • incremental → when exhausted OR we naturally reached the watermark
  //     boundary; NOT when we stopped at the upsert cap (resume next run).
  const cleanStop = backfill ? exhausted : (exhausted || hitWatermark);
  if (maxMod && cleanStop) {
    await svc.from("zoho_sync_state").upsert(
      { zoho_org_id: env.orgId, module, last_modified: maxMod, last_run_at: new Date().toISOString() },
      { onConflict: "zoho_org_id,module" },
    );
  }

  return { scanned, upserts, recomputed, exhausted };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return reply({ error: "method not allowed" }, 405);
  }

  const env = zohoEnv();
  if (!env) return reply({ skipped: "Zoho secrets not configured" }, 200);  // staging no-op

  const url = new URL(req.url);
  const backfill = url.searchParams.get("mode") === "backfill";
  const only = url.searchParams.get("module"); // optional: limit to one module

  const svc = serviceClient();
  const out: Record<string, unknown> = { mode: backfill ? "backfill" : "incremental" };
  try {
    for (const m of MODULES) {
      if (only && only !== m) continue;
      out[m] = await pullModule(svc, env, m, backfill);
    }
    return reply({ ok: true, ...out });
  } catch (e) {
    console.error("zoho-sync error", e);
    return reply({ ok: false, error: (e as Error).message, ...out }, 500);
  }
});
