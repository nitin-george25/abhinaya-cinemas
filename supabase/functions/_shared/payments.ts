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
// Who may ask the owner for the bank OTP (the payers).
export const PAYMENT_OTP_ROLES = new Set(["owner", "accountant"]);

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
      "approved_by_email, rejected_reason, slack_channel, slack_ts, otp_slack_ts, " +
      "operating_unit_id, payment_type_id, is_advance, mode, " +
      "bank_account_id, payee_account_last4, payee_ifsc, " +
      "paid_amount, paid_at, bank_reference, payment_receipt_url, paid_via_bank_account_id",
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
  const bankId = d.paid_via_bank_account_id ?? d.bank_account_id;
  if (bankId) {
    const { data: b } = await svc
      .from("bank_accounts").select("name, bank_name").eq("id", bankId).maybeSingle();
    d.bank_label = b ? [b.name, b.bank_name].filter(Boolean).join(" · ") : null;
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
  // A rejection parks the payment back in 'draft' with the reason attached, so
  // key off the reason rather than a 'rejected' status. Everything downstream of
  // approval (otp_requested / paid / posted) still reads as approved — before
  // payments_70 anything that wasn't literally 'approved' rendered as rejected.
  const rejected = p.status === "cancelled" || p.status === "rejected"
    || ((p.status === "draft" || p.status === "pending") && !!p.rejected_reason);
  const paid = p.status === "paid" || p.status === "posted";
  const header = decided
    ? (rejected ? ":no_entry: *Payment rejected*"
      : paid ? ":moneybag: *Payment paid*"
      : ":white_check_mark: *Payment approved*")
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
    const reason = rejected && p.rejected_reason ? ` — _${p.rejected_reason}_` : "";
    blocks.push({
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: `${rejected ? "Rejected" : "Approved"} by ${p.approved_by_email ?? "owner"}${reason}`,
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
 * Block Kit layout for the OTP ask — posted as a REPLY on the payment's own
 * approval card so the approval and the OTP live in one thread. The owner
 * answers with the bank's code as a normal thread message; nothing reads or
 * stores that reply (§ payments_70), it is a handshake between two people.
 */
// deno-lint-ignore no-explicit-any
export function otpRequestBlocks(p: any, requestedBy: string, deepLink?: string | null): any[] {
  const fields = [
    `*Payee:* ${p.payee_name ?? "—"}`,
    `*Amount:* ${inr(Number(p.amount) || 0)}`,
    `*Paying from:* ${p.bank_label ?? "—"}`,
    p.payee_account_last4 ? `*To A/c:* ••••${p.payee_account_last4}` : null,
    `*Mode:* ${String(p.mode ?? "bank_transfer").replace(/_/g, " ")}`,
    `*Approved by:* ${p.approved_by_email ?? "—"}`,
  ].filter(Boolean);

  // deno-lint-ignore no-explicit-any
  const blocks: any[] = [
    { type: "section", text: { type: "mrkdwn", text: ":closed_lock_with_key: *Payment OTP needed*" } },
    { type: "section", fields: fields.map((t) => ({ type: "mrkdwn", text: t as string })) },
    {
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: `${requestedBy || "The accountant"} is ready to pay — *reply in this thread with the OTP*.`,
      }],
    },
  ];
  if (deepLink) {
    blocks.push({
      type: "actions",
      block_id: `payment_otp:${p.id}`,
      elements: [{ type: "button", text: { type: "plain_text", text: "Open in console" }, url: deepLink }],
    });
  }
  return blocks;
}

/**
 * Outbound handler for the payment Slack kinds (called by notify-slack):
 *   • payment_card          — post the interactive card, store channel+ts.
 *   • payment_card_decided  — edit the stored card after a console decision.
 *   • payment_otp_request   — reply on that card asking the owner for the OTP.
 *   • payment_paid_note     — reply on that card reporting the money out.
 */
// deno-lint-ignore no-explicit-any
export async function handlePaymentOutbound(
  svc: any, role: string, kind: string, paymentId?: string,
  deepLink?: string | null, callerEmail?: string,
): Promise<Response> {
  const BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");
  const CHAN = Deno.env.get("SLACK_PAYMENTS_CHANNEL_ID");
  // These messages reach the console user, so name the missing piece.
  if (!BOT_TOKEN) {
    return json({ error: "Slack isn't set up for this environment (SLACK_BOT_TOKEN secret missing)." }, 500);
  }
  if (!paymentId) return json({ error: "paymentId required" }, 400);

  const p = await loadPaymentForSlack(svc, paymentId);
  if (!p) return json({ error: "payment not found" }, 404);

  if (kind === "payment_card") {
    if (!PAYMENT_POST_ROLES.has(role)) {
      return json({ error: `your role (${role || "unknown"}) can't post payment cards` }, 403);
    }
    if (!CHAN) {
      return json({ error: "the payments Slack channel isn't set (SLACK_PAYMENTS_CHANNEL_ID secret missing)." }, 500);
    }
    const text = `Payment awaiting approval: ${inr(Number(p.amount) || 0)} — ${p.payee_name ?? ""}`;
    const pj = await slackApi("chat.postMessage", BOT_TOKEN, {
      channel: CHAN, text, blocks: paymentBlocks(p, false, deepLink),
    });
    if (!pj.ok) {
      const hint = pj.error === "not_in_channel" || pj.error === "channel_not_found"
        ? " — invite the bot to that channel (/invite @<app>) and check the channel id"
        : "";
      return json({ error: `Slack rejected the card: ${pj.error}${hint}` }, 502);
    }
    await svc.from("payment_requests")
      .update({ slack_channel: pj.channel, slack_ts: pj.ts })
      .eq("id", p.id);
    return json({ ok: true, channel: pj.channel, ts: pj.ts });
  }

  if (kind === "payment_otp_request") {
    if (!PAYMENT_OTP_ROLES.has(role)) {
      return json({ error: `your role (${role || "unknown"}) can't request a payment OTP` }, 403);
    }
    if (!CHAN && !p.slack_channel) {
      return json({ error: "the payments Slack channel isn't set (SLACK_PAYMENTS_CHANNEL_ID secret missing)." }, 500);
    }
    const text = `Payment OTP needed: ${inr(Number(p.amount) || 0)} — ${p.payee_name ?? ""}`;
    // Thread it under the approval card when we have one; if the card never got
    // posted (Slack was down at submit), fall back to a standalone message so
    // the owner is still asked. `reply_broadcast` surfaces the reply in the
    // channel too — a threaded-only ask is easy to miss.
    // deno-lint-ignore no-explicit-any
    const payload: any = {
      channel: p.slack_channel ?? CHAN,
      text,
      blocks: otpRequestBlocks(p, callerEmail ?? "", deepLink),
    };
    if (p.slack_ts) { payload.thread_ts = p.slack_ts; payload.reply_broadcast = true; }

    const pj = await slackApi("chat.postMessage", BOT_TOKEN, payload);
    if (!pj.ok) {
      const hint = pj.error === "not_in_channel" || pj.error === "channel_not_found"
        ? " — invite the bot to that channel (/invite @<app>) and check the channel id"
        : "";
      return json({ error: `Slack rejected the OTP request: ${pj.error}${hint}` }, 502);
    }
    await svc.from("payment_requests").update({ otp_slack_ts: pj.ts }).eq("id", p.id);
    return json({ ok: true, channel: pj.channel, ts: pj.ts, threaded: !!p.slack_ts });
  }

  // Closes the loop for whoever shared the OTP: the same thread reports that the
  // money actually went out, with the transaction receipt attached.
  if (kind === "payment_paid_note") {
    if (!PAYMENT_OTP_ROLES.has(role)) {
      return json({ error: `your role (${role || "unknown"}) can't post payment updates` }, 403);
    }
    if (!p.slack_channel && !CHAN) return json({ ok: true, skipped: "no channel" });
    const amt = inr(Number(p.paid_amount ?? p.amount) || 0);
    const text = `Payment made: ${amt} — ${p.payee_name ?? ""}`;
    const lines = [
      `:white_check_mark: *Payment made* — ${amt} to *${p.payee_name ?? "—"}*`,
      `*Paid from:* ${p.bank_label ?? "—"}`,
      p.bank_reference ? `*Reference:* ${p.bank_reference}` : null,
      p.payment_receipt_url ? `*Receipt:* <${p.payment_receipt_url}|view>` : null,
      `Recorded by ${callerEmail ?? "the accountant"}.`,
    ].filter(Boolean).join("\n");

    // deno-lint-ignore no-explicit-any
    const payload: any = {
      channel: p.slack_channel ?? CHAN,
      text,
      blocks: [{ type: "section", text: { type: "mrkdwn", text: lines } }],
    };
    if (p.slack_ts) { payload.thread_ts = p.slack_ts; payload.reply_broadcast = true; }
    const pj = await slackApi("chat.postMessage", BOT_TOKEN, payload);
    if (!pj.ok) return json({ error: `Slack rejected the paid note: ${pj.error}` }, 502);
    return json({ ok: true, ts: pj.ts });
  }

  if (kind === "payment_card_decided") {
    if (!p.slack_channel || !p.slack_ts) return json({ ok: true, skipped: "no slack message stored" });
    const text = `Payment ${p.status}: ${inr(Number(p.amount) || 0)} — ${p.payee_name ?? ""}`;
    const uj = await slackApi("chat.update", BOT_TOKEN, {
      channel: p.slack_channel, ts: p.slack_ts, text, blocks: paymentBlocks(p, true),
    });
    if (!uj.ok) return json({ error: `Slack rejected the card update: ${uj.error}` }, 502);
    return json({ ok: true });
  }

  return json({ error: `unknown payment kind: ${kind}` }, 400);
}
