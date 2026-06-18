-- ============================================================================
-- Project Management digest scheduler (pg_cron + pg_net)
--
-- Schedules the `pm-digest` Edge Function on two cadences. Mirrors the DCR
-- digest scheduler in 20260617000000_digest_cron_schedule.sql exactly, and
-- REUSES the same Vault secrets (`digest_project_url`, `digest_anon_key`) — no
-- new secrets to set. Each cron command reads those at RUN TIME and returns
-- early when they are absent.
--
-- PARITY: this migration applies to BOTH staging and prod and hard-codes
-- nothing environment-specific. The Vault secrets are set ONLY in prod, so the
-- PM digests fire on prod only; staging registers the jobs but they no-op (no
-- email, no error). The DCR digest cron already created these two secrets in
-- prod (2026-06-17), so there is NOTHING extra to run for the PM digest —
-- applying this migration is enough.
--
-- Schedules (IST = UTC+5:30):
--   abhinaya-pm-digest-daily   — 09:30 AM IST (04:00 UTC) every day
--   abhinaya-pm-digest-weekly  — 09:45 AM IST (04:15 UTC) every Monday
--                                (weekly passes ?mode=weekly → 7-day activity)
--
-- Safe to re-run: each job is dropped then recreated.
-- ============================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- Drop any prior schedule for these names (idempotent re-apply)
do $$
declare j bigint;
begin
  for j in
    select jobid from cron.job
    where jobname in ('abhinaya-pm-digest-daily', 'abhinaya-pm-digest-weekly')
  loop
    perform cron.unschedule(j);
  end loop;
end $$;

-- Daily PM digest — 09:30 AM IST (04:00 UTC) every day
select cron.schedule('abhinaya-pm-digest-daily', '0 4 * * *', $cron$
do $job$
declare
  base text := (select decrypted_secret from vault.decrypted_secrets
                where name = 'digest_project_url' limit 1);
  key  text := (select decrypted_secret from vault.decrypted_secrets
                where name = 'digest_anon_key' limit 1);
begin
  -- Not configured (e.g. staging) -> no-op, no email, no error.
  if base is null or key is null then return; end if;
  perform net.http_post(
    url     := base || '/functions/v1/pm-digest',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || key
               ),
    body    := '{}'::jsonb
  );
end
$job$;
$cron$);

-- Weekly PM digest — 09:45 AM IST (04:15 UTC) every Monday
select cron.schedule('abhinaya-pm-digest-weekly', '15 4 * * 1', $cron$
do $job$
declare
  base text := (select decrypted_secret from vault.decrypted_secrets
                where name = 'digest_project_url' limit 1);
  key  text := (select decrypted_secret from vault.decrypted_secrets
                where name = 'digest_anon_key' limit 1);
begin
  if base is null or key is null then return; end if;
  perform net.http_post(
    url     := base || '/functions/v1/pm-digest?mode=weekly',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || key
               ),
    body    := '{}'::jsonb
  );
end
$job$;
$cron$);

-- ============================================================================
-- VERIFY (run after applying, in prod):
--   select jobname, schedule, active from cron.job
--    where jobname like 'abhinaya-pm-digest%';
--   -- Manual fire (preview, no send):
--   --   curl 'https://xkmjygegtpmmwwnyoufn.supabase.co/functions/v1/pm-digest?dry=1' \
--   --        -H 'Authorization: Bearer <legacy eyJ… anon key>'
-- ============================================================================
