# PM Digest — handoff

A daily + weekly **Project Management status digest**, built on the same plumbing
as the DCR `daily-digest` that went live 2026-06-17. For every **active** project
it emails overall progress %, tasks done, delayed (overdue & not done), tasks due
in the next 7 days, recent task activity, and the overdue / upcoming task lists.

## Decisions baked in
- **Separate email** — its own `pm-digest` Edge Function (not appended to the DCR digest).
- **Daily + weekly** — one function, two cron jobs; weekly passes `?mode=weekly` (7-day activity window vs 24h).
- **Recipients = project team + owners** — each project's `project_members` (+ `project_manager_email`) plus every global `owner`. Each person gets only the active projects relevant to them; owners get all.
- **Scope = active only** — `projects.status = 'active'`.

## Files
- `supabase/functions/pm-digest/index.ts` — the function.
- `supabase/migrations/20260618000000_pm_digest_cron_schedule.sql` — schedules `abhinaya-pm-digest-daily` (04:00 UTC = 09:30 IST daily) + `abhinaya-pm-digest-weekly` (04:15 UTC = 09:45 IST Mon). Vault-backed, idempotent, prod-only by design (no-op on staging).
- `supabase/config.toml` — added `[functions.pm-digest] verify_jwt = true` so the Supabase integration deploys it on push.

## No new secrets required
- **Vault** (`digest_project_url`, `digest_anon_key`) — already set in prod by the DCR digest cron; this cron reuses them. Nothing to add.
- **`RESEND_API_KEY`** — already set (DCR digest uses it).
- **Optional**: `PM_DIGEST_FROM` (default `Abhinaya PM <noreply@mail.abhinayacinemas.com>`); `PM_DIGEST_TO` (comma-separated override — when set, sends ALL active projects to exactly those addresses and bypasses per-recipient routing; leave unset for normal routing).

> Reuses the **legacy `eyJ…` anon key** stored in the `digest_anon_key` Vault secret — the function gateway rejects the new `sb_publishable_…` key (`UNAUTHORIZED_INVALID_JWT_FORMAT`). Already correct in prod.

## Deploy (run on your Mac — sandbox can't run git/deno)
```bash
cd ~/Developer/abhinaya-cinemas
rm -f .git/index.lock                 # clear the stale lock the sandbox left
git stash                             # park the 3 uncommitted changes
git checkout main && git pull
git checkout -b feat/pm-digest
git stash pop                         # restores pm-digest/, the migration, config.toml
deno check supabase/functions/pm-digest/index.ts   # optional typecheck
git add supabase/functions/pm-digest supabase/migrations/20260618000000_pm_digest_cron_schedule.sql supabase/config.toml
git commit -m "feat(pm): daily + weekly Project Management status digest

New pm-digest Edge Function + Vault-backed pg_cron schedule (daily 09:30 IST,
weekly Mon 09:45 IST). Per-recipient routing: project team + owners; active
projects only. Reuses the existing digest Vault secrets + RESEND_API_KEY."
git push -u origin feat/pm-digest
```
Then PR → **merge to `staging`** (CI applies the migration to the staging DB + deploys the function to the staging project) → verify → **promote to `main`** (applies to prod DB + deploys to the prod project; the cron starts firing because prod has the Vault secrets).

## Verify
```bash
# Preview the email (owner view of all active projects) — no send:
curl 'https://xkmjygegtpmmwwnyoufn.supabase.co/functions/v1/pm-digest?dry=1' \
     -H 'Authorization: Bearer <legacy eyJ… anon key>'
#   ...&mode=weekly          weekly framing
#   ...&to=you@x.com         send a single real test email (all projects)
#   ...&date=2026-06-18      override "today" for delayed / due-soon math

# Cron registered (run in prod SQL editor):
select jobname, schedule, active from cron.job where jobname like 'abhinaya-pm-digest%';
```

## Notes
- Staging registers the cron jobs but they **no-op** (Vault secrets are prod-only) — test staging via the `?dry=1` / `?to=` curl above.
- Metric definitions mirror the console Progress tab exactly: `projectProgressPct`, delayed = `!done && end_date < today (IST)`, due-soon = `!done && today ≤ end_date ≤ today+7`.
- The DCR digest's footer still links the stale `/admin/dcr/` path; this function uses the correct `https://admin.abhinayacinemas.com/projects/renovations`.
