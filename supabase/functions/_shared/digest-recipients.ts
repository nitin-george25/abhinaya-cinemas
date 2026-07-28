// ============================================================================
// _shared/digest-recipients.ts — console-managed digest recipients.
//
// SHARED CODE, not a deployable function. Used by daily-digest, weekly-digest,
// cash-closing-digest and pm-digest so all four resolve "who gets this email?"
// the same way.
//
// Recipients used to live only in Supabase secrets (DIGEST_TO etc.), which
// meant changing them needed CLI access. They now live in the console at
// Settings -> Notifications, which writes them into the existing config blob
// at config.data.cinema.digests.<key>. See app/src/pages/settings/Notifications.tsx.
//
// RESOLUTION ORDER (first non-empty wins):
//   1. ?to= / body.to      — explicit manual test, one-off, bypasses `enabled`
//   2. config.data.cinema.digests.<key>.to  — the console list (authoritative)
//   3. the env var          — pre-console fallback, kept so nothing breaks on
//                             an environment where the console list is empty
//   4. hardcoded default    — last resort so a digest is never silently
//                             addressed to nobody
//
// The console deliberately outranks the env var: an owner who edits the list
// in the UI and sees no change because a stale secret is winning would have no
// way to diagnose it. The env var only applies while the console list is empty.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { corsHeaders } from "./slack.ts";

// Re-exported so a digest function needs one import, not two. The constant
// itself lives in slack.ts because extract-invoice already treats it as the
// repo's generic browser-facing CORS header set.
export { corsHeaders };

/**
 * Copy CORS headers onto a response.
 *
 * The digests were cron-only until Settings -> Notifications grew a "Send test"
 * button. That button calls them from the browser through supabase-js, which
 * issues a preflight — without these headers the call fails in the browser
 * while working perfectly from curl.
 */
export function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

/** Keys under config.data.cinema.digests — must match DigestsConfig in app/src/lib/types.ts. */
export type DigestKey = "cashClosing" | "daily" | "weekly" | "pm";

export type DigestChannelConfig = { enabled?: boolean; to?: string[] };

export type ResolvedRecipients = {
  /** Addresses to send to. Never empty unless `enabled` is false. */
  to: string[];
  /** False only when the owner switched this digest off in the console. */
  enabled: boolean;
  /** Which rung of the ladder won — surfaced in the JSON response for debugging. */
  source: "query" | "console" | "env" | "default";
  /** Cinema display name from the same config row, so callers need only one query. */
  cinemaName: string;
};

const DEFAULT_TO = [
  "nitin.george@abhinayacinemas.com",
  "ajim20@hotmail.com",
  "shinu.thomas@abhinayacinemas.com",
];
const DEFAULT_CINEMA_NAME = "Abhinaya Cinemas, Changanacherry";

/** Split a comma-separated list and drop blanks. Accepts arrays untouched. */
export function parseList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

/**
 * Merge query-string and JSON-body params.
 *
 * The cron calls these functions with query params; the console's "Send test"
 * button goes through supabase-js `functions.invoke()`, which POSTs a JSON body
 * and cannot set a query string. Reading both means one handler serves both.
 */
export async function readParams(req: Request): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URL(req.url).searchParams) out[k] = v;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body && typeof body === "object" && !Array.isArray(body)) {
        for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
          if (v !== null && v !== undefined) out[k] = Array.isArray(v) ? v.join(",") : String(v);
        }
      }
    } catch {
      // No body, or not JSON. Query params alone are fine.
    }
  }
  return out;
}

/**
 * Resolve recipients for one digest.
 *
 * `envValue` is the raw env var (e.g. Deno.env.get("DIGEST_TO")) — passed in
 * rather than read here so each function keeps naming its own variable.
 */
export async function resolveRecipients(opts: {
  sb: SupabaseClient;
  key: DigestKey;
  envValue?: string | null;
  queryTo?: string | null;
  defaults?: string[];
  /** Already-loaded config.data.cinema, to skip a redundant read. daily-digest
   *  and weekly-digest fetch the whole config blob anyway. */
  cinema?: Record<string, unknown> | null;
}): Promise<ResolvedRecipients> {
  const { sb, key, envValue, queryTo } = opts;
  const defaults = opts.defaults ?? DEFAULT_TO;

  // One read serves both the recipient list and the cinema name.
  let cfg: DigestChannelConfig = {};
  let cinemaName = DEFAULT_CINEMA_NAME;
  try {
    let cinema = opts.cinema ?? null;
    if (!cinema) {
      const res = await sb.from("config").select("data").eq("id", 1).maybeSingle();
      cinema = (res.data?.data as { cinema?: Record<string, unknown> } | null)?.cinema ?? null;
    }
    if (cinema) {
      if (typeof cinema.name === "string" && cinema.name.trim()) cinemaName = cinema.name.trim();
      const digests = cinema.digests as Record<string, DigestChannelConfig> | undefined;
      cfg = digests?.[key] ?? {};
    }
  } catch {
    // Config unreadable -> fall through to env/defaults rather than fail the run.
  }

  // A manual test wins outright and ignores the enabled switch, so a digest
  // that is switched off can still be previewed before being turned back on.
  const fromQuery = parseList(queryTo);
  if (fromQuery.length) {
    return { to: fromQuery, enabled: true, source: "query", cinemaName };
  }

  const enabled = cfg.enabled !== false;

  const fromConsole = parseList(cfg.to);
  if (fromConsole.length) return { to: fromConsole, enabled, source: "console", cinemaName };

  const fromEnv = parseList(envValue);
  if (fromEnv.length) return { to: fromEnv, enabled, source: "env", cinemaName };

  return { to: defaults, enabled, source: "default", cinemaName };
}
