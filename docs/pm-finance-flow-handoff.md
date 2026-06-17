# PM Finance Flow — build handoff (pipeline #18)

Feature: expense approval & payment flow for the Project Management → Finances tab.
Design spec: `Operations/Project Management/PM Finances Redesign - User Flow.md`.
Files written into the working tree (currently on `feat/guides-page` — move to a clean branch below).

## What was added / changed
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
  + `isOwner/isPM/isMember/isAccountant`.
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

## 4. Deploy the Slack function + set the webhook secret (BOTH projects)
Staging webhook → staging #payments, prod webhook → prod #payments (parity).
```bash
supabase functions deploy notify-slack --project-ref lctkvmpzijaspaytunkm   # staging
supabase functions deploy notify-slack --project-ref xkmjygegtpmmwwnyoufn   # prod
supabase secrets set SLACK_PAYMENTS_WEBHOOK_URL="https://hooks.slack.com/services/XXX" --project-ref lctkvmpzijaspaytunkm
supabase secrets set SLACK_PAYMENTS_WEBHOOK_URL="https://hooks.slack.com/services/YYY" --project-ref xkmjygegtpmmwwnyoufn
```
Create the incoming webhook in Slack: add an app to the workspace → Incoming
Webhooks → add to #payments → copy the URL.

## 5. Commit
```bash
git add supabase/migrations/20260617120000_project_expense_flow.sql \
        supabase/functions/notify-slack/index.ts \
        app/src/lib/projects.ts \
        app/src/components/projects/FinancesPanel.tsx \
        app/src/pages/projects/ProjectDetail.tsx \
        docs/pm-finance-flow-handoff.md
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
