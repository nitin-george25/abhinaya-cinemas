// ============================================================================
// _shared/slack.ts — generic Slack + HTTP helpers shared by the Slack Edge
// Functions (notify-slack = outbound, slack-interactions = inbound).
//
// This is SHARED CODE, not a deployable function — the leading-underscore dir
// is skipped by `supabase functions deploy` and bundled into each importer.
// Keep this file free of domain logic (petty/PM specifics live elsewhere).
// ============================================================================

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** JSON response with CORS — used by the browser-facing outbound function. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Reply for Slack-facing endpoints: objects → JSON (e.g. {response_action}),
 * strings → text/plain. Slack expects a 200 either way.
 */
export function reply(body: unknown = "", status = 200): Response {
  const isObj = typeof body === "object" && body !== null;
  return new Response(isObj ? JSON.stringify(body) : String(body), {
    status,
    headers: { "Content-Type": isObj ? "application/json" : "text/plain" },
  });
}

/** Indian-rupee formatter used in every Slack message. */
export const inr = (n: number) =>
  "₹" + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** Call a Slack Web API method with a bot token; returns the parsed JSON. */
// deno-lint-ignore no-explicit-any
export async function slackApi(method: string, token: string, payload: unknown): Promise<any> {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  return await r.json();
}

/** Post to an Incoming Webhook (PM flow). Throws on non-2xx. */
export async function postWebhook(url: string, payload: unknown): Promise<void> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Slack webhook failed: ${r.status} ${await r.text()}`);
}

/** Resolve a Slack user's email (needs the users:read.email scope). */
export async function slackUserEmail(token: string, userId: string): Promise<string | null> {
  const r = await fetch(
    `https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const j = await r.json();
  return j.ok ? (j.user?.profile?.email ?? null) : null;
}

const enc = new TextEncoder();

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/**
 * Verify a request genuinely came from Slack: HMAC-SHA256 over the RAW body,
 * compared in constant time, with a 5-minute replay window.
 */
export async function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
): Promise<boolean> {
  if (!timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(signingSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(`v0:${timestamp}:${rawBody}`));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return safeEqual(`v0=${hex}`, signature);
}

/** Post an ephemeral message back to a Slack response_url (best-effort). */
export async function ephemeral(responseUrl: string, text: string): Promise<void> {
  try {
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response_type: "ephemeral", replace_original: false, text }),
    });
  } catch { /* best-effort */ }
}
