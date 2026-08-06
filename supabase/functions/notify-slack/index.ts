// ============================================================================
// notify-slack — OUTBOUND Slack notifications.
//
// PM expense flow (#18) — one-way Incoming Webhooks, one channel per kind:
//   • "payment_request"  → #payments  (owner / accountant)
//   • "payment_paid"     → #payments  (owner / accountant)
//   • "invoice_uploaded" → #invoices  (any entry-writer / accountant)
//
// Petty-expense two-way approval (cash_21) — bot token + interactive buttons,
// delegated to ../_shared/petty.ts:
//   • "petty_request"  → #petty-expenses  posts the pending card + buttons
//   • "petty_decided"  → #petty-expenses  edits the card after a console decision
// Button clicks land on the separate slack-interactions function.
//
// Unified payments (§7 + payments_70), delegated to ../_shared/payments.ts —
// all four land in #payments, the last two as replies on the approval card:
//   • "payment_card"         posts the Approve/Reject card
//   • "payment_card_decided" edits it after a console decision
//   • "payment_card_refresh" re-renders it after an edit (buttons intact)
//   • "payment_otp_request"  asks the owner for the bank OTP (thread reply)
//   • "payment_paid_note"    reports the money out + receipt (thread reply)
//
// Secrets (per Supabase project, for staging/prod parity):
//   • SLACK_PAYMENTS_WEBHOOK_URL, SLACK_INVOICES_WEBHOOK_URL  (PM webhooks)
//   • SLACK_BOT_TOKEN, SLACK_PETTY_CHANNEL_ID                 (petty kinds)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, inr, json, postWebhook } from "../_shared/slack.ts";
import { handlePettyOutbound } from "../_shared/petty.ts";
import { handlePaymentOutbound } from "../_shared/payments.ts";

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
  receiptUrl?: string | null;
  receiptFileName?: string | null;
  deepLink?: string | null;
  // Petty-expense two-way approval (cash_21).
  pettyExpenseId?: string;
  // Unified payments interactive card (§7).
  paymentId?: string;
}

const PAYMENT_ROLES = new Set(["owner", "accountant"]);
const INVOICE_ROLES = new Set(["owner", "manager", "daily_manager", "accountant"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const SUPABASE_URL  = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY      = Deno.env.get("SUPABASE_ANON_KEY");
  const PAYMENTS_HOOK = Deno.env.get("SLACK_PAYMENTS_WEBHOOK_URL");
  const INVOICES_HOOK = Deno.env.get("SLACK_INVOICES_WEBHOOK_URL");
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
  // Resolve the role case-insensitively. Every RLS policy compares
  // lower(email); a mixed-case authorized_users row would otherwise resolve to
  // no role here and silently 403 the Slack post. (An exact hit is the common
  // path; the scan is a fallback over a table with a handful of rows. `ilike`
  // is avoided because `_` in an email is a LIKE wildcard.)
  let role = "";
  const { data: exactRow } = await svc
    .from("authorized_users").select("role").eq("email", callerEmail).maybeSingle();
  if (exactRow?.role) {
    role = exactRow.role as string;
  } else {
    const { data: all } = await svc.from("authorized_users").select("email, role");
    const hit = (all as Array<{ email: string | null; role: string | null }> | null ?? [])
      .find((u) => (u.email ?? "").toLowerCase() === callerEmail);
    role = hit?.role ?? "";
  }

  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return json({ error: "invalid JSON body" }, 400); }

  const kind = body.kind ?? "payment_request";

  // Petty-expense two-way kinds (cash_21) — delegated to the shared handler.
  if (kind === "petty_request" || kind === "petty_decided") {
    return await handlePettyOutbound(svc, role, kind, body.pettyExpenseId);
  }

  // Unified payments interactive card (§7) + the OTP handshake and paid note
  // threaded under it (payments_70) — delegated to the shared handler.
  if (kind === "payment_card" || kind === "payment_card_decided"
      || kind === "payment_card_refresh"
      || kind === "payment_otp_request" || kind === "payment_paid_note") {
    return await handlePaymentOutbound(
      svc, role, kind, body.paymentId, body.deepLink ?? null, callerEmail,
    );
  }

  // --------------------------------------------------------------------------
  // PM webhook kinds — pick channel + gate + message by kind.
  // --------------------------------------------------------------------------
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
  } else if (kind === "payment_paid") {
    if (!PAYMENT_ROLES.has(role)) return json({ error: "accountant role required" }, 403);
    webhook = PAYMENTS_HOOK;
    if (!webhook) return json({ error: "SLACK_PAYMENTS_WEBHOOK_URL not configured" }, 500);
    text = `Payment made: ${body.expenseTitle ?? ""} — ${inr(body.amount ?? 0)} (${body.vendor ?? "vendor"})`;
    lines = [
      `*Payment made* — receipt attached.`,
      `*Project:* ${body.projectName ?? "—"}`,
      body.lineItem ? `*Budget line:* ${body.lineItem}` : null,
      `*Expense:* ${body.expenseTitle ?? "—"}`,
      `*Vendor:* ${body.vendor ?? "—"}`,
      `*Amount paid:* ${inr(body.amount ?? 0)}`,
      body.receiptUrl ? `*Receipt:* <${body.receiptUrl}|${body.receiptFileName ?? "view receipt"}>` : null,
      body.deepLink ? `*Open in console:* ${body.deepLink}` : null,
      `Marked paid by ${callerEmail}.`,
    ];
  } else if (kind === "payment_request") {
    if (!PAYMENT_ROLES.has(role)) return json({ error: "accountant role required" }, 403);
    webhook = PAYMENTS_HOOK;
    if (!webhook) return json({ error: "SLACK_PAYMENTS_WEBHOOK_URL not configured" }, 500);
    text = `Payment requested: ${body.expenseTitle ?? ""} — ${inr(body.amount ?? 0)} (${body.vendor ?? "vendor"})`;
    lines = [
      `*Payment requested* — please review and approve.`,
      `*Project:* ${body.projectName ?? "—"}`,
      body.lineItem ? `*Budget line:* ${body.lineItem}` : null,
      `*Expense:* ${body.expenseTitle ?? "—"}`,
      `*Vendor:* ${body.vendor ?? "—"}`,
      `*Amount:* ${inr(body.amount ?? 0)}`,
      body.invoiceUrl ? `*Invoice:* <${body.invoiceUrl}|${body.invoiceFileName ?? "view bill"}>` : null,
      body.deepLink ? `*Open in console:* ${body.deepLink}` : null,
      `Requested by ${callerEmail}.`,
    ];
  } else {
    // Anything else is a kind this deployment doesn't know. It used to fall into
    // the PM branch above and post an empty "Payment requested — Project: —,
    // Amount: ₹0" card, which reads as a broken notification rather than as the
    // stale deployment it actually is. Say so instead.
    return json({
      error: `this notify-slack deployment doesn't handle the kind "${kind}" — redeploy the function`,
    }, 400);
  }

  const slackPayload = {
    text,
    blocks: [{ type: "section", text: { type: "mrkdwn", text: lines.filter(Boolean).join("\n") } }],
  };

  try {
    await postWebhook(webhook, slackPayload);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }

  return json({ ok: true, channel: kind === "invoice_uploaded" ? "#invoices" : "#payments", ts: null });
});
