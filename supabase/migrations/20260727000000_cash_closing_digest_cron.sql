-- ============================================================================
-- Cash closing digest scheduler (pg_cron + pg_net)
--
-- Mirrors 20260617000000_digest_cron_schedule.sql exactly: the cron command
-- reads the project URL + anon key from Vault AT RUN TIME and returns early
-- when they are absent. Those Vault secrets are set in PROD only, so this
-- digest fires on prod alone; staging registers the job but it no-ops (no
-- email, no error). No new secrets are needed — it reuses digest_project_url
-- and digest_anon_key.
--
-- Schedule (IST = UTC+5:30):
--   abhinaya-cash-closing-digest — 7:00 AM IST (01:30 UTC) every day,
--   covering the PREVIOUS business day's tills. It lands before the DCR
--   digest (10:00 AM IST) so the morning cash review happens first.
--
-- Safe to re-run: the job is dropped then recreated.
-- ============================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- Drop any prior schedule for this name (idempotent re-apply)
do $$
declare j bigint;
begin
  for j in
    select jobid from cron.job where jobname = 'abhinaya-cash-closing-digest'
  loop
    perform cron.unschedule(j);
  end loop;
end $$;

-- Cash closing digest — 7:00 AM IST (01:30 UTC) every day
select cron.schedule('abhinaya-cash-closing-digest', '30 1 * * *', $cron$
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
    url     := base || '/functions/v1/cash-closing-digest',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || key
               ),
    body    := '{}'::jsonb
  );
end
$job$;
$cron$);
