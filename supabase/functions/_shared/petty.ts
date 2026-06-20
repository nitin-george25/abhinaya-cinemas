// ============================================================================
// _shared/petty.ts — petty-expense domain logic for two-way Slack approval
// (cash_21). Shared by notify-slack (outbound: post + edit) and
// slack-interactions (inbound: authorize + decide + edit).
//
// SHARED CODE, not a deployable function. Generic Slack plumbing lives in
// ./slack.ts; this file owns only what's specific to petty expenses.
// ============================================================================

import { inr, json, slackApi, slackUserEmail } from "./slack.ts";

// Who may trigger a petty-expense Slack post (creators + approvers).
export const PETTY_POST_ROLES = new Set([
  "cashier", "owner", "manager", "daily_manager", "accountant",
]);
// Who may decide a petty expense (mirrors can_approve_petty_expense()).
export const PETTY_APPROVE_ROLES = new Set(["owner", "manager", "daily_manager"]);

/**
 * Load a petty expense plus its unit/counter names and cinema id (for the
 * message + the approver's cinema-access check). Names/cinema are looked up
 * separately — the pos_counters FK is composite, which trips PostgREST's
 * automatic embedding.
 */
// deno-lint-ignore no-explicit-any
export async function loadPettyExpense(svc: any, id: string) {
  const { data } = await svc
    .from("petty_expenses")
    .select(
      "id, operating_unit_id, pos_counter_id, amount, category, description, " +
      "paid_to, expense_date, status, approved_by_email, rejected_reason, " +
      "requested_by_email, receipt_url, no_receipt_reason, slack_channel, slack_ts",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  // deno-lint-ignore no-explicit-any
  const d = data as any;
  if (d.operating_unit_id) {
    const { data: u } = await svc
      .from("operating_units").select("name, cinema_id").eq("id", d.operating_unit_id).maybeSingle();
    d.unit_name = u?.name ?? null;
    d.cinema_id = u?.cinema_id ?? null;
  }
  if (d.pos_counter_id) {
    const { data: c } = await svc
      .from("pos_counters").select("name").eq("id", d.pos_counter_id).maybeSingle();
    d.counter_name = c?.name ?? null;
  }
  return d;
}

/**
 * Block Kit layout for a petty expense. `decided=false` renders the pending
 * card with Approve/Reject buttons; `decided=true` renders the static
 * approved/rejected card (buttons removed). One builder, both states + sides.
 */
// deno-lint-ignore no-explicit-any
export function pettyBlocks(e: any, decided: boolean): any[] {
  const header = decided
    ? (e.status === "approved"
        ? ":white_check_mark: *Petty expense approved*"
        : ":x: *Petty expense rejected*")
    : ":receipt: *Petty expense — pending approval*";

  const fields = [
    `*Amount:* ${inr(Number(e.amount) || 0)}`,
    `*Category:* ${e.category ?? "—"}`,
    `*Paid to:* ${e.paid_to ?? "—"}`,
    `*Date:* ${e.expense_date ?? "—"}`,
    `*Unit:* ${e.unit_name ?? "—"}`,
    `*Counter:* ${e.counter_name ?? "—"}`,
  ];

  // deno-lint-ignore no-explicit-any
  const blocks: any[] = [
    { type: "section", text: { type: "mrkdwn", text: header } },
    { type: "section", text: { type: "mrkdwn", text: `*Description:* ${e.description ?? "—"}` } },
    { type: "section", fields: fields.map((t) => ({ type: "mrkdwn", text: t })) },
  ];

  if (e.receipt_url) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Receipt:* <${e.receipt_url}|view>` } });
  } else if (e.no_receipt_reason) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*No receipt:* ${e.no_receipt_reason}` } });
  }

  if (decided) {
    const reason = e.status === "rejected" && e.rejected_reason ? ` — _${e.rejected_reason}_` : "";
    blocks.push({
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: `${e.status === "approved" ? "Approved" : "Rejected"} by ${e.approved_by_email ?? "—"}${reason}`,
      }],
    });
  } else {
    blocks.push({
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: `Requested by ${e.requested_by_email ?? "—"} · approve here or in the console`,
      }],
    });
    blocks.push({
      type: "actions",
      block_id: `petty:${e.id}`,
      elements: [
        { type: "button", style: "primary", text: { type: "plain_text", text: "Approve" },
          action_id: "petty_approve", value: e.id },
        { type: "button", style: "danger", text: { type: "plain_text", text: "Reject" },
          action_id: "petty_reject", value: e.id },
      ],
    });
  }
  return blocks;
}

