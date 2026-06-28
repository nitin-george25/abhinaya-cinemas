#!/usr/bin/env bash
# ============================================================================
# scripts/db-push.sh — apply pending Supabase migrations.
#
# Usage:
#   bash scripts/db-push.sh staging
#   bash scripts/db-push.sh prod
#
# What it does:
#   1. Validates the `supabase` CLI is installed (fails fast otherwise).
#   2. Links the CLI to the requested project (staging vs prod). This step
#      is idempotent — re-linking the same project is a no-op.
#   3. Lists migrations that haven't been applied yet (db lint).
#   4. Prompts for confirmation when target is prod.
#   5. Runs `supabase db push` so every file in supabase/migrations/ not
#      already in `supabase_migrations.schema_migrations` gets applied.
#
# Project refs (kept in this script, not in env, so they're version-controlled
# and reviewable — they're not secrets):
#   staging  →  lctkvmpzijaspaytunkm
#   prod     →  xkmjygegtpmmwwnyoufn
#
# You'll need a Supabase access token in $SUPABASE_ACCESS_TOKEN. Get it from
# https://supabase.com/dashboard/account/tokens. Add it to your shell rc
# or .env.local and `source` it before running this script.
#
# CI / non-interactive use:
#   • Set $SUPABASE_DB_PASSWORD so link/push never prompt for the DB password.
#   • Set ASSUME_YES=1 (or run under CI, where CI=true) to skip the prod
#     confirmation prompt. A missing TTY is also treated as non-interactive.
#   This script is the single entry point used by both humans and the
#   .github/workflows/db-migrations.yml workflow.
# ============================================================================

set -euo pipefail

TARGET="${1:-}"
STAGING_REF="lctkvmpzijaspaytunkm"
PROD_REF="xkmjygegtpmmwwnyoufn"

case "$TARGET" in
  staging) PROJECT_REF="$STAGING_REF" ;;
  prod)    PROJECT_REF="$PROD_REF" ;;
  *)
    echo "Usage: bash scripts/db-push.sh <staging|prod>" >&2
    exit 2
    ;;
esac

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI not found." >&2
  echo "Install: brew install supabase/tap/supabase" >&2
  echo "Or: https://supabase.com/docs/guides/local-development/cli/getting-started" >&2
  exit 1
fi

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "SUPABASE_ACCESS_TOKEN is not set in your environment." >&2
  echo "Get a token at https://supabase.com/dashboard/account/tokens" >&2
  echo "Then: export SUPABASE_ACCESS_TOKEN=sbp_..." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Optional DB password — required in non-interactive runs (CI). When set we
# pass it explicitly to link/list/push so the CLI never blocks on a prompt.
# Locally you can leave it unset and the CLI will prompt or use a cached value.
PW_ARGS=()
if [[ -n "${SUPABASE_DB_PASSWORD:-}" ]]; then
  PW_ARGS=(--password "$SUPABASE_DB_PASSWORD")
fi

# Are we running unattended? CI sets CI=true; ASSUME_YES=1 forces it; and a
# missing TTY on stdin means there's no human to answer the prompt.
NONINTERACTIVE=0
if [[ "${ASSUME_YES:-}" == "1" || "${CI:-}" == "true" || ! -t 0 ]]; then
  NONINTERACTIVE=1
fi

echo "→ Linking Supabase project ($TARGET → $PROJECT_REF)"
supabase link --project-ref "$PROJECT_REF" "${PW_ARGS[@]}" >/dev/null

echo "→ Pending migrations:"
# `migration list` shows local + remote; the side-by-side diff is exactly
# what we want before applying anything. Informational — never fail the run on it.
supabase migration list "${PW_ARGS[@]}" || true

if [[ "$TARGET" == "prod" && "$NONINTERACTIVE" -eq 0 ]]; then
  echo ""
  read -r -p "Apply these migrations to PROD? (type 'yes' to confirm) " CONFIRM
  if [[ "$CONFIRM" != "yes" ]]; then
    echo "Aborted." >&2
    exit 1
  fi
fi

echo "→ Pushing migrations…"
supabase db push "${PW_ARGS[@]}"

echo ""
echo "Done. Verify with: supabase migration list"
