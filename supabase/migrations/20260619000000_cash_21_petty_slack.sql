-- ============================================================================
-- cash_21 — Slack two-way approval for petty expenses
--
-- Stores the coordinates of the Slack approval message posted for each petty
-- expense so the message can be UPDATED in place (chat.update) after a
-- decision is taken from EITHER side:
--   • from Slack  — the slack-interactions Edge Function updates via response_url
--   • from the console — cash.ts invokes notify-slack(kind=petty_decided), which
--                        reads these columns and calls chat.update.
--
-- No new RLS: the columns are written by the notify-slack Edge Function using
-- the service-role key (the petty-expense creator — a cashier — has no UPDATE
-- privilege on the row, so the function does the write, not the client).
-- Idempotent.
-- ============================================================================

begin;

alter table public.petty_expenses
  add column if not exists slack_channel text,   -- Slack channel ID the approval message was posted to
  add column if not exists slack_ts      text;   -- Slack message ts (timestamp id) for chat.update

comment on column public.petty_expenses.slack_channel is
  'Slack channel ID of the posted approval message (cash_21, two-way Slack approval).';
comment on column public.petty_expenses.slack_ts is
  'Slack message ts of the posted approval message; used by chat.update to reflect the decision.';

commit;
