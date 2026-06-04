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

# Cloudflare Pages Functions routing scope — copy repo-root version too.
# The build below overwrites with a fresh heredoc, but copying first means
# the repo-committed version is the source of truth that tracks via git.
[ -f _routes.json ] && cp _routes.json dist/_routes.json

# Cloudflare Pages redirects — written fresh by build.sh because we need:
#   • SPA fallback for /admin/dcr/* → /admin/dcr/index.html (React Router)
#   • 301 from old /v2/* URLs (pre-cutover bookmarks) → /admin/dcr/*
cat > dist/_redirects <<'REDIRECTS'
# Root → landing page. The landing HTML lives at /home.html (NOT
# /index.html) to defeat Cloudflare Pages' platform-level SPA fallback —
# see the cp index.html dist/home.html line below.
/    /home.html    200

# Pre-cutover bookmarks — 301 redirect /v2/* into the new /admin/dcr/*.
/v2/*    /admin/dcr/:splat   301

# Legacy vanilla console SPA fallback — first, so /admin/dcr-legacy/*
# never matches the /admin/dcr/* rule below.
/admin/dcr-legacy/*    /admin/dcr-legacy/index.html   200

# SPA fallback for the React app at /admin/dcr/ — any /admin/dcr/* request
# that doesn't match a real file is served the index.html shell with 200
# so React Router can pick up the path client-side.
/admin/dcr/*    /admin/dcr/index.html   200
REDIRECTS

# Cloudflare Pages Functions routing scope.
#
# With ANY file under functions/, Cloudflare's default _routes.json includes
# a catch-all "/*" that pipes every request through the Functions middleware.
# When the middleware doesn't match a function, Cloudflare's framework
# detection can fall back to serving the root index.html as a SPA — which
# makes /_redirects, /admin/dcr/*, and every other non-asset path render
# the landing page.
#
# Scoping `include` to /api/* tells Cloudflare:
#   - /api/* → run Pages Functions
#   - everything else → strict static file serving with _redirects rules
#
# This is the canonical fix per Cloudflare's docs:
#   https://developers.cloudflare.com/pages/functions/routing/#create-a-_routesjson-file
cat > dist/_routes.json <<'ROUTES'
{
  "version": 1,
  "include": ["/api/*"],
  "exclude": []
}
ROUTES

# Public landing page at /  →  marketing site (Now Showing, Coming Soon,
# Legacy, Gallery, Contact). Pulls movies live from Supabase.
#
# Critical: the landing HTML is shipped as dist/home.html, NOT
# dist/index.html. With no root index.html, Cloudflare Pages' platform-level
# SPA fallback has nothing to fall back to — every unmatched path becomes a
# real 404 and the _redirects rules below are the only routing source.
# `/  /home.html  200` (added in the REDIRECTS block above) wires the
# landing page to the root URL.
cp index.html   dist/home.html
cp privacy.html dist/privacy.html
cp terms.html   dist/terms.html
mkdir -p dist/site
cp -R site/. dist/site/

echo "==> Done"
ls -la dist
