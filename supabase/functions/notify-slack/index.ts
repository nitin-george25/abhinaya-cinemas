// ============================================================================
// notify-slack — posts a project payment-request to Slack #payments.
//
// Part of the PM expense flow (pipeline #18). When the accountant requests
// payment for an approved+invoiced expense, the browser calls this function;
// it posts the bill details + an OTP request to the #payments channel via a
// Slack Incoming Webhook. The owner then replies on Slack with an OTP, which
// the accountant enters back in the console to mark the expense paid.
//
// v1 is ONE-WAY: a webhook is enough, no bot token, we don't read replies.
//
// Auth: caller's JWT must resolve to a global `accountant` (or `owner`) — the
// same roles allowed to request payment in the DB transition function.
//
// Env vars (Edge Function secrets — set PER Supabase project so staging and
// prod post to their own channels, satisfying staging/prod parity):
//   • SLACK_PAYMENTS_WEBHOOK_URL  — Slack Incoming Webhook URL for #payments
//
// Request body:
//   { kind: "payment_request", projectName, lineItem, expenseTitle, vendor,
//     amount, invoiceUrl, invoiceFileName, deepLink }
// Response: { ok: true, channel: "#payments", ts: null }
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
  kind?: string;
  projectName?: string;
  lineItem?: string | null;
  expenseTitle?: string;
  vendor?: string | null;
  amount?: number;
  invoiceUrl?: string | null;
  invoiceFileName?: string | null;
  deepLink?: string | null;
}

const PAYMENT_ROLES = new Set(["owner", "accountant"]);

const inr = (n: number) =>
  "₹" + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY");
  const WEBHOOK_URL  = Deno.env.get("SLACK_PAYMENTS_WEBHOOK_URL");
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: "Supabase env vars not configured" }, 500);
  }
  if (!WEBHOOK_URL) {
    return json({ error: "SLACK_PAYMENTS_WEBHOOK_URL not configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing authorization header" }, 401);

  // 1) Verify caller is an accountant/owner.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes.user?.email) return json({ error: "invalid session" }, 401);
  const callerEmail = userRes.user.email.toLowerCase();

  const svc = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: callerRow } = await svc
    .from("authorized_users").select("role").eq("email", callerEmail).maybeSingle();
  if (!callerRow || !PAYMENT_ROLES.has(callerRow.role as string)) {
    return json({ error: "accountant role required" }, 403);
  }

  // 2) Parse body.
  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return json({ error: "invalid JSON body" }, 400); }

  const lines = [
    `*Payment requested* — please review and reply with the OTP to approve.`,
    `*Project:* ${body.projectName ?? "—"}`,
    body.lineItem ? `*Budget line:* ${body.lineItem}` : null,
    `*Expense:* ${body.expenseTitle ?? "—"}`,
    `*Vendor:* ${body.vendor ?? "—"}`,
    `*Amount:* ${inr(body.amount ?? 0)}`,
    body.invoiceUrl ? `*Invoice:* <${body.invoiceUrl}|${body.invoiceFileName ?? "view bill"}>` : null,
    body.deepLink ? `*Open in console:* ${body.deepLink}` : null,
    `Requested by ${callerEmail}.`,
  ].filter(Boolean);

  const slackPayload = {
    text: `Payment requested: ${body.expenseTitle ?? ""} — ${inr(body.amount ?? 0)} (${body.vendor ?? "vendor"})`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
    ],
  };

  // 3) Post to Slack incoming webhook.
  try {
    const r = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slackPayload),
    });
    if (!r.ok) {
      const t = await r.text();
      return json({ error: `Slack webhook failed: ${r.status} ${t}` }, 502);
    }
  } catch (e) {
    return json({ error: `Slack webhook error: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }

  // Incoming webhooks don't return a message ts; channel is fixed by the webhook.
  return json({ ok: true, channel: "#payments", ts: null });
});
