// ============================================================================
// send-whatsapp-show — sends a template message via Meta WhatsApp Cloud API.
//
// Auth: caller's JWT must resolve to an entry-writer (owner | manager |
// daily_manager). The browser uploads the show image to Supabase Storage
// `show-messages` bucket first, then POSTs here with:
//   { recipient, mediaUrl, text, entryDate, movieId, screenId, showIdx }
//
// We call Meta's POST /v17.0/{phone_number_id}/messages with a template
// using an IMAGE header (link=mediaUrl) and a single body variable
// containing `text` (typically buildShowText() output).
//
// Env vars (Edge Function secrets):
//   • WHATSAPP_ACCESS_TOKEN     — Meta permanent token
//   • WHATSAPP_PHONE_NUMBER_ID  — sender number's phone_number_id
//
// Template name + language are pulled from `config.cinema.whatsapp` so the
// operator can swap templates without redeploying. Defaults are sensible
// fallbacks.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface Body {
  /** E.164 recipient phone, e.g. "+919876543210". */
  recipient: string;
  /** Public Supabase Storage URL for the show image PNG. */
  mediaUrl: string;
  /** Body variable {{1}} — typically buildShowText() output. */
  text: string;
  /** Audit-log fields. */
  entryDate?: string;
  movieId?: string;
  screenId?: string;
  showIdx?: number;
}

const ENTRY_WRITER_ROLES = new Set(["owner", "manager", "daily_manager"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY");
  const WA_TOKEN     = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const WA_PHONE_ID  = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: "Supabase env vars not configured" }, 500);
  }
  if (!WA_TOKEN || !WA_PHONE_ID) {
    return json({ error: "WhatsApp env vars not configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing authorization header" }, 401);

  // 1) Verify caller
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes.user?.email) return json({ error: "invalid session" }, 401);
  const callerEmail = userRes.user.email.toLowerCase();

  const svc = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: callerRow } = await svc
    .from("authorized_users")
    .select("role")
    .eq("email", callerEmail)
    .maybeSingle();
  if (!callerRow || !ENTRY_WRITER_ROLES.has(callerRow.role as string)) {
    return json({ error: "entry-writer role required" }, 403);
  }

  // 2) Parse + validate body
  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return json({ error: "invalid JSON body" }, 400); }
  if (!body.recipient) return json({ error: "recipient is required" }, 400);
  if (!body.mediaUrl)  return json({ error: "mediaUrl is required" }, 400);
  if (!body.text)      return json({ error: "text is required" }, 400);

  // 3) Pull template config from public.config.data.cinema.whatsapp
  const { data: cfgRow } = await svc
    .from("config")
    .select("data")
    .eq("id", 1)
    .maybeSingle();
  const cfg = (cfgRow?.data as Record<string, unknown> | null) ?? {};
  const cinema = (cfg.cinema as Record<string, unknown> | undefined) ?? {};
  const wa = (cinema.whatsapp as Record<string, unknown> | undefined) ?? {};
  const templateName = (wa.templateName as string) || "show_collection_v1";
  const templateLang = (wa.templateLang as string) || "en";

  // 4) Call Meta Cloud API
  const metaUrl = `https://graph.facebook.com/v17.0/${WA_PHONE_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: body.recipient.replace(/[^\d+]/g, ""),
    type: "template",
    template: {
      name: templateName,
      language: { code: templateLang },
      components: [
        {
          type: "header",
          parameters: [{ type: "image", image: { link: body.mediaUrl } }],
        },
        {
          type: "body",
          parameters: [{ type: "text", text: body.text.slice(0, 1024) }],
        },
      ],
    },
  };

  let status = "sent";
  let metaMessageId: string | null = null;
  let errorMsg: string | null = null;
  try {
    const r = await fetch(metaUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok) {
      status = "failed";
      errorMsg = data?.error?.message ?? `HTTP ${r.status}`;
    } else {
      metaMessageId = data?.messages?.[0]?.id ?? null;
    }
  } catch (e) {
    status = "failed";
    errorMsg = e instanceof Error ? e.message : String(e);
  }

  // 5) Audit log (best-effort; don't block the response if it fails)
  try {
    await svc.from("whatsapp_log").insert({
      recipient: body.recipient,
      entry_date: body.entryDate ?? null,
      movie_id: body.movieId ?? null,
      screen_id: body.screenId ?? null,
      show_idx: body.showIdx ?? null,
      media_url: body.mediaUrl,
      status,
      meta_message_id: metaMessageId,
      error: errorMsg,
      caller_email: callerEmail,
    });
  } catch { /* swallow */ }

  if (status === "failed") {
    return json({ ok: false, error: errorMsg }, 502);
  }
  return json({ ok: true, messageId: metaMessageId });
});
