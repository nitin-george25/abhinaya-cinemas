// ============================================================================
// _shared/payments.ts — unified-payment domain logic for two-way Slack approval
// (§7). Shared by notify-slack (outbound: post + edit) and slack-interactions
// (inbound: decide + edit). Mirrors _shared/petty.ts.
//
// SHARED CODE, not a deployable function. Generic Slack plumbing is in
// ./slack.ts; this file owns only what's specific to the payments inbox.
// ============================================================================

import { inr, json, slackApi } from "./slack.ts";

// Who may trigger a payment Slack post (the raisers).
export const PAYMENT_POST_ROLES = new Set(["owner", "manager", "accountant"]);

/**
 * Load a payment plus its type name and the cinema id of its operating unit
 * (the type FK + unit are fetched separately to keep the embed simple).
 */
// deno-lint-ignore no-explicit-any
export async function loadPaymentForSlack(svc: any, id: string) {
  const { data } = await svc
    .from("payment_requests")
    .select(
      "id, payee_name, amount, needed_by, status, invoice_url, proforma_url, " +
      "approved_by_email, rejected_reason, slack_channel, slack_ts, " +
      "operating_unit_id, payment_type_id, is_advance",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  // deno-lint-ignore no-explicit-any
  const d = data as any;
  if (d.payment_type_id) {
    const { data: t } = await svc
      .from("payment_types").select("name, accounting_head").eq("id", d.payment_type_id).maybeSingle();
    d.type_name = t?.name ?? null;
    d.accounting_head = t?.accounting_head ?? null;
  }
  if (d.operating_unit_id) {
    const { data: u } = await svc
      .from("operating_units").select("name, cinema_id").eq("id", d.operating_unit_id).maybeSingle();
    d.unit_name = u?.name ?? null;
    d.cinema_id = u?.cinema_id ?? null;
  }
  return d;
}

/**
 * Block Kit layout for a payment. `decided=false` renders the pending card with
 * Approve/Reject buttons; `decided=true` renders the static approved/rejected
 * card (buttons removed). `deepLink` adds an "Open in console" button.
 */
// deno-lint-ignore no-explicit-any
export function paymentBlocks(p: any, decided: boolean, deepLink?: string | null): any[] {
  const approved = p.status === "approved";
  const header = decided
    ? (approved ? ":white_check_mark: *Payment approved*" : ":no_entry: *Payment rejected*")
    : ":money_with_wings: *Payment — awaiting your approval*";

  const fields = [
    `*Type:* ${p.type_name ?? "Payment"}`,
    `*Payee:* ${p.payee_name ?? "—"}`,
    `*Amount:* ${inr(Number(p.amount) || 0)}`,
    `*Needed by:* ${p.needed_by ?? "—"}`,
    p.is_advance ? `*Advance:* yes` : null,
    `*Unit:* ${p.unit_name ?? "—"}`,
  ].filter(Boolean);

  // deno-lint-ignore no-explicit-any
  const blocks: any[] = [
    { type: "section", text: { type: "mrkdwn", text: header } },
    { type: "section", fields: fields.map((t) => ({ type: "mrkdwn", text: t as string })) },
  ];

  if (p.invoice_url) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Invoice:* <${p.invoice_url}|view>` } });
  }

  if (decided) {
    const reason = !approved && p.rejected_reason ? ` — _${p.rejected_reason}_` : "";
    blocks.push({
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: `${approved ? "Approved" : "Rejected"} by ${p.approved_by_email ?? "owner"}${reason}`,
      }],
    });
  } else {
    // deno-lint-ignore no-explicit-any
    const elements: any[] = [
      { type: "button", style: "primary", text: { type: "plain_text", text: "Approve" },
        action_id: "payment_approve", value: p.id },
      { type: "button", style: "danger", text: { type: "plain_text", text: "Reject" },
        action_id: "payment_reject", value: p.id },
    ];
    if (deepLink) {
      elements.push({ type: "button", text: { type: "plain_text", text: "Open in console" }, url: deepLink });
    }
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "Only the owner can approve." }] });
    blocks.push({ type: "actions", block_id: `payment:${p.id}`, elements });
  }
  return blocks;
}

/**
 * Outbound handler for the payment Slack kinds (called by notify-slack):
 *   • payment_card          — post the interactive card, store channel+ts.
 *   • payment_card_decided  — edit the stored card after a console decision.
 */
// deno-lint-ignore no-explicit-any
export async function handlePaymentOutbound(
  svc: any, role: string, kind: string, paymentId?: string, deepLink?: string | null,
): Promise<Response> {
  const BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");
  const CHAN = Deno.env.get("SLACK_PAYMENTS_CHANNEL_ID");
  if (!BOT_TOKEN) return json({ error: "SLACK_BOT_TOKEN not configured" }, 500);
  if (!paymentId) return json({ error: "paymentId required" }, 400);

  const p = await loadPaymentForSlack(svc, paymentId);
  if (!p) return json({ error: "payment not found" }, 404);

  if (kind === "payment_card") {
    if (!PAYMENT_POST_ROLES.has(role)) return json({ error: "not permitted" }, 403);
    if (!CHAN) return json({ error: "SLACK_PAYMENTS_CHANNEL_ID not configured" }, 500);
    const text = `Payment awaiting approval: ${inr(Number(p.amount) || 0)} — ${p.payee_name ?? ""}`;
    const pj = await slackApi("chat.postMessage", BOT_TOKEN, {
      channel: CHAN, text, blocks: paymentBlocks(p, false, deepLink),
    });
    if (!pj.ok) return json({ error: `chat.postMessage failed: ${pj.error}` }, 502);
    await svc.from("payment_requests")
      .update({ slack_channel: pj.channel, slack_ts: pj.ts })
      .eq("id", p.id);
    return json({ ok: true, channel: pj.channel, ts: pj.ts });
  }

  if (kind === "payment_card_decided") {
    if (!p.slack_channel || !p.slack_ts) return json({ ok: true, skipped: "no slack message stored" });
    const text = `Payment ${p.status}: ${inr(Number(p.amount) || 0)} — ${p.payee_name ?? ""}`;
    const uj = await slackApi("chat.update", BOT_TOKEN, {
      channel: p.slack_channel, ts: p.slack_ts, text, blocks: paymentBlocks(p, true),
    });
    if (!uj.ok) return json({ error: `chat.update failed: ${uj.error}` }, 502);
    return json({ ok: true });
  }

  return json({ error: `unknown payment kind: ${kind}` }, 400);
}
