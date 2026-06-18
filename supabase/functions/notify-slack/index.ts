// ============================================================================
// notify-slack — posts project finance events to Slack (PM expense flow #18).
//
// Two event kinds, each to its own channel via its own Incoming Webhook:
//   • "payment_request"  → #payments  — accountant requests payment; posts the
//        bill + an OTP request. Owner replies with an OTP on Slack, which the
//        accountant enters back in the console to mark the expense paid.
//        Allowed: owner / accountant.
//   • "invoice_uploaded" → #invoices  — PM/DM uploaded a vendor invoice against
//        an approved expense. Informational. Allowed: any entry-writer/accountant.
//
// v1 is ONE-WAY: webhooks only, no bot token, we don't read replies.
//
// Env vars (Edge Function secrets — set PER Supabase project so staging and prod
// post to their own channels, satisfying staging/prod parity):
//   • SLACK_PAYMENTS_WEBHOOK_URL  — Incoming Webhook for #payments
//   • SLACK_INVOICES_WEBHOOK_URL  — Incoming Webhook for #invoices
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
  invoiceNo?: string | null;
  invoiceUrl?: string | null;
  invoiceFileName?: string | null;
  deepLink?: string | null;
}

const PAYMENT_ROLES = new Set(["owner", "accountant"]);
const INVOICE_ROLES = new Set(["owner", "manager", "daily_manager", "accountant"]);

const inr = (n: number) =>
  "₹" + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const SUPABASE_URL   = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY       = Deno.env.get("SUPABASE_ANON_KEY");
  const PAYMENTS_HOOK  = Deno.env.get("SLACK_PAYMENTS_WEBHOOK_URL");
  const INVOICES_HOOK  = Deno.env.get("SLACK_INVOICES_WEBHOOK_URL");
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: "Supabase env vars not configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing authorization header" }, 401);

  // Verify caller + resolve role.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes.user?.email) return json({ error: "invalid session" }, 401);
  const callerEmail = userRes.user.email.toLowerCase();

  const svc = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: callerRow } = await svc
    .from("authorized_users").select("role").eq("email", callerEmail).maybeSingle();
  const role = (callerRow?.role as string) ?? "";

  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return json({ error: "invalid JSON body" }, 400); }

  const kind = body.kind ?? "payment_request";

  // Pick channel + gate + message by kind.
  let webhook: string | undefined;
  let text: string;
  let lines: (string | null)[];

  if (kind === "invoice_uploaded") {
    if (!INVOICE_ROLES.has(role)) return json({ error: "not permitted" }, 403);
    webhook = INVOICES_HOOK;
    if (!webhook) return json({ error: "SLACK_INVOICES_WEBHOOK_URL not configured" }, 500);
    text = `Invoice uploaded: ${body.expenseTitle ?? ""} — ${inr(body.amount ?? 0)} (${body.vendor ?? "vendor"})`;
    lines = [
      `*Invoice uploaded* for an approved expense.`,
      `*Project:* ${body.projectName ?? "—"}`,
      body.lineItem ? `*Budget line:* ${body.lineItem}` : null,
      `*Expense:* ${body.expenseTitle ?? "—"}`,
      `*Vendor:* ${body.vendor ?? "—"}`,
      body.invoiceNo ? `*Invoice #:* ${body.invoiceNo}` : null,
      `*Amount:* ${inr(body.amount ?? 0)}`,
      body.invoiceUrl ? `*Bill:* <${body.invoiceUrl}|${body.invoiceFileName ?? "view"}>` : null,
      body.deepLink ? `*Open in console:* ${body.deepLink}` : null,
      `Uploaded by ${callerEmail}.`,
    ];
  } else {
    if (!PAYMENT_ROLES.has(role)) return json({ error: "accountant role required" }, 403);
    webhook = PAYMENTS_HOOK;
    if (!webhook) return json({ error: "SLACK_PAYMENTS_WEBHOOK_URL not configured" }, 500);
    text = `Payment requested: ${body.expenseTitle ?? ""} — ${inr(body.amount ?? 0)} (${body.vendor ?? "vendor"})`;
    lines = [
      `*Payment requested* — please review and reply with the OTP to approve.`,
      `*Project:* ${body.projectName ?? "—"}`,
      body.lineItem ? `*Budget line:* ${body.lineItem}` : null,
      `*Expense:* ${body.expenseTitle ?? "—"}`,
      `*Vendor:* ${body.vendor ?? "—"}`,
      `*Amount:* ${inr(body.amount ?? 0)}`,
      body.invoiceUrl ? `*Invoice:* <${body.invoiceUrl}|${body.invoiceFileName ?? "view bill"}>` : null,
      body.deepLink ? `*Open in console:* ${body.deepLink}` : null,
      `Requested by ${callerEmail}.`,
    ];
  }

  const slackPayload = {
    text,
    blocks: [{ type: "section", text: { type: "mrkdwn", text: lines.filter(Boolean).join("\n") } }],
  };

  try {
    const r = await fetch(webhook, {
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

  return json({ ok: true, channel: kind === "invoice_uploaded" ? "#invoices" : "#payments", ts: null });
});
