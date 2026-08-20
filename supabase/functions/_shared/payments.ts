// ============================================================================
// _shared/payments.ts — unified-payment domain logic for two-way Slack approval
// (§7). Shared by notify-slack (outbound: post + edit) and slack-interactions
// (inbound: decide + edit). Mirrors _shared/petty.ts.
//
// SHARED CODE, not a deployable function. Generic Slack plumbing is in
// ./slack.ts; this file owns only what's specific to the payments inbox.
// ============================================================================

import { inr, json, slackApi } from "./slack.ts";

/**
 * Build marker for the Slack payment code. Bump it whenever this file changes
 * in a way an operator needs to see live.
 *
 * It exists because "is the deployed function actually running this code?" was
 * unanswerable without it: migrations and Edge Functions ship separately, so a
 * project can have the payments_70 DB and a pre-payments_70 function, and the
 * only symptom is a Slack card that looks wrong. Both notify-slack and
 * slack-interactions log this on every request and notify-slack returns it, so
 * the answer is one line in the dashboard logs. Living in _shared means it also
 * proves the SHARED file was bundled — the piece a partial redeploy misses.
 */
export const PAYMENTS_BUILD = "2026-08-18 · one-line OTP ask";

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
      "id, payee_name, amount, needed_by, status, purpose, invoice_url, proforma_url, " +
      "approved_by_email, rejected_reason, slack_channel, slack_ts, otp_slack_ts, " +
      "operating_unit_id, payment_type_id, is_advance, mode, " +
      "bank_account_id, payee_account_last4, payee_ifsc, " +
      "paid_amount, paid_at, bank_reference, payment_receipt_url, paid_via_bank_account_id, " +
      "edited_at",
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
    blocks.push({
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: p.edited_at
          ? ":pencil2: Revised since it was raised. Only the owner can approve."
          : "Only the owner can approve.",
      }],
    });
    blocks.push({ type: "actions", block_id: `payment:${p.id}`, elements });
  }
  return blocks;
}

/**
 * Block Kit layout for the OTP ask — posted as a REPLY on the payment's own
 * approval card so the approval and the OTP live in one thread. The owner
 * answers with the bank's code as a normal thread message; nothing reads or
 * stores that reply (§ payments_70), it is a handshake between two people.
 *
 * Deliberately ONE line. This used to restate the type, mode, paying-from
 * account, payee A/c, unit, approver, purpose and invoice link — every one of
 * which is already on the approval card directly above it in the same thread.
 * The owner is being asked for a code, not re-briefed on the payment. The line
 * keeps the amount and payee so the push notification still says which payment
 * it is; the thread carries everything else.
 */
