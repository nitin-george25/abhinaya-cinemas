// ============================================================================
// zoho-webhook — real-time inbound from Zoho Books Workflow Rules.
//
// Two Zoho Workflow Rules (one on Bills, one on Invoices), each "Created or
// Edited / every time", POST the full record here as a Default Payload. Wire
// the module into the URL: …/functions/v1/zoho-webhook?module=bills (and
// ?module=invoices); we also detect it from the payload as a fallback.
//
// Security: Zoho can't send a Supabase JWT → verify_jwt=false. Every request
// must carry the shared secret in the `x-webhook-secret` header (or ?secret=),
// compared in constant time against ZOHO_WEBHOOK_SECRET. (Zoho Books does not
// HMAC-sign webhook bodies, so a shared secret is the practical auth.)
//
// The service-role key performs the upsert. Idempotent on (cinema_id, zoho_id)
// with a last-modified guard, so Zoho's at-least-once delivery + re-edits all
// converge. Sales invoices additionally recompute that day's fb_entries.
//
// Secrets: ZOHO_WEBHOOK_SECRET (required). For the thin-payload line-item
// fallback + org→cinema, also ZOHO_CLIENT_ID/SECRET, ZOHO_REFRESH_TOKEN,
// ZOHO_ORG_ID, ZOHO_DC.
// ============================================================================

import {
  deadLetter,
  getRecordById,
  mapCinema,
  type Module,
  normalize,
  recomputeSalesDays,
  safeEqual,
  serviceClient,
  upsertInvoice,
  zohoEnv,
} from "../_shared/zoho.ts";

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
function detectModule(url: URL, doc: any): Module | null {
  const q = url.searchParams.get("module");
  if (q === "bills" || q === "invoices") return q;
  if (doc?.bill_id) return "bills";
  if (doc?.invoice_id) return "invoices";
  return null;
}

// Zoho "Default Payload" usually posts the record fields at top level, but some
// configurations wrap them under a key. Unwrap defensively.
// deno-lint-ignore no-explicit-any
function unwrap(body: any): any {
  if (!body || typeof body !== "object") return body;
  return body.bill ?? body.invoice ?? body.data ?? body;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply({ error: "method not allowed" }, 405);

  const SECRET = Deno.env.get("ZOHO_WEBHOOK_SECRET");
  if (!SECRET) return reply({ error: "server not configured" }, 500);

  const url = new URL(req.url);
  const provided = req.headers.get("x-webhook-secret") ?? url.searchParams.get("secret") ?? "";
  if (!safeEqual(provided, SECRET)) return reply({ error: "invalid secret" }, 401);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); }
  catch { return reply({ error: "invalid JSON" }, 400); }

  let doc = unwrap(body);
  const module = detectModule(url, doc);
  if (!module) return reply({ error: "could not determine module (pass ?module=bills|invoices)" }, 400);

  const svc = serviceClient();
  const env = zohoEnv();

  const orgId = (doc.organization_id as string) ?? env?.orgId ?? null;
  const branchId = (doc.branch_id as string) ?? null;
  const zohoId = String((module === "bills" ? doc.bill_id : doc.invoice_id) ?? "");

  // Map to a cinema. An unmapped branch is parked, not guessed.
  const cinemaId = await mapCinema(svc, orgId, branchId);
  if (!cinemaId) {
    await deadLetter(svc, "webhook", module, body, "no cinema mapping for org/branch", { orgId, branchId, zohoId });
    return reply({ ok: false, parked: "unmapped org/branch" }, 200);
  }

  try {
    // Thin payload (no line items)? Re-fetch the full record if we can.
    if ((!doc.line_items || doc.line_items.length === 0) && env && zohoId) {
      const full = await getRecordById(env, module, zohoId);
      if (full) doc = full;
    }

    const norm = normalize(module, cinemaId, doc);
    if (!norm) {
      await deadLetter(svc, "webhook", module, body, "normalize returned null (missing id)", { orgId, branchId, zohoId });
      return reply({ ok: false, parked: "unparseable record" }, 200);
    }

    const res = await upsertInvoice(svc, norm);
    // Recompute the day(s) ONLY when we actually wrote — a guard-skipped
    // (stale) delivery must not trigger a recompute that could clear a day.
    if (norm.header.type === "sales" && res.written) {
      await recomputeSalesDays(svc, cinemaId, [norm.saleDate, res.prevDate]);
    }
    return reply({ ok: true, module, zohoId, written: res.written });
  } catch (e) {
    // Unexpected/transient error → 500 so Zoho retries (idempotent on retry).
    console.error("zoho-webhook processing error", e);
    return reply({ error: (e as Error).message }, 500);
  }
});
