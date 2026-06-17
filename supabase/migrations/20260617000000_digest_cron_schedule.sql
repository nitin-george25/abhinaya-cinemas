-- ============================================================================
-- Digest email scheduler (pg_cron + pg_net)
--
-- Replaces the old hand-run "Abhinaya DCR Cloud - Step 3 Digest Cron.sql",
-- which shipped with unsubstituted {{SUPABASE_PROJECT_URL}} /
-- {{SUPABASE_ANON_KEY}} placeholders and so failed on every run
-- ("invalid URL ...: Bad scheme"). The digests had never actually sent.
--
-- PARITY: this migration applies to BOTH staging and prod, so it hard-codes
-- nothing environment-specific. Each cron command reads the project URL + anon
-- key from Vault AT RUN TIME and returns early when they are absent. We set
-- those Vault secrets ONLY in prod, so the digests fire on prod only; staging
-- registers the jobs but they no-op (no email, no error).
--
-- ONE-TIME PER-ENVIRONMENT SETUP (run in the SQL editor; values NOT committed).
-- Run in PROD only (run in staging too only if you ever want staging digests):
--   select vault.create_secret('https://xkmjygegtpmmwwnyoufn.supabase.co', 'digest_project_url');
--   select vault.create_secret('<prod anon / publishable key>',            'digest_anon_key');
-- To rotate the key later:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'digest_anon_key'),
--     '<new key>');
--
-- Schedules (IST = UTC+5:30):
--   abhinaya-daily-digest  — 10:00 AM IST (04:30 UTC) every day
--   abhinaya-weekly-digest — 11:00 AM IST (05:30 UTC) every Monday
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
    where jobname in ('abhinaya-daily-digest', 'abhinaya-weekly-digest')
  loop
    perform cron.unschedule(j);
  end loop;
end $$;

-- Daily digest — 10:00 AM IST (04:30 UTC) every day
select cron.schedule('abhinaya-daily-digest', '30 4 * * *', $cron$
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
    url     := base || '/functions/v1/daily-digest',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || key
               ),
    body    := '{}'::jsonb
  );
end
$job$;
$cron$);

-- Weekly digest — 11:00 AM IST (05:30 UTC) every Monday
select cron.schedule('abhinaya-weekly-digest', '30 5 * * 1', $cron$
do $job$
declare
  base text := (select decrypted_secret from vault.decrypted_secrets
                where name = 'digest_project_url' limit 1);
  key  text := (select decrypted_secret from vault.decrypted_secrets
                where name = 'digest_anon_key' limit 1);
begin
  if base is null or key is null then return; end if;
  perform net.http_post(
    url     := base || '/functions/v1/weekly-digest',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || key
               ),
    body    := '{}'::jsonb
  );
end
$job$;
$cron$);
