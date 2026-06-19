# Petty-expense two-way Slack approval (cash_21) — handoff

Post each pending petty expense to a dedicated **#petty-expenses** Slack channel
with **Approve / Reject** buttons. A decision can be taken from **either** Slack
**or** the console; whichever happens first updates the Slack message in place
and writes the same DB row. Approvers are matched to console users by their
**Slack email** (auto-match) and must be `owner` / `manager` / `daily_manager`
with access to the expense's cinema — identical to in-console rules.

## What changed in the code

Two Edge Functions at the deploy boundary (one outbound, one inbound), with the
shared mechanics extracted into `_shared/` modules — no duplicated Slack
plumbing, no per-event function sprawl, secrets set once per function.

- **`supabase/migrations/20260619000000_cash_21_petty_slack.sql`** — adds
  `petty_expenses.slack_channel` + `slack_ts` (coordinates of the posted message
  so it can be edited later). Idempotent, no RLS change.
- **`supabase/functions/_shared/slack.ts`** — NEW shared module: generic Slack +
  HTTP helpers (`slackApi`, `postWebhook`, `slackUserEmail`,
  `verifySlackSignature`, `ephemeral`, `inr`, `json`/`reply`). No domain logic.
- **`supabase/functions/_shared/petty.ts`** — NEW shared module: petty domain
  (`loadPettyExpense`, `pettyBlocks` (pending+decided in one builder),
  `authorizePettyApprover`, `handlePettyOutbound`, role sets).
- **`supabase/functions/notify-slack/index.ts`** — OUTBOUND. PM webhook kinds
  unchanged; petty kinds (`petty_request` / `petty_decided`) delegated to
  `handlePettyOutbound`. Uses the **bot token** for petty.
- **`supabase/functions/slack-interactions/index.ts`** — NEW, INBOUND. The Slack
  interactivity **Request URL**. Verifies the **signing secret**, resolves the
  clicker's email (`users.info`), authorizes, approves immediately or opens a
  **reject-reason modal**, then edits the message. `verify_jwt = false`.
- **`app/src/lib/cash.ts`** — `createPettyExpense` posts `petty_request`;
  `approvePettyExpense` / `rejectPettyExpense` post `petty_decided`. All
  **best-effort** — Slack being down or unconfigured never breaks the expense.
- **`supabase/config.toml`** — declares `slack-interactions` (`verify_jwt=false`)
  and updates the `notify-slack` note.

> `_shared/` is shared code, **not** a deployable function — the leading-underscore
> directory is skipped by `supabase functions deploy` and bundled into each
> function that imports it. No `config.toml` entry for it.

## One-time Slack app setup (do this once per environment)

Because staging and prod are separate Supabase projects with different function
URLs, create **two Slack apps** (or one app per workspace) — a staging app and a
prod app — each pointed at its own project. Steps are identical for both.

1. **Create the app** at <https://api.slack.com/apps> → *Create New App* → *From
   scratch*. Name it e.g. "Abhinaya Console (prod)".
2. **Bot scopes** — *OAuth & Permissions* → *Scopes* → *Bot Token Scopes*, add:
   - `chat:write` — post + edit the approval messages
   - `users:read` and `users:read.email` — map the clicker to a console user
3. **Install** the app to the workspace (*Install to Workspace*). Copy the
   **Bot User OAuth Token** (`xoxb-…`).
4. **Signing secret** — *Basic Information* → *App Credentials* → copy the
   **Signing Secret**.
5. **Create the channel** `#petty-expenses`, then **invite the bot**:
   `/invite @Abhinaya Console`. Get the channel **ID** (channel → *View channel
   details* → bottom, `C0XXXXXXX`).
6. **Enable interactivity** — *Interactivity & Shortcuts* → toggle on →
   **Request URL**:
   `https://<PROJECT_REF>.supabase.co/functions/v1/slack-interactions`
   (use the staging project ref for the staging app, prod ref for the prod app).
   Save.

## Set the Edge Function secrets (per Supabase project)

```bash
# staging project
supabase secrets set --project-ref <STAGING_REF> \
  SLACK_BOT_TOKEN='xoxb-...staging...' \
  SLACK_SIGNING_SECRET='...staging...' \
  SLACK_PETTY_CHANNEL_ID='C0...staging...'

# prod project
supabase secrets set --project-ref <PROD_REF> \
  SLACK_BOT_TOKEN='xoxb-...prod...' \
  SLACK_SIGNING_SECRET='...prod...' \
  SLACK_PETTY_CHANNEL_ID='C0...prod...'
```

The existing `SLACK_PAYMENTS_WEBHOOK_URL` / `SLACK_INVOICES_WEBHOOK_URL` (PM
flow) are unchanged and stay set.

## Deploy

CI applies migrations and deploys functions on push (staging→staging DB,
main→prod DB). `notify-slack` and `slack-interactions` are both declared in
`config.toml`, so a push deploys them. If deploying by hand:

```bash
supabase functions deploy notify-slack       --project-ref <REF>
supabase functions deploy slack-interactions  --project-ref <REF> --no-verify-jwt
supabase db push   # applies 20260619000000_cash_21_petty_slack.sql
```

## End-to-end test (staging first)

1. As a cashier, create a petty expense → a card appears in **#petty-expenses**
   with Approve / Reject.
2. Click **Approve** as an owner/manager/daily_manager whose Slack email matches
   their console email → message flips to "approved by …"; the expense shows
   approved in the console.
3. New expense → click **Reject** → modal asks for a reason → submit → message
   flips to "rejected … — reason"; console shows rejected with the reason.
4. New expense → **approve in the console** → the Slack card updates to
   "approved" with the buttons gone.
5. Click a button as a non-approver (e.g. cashier) → polite ephemeral "your role
   can't approve" and the card is untouched.

## Notes / gotchas

- **`verify_jwt=false` + apikey:** `slack-interactions` must be publicly
  reachable. If Slack reports the Request URL failing with 401, append the anon
  key as a query param to the Request URL
  (`…/slack-interactions?apikey=<ANON_KEY>`) — the signing-secret check still
  protects the endpoint.
- **Email match:** auto-match assumes a user's Slack email equals their console
  `authorized_users.email`. If someone's emails differ, they'll get the ephemeral
  "isn't a console user" notice and can approve in the console instead.
- **Staging/prod parity:** two Slack apps, two channels, secrets set per project.
  Nothing is hard-coded; each function reads its own project's secrets.
- The reject modal needs `chat:write` (to edit the message) and the message's
  `channel`+`ts`, carried in the modal's `private_metadata`.
