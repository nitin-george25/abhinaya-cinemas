#!/usr/bin/env bash
# ============================================================================
# Cloudflare Pages build script.
#
# Phase C7 cutover layout:
#   /admin/dcr/         → New React app  (primary console)
#   /admin/dcr-legacy/  → Legacy vanilla console (fallback during the
#                         confidence period; remove after ~2 weeks)
#
# Cloudflare Pages dashboard settings:
#   Build command:           bash build.sh
#   Build output directory:  dist
# ============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT"

echo "==> Building React app (app/)"
cd app
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi
npm run build
cd "$REPO_ROOT"

echo "==> Staging unified Cloudflare output (dist/)"
rm -rf dist
mkdir -p dist

# Legacy vanilla site → /admin/dcr-legacy/
mkdir -p dist/admin
cp -R admin/dcr dist/admin/dcr-legacy

# React app → /admin/dcr/  (Vite base is '/admin/dcr/', so the index.html
# already references /admin/dcr/assets/*. We just need to put the files
# at that path.)
mkdir -p dist/admin/dcr
cp -R app/dist/. dist/admin/dcr/

# Cloudflare Pages headers — copy from repo root if present
[ -f _headers ] && cp _headers dist/_headers

# Cloudflare Pages redirects — written fresh by build.sh because we need:
#   • SPA fallback for /admin/dcr/* → /admin/dcr/index.html (React Router)
#   • 301 from old /v2/* URLs (pre-cutover bookmarks) → /admin/dcr/*
cat > dist/_redirects <<'REDIRECTS'
# Pre-cutover bookmarks — 301 redirect /v2/* into the new /admin/dcr/*.
/v2/*    /admin/dcr/:splat   301

# SPA fallback for the React app at /admin/dcr/ — any /admin/dcr/* request
# that doesn't match a real file is served the index.html shell with 200
# so React Router can pick up the path client-side. This MUST come after
# the legacy block above so /admin/dcr-legacy/* keeps serving static.
/admin/dcr/*    /admin/dcr/index.html   200
REDIRECTS

# Public landing page at /  →  marketing site (Now Showing, Coming Soon,
# Legacy, Gallery, Contact). Pulls movies live from Supabase.
cp index.html dist/index.html
mkdir -p dist/site
cp -R site/. dist/site/

echo "==> Done"
ls -la dist
