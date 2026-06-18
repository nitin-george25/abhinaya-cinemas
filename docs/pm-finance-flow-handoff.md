# PM Finance Flow — build handoff (pipeline #18)

Feature: expense approval & payment flow for the Project Management → Finances tab.
Design spec: `Operations/Project Management/PM Finances Redesign - User Flow.md`.
Files written into the working tree (currently on `feat/guides-page` — move to a clean branch below).

## What was added / changed
- **Backfill migration** `supabase/migrations/20260617130000_project_invoice_backfill.sql`
  - turns every pre-existing invoice into a completed `paid` expense and links
    it, so budget-line spend is unchanged after deploy. Idempotent; legacy items
    tagged "Imported from legacy invoice" in `payment_note`. **Critical for prod**
    (where real invoices exist) — without it, spend would drop to ₹0.
- **Skip-quotation side-step** `supabase/migrations/20260617140000_project_expense_skip_quote.sql`
  - PM/owner can skip the quotation stage with a reason ("known vendor"):
    `quoting → quote_approved` directly, recording vendor + amount + reason
    (`project_expenses.quote_skip_reason`). New RPC `fn_project_expense_skip_quotation`.
    UI: "Skip quotations" button in the quoting state (PM/owner); skip reason shown
    on the card.
- **Migration** `supabase/migrations/20260617120000_project_expense_flow.sql`
  - tables `project_expenses`, `project_quotations`; extends `project_invoices`
    (`expense_id`, `subtotal`, `gst`, `freight`, `total`, `deviation_reason`)
  - helper `is_accountant_or_owner()`
  - SECURITY DEFINER transition fns: `fn_project_quote_approve`,
    `fn_project_quotes_reject`, `fn_project_expense_record_invoice`,
    `fn_project_expense_request_payment`, `fn_project_expense_mark_paid`,
    `fn_project_expense_cancel`, `fn_project_expense_audit`
  - RLS: read = cinema_access; expense/quote writes = is_project_member;
    state changes gated inside the definer fns (owner approves; accountant
    requests + marks paid). Every transition writes `project_audit`.
- **DAL** `app/src/lib/projects.ts` — expense/quotation types + CRUD, transition
  RPC wrappers, `expenseFinanceSummary` (Estimate/Paid/Remaining); `ProjectBundle`
  + `loadProjectBundle` now include `expenses` + `quotations`.
- **UI** `app/src/components/projects/FinancesPanel.tsx` — rebuilt: budget-vs-paid
  table + expense cards with per-actor actions; quote file + invoice file required;
  invoice subtotal vs approved-amount deviation flag.
- **Wiring** `app/src/pages/projects/ProjectDetail.tsx` — passes expenses/quotations
  + `isOwner/isPM/isMember/isAccountant`. Also merges **Timeline + Checklist** into a
  single **Progress** tab (pills via `ui/Tabs`) with a status row: Progress %,
  Tasks done, Delayed (overdue, IST dates), Due in 7 days. Top-level tabs are now
  Progress / Finances / Team.
- **Edge Function** `supabase/functions/notify-slack/index.ts` — posts the payment
  request + OTP ask to Slack #payments (one-way webhook, accountant/owner only).

## 1. Move to a clean branch off main
The files are uncommitted on `feat/guides-page`; the 4 edited files are identical
between that branch and main, so stash → branch → pop is conflict-free.

```bash
cd ~/Developer/abhinaya-cinemas
rm -f .git/index.lock .git/packed-refs.lock
git stash -u
git checkout main && git pull
git checkout -b feat/pm-finance-flow
git stash pop
```

## 2. Build / typecheck (sandbox couldn't run npm)
```bash
cd app
npm install        # if node_modules was cleared in the move
npm run build      # report any TS errors back
```

## 3. Apply the migration (staging first)
```bash
npm run db:push:staging
# after verifying on staging:
npm run db:push:prod
```

## 4. Deploy the Slack function + set the webhook secrets (BOTH projects)
`notify-slack` posts to TWO channels via two webhooks: **#payments** (payment
requests + OTP ask) and **#invoices** (invoice uploaded). It's declared in
`supabase/config.toml` (`[functions.notify-slack]`), so the integration deploys
it on push — the `functions deploy` commands below are a manual fallback. Secrets
are NOT deployed by the integration, so set them per project (staging → staging
channels, prod → prod, parity).
```bash
supabase functions deploy notify-slack --project-ref lctkvmpzijaspaytunkm   # staging
supabase functions deploy notify-slack --project-ref xkmjygegtpmmwwnyoufn   # prod
# staging
supabase secrets set SLACK_PAYMENTS_WEBHOOK_URL="https://hooks.slack.com/services/XXX" --project-ref lctkvmpzijaspaytunkm
supabase secrets set SLACK_INVOICES_WEBHOOK_URL="https://hooks.slack.com/services/AAA" --project-ref lctkvmpzijaspaytunkm
# prod
supabase secrets set SLACK_PAYMENTS_WEBHOOK_URL="https://hooks.slack.com/services/YYY" --project-ref xkmjygegtpmmwwnyoufn
supabase secrets set SLACK_INVOICES_WEBHOOK_URL="https://hooks.slack.com/services/BBB" --project-ref xkmjygegtpmmwwnyoufn
```
Create each incoming webhook in Slack (add an app → Incoming Webhooks → add to
#payments and again to #invoices → copy each URL). The #invoices post is
best-effort — if its webhook is unset the invoice still records, it just won't notify.

## 5. Commit
```bash
git add supabase/migrations/20260617120000_project_expense_flow.sql \
        supabase/migrations/20260617130000_project_invoice_backfill.sql \
        supabase/migrations/20260617140000_project_expense_skip_quote.sql \
        supabase/functions/notify-slack/index.ts \
        supabase/config.toml \
        app/src/lib/projects.ts \
        app/src/components/ui/Tabs.tsx \
        app/src/components/projects/FinancesPanel.tsx \
        app/src/pages/projects/ProjectDetail.tsx \
        docs/pm-finance-flow-handoff.md
# (or simply: git add -A — this branch only has these changes)
git commit -m "feat(projects): expense approval & payment flow for PM finances"
git push -u origin feat/pm-finance-flow
```

## 6. Smoke test (on staging)
1. As PM/DM: raise an expense under a budget line, add ≥1 quotation **with a file**.
2. As owner: Approve one quotation (others auto-reject).
3. As PM/DM: Upload invoice (subtotal must match approved; add GST/freight).
4. As accountant: Request payment → check Slack **#payments** for the message.
5. Owner replies with an OTP on Slack → accountant enters it → Mark paid.
6. Confirm the budget line **Paid** + summary update, and the audit trail logged
   each step.

## Open follow-ups (not built)
- Two-way Slack (read the OTP reply / in-console chatbox) — deferred per design.
- The old `financeSummary`/`createInvoice` exports in projects.ts are now unused
  (left in place; safe to prune later).
