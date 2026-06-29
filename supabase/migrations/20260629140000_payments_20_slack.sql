-- ============================================================================
-- payments_20 — Interactive Slack approval for unified payments (phase 3, §7).
--
-- The owner approves/rejects every payment from an interactive Block Kit card in
-- #payments (replaces the OTP). Mirrors the proven petty-expense mechanism:
--   • notify-slack posts the card on submit and stores slack_channel + slack_ts.
--   • slack-interactions handles the Approve/Reject buttons + reject modal.
--
-- This migration adds:
--   1) authorized_users.slack_user_id — maps a Slack identity → console user.
--   2) payment_requests.slack_channel / slack_ts — the posted card coordinates.
--   3) fn_slack_payment_decide — the transition the edge function calls. It is
--      SECURITY DEFINER and verifies the clicking Slack user maps to the OWNER,
--      so the owner check lives in SQL too (defence in depth). EXECUTE is
--      revoked from anon/authenticated and granted only to service_role, so it
--      can't be called directly from a browser with a spoofed slack_user_id.
--
-- HOW TO RUN: npm run db:push:staging / :prod (Supabase CLI). Idempotent.
-- After applying: set the owner's authorized_users.slack_user_id, and set the
-- per-env secrets SLACK_PAYMENTS_CHANNEL_ID / SLACK_BOT_TOKEN /
-- SLACK_SIGNING_SECRET (staging and prod use separate Slack apps/channels).
-- ============================================================================

begin;

alter table public.authorized_users
  add column if not exists slack_user_id text;
comment on column public.authorized_users.slack_user_id is
  'Slack user id (e.g. U0123ABC) used to authorise interactive payment approvals (§7).';

alter table public.payment_requests
  add column if not exists slack_channel text,
  add column if not exists slack_ts      text;

-- ----------------------------------------------------------------------------
-- Slack-driven approve/reject. Called ONLY by the edge function (service role).
-- Verifies the Slack user maps to the owner, performs the transition + audit.
-- Returns the resolved approver email so the card can show "Approved by …".
-- ----------------------------------------------------------------------------
create or replace function public.fn_slack_payment_decide(
  p_payment_id uuid, p_slack_user_id text, p_decision text, p_reason text
) returns text language plpgsql security definer set search_path = public
as $$
declare r public.payment_requests%rowtype; v_email text; v_role text;
begin
  select email, role into v_email, v_role
    from public.authorized_users
   where slack_user_id = p_slack_user_id
   limit 1;
  if v_email is null then raise exception 'SLACK_USER_UNMAPPED'; end if;
  if v_role <> 'owner' then raise exception 'NOT_OWNER'; end if;

  select * into r from public.payment_requests where id = p_payment_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status not in ('pending','awaiting_approval','awaiting_payment_approval') then
    raise exception 'NOT_AWAITING:%', r.status;
  end if;

  if p_decision = 'approve' then
    update public.payment_requests
       set status = 'approved', approved_by_email = v_email,
           approved_by_slack_user = p_slack_user_id, approved_at = now()
     where id = r.id;
    insert into public.payment_audit (payment_id, from_status, to_status, actor_email, actor_slack_user, note)
    values (r.id, r.status, 'approved', v_email, p_slack_user_id, 'Approved in Slack');
  elsif p_decision = 'reject' then
    if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
    update public.payment_requests
       set status = 'draft', rejected_reason = p_reason, approved_by_slack_user = p_slack_user_id
     where id = r.id;
    insert into public.payment_audit (payment_id, from_status, to_status, actor_email, actor_slack_user, note)
    values (r.id, r.status, 'rejected', v_email, p_slack_user_id, p_reason);
  else
    raise exception 'BAD_DECISION';
  end if;

  return v_email;
end;
$$;

revoke execute on function public.fn_slack_payment_decide(uuid, text, text, text) from anon, authenticated;
grant  execute on function public.fn_slack_payment_decide(uuid, text, text, text) to service_role;

commit;

-- ============================================================================
-- VERIFY (after applying):
--   select column_name from information_schema.columns
--     where table_name='payment_requests' and column_name in ('slack_channel','slack_ts');
--   select proname from pg_proc where proname='fn_slack_payment_decide';
--   -- set the owner mapping:
--   --   update authorized_users set slack_user_id='U0123ABC' where role='owner';
-- ============================================================================
