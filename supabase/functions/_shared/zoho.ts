// ============================================================================
// _shared/zoho.ts — Zoho Books integration core, shared by zoho-webhook
// (real-time) and zoho-sync (scheduled pull / backfill).
//
// SHARED CODE, not a deployable function — the leading-underscore dir is
// skipped by `supabase functions deploy` and bundled into each importer.
//
// Responsibilities:
//   • OAuth2 self-client token refresh (cached in module scope).
//   • org/branch → cinema mapping (public.zoho_orgs); dead-letters on a miss.
//   • normalize a Zoho Bill (purchase) / Invoice (sales) → our `invoices` row
//     + `invoice_line_items` rows.
//   • idempotent upsert keyed on (cinema_id, zoho_id) with a last-modified
//     guard, so webhook retries / re-edits / pull overlap all converge.
//   • recompute a day's F&B aggregate (fb_entries, source='zoho') from all
//     type='sales' rows for that cinema+date — the bridge into the existing
//     daily F&B model that Dashboard / reports / history read.
//
// Secrets (Edge Function secrets — supabase secrets set ...):
//   ZOHO_WEBHOOK_SECRET, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET,
//   ZOHO_REFRESH_TOKEN, ZOHO_ORG_ID, ZOHO_DC (default 'in').
// ============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type Module = "bills" | "invoices";

// ── Env / service client ─────────────────────────────────────────────────────

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured");
  return createClient(url, key);
}

interface ZohoEnv {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  orgId: string;
  dc: string;            // 'in' | 'com' | 'eu' | ...
}

/** Exported alias so importing functions can type a non-null ZohoEnv value. */
export type ZohoEnvT = ZohoEnv;

export function zohoEnv(): ZohoEnv | null {
  const clientId = Deno.env.get("ZOHO_CLIENT_ID");
  const clientSecret = Deno.env.get("ZOHO_CLIENT_SECRET");
  const refreshToken = Deno.env.get("ZOHO_REFRESH_TOKEN");
  const orgId = Deno.env.get("ZOHO_ORG_ID");
  if (!clientId || !clientSecret || !refreshToken || !orgId) return null;
  return { clientId, clientSecret, refreshToken, orgId, dc: Deno.env.get("ZOHO_DC") ?? "in" };
}

export const accountsHost = (dc: string) => `https://accounts.zoho.${dc}`;
export const apiHost = (dc: string) => `https://www.zohoapis.${dc}`;

// ── Constant-time secret compare (webhook auth) ──────────────────────────────

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// ── OAuth token (cached in module scope; ~1h validity) ───────────────────────

let _token: { value: string; expiresAt: number } | null = null;

export async function getAccessToken(env: ZohoEnv, force = false): Promise<string> {
  const now = Date.now();
  if (!force && _token && _token.expiresAt > now + 60_000) return _token.value;
  const url = `${accountsHost(env.dc)}/oauth/v2/token`;
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: env.refreshToken,
    client_id: env.clientId,
    client_secret: env.clientSecret,
  });
  const r = await fetch(`${url}?${params.toString()}`, { method: "POST" });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    throw new Error(`Zoho token refresh failed: ${r.status} ${JSON.stringify(j)}`);
  }
  const ttl = (Number(j.expires_in) || 3600) * 1000;
  _token = { value: j.access_token as string, expiresAt: now + ttl };
  return _token.value;
}

