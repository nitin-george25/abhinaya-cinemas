# Unified Payments — Slack approval card (§7) — handoff

Every submitted payment posts an interactive **Approve / Reject** card to a
dedicated **#payments** channel, and any console-side decision edits that card in
place. Two further messages land **as replies in that card's thread** (added
2026-08-06, migration `payments_70`), so one payment reads as one conversation:

| Thread message | Posted when | By |
| --- | --- | --- |
| :closed_lock_with_key: **OTP requested** (type, payee, amount, mode, paying-from account, payee A/c, unit, approver, purpose, invoice) | accountant clicks **Request payment OTP** on an approved payment | accountant / owner |
| :white_check_mark: **Payment made** (+ receipt link) | accountant marks it paid | accountant / owner |

The owner answers the OTP ask with the bank's code **as a normal thread reply**.
Nothing reads or stores that reply — a bank OTP can't be verified by us and has no
business sitting in the database. The console records only that it was asked for,
by whom, and when. Both replies use `reply_broadcast`, so they also surface in the
channel rather than hiding in the thread.

This is the same mechanism as the petty-expense flow
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
| Post / edit the card, thread replies | `supabase/functions/_shared/payments.ts` → `handlePaymentOutbound` |
| Outbound entry point | `supabase/functions/notify-slack` (kinds `payment_card`, `payment_card_decided`, `payment_card_refresh`, `payment_otp_request`, `payment_paid_note`) |
| Button clicks + reject modal | `supabase/functions/slack-interactions` (actions `payment_approve`, `payment_reject`) |
| DB transition from Slack | `fn_slack_payment_decide` (migration `20260629140000_payments_20_slack.sql`) |
| OTP step + receipt gate | `fn_payment_request_otp` / `fn_payment_mark_paid` (migration `20260806120000_payments_70_otp_receipt.sql`) |
| Edit window + re-approval | `fn_payment_edit` / `fn_payment_can_edit` (migration `20260806130000_payments_80_edit_window.sql`) |
| Console callers | `app/src/lib/payments.ts` → `postPaymentCard` / `syncPaymentCard` / `postOtpRequest` / `postPaidNote` |

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
5. On an approved payment, the accountant's only action is **Request payment
   OTP** → a "Payment OTP needed" reply appears in that card's thread. Reply to
   it with a code as the owner (nothing is stored — this is the handshake).
6. **Mark paid** is now available; it refuses to submit without a **transaction
   receipt**. On success a "Payment made" reply lands in the same thread with the
   receipt link, and the console shows the receipt under Documents.

7. Edit a payment that's still awaiting approval → the posted card re-renders in
   place with the new figures and a ":pencil2: Revised" note. Edit an *approved*
   payment's amount or payee → it drops back to awaiting approval and a **new**
   card is posted (the old one stays as the record of what was approved).

If a thread reply fails (bot removed, channel id wrong), the transition still
goes through and the console shows an amber "…, but Slack wasn't updated: …"
notice — the accountant then has to ask the owner for the OTP by other means.

> **A generic "Payment requested — Project: —, Amount: ₹0" card in #payments
> means this function is running an older build.** Any `payment_*` kind it
> doesn't recognise used to fall through to the one-way PM webhook and post that
> empty card; it now answers `this notify-slack deployment doesn't handle the
> kind "…"` instead. Redeploy `notify-slack` **and** `slack-interactions` — they
> share `_shared/payments.ts`.

## Which build is live?

`_shared/payments.ts` exports `PAYMENTS_BUILD`. Both functions log it on boot and
on every request, so **Dashboard → Edge Functions → `notify-slack` → Logs** shows
a line like:

```
[notify-slack] kind=payment_otp_request role=accountant build=2026-08-06 · otp+receipt+edit (payments_70/80/90)
```

No `build=` line at all means an older build is running — it doesn't log. Because
the constant lives in `_shared`, seeing it also proves the shared module was
bundled, which is the part a partial redeploy misses. `notify-slack` also answers
`{"kind":"ping"}` with the build and every kind it handles, with no side effects.

## Deploying the functions

Migrations and Edge Functions ship **separately** — `npm run db:push:prod` does
not touch the functions, which is how the console ends up doing the right thing
while Slack posts nonsense. After any change under `supabase/functions/`:

```bash
npm run fn:deploy:staging
npm run fn:deploy:prod
```

`scripts/functions-deploy.sh` deploys `notify-slack` + `slack-interactions`
together (both bundle `_shared/payments.ts`, and a `_shared` change means every
importer needs redeploying), asks before touching prod, and prints the live
`UPDATED_AT` afterwards so a no-op deploy is obvious. It needs
`SUPABASE_ACCESS_TOKEN` — the same token `db-push.sh` uses — and falls back to
`npx supabase@latest` when the CLI isn't installed.