/**
 * Authorize a clicking Slack user against an expense: resolve their Slack email,
 * match an authorized_users row, require an approver role + cinema access.
 * Returns the matched console email, or an error string to show the user.
 */
// deno-lint-ignore no-explicit-any
export async function authorizePettyApprover(
  svc: any, botToken: string, slackUserId: string, expense: any,
): Promise<{ email: string } | { error: string }> {
  const email = await slackUserEmail(botToken, slackUserId);
  if (!email) {
    return { error: "Couldn't read your Slack email. Ask an admin to add the users:read.email scope, or approve in the console." };
  }
  const { data: u } = await svc
    .from("authorized_users").select("role, cinema_ids").eq("email", email.toLowerCase()).maybeSingle();
  if (!u) return { error: `Your Slack email (${email}) isn't a console user. Approve in the console instead.` };
  if (!PETTY_APPROVE_ROLES.has(u.role)) return { error: "Your role can't approve petty expenses." };
  const cinemaIds: string[] = u.cinema_ids ?? [];
  if (expense.cinema_id && !cinemaIds.includes(expense.cinema_id)) {
    return { error: "You don't have access to this expense's cinema." };
  }
  return { email: email.toLowerCase() };
}

/**
 * Outbound handler for the petty Slack kinds (called by notify-slack):
 *   • petty_request  — post the interactive card, store channel+ts.
 *   • petty_decided  — edit the stored card after a console-side decision.
 * Reads its own Slack secrets. Returns a JSON Response.
 */
// deno-lint-ignore no-explicit-any
export async function handlePettyOutbound(
  svc: any, role: string, kind: string, pettyExpenseId?: string,
): Promise<Response> {
  const BOT_TOKEN  = Deno.env.get("SLACK_BOT_TOKEN");
  const PETTY_CHAN = Deno.env.get("SLACK_PETTY_CHANNEL_ID");
  if (!BOT_TOKEN) return json({ error: "SLACK_BOT_TOKEN not configured" }, 500);
  if (!pettyExpenseId) return json({ error: "pettyExpenseId required" }, 400);

  const expense = await loadPettyExpense(svc, pettyExpenseId);
  if (!expense) return json({ error: "petty expense not found" }, 404);

  if (kind === "petty_request") {
    if (!PETTY_POST_ROLES.has(role)) return json({ error: "not permitted" }, 403);
    if (!PETTY_CHAN) return json({ error: "SLACK_PETTY_CHANNEL_ID not configured" }, 500);

    const text = `Petty expense pending: ${inr(Number(expense.amount) || 0)} — ${expense.description ?? ""}`;
    const pj = await slackApi("chat.postMessage", BOT_TOKEN, {
      channel: PETTY_CHAN, text, blocks: pettyBlocks(expense, false),
    });
    if (!pj.ok) return json({ error: `chat.postMessage failed: ${pj.error}` }, 502);

    // Store the message coordinates so a later decision can edit it in place.
    // The cashier creator has no UPDATE right on the row — the service role does it.
    await svc.from("petty_expenses")
      .update({ slack_channel: pj.channel, slack_ts: pj.ts })
      .eq("id", expense.id);

    return json({ ok: true, channel: pj.channel, ts: pj.ts });
  }

  if (kind === "petty_decided") {
    if (!PETTY_APPROVE_ROLES.has(role)) return json({ error: "not permitted" }, 403);
    if (!expense.slack_channel || !expense.slack_ts) {
      return json({ ok: true, skipped: "no slack message stored" });
    }
    const text = `Petty expense ${expense.status}: ${inr(Number(expense.amount) || 0)} — ${expense.description ?? ""}`;
    const uj = await slackApi("chat.update", BOT_TOKEN, {
      channel: expense.slack_channel, ts: expense.slack_ts,
      text, blocks: pettyBlocks(expense, true),
    });
    if (!uj.ok) return json({ error: `chat.update failed: ${uj.error}` }, 502);
    return json({ ok: true });
  }

  return json({ error: `unknown petty kind: ${kind}` }, 400);
}