// deno-lint-ignore no-explicit-any
export function otpRequestBlocks(p: any): any[] {
  return [{
    type: "section",
    text: {
      type: "mrkdwn",
      text: `:closed_lock_with_key: *OTP requested* — ${inr(Number(p.amount) || 0)} to *${p.payee_name ?? "—"}*`,
    },
  }];
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
    const text = `OTP requested: ${inr(Number(p.amount) || 0)} — ${p.payee_name ?? ""}`;
    // Thread it under the approval card when we have one; if the card never got
    // posted (Slack was down at submit), fall back to a standalone message so
    // the owner is still asked. `reply_broadcast` surfaces the reply in the
    // channel too — a threaded-only ask is easy to miss.
    // deno-lint-ignore no-explicit-any
    const payload: any = {
      channel: p.slack_channel ?? CHAN,
      text,
      blocks: otpRequestBlocks(p),
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

  // An edit while the payment is still awaiting a decision leaves the posted
  // card showing stale figures — re-render it in place, buttons intact, so the
  // owner never approves a number that has since changed.
  if (kind === "payment_card_refresh") {
    if (!PAYMENT_POST_ROLES.has(role)) {
      return json({ error: `your role (${role || "unknown"}) can't update payment cards` }, 403);
    }
    if (!p.slack_channel || !p.slack_ts) return json({ ok: true, skipped: "no slack message stored" });
    const text = `Payment awaiting approval (revised): ${inr(Number(p.amount) || 0)} — ${p.payee_name ?? ""}`;
    const uj = await slackApi("chat.update", BOT_TOKEN, {
      channel: p.slack_channel, ts: p.slack_ts, text, blocks: paymentBlocks(p, false, deepLink),
    });
    if (!uj.ok) return json({ error: `Slack rejected the card update: ${uj.error}` }, 502);
    return json({ ok: true });
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

// ============================================================================
// Batches (payments_100) — many invoices to one payee, one transfer.
//
// The same four beats as a single payment (card → decision → OTP → paid note),
// but the card itemises the invoices so the owner approves a total he can see
// the parts of. A batch assembled from already-approved payments never reaches
// here — fn_payment_batch_submit sends it straight to 'approved'.
// ============================================================================

/** Load a batch, its lines (with type names) and the labels the card needs. */
// deno-lint-ignore no-explicit-any
export async function loadBatchForSlack(svc: any, id: string) {
  const { data } = await svc
    .from("payment_batches")
    .select(
      "id, payee_name, needed_by, status, note, mode, " +
      "approved_by_email, rejected_reason, slack_channel, slack_ts, otp_slack_ts, " +
      "operating_unit_id, bank_account_id, payee_account_last4, payee_ifsc, " +
      "paid_amount, paid_at, bank_reference, payment_receipt_url, paid_via_bank_account_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  // deno-lint-ignore no-explicit-any
  const b = data as any;

  const { data: lines } = await svc
    .from("payment_requests")
    .select("id, purpose, amount, invoice_url, payment_type_id, status")
    .eq("batch_id", id)
    .order("created_at", { ascending: true });
  // deno-lint-ignore no-explicit-any
  b.lines = (lines ?? []) as any[];

  // Type names, one round trip for the whole batch.
  const typeIds = [...new Set(b.lines.map((l: { payment_type_id: string | null }) => l.payment_type_id).filter(Boolean))];
  if (typeIds.length > 0) {
    const { data: types } = await svc
      .from("payment_types").select("id, name").in("id", typeIds);
    const byId = new Map((types ?? []).map((t: { id: string; name: string }) => [t.id, t.name]));
    for (const l of b.lines) l.type_name = byId.get(l.payment_type_id) ?? null;
  }

  b.gross = b.lines.reduce((a: number, l: { amount: number | string }) => a + (Number(l.amount) || 0), 0);

  const bankId = b.paid_via_bank_account_id ?? b.bank_account_id;
  if (bankId) {
    const { data: acc } = await svc
      .from("bank_accounts").select("name, bank_name").eq("id", bankId).maybeSingle();
    b.bank_label = acc ? [acc.name, acc.bank_name].filter(Boolean).join(" · ") : null;
  }
  if (b.operating_unit_id) {
    const { data: u } = await svc
      .from("operating_units").select("name, cinema_id").eq("id", b.operating_unit_id).maybeSingle();
    b.unit_name = u?.name ?? null;
    b.cinema_id = u?.cinema_id ?? null;
  }
  return b;
}

/** The invoice list, capped so a long batch can't blow Slack's block limits. */
// deno-lint-ignore no-explicit-any
function lineListText(b: any): string {
  const MAX = 12;
  // deno-lint-ignore no-explicit-any
  const shown = (b.lines as any[]).slice(0, MAX).map((l, i) => {
    const label = l.purpose || l.type_name || "Invoice";
    const link = l.invoice_url ? ` <${l.invoice_url}|invoice>` : "";
    return `${i + 1}. ${label} — ${inr(Number(l.amount) || 0)}${link}`;
  });
  const rest = b.lines.length - shown.length;
  if (rest > 0) shown.push(`_…and ${rest} more (open in console)._`);
  return shown.join("\n");
}

// deno-lint-ignore no-explicit-any
export function batchBlocks(b: any, decided: boolean, deepLink?: string | null): any[] {
  const rejected = b.status === "cancelled" || b.status === "rejected"
    || (b.status === "draft" && !!b.rejected_reason);
  const paid = b.status === "paid";
  const header = decided
    ? (rejected ? ":no_entry: *Batch payment rejected*"
      : paid ? ":moneybag: *Batch payment paid*"
      : ":white_check_mark: *Batch payment approved*")
    : ":money_with_wings: *Batch payment — awaiting your approval*";

  const fields = [
    `*Payee:* ${b.payee_name ?? "—"}`,
    `*Invoices:* ${b.lines?.length ?? 0}`,
    `*Total:* ${inr(Number(b.gross) || 0)}`,
    `*Needed by:* ${b.needed_by ?? "—"}`,
    `*Mode:* ${String(b.mode ?? "bank_transfer").replace(/_/g, " ")}`,
    `*Unit:* ${b.unit_name ?? "—"}`,
  ];

  // deno-lint-ignore no-explicit-any
  const blocks: any[] = [
    { type: "section", text: { type: "mrkdwn", text: header } },
    { type: "section", fields: fields.map((t) => ({ type: "mrkdwn", text: t })) },
  ];
  if (b.note) blocks.push({ type: "section", text: { type: "mrkdwn", text: `*For:* ${b.note}` } });
  if (b.lines?.length) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: lineListText(b) } });
  }

  if (decided) {
    const reason = rejected && b.rejected_reason ? ` — _${b.rejected_reason}_` : "";
    blocks.push({
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: `${rejected ? "Rejected" : "Approved"} by ${b.approved_by_email ?? "owner"}${reason}`,
      }],
    });
  } else {
    // deno-lint-ignore no-explicit-any
    const elements: any[] = [
      { type: "button", style: "primary", text: { type: "plain_text", text: "Approve all" },
        action_id: "payment_batch_approve", value: b.id },
      { type: "button", style: "danger", text: { type: "plain_text", text: "Reject" },
        action_id: "payment_batch_reject", value: b.id },
    ];
    if (deepLink) {
      elements.push({ type: "button", text: { type: "plain_text", text: "Open in console" }, url: deepLink });
    }
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: "One transfer settles all of these. Only the owner can approve." }],
    });
    blocks.push({ type: "actions", block_id: `payment_batch:${b.id}`, elements });
  }
  return blocks;
}

