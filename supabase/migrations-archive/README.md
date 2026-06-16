# Migrations — archive (NOT applied by CI)

Historical, human-organised migration sources. These files are **reference
only**. They live outside `supabase/migrations/`, so the Supabase CLI
(`supabase db push`) and the CI workflow **never** read or apply them.

Why they're here and not in the push path:

- **catalog-normalization/** — the foundational normalized schema (cinemas,
  screens, classes, movies, audit/realtime). It was applied to staging + prod
  **before** we adopted the CLI migration workflow, so it is already live in
  both databases but was never recorded in `supabase_migrations.schema_migrations`.
  Re-running it (backfills, ALTERs, constraints) would be destructive, so it is
  archived rather than pushed.
- **`*_verify.sql`** — read-only sanity-check queries, run by hand when needed.
- **`*_rollback.sql` / `99_rollback.sql`** — teardown scripts, run by hand only
  when intentionally reversing a feature. Never auto-applied.
- **cash-management / fb-checklist / operations-rosters** — the forward
  migrations from these features were copied into `supabase/migrations/` as
  timestamped files (the real, applied source). What remains here is the
  original grouped source plus their verify/rollback helpers.

## Going forward — single source of truth

Author **every new migration directly in `supabase/migrations/`** as a
timestamped file (`YYYYMMDDHHMMSS_description.sql`). Do **not** recreate the old
`migrations/<feature>/` convention. CI applies everything in
`supabase/migrations/` on push:

- push to **staging** → applied to the **staging** database
- push to **main** → applied to the **prod** database

See `.github/workflows/db-migrations.yml` and `scripts/db-push.sh`.

If you ever need a verify or rollback script for a new feature, keep it here in
the archive (or in `docs/`), never in `supabase/migrations/`.