/** Authenticated GET against the Books API. Retries once on 401. */
// deno-lint-ignore no-explicit-any
export async function zohoGet(env: ZohoEnv, path: string, query: Record<string, string> = {}): Promise<any> {
  const run = async (token: string) => {
    const qs = new URLSearchParams({ organization_id: env.orgId, ...query });
    const r = await fetch(`${apiHost(env.dc)}/books/v3${path}?${qs.toString()}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    return r;
  };
  let token = await getAccessToken(env);
  let r = await run(token);
  if (r.status === 401) { token = await getAccessToken(env, true); r = await run(token); }
  const j = await r.json();
  if (!r.ok) throw new Error(`Zoho GET ${path} failed: ${r.status} ${JSON.stringify(j)}`);
  return j;
}

/** Fetch a single full record (line-item fallback when a webhook payload is thin). */
// deno-lint-ignore no-explicit-any
export async function getRecordById(env: ZohoEnv, module: Module, id: string): Promise<any | null> {
  const path = module === "bills" ? `/bills/${id}` : `/invoices/${id}`;
  const key = module === "bills" ? "bill" : "invoice";
  const j = await zohoGet(env, path);
  return j?.[key] ?? null;
}

// ── org/branch → cinema mapping ──────────────────────────────────────────────

export async function mapCinema(
  svc: SupabaseClient,
  orgId: string | null,
  branchId: string | null,
): Promise<string | null> {
  if (!orgId) return null;
  // Prefer an exact (org, branch) match; fall back to an org-wide row (null branch).
  const { data } = await svc
    .from("zoho_orgs")
    .select("cinema_id, zoho_branch_id")
    .eq("zoho_org_id", orgId);
  const rows = (data as Array<{ cinema_id: string; zoho_branch_id: string | null }>) ?? [];
  const exact = rows.find((r) => r.zoho_branch_id === branchId);
  if (exact) return exact.cinema_id;
  const wide = rows.find((r) => r.zoho_branch_id === null);
  return wide ? wide.cinema_id : null;
}

export async function deadLetter(
  svc: SupabaseClient,
  origin: "webhook" | "sync",
  module: Module | null,
  raw: unknown,
  reason: string,
  ids: { orgId?: string | null; branchId?: string | null; zohoId?: string | null } = {},
): Promise<void> {
  try {
    await svc.from("zoho_dead_letters").insert({
      origin,
      module,
      zoho_org_id: ids.orgId ?? null,
      zoho_branch_id: ids.branchId ?? null,
      zoho_id: ids.zohoId ?? null,
      reason,
      raw: raw ?? {},
    });
  } catch (e) {
    console.error("deadLetter insert failed", e);
  }
}

// ── Normalization ────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
type Json = any;

const n = (x: unknown): number => {
  const v = Number(x ?? 0);
  return Number.isFinite(v) ? v : 0;
};

/** NaN-safe timestamp → epoch ms. Returns null for missing/invalid dates so
 *  comparisons can't silently succeed via NaN. */
const tms = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? null : t;
};

/** Sum a Zoho `taxes` array into a {cgst,sgst,igst} split by tax_name. */
function taxSplit(taxes: Json[] | undefined): { cgst: number; sgst: number; igst: number } {
  const out = { cgst: 0, sgst: 0, igst: 0 };
  for (const t of taxes ?? []) {
    const name = String(t?.tax_name ?? "").toLowerCase();
    const amt = n(t?.tax_amount);
    // Match Zoho's CGST/SGST/IGST names plus the spelled-out variants.
    if (/igst|integrated/.test(name)) out.igst += amt;
    else if (/cgst|central/.test(name)) out.cgst += amt;
    else if (/sgst|state/.test(name)) out.sgst += amt;
  }
  return out;
}

export interface NormalizedInvoice {
  header: Record<string, unknown>;
  lines: Array<Record<string, unknown>>;
  zohoId: string;
  zohoLastModified: string | null;
  saleDate: string | null;   // set for sales, drives the fb recompute
}

/** Map a raw Zoho Bill/Invoice (the doc object, not the API envelope). */
export function normalize(module: Module, cinemaId: string, raw: Json): NormalizedInvoice | null {
  const isBill = module === "bills";
  const zohoId = String(isBill ? raw.bill_id : raw.invoice_id);
  if (!zohoId || zohoId === "undefined") {
    console.warn(`normalize(${module}): missing id field; keys=${Object.keys(raw ?? {}).join(",")}`);
    return null;
  }

  const split = taxSplit(raw.taxes);
  const date = (raw.date as string) ?? null;
  const header: Record<string, unknown> = {
    cinema_id: cinemaId,
    type: isBill ? "purchase" : "sales",
    source: "zoho",
    zoho_org_id: raw.organization_id ?? null,
    zoho_branch_id: raw.branch_id ?? null,
    zoho_id: zohoId,
    party_name: isBill ? (raw.vendor_name ?? null) : (raw.customer_name ?? null),
    invoice_no: (isBill ? raw.bill_number : raw.invoice_number) ?? null,
    invoice_date: date,
    due_date: raw.due_date ?? null,
    status: raw.status ?? null,
    currency: raw.currency_code ?? "INR",
    sub_total: n(raw.sub_total),
    tax_total: n(raw.tax_total),
    cgst: split.cgst,
    sgst: split.sgst,
    igst: split.igst,
    total: n(raw.total),
    balance: n(raw.balance),
    gst_treatment: raw.gst_treatment ?? null,
    place_of_supply: raw.place_of_supply ?? raw.destination_of_supply ?? null,
    gstin: raw.gst_no ?? null,
    raw,
    zoho_last_modified: raw.last_modified_time ?? null,
    updated_by: "zoho",
  };

  const lines: Array<Record<string, unknown>> = (raw.line_items ?? []).map((li: Json, i: number) => {
    const lsplit = taxSplit(li.taxes);
    return {
      line_no: i,
      zoho_line_id: li.line_item_id ?? null,
      name: li.name ?? null,
      description: li.description ?? null,
      hsn_or_sac: li.hsn_or_sac ?? null,
      quantity: n(li.quantity),
      rate: n(li.rate),
      item_total: n(li.item_total),
      tax_percentage: n(li.tax_percentage),
      cgst: lsplit.cgst,
      sgst: lsplit.sgst,
      igst: lsplit.igst,
      account: li.account_name ?? null,
      raw: li,
    };
  });

  return {
    header,
    lines,
    zohoId,
    zohoLastModified: (raw.last_modified_time as string) ?? null,
    saleDate: isBill ? null : date,
  };
}

// ── Idempotent upsert ────────────────────────────────────────────────────────

export interface UpsertResult {
  written: boolean;        // false if skipped by the last-modified guard
  invoiceId: string | null;
  /** The invoice_date BEFORE this write (for sales: recompute the old day too
   *  when a record's date was edited). Null if the row is new. */
  prevDate: string | null;
}

/**
 * Upsert one normalized invoice + its lines. Idempotent on (cinema_id, zoho_id)
 * with a last-modified guard: an out-of-order retry carrying an OLDER
 * last_modified is ignored. Lines are replaced wholesale.
 */
export async function upsertInvoice(svc: SupabaseClient, norm: NormalizedInvoice): Promise<UpsertResult> {
  const cinemaId = norm.header.cinema_id as string;

  // Guard: skip if we already have a row strictly newer than this payload.
  const { data: existing } = await svc
    .from("invoices")
    .select("id, zoho_last_modified, invoice_date")
    .eq("cinema_id", cinemaId)
    .eq("zoho_id", norm.zohoId)
    .maybeSingle();
  const prevDate = (existing?.invoice_date as string | null) ?? null;

  // Last-modified guard. If we already hold a row that carries a timestamp,
  // skip when the incoming payload is missing OR older — never let a partial/
  // stale delivery overwrite newer data. NaN-safe (tms returns null).
  if (existing?.zoho_last_modified) {
    const have = tms(existing.zoho_last_modified);
    const incoming = tms(norm.zohoLastModified);
    if (incoming === null || (have !== null && have > incoming)) {
      return { written: false, invoiceId: (existing.id as string) ?? null, prevDate };
    }
  }

  const { data: up, error } = await svc
    .from("invoices")
    .upsert(norm.header, { onConflict: "cinema_id,zoho_id" })
    .select("id")
    .single();
  if (error) throw new Error(`invoices upsert failed: ${error.message}`);
  const invoiceId = up.id as string;

  // Replace child lines — ONLY when this payload actually carries lines. A thin
  // payload (list view, or a failed detail re-fetch falling back to the list
  // record) has zero lines; wiping then would destroy the real line items, so
  // leave the existing ones untouched in that case.
  if (norm.lines.length) {
    await svc.from("invoice_line_items").delete().eq("invoice_id", invoiceId);
    const rows = norm.lines.map((l) => ({ ...l, invoice_id: invoiceId }));
    const { error: lerr } = await svc.from("invoice_line_items").insert(rows);
    if (lerr) throw new Error(`line items insert failed: ${lerr.message}`);
  }
  return { written: true, invoiceId, prevDate };
}

/** For a sales upsert, recompute every affected day (new date + edited-away
 *  old date). De-duplicates and ignores nulls. */
export async function recomputeSalesDays(
  svc: SupabaseClient,
  cinemaId: string,
  dates: Array<string | null>,
): Promise<void> {
  const seen = new Set<string>();
  for (const d of dates) {
    if (!d || seen.has(d)) continue;
    seen.add(d);
    await recomputeFbEntry(svc, cinemaId, d);
  }
}

// ── F&B classification + daily recompute ─────────────────────────────────────

const BEVERAGE_WORDS = [
  "beverage", "drink", "soda", "cola", "coke", "pepsi", "sprite", "fanta",
  "water", "juice", "coffee", "tea", "shake", "lassi", "soft drink", "mocktail",
  "thums", "maaza", "frooti", "redbull", "red bull",
];

type ProductIndex = Map<string, { superCategory: string | null; category: string | null }>;

function classify(idx: ProductIndex, line: { name?: string | null; hsn_or_sac?: string | null; account?: string | null }): "food" | "beverages" {
  const name = String(line.name ?? "").trim().toLowerCase();

  // 1) Catalog match (by normalized name) → super_category/category.
  const prod = idx.get(name);
  const cat = `${prod?.superCategory ?? ""} ${prod?.category ?? ""}`.toLowerCase();
  if (cat.includes("bever") || cat.includes("drink")) return "beverages";
  if (cat.includes("food") || cat.includes("snack") || cat.includes("combo") || cat.includes("popcorn")) return "food";

  // 2) Account name hint (POS often books beverages to a distinct account).
  const acct = String(line.account ?? "").toLowerCase();
  if (acct.includes("bever") || acct.includes("drink")) return "beverages";

  // 3) Keyword heuristic on the item name.
  if (BEVERAGE_WORDS.some((w) => name.includes(w))) return "beverages";
  return "food";
}

async function productIndex(svc: SupabaseClient, cinemaId: string): Promise<ProductIndex> {
  const idx: ProductIndex = new Map();
  const { data } = await svc
    .from("fb_products")
    .select("name, category, super_category")
    .eq("cinema_id", cinemaId);
  for (const p of (data as Array<{ name: string; category: string | null; super_category: string | null }>) ?? []) {
    if (p.name) idx.set(p.name.trim().toLowerCase(), { superCategory: p.super_category, category: p.category });
  }
  return idx;
}

/**
 * Recompute fb_entries(cinema, date) from ALL type='sales' invoices for that
 * day. Idempotent and convergent — re-derivable from the invoices table, so
 * webhook retries and edits land on the same row. Writes source='zoho'.
 */
export async function recomputeFbEntry(svc: SupabaseClient, cinemaId: string, saleDate: string): Promise<void> {
  // All sales invoices that day (+ their lines).
  const { data: invs } = await svc
    .from("invoices")
    .select("id, tax_total")
    .eq("cinema_id", cinemaId)
    .eq("type", "sales")
    .eq("invoice_date", saleDate);
  const invoices = (invs as Array<{ id: string; tax_total: number | null }>) ?? [];

  if (invoices.length === 0) {
    // No sales left for that date → clear any zoho row we own (keep manual rows).
    await svc.from("fb_entries").delete()
      .eq("cinema_id", cinemaId).eq("entry_date", saleDate).eq("source", "zoho");
    return;
  }

  const ids = invoices.map((i) => i.id);
  const { data: lineRows } = await svc
    .from("invoice_line_items")
    .select("invoice_id, name, hsn_or_sac, account, quantity, item_total")
    .in("invoice_id", ids);
  const lines = (lineRows as Array<{
    invoice_id: string; name: string | null; hsn_or_sac: string | null;
    account: string | null; quantity: number | null; item_total: number | null;
  }>) ?? [];

  const idx = await productIndex(svc, cinemaId);

  let foodSales = 0;
  let beveragesSales = 0;
  const itemsByName = new Map<string, { name: string; qty: number; netAmount: number; category: string }>();
  for (const l of lines) {
    const kind = classify(idx, l);
    const net = n(l.item_total);
    if (kind === "beverages") beveragesSales += net; else foodSales += net;
    const key = `${kind}:${(l.name ?? "").trim().toLowerCase()}`;
    const cur = itemsByName.get(key) ?? { name: l.name ?? "—", qty: 0, netAmount: 0, category: kind };
    cur.qty += n(l.quantity);
    cur.netAmount += net;
    itemsByName.set(key, cur);
  }
  const addTax = invoices.reduce((acc, i) => acc + n(i.tax_total), 0);
  const grossSales = foodSales + beveragesSales;

  const summary = {
    grossSales,
    foodSales,
    beveragesSales,
    addTax,
    netSalesWithTax: grossSales + addTax,
    bills: invoices.length,
  };
  const items = Array.from(itemsByName.values());

  const { error } = await svc.from("fb_entries").upsert(
    {
      cinema_id: cinemaId,
      entry_date: saleDate,
      summary,
      items,
      source: "zoho",
      updated_by: "zoho-import",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "cinema_id,entry_date" },
  );
  if (error) throw new Error(`fb_entries recompute upsert failed: ${error.message}`);
}