/** One line, for the same reason as otpRequestBlocks — see the note there. */
// deno-lint-ignore no-explicit-any
function batchOtpBlocks(b: any): any[] {
  return [{
    type: "section",
    text: {
      type: "mrkdwn",
      text: `:closed_lock_with_key: *OTP requested* — ${inr(Number(b.gross) || 0)} to *${b.payee_name ?? "—"}* (${b.lines?.length ?? 0} invoices)`,
    },
  }];
}

/**
 * Outbound handler for the batch Slack kinds (called by notify-slack):
 *   • payment_batch_card          — post the interactive card, store channel+ts.
 *   • payment_batch_card_decided  — edit it after a console decision.
 *   • payment_batch_otp_request   — reply asking the owner for the OTP.
 *   • payment_batch_paid_note     — reply reporting the single transfer.
 */
// deno-lint-ignore no-explicit-any
export async function handleBatchOutbound(
  svc: any, role: string, kind: string, batchId?: string,
  deepLink?: string | null, callerEmail?: string,
): Promise<Response> {
  const BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");
  const CHAN = Deno.env.get("SLACK_PAYMENTS_CHANNEL_ID");
  if (!BOT_TOKEN) {
    return json({ error: "Slack isn't set up for this environment (SLACK_BOT_TOKEN secret missing)." }, 500);
  }
  if (!batchId) return json({ error: "batchId required" }, 400);

  const b = await loadBatchForSlack(svc, batchId);
  if (!b) return json({ error: "batch not found" }, 404);

  if (kind === "payment_batch_card") {
    if (!PAYMENT_POST_ROLES.has(role)) {
      return json({ error: `your role (${role || "unknown"}) can't post payment cards` }, 403);
    }
    if (!CHAN) {
      return json({ error: "the payments Slack channel isn't set (SLACK_PAYMENTS_CHANNEL_ID secret missing)." }, 500);
    }
    const text = `Batch payment awaiting approval: ${inr(Number(b.gross) || 0)} — ${b.payee_name ?? ""} (${b.lines?.length ?? 0} invoices)`;
    const pj = await slackApi("chat.postMessage", BOT_TOKEN, {
      channel: CHAN, text, blocks: batchBlocks(b, false, deepLink),
    });
    if (!pj.ok) {
      const hint = pj.error === "not_in_channel" || pj.error === "channel_not_found"
        ? " — invite the bot to that channel (/invite @<app>) and check the channel id"
        : "";
      return json({ error: `Slack rejected the card: ${pj.error}${hint}` }, 502);
    }
    await svc.from("payment_batches")
      .update({ slack_channel: pj.channel, slack_ts: pj.ts })
      .eq("id", b.id);
    return json({ ok: true, channel: pj.channel, ts: pj.ts });
  }

  if (kind === "payment_batch_otp_request") {
    if (!PAYMENT_OTP_ROLES.has(role)) {
      return json({ error: `your role (${role || "unknown"}) can't request a payment OTP` }, 403);
    }
    if (!CHAN && !b.slack_channel) {
      return json({ error: "the payments Slack channel isn't set (SLACK_PAYMENTS_CHANNEL_ID secret missing)." }, 500);
    }
    const text = `OTP requested: ${inr(Number(b.gross) || 0)} — ${b.payee_name ?? ""} (${b.lines?.length ?? 0} invoices)`;
    // deno-lint-ignore no-explicit-any
    const payload: any = {
      channel: b.slack_channel ?? CHAN,
      text,
      blocks: batchOtpBlocks(b),
    };
    // A batch of already-approved lines has no card of its own to thread under
    // (it never asked for approval) — then this posts standalone, as intended.
    if (b.slack_ts) { payload.thread_ts = b.slack_ts; payload.reply_broadcast = true; }

    const pj = await slackApi("chat.postMessage", BOT_TOKEN, payload);
    if (!pj.ok) {
      const hint = pj.error === "not_in_channel" || pj.error === "channel_not_found"
        ? " — invite the bot to that channel (/invite @<app>) and check the channel id"
        : "";
      return json({ error: `Slack rejected the OTP request: ${pj.error}${hint}` }, 502);
    }
    await svc.from("payment_batches").update({ otp_slack_ts: pj.ts }).eq("id", b.id);
    return json({ ok: true, channel: pj.channel, ts: pj.ts, threaded: !!b.slack_ts });
  }

  if (kind === "payment_batch_paid_note") {
    if (!PAYMENT_OTP_ROLES.has(role)) {
      return json({ error: `your role (${role || "unknown"}) can't post payment updates` }, 403);
    }
    if (!b.slack_channel && !CHAN) return json({ ok: true, skipped: "no channel" });
    const amt = inr(Number(b.paid_amount ?? b.gross) || 0);
    const text = `Batch payment made: ${amt} — ${b.payee_name ?? ""}`;
    const lines = [
      `:white_check_mark: *Batch payment made* — ${amt} to *${b.payee_name ?? "—"}* settling ${b.lines?.length ?? 0} invoices`,
      `*Paid from:* ${b.bank_label ?? "—"}`,
      b.bank_reference ? `*Reference:* ${b.bank_reference}` : null,
      b.payment_receipt_url ? `*Receipt:* <${b.payment_receipt_url}|view>` : null,
      `Recorded by ${callerEmail ?? "the accountant"}.`,
    ].filter(Boolean).join("\n");

    // deno-lint-ignore no-explicit-any
    const payload: any = {
      channel: b.slack_channel ?? CHAN,
      text,
      blocks: [{ type: "section", text: { type: "mrkdwn", text: lines } }],
    };
    if (b.slack_ts) { payload.thread_ts = b.slack_ts; payload.reply_broadcast = true; }
    const pj = await slackApi("chat.postMessage", BOT_TOKEN, payload);
    if (!pj.ok) return json({ error: `Slack rejected the paid note: ${pj.error}` }, 502);
    return json({ ok: true, ts: pj.ts });
  }

  if (kind === "payment_batch_card_decided") {
    if (!b.slack_channel || !b.slack_ts) return json({ ok: true, skipped: "no slack message stored" });
    const text = `Batch payment ${b.status}: ${inr(Number(b.gross) || 0)} — ${b.payee_name ?? ""}`;
    const uj = await slackApi("chat.update", BOT_TOKEN, {
      channel: b.slack_channel, ts: b.slack_ts, text, blocks: batchBlocks(b, true),
    });
    if (!uj.ok) return json({ error: `Slack rejected the card update: ${uj.error}` }, 502);
    return json({ ok: true });
  }

  return json({ error: `unknown batch kind: ${kind}` }, 400);
}
