-- ============================================================================
-- Abhinaya Cinemas — Phase 1.7: Schedule digest emails from Postgres (pg_cron)
--
-- After this runs, two cron jobs will fire automatically:
--   • daily-digest  — every day at 10:00 AM IST (04:30 UTC)
--   • weekly-digest — every Monday at 11:00 AM IST (05:30 UTC)
--
-- Each job POSTs to its Edge Function URL. The function reads yesterday's /
-- previous-week's data and sends the email via Resend.
--
-- HOW TO RUN:
--   1. Open https://supabase.com/dashboard → your prod project
--   2. SQL Editor → New query → paste this entire file → Run
--
-- PREREQUISITES:
--   • Edge Functions `daily-digest` and `weekly-digest` must already be deployed
--     (Dashboard → Edge Functions → Create function → paste from
--      supabase/functions/<name>/index.ts in the repo)
--   • Edge Function secret RESEND_API_KEY must be set
--     (Dashboard → Edge Functions → Secrets)
--
-- Safe to re-run: each job is dropped + recreated.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) Enable the extensions we need (idempotent)
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;


-- ---------------------------------------------------------------------------
-- 2) Function URLs — Edge Functions are reachable at this pattern
-- ---------------------------------------------------------------------------
-- daily-digest:  https://<project-ref>.supabase.co/functions/v1/daily-digest
-- weekly-digest: https://<project-ref>.supabase.co/functions/v1/weekly-digest
--
-- The Authorization header uses the project's anon key so Supabase accepts
-- the request as an "authenticated" caller. The Edge Function itself uses
-- the SERVICE_ROLE key internally to bypass RLS.
--
-- IMPORTANT — fill in the two placeholders below with your prod values:
--   {{SUPABASE_PROJECT_URL}}  e.g. https://xkmjygegtpmmwwnyoufn.supabase.co
--   {{SUPABASE_ANON_KEY}}     get from Settings → API Keys → Publishable key
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 3) Daily digest — every day at 10:00 AM IST (04:30 UTC)
-- ---------------------------------------------------------------------------
do $$
declare
  job_id bigint;
begin
  -- Drop any prior schedule for this name (idempotent re-run)
  select jobid into job_id from cron.job where jobname = 'abhinaya-daily-digest';
  if found then perform cron.unschedule(job_id); end if;
end $$;

select cron.schedule(
  'abhinaya-daily-digest',
  '30 4 * * *',
  $$
  select net.http_post(
    url     := '{{SUPABASE_PROJECT_URL}}/functions/v1/daily-digest',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer {{SUPABASE_ANON_KEY}}'
               ),
    body    := '{}'::jsonb
  );
  $$
);


-- ---------------------------------------------------------------------------
-- 4) Weekly digest — every Monday at 11:00 AM IST (05:30 UTC)
-- ---------------------------------------------------------------------------
do $$
declare
  job_id bigint;
begin
  select jobid into job_id from cron.job where jobname = 'abhinaya-weekly-digest';
  if found then perform cron.unschedule(job_id); end if;
end $$;

select cron.schedule(
  'abhinaya-weekly-digest',
  '30 5 * * 1',
  $$
  select net.http_post(
    url     := '{{SUPABASE_PROJECT_URL}}/functions/v1/weekly-digest',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer {{SUPABASE_ANON_KEY}}'
               ),
    body    := '{}'::jsonb
  );
  $$
);


-- ---------------------------------------------------------------------------
-- 5) Verify — see what's scheduled
-- ---------------------------------------------------------------------------
-- Run this any time to see the two jobs and when they last/next ran:
--   select jobname, schedule, active, command from cron.job
--     where jobname like 'abhinaya-%' order by jobname;
--
-- See recent execution history:
--   select jobname, status, return_message, start_time, end_time
--     from cron.job_run_details d
--     join cron.job j on j.jobid = d.jobid
--     where j.jobname like 'abhinaya-%'
--     order by start_time desc limit 20;
