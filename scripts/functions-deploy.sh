#!/usr/bin/env bash
# ============================================================================
# scripts/functions-deploy.sh — deploy Supabase Edge Functions.
#
# The companion to db-push.sh. Migrations and Edge Functions ship separately:
# applying a migration does NOT update the functions, and that split is the
# usual cause of "the console does the right thing but Slack posts nonsense" —
# the browser sends a message kind the deployed function has never heard of.
# When a change touches supabase/functions/, run this too.
#
# Usage:
#   bash scripts/functions-deploy.sh staging               # the Slack pair
#   bash scripts/functions-deploy.sh prod                  # (asks first)
#   bash scripts/functions-deploy.sh staging notify-slack  # named functions
#
# Anything under supabase/functions/_shared is NOT deployable on its own — it
# is bundled into each function that imports it, so a change there means
# redeploying every importer. notify-slack and slack-interactions both import
# _shared/payments.ts, which is why they are the default pair.
#
# Project refs (same as db-push.sh — not secrets):
#   staging  →  lctkvmpzijaspaytunkm
#   prod     →  xkmjygegtpmmwwnyoufn
#
# Needs $SUPABASE_ACCESS_TOKEN (https://supabase.com/dashboard/account/tokens),
# exactly like db-push.sh. No global CLI install required: if `supabase` isn't
# on PATH this falls back to `npx supabase@latest`, so Node is enough.
# ============================================================================

set -euo pipefail

TARGET="${1:-}"
STAGING_REF="lctkvmpzijaspaytunkm"
PROD_REF="xkmjygegtpmmwwnyoufn"

case "$TARGET" in
  staging) PROJECT_REF="$STAGING_REF" ;;
  prod)    PROJECT_REF="$PROD_REF" ;;
  *)
    echo "Usage: bash scripts/functions-deploy.sh <staging|prod> [function…]" >&2
    exit 2
    ;;
esac
shift

# Everything after the target is a function name; default to the Slack pair.
FUNCTIONS=("$@")
if [[ ${#FUNCTIONS[@]} -eq 0 ]]; then
  FUNCTIONS=(notify-slack slack-interactions)
fi

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "SUPABASE_ACCESS_TOKEN is not set in your environment." >&2
  echo "Get a token at https://supabase.com/dashboard/account/tokens" >&2
  echo "Then: export SUPABASE_ACCESS_TOKEN=sbp_..." >&2
  exit 1
fi

# Prefer an installed CLI; otherwise run it through npx so no install is needed.
if command -v supabase >/dev/null 2>&1; then
  SUPA=(supabase)
elif command -v npx >/dev/null 2>&1; then
  echo "→ supabase CLI not on PATH — using npx supabase@latest"
  SUPA=(npx --yes supabase@latest)
else
  echo "Neither the supabase CLI nor npx was found." >&2
  echo "Install Node (which provides npx), or the CLI:" >&2
  echo "  https://supabase.com/docs/guides/local-development/cli/getting-started" >&2
  exit 1
fi

# Deploy must run from the repo root — that's where supabase/functions/ lives.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

NONINTERACTIVE=0
if [[ "${ASSUME_YES:-}" == "1" || "${CI:-}" == "true" || ! -t 0 ]]; then
  NONINTERACTIVE=1
fi

echo "→ Target: $TARGET ($PROJECT_REF)"
echo "→ Functions: ${FUNCTIONS[*]}"
echo "→ Commit: $(git rev-parse --short HEAD 2>/dev/null || echo 'not a git checkout')"

if [[ "$TARGET" == "prod" && "$NONINTERACTIVE" -eq 0 ]]; then
  echo ""
  read -r -p "Deploy these functions to PROD? (type 'yes' to confirm) " CONFIRM
  if [[ "$CONFIRM" != "yes" ]]; then
    echo "Aborted." >&2
    exit 1
  fi
fi

for FN in "${FUNCTIONS[@]}"; do
  if [[ ! -d "supabase/functions/$FN" ]]; then
    echo "No such function: supabase/functions/$FN" >&2
    exit 1
  fi
  echo ""
  echo "→ Deploying $FN…"
  "${SUPA[@]}" functions deploy "$FN" --project-ref "$PROJECT_REF"
done

echo ""
echo "→ What's live now:"
"${SUPA[@]}" functions list --project-ref "$PROJECT_REF" || true
echo ""
echo "Done. Check the UPDATED_AT column above — it should be just now."
