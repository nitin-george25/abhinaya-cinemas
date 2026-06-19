// ============================================================================
// slack-interactions — INBOUND Slack interactivity (cash_21).
//
// The "Request URL" configured under Interactivity & Shortcuts. Slack POSTs here
// when a user clicks Approve/Reject on a petty-expense card (or submits the
// reject-reason modal):
//   • Approve button  → approve the expense, edit the card to "approved".
//   • Reject button   → open a modal asking for a reason.
//   • Modal submitted → reject with that reason, edit the card.
//
// Security: no Supabase JWT (Slack can't send one) → verify_jwt=false; every
// request is authenticated via the Slack SIGNING SECRET (HMAC over the raw
// body). The clicker is matched to an authorized_users row by Slack email and
// must be owner/manager/daily_manager with access to the expense's cinema. The
// service-role key performs the DB write. Domain logic lives in ../_shared.
//
// Secrets (per Supabase project): SLACK_SIGNING_SECRET, SLACK_BOT_TOKEN.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { ephemeral, reply, slackApi, verifySlackSignature } from "../_shared/slack.ts";
import { authorizePettyApprover, loadPettyExpense, pettyBlocks } from "../_shared/petty.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply("method not allowed", 405);

  const SIGNING_SECRET = Deno.env.get("SLACK_SIGNING_SECRET");
  const BOT_TOKEN      = Deno.env.get("SLACK_BOT_TOKEN");
  const SUPABASE_URL   = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SIGNING_SECRET || !BOT_TOKEN || !SUPABASE_URL || !SERVICE_KEY) {
    return reply("server not configured", 500);
  }

  // Read the RAW body first — the signature is computed over it.
  const rawBody = await req.text();
  const valid = await verifySlackSignature(
    SIGNING_SECRET,
    req.headers.get("x-slack-request-timestamp") ?? "",
    rawBody,
    req.headers.get("x-slack-signature") ?? "",
  );
  if (!valid) return reply("invalid signature", 401);

  // Interactivity payloads arrive urlencoded as payload=<json>.
  const payloadStr = new URLSearchParams(rawBody).get("payload");
  if (!payloadStr) return reply("no payload", 400);
  // deno-lint-ignore no-explicit-any
  let payload: any;
  try { payload = JSON.parse(payloadStr); } catch { return reply("bad payload", 400); }

  const svc = createClient(SUPABASE_URL, SERVICE_KEY);

  // --------------------------------------------------------------------------
  // 1) Button click (Approve / Reject).
  // --------------------------------------------------------------------------
  if (payload.type === "block_actions") {
    const action = payload.actions?.[0];
    const expenseId = action?.value as string | undefined;
    const responseUrl = payload.response_url as string;
    const slackUserId = payload.user?.id as string;
    if (!action || !expenseId) return reply();

    const expense = await loadPettyExpense(svc, expenseId);
    if (!expense) { await ephemeral(responseUrl, "That expense no longer exists."); return reply(); }

    const channel = payload.container?.channel_id ?? expense.slack_channel;
    const ts = payload.message?.ts ?? expense.slack_ts;

    // Already decided? Refresh the card and tell the clicker.
    if (expense.status !== "pending") {
      await slackApi("chat.update", BOT_TOKEN, {
        channel, ts, text: `Petty expense ${expense.status}`, blocks: pettyBlocks(expense, true),
      });
      await ephemeral(responseUrl, `Already ${expense.status}.`);
      return reply();
    }

    const auth = await authorizePettyApprover(svc, BOT_TOKEN, slackUserId, expense);
    if ("error" in auth) { await ephemeral(responseUrl, auth.error); return reply(); }

    if (action.action_id === "petty_approve") {
      const { data: updated } = await svc
        .from("petty_expenses")
        .update({ status: "approved", approved_by_email: auth.email, approved_at: new Date().toISOString() })
        .eq("id", expenseId).eq("status", "pending")
        .select("id").maybeSingle();
      const fresh = await loadPettyExpense(svc, expenseId);
      await slackApi("chat.update", BOT_TOKEN, {
        channel, ts, text: "Petty expense approved", blocks: pettyBlocks(fresh, true),
      });
      if (!updated) await ephemeral(responseUrl, "It was just decided by someone else.");
      return reply();
    }

    if (action.action_id === "petty_reject") {
      // Open a modal to capture the reason; the reject happens on submit.
      const res = await slackApi("views.open", BOT_TOKEN, {
        trigger_id: payload.trigger_id,
        view: {
          type: "modal",
          callback_id: "petty_reject_modal",
          private_metadata: JSON.stringify({ expenseId, channel, ts }),
          title: { type: "plain_text", text: "Reject expense" },
          submit: { type: "plain_text", text: "Reject" },
          close: { type: "plain_text", text: "Cancel" },
          blocks: [{
            type: "input",
            block_id: "reason_block",
            label: { type: "plain_text", text: "Reason for rejection" },
            element: { type: "plain_text_input", action_id: "reason", multiline: true },
          }],
        },
      });
      if (!res.ok) await ephemeral(responseUrl, `Couldn't open the reject dialog: ${res.error}`);
      return reply();
    }

    return reply();
  }

  // --------------------------------------------------------------------------
  // 2) Reject-reason modal submitted.
  // --------------------------------------------------------------------------
  if (payload.type === "view_submission" && payload.view?.callback_id === "petty_reject_modal") {
    let meta: { expenseId: string; channel: string; ts: string };
    try { meta = JSON.parse(payload.view.private_metadata); }
    catch { return reply({ response_action: "clear" }); }

    const reason = payload.view.state?.values?.reason_block?.reason?.value?.trim() ?? "";
    if (!reason) {
      return reply({ response_action: "errors", errors: { reason_block: "Please give a reason." } });
    }

    const expense = await loadPettyExpense(svc, meta.expenseId);
    if (!expense) return reply({ response_action: "clear" });

    if (expense.status !== "pending") {
      await slackApi("chat.update", BOT_TOKEN, {
        channel: meta.channel, ts: meta.ts,
        text: `Petty expense ${expense.status}`, blocks: pettyBlocks(expense, true),
      });
      return reply({ response_action: "clear" });
    }

    const auth = await authorizePettyApprover(svc, BOT_TOKEN, payload.user?.id, expense);
    if ("error" in auth) {
      return reply({ response_action: "errors", errors: { reason_block: auth.error } });
    }

    await svc.from("petty_expenses")
      .update({
        status: "rejected", approved_by_email: auth.email,
        approved_at: new Date().toISOString(), rejected_reason: reason,
      })
      .eq("id", meta.expenseId).eq("status", "pending");

    const fresh = await loadPettyExpense(svc, meta.expenseId);
    await slackApi("chat.update", BOT_TOKEN, {
      channel: meta.channel, ts: meta.ts,
      text: "Petty expense rejected", blocks: pettyBlocks(fresh, true),
    });
    return reply({ response_action: "clear" });
  }

  return reply();
});
