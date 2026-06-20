-- ============================================================================
-- Zoho sync scheduler (pg_cron + pg_net)
--
-- Calls the zoho-sync Edge Function every 15 minutes to reconcile anything the
-- real-time webhook dropped (best-effort delivery, no signature). The one-time
-- history backfill is run by hand (?mode=backfill) — see the runbook.
--
-- PARITY: mirrors 20260617000000_digest_cron_schedule.sql exactly — it reads
-- the project URL + anon key from Vault AT RUN TIME and returns early when they
-- are absent. We set those Vault secrets ONLY in prod, so the sync fires on
-- prod only; staging registers the job but it no-ops. It REUSES the existing
-- `digest_project_url` / `digest_anon_key` Vault secrets (they are just the
-- project URL + anon key, not digest-specific) — no new Vault setup needed.
--
-- Independently, zoho-sync itself no-ops (200) when the ZOHO_* Edge secrets are
-- absent, so even a misconfigured prod cron is harmless.
--
-- Schedule (IST = UTC+5:30):
--   abhinaya-zoho-sync — every 15 minutes
--
-- Safe to re-run: the job is dropped then recreated.
-- ============================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

do $$
declare j bigint;
begin
  for j in select jobid from cron.job where jobname = 'abhinaya-zoho-sync'
  loop
    perform cron.unschedule(j);
  end loop;
end $$;

select cron.schedule('abhinaya-zoho-sync', '*/15 * * * *', $cron$
do $job$
declare
  base text := (select decrypted_secret from vault.decrypted_secrets
                where name = 'digest_project_url' limit 1);
  key  text := (select decrypted_secret from vault.decrypted_secrets
                where name = 'digest_anon_key' limit 1);
begin
  -- Not configured (e.g. staging) -> no-op, no call, no error.
  if base is null or key is null then return; end if;
  perform net.http_post(
    url     := base || '/functions/v1/zoho-sync',
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
-- VERIFY (after applying):
--   select jobname, schedule from cron.job where jobname = 'abhinaya-zoho-sync';
-- ============================================================================
