# Unified Payments — Slack approval card (§7) — handoff

Every submitted payment posts an interactive **Approve / Reject** card to a
dedicated **#payments** channel, and any console-side decision edits that card in
place. This is the same mechanism as the petty-expense flow
([petty-slack-handoff.md](petty-slack-handoff.md)) — same Slack app, same bot
token, same interactivity Request URL — but a **different channel** and a
**different secret**, and that is the piece that gets missed.

> **If payments aren't reaching Slack, check `SLACK_PAYMENTS_CHANNEL_ID` first.**
> It is separate from `SLACK_PAYMENTS_WEBHOOK_URL` (the one-way PM webhook) and
> from `SLACK_PETTY_CHANNEL_ID`. Without it the Edge Function returns
> "the payments Slack channel isn't set", the transition still succeeds, and no
> card is posted.

## The moving parts

| Piece | Where |
| --- | --- |
| Post / edit the card | `supabase/functions/_shared/payments.ts` → `handlePaymentOutbound` |
| Outbound entry point | `supabase/functions/notify-slack` (kinds `payment_card`, `payment_card_decided`) |
| Button clicks + reject modal | `supabase/functions/slack-interactions` (actions `payment_approve`, `payment_reject`) |
| DB transition from Slack | `fn_slack_payment_decide` (migration `20260629140000_payments_20_slack.sql`) |
| Console callers | `app/src/lib/payments.ts` → `postPaymentCard` / `syncPaymentCard` |

Posting is **best-effort** — a Slack outage never blocks the payment — but the
reason is now returned to the console and shown as an amber notice
("Submitted, but the Slack approval card didn't go out: …") instead of only
landing in the browser console.

## Required secrets (per Supabase project)

```bash
supabase secrets set --project-ref <REF> \
  SLACK_BOT_TOKEN='xoxb-...' \
  SLACK_SIGNING_SECRET='...' \
  SLACK_PAYMENTS_CHANNEL_ID='C0...'
```

- `SLACK_BOT_TOKEN` / `SLACK_SIGNING_SECRET` — already set if petty approvals
  work; the payments card reuses them.
- `SLACK_PAYMENTS_CHANNEL_ID` — the **channel id** (not the name) of the channel
  the card is posted to. Channel → *View channel details* → bottom, `C0XXXXXXX`.
- Set them on **both** projects: staging `lctkvmpzijaspaytunkm`, prod
  `xkmjygegtpmmwwnyoufn`.

Then **invite the bot to that channel**: `/invite @Abhinaya Console`. Without
this, Slack answers `not_in_channel` and the console notice says so.

## Owner mapping (needed for the buttons, not the post)

`fn_slack_payment_decide` resolves the clicking Slack user to a console user and
requires the `owner` role:

```sql
update public.authorized_users set slack_user_id = 'U0123ABC' where role = 'owner';
```

Without it, clicking Approve returns "Your Slack account isn't linked to a
console user" — the card posts fine, only the decision is blocked.

## Checklist when "payments aren't notifying Slack"

1. Submit a payment in the console. An amber notice naming the cause now appears
   if the post failed — start there.
2. `SLACK_PAYMENTS_CHANNEL_ID` set on that project? (`supabase secrets list --project-ref <REF>`)
3. Bot invited to the channel?
4. Caller's role — only `owner` / `manager` / `accountant` may post a card; the
   notice reports the role that was resolved.
5. `authorized_users.email` matches the signed-in email (compared
   case-insensitively since this fix).
6. Function logs: Supabase dashboard → Edge Functions → `notify-slack` → Logs.

## End-to-end test (staging first)

1. Make a payment → **Submit for approval** → card appears in #payments with
   Approve / Reject / Open in console.
2. Click **Approve** as the mapped owner → card flips to "Payment approved",
   console shows `approved`.
3. New payment → **Reject** in Slack → reason modal → card flips to rejected;
   the console shows the payment back in **Drafts** with the reason and an
   **Edit** action to revise and resubmit.
4. New payment → approve **in the console** → the Slack card updates in place
   with the buttons removed.
