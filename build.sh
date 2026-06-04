#!/usr/bin/env bash
# ============================================================================
# Cloudflare Pages build script — LANDING SITE.
#
# This project (abhinaya-cinemas) is the landing site, deployed to:
#   abhinayacinemas.com       (apex)
#   www.abhinayacinemas.com
#   staging-refactor.abhinaya-cinemas.pages.dev (and other branch previews)
#
# The admin DCR console moved to its own Cloudflare Pages project served
# at admin.abhinayacinemas.com — it builds from app/ in this same repo via
# a separate CF Pages project configuration (root: /, build command:
# `cd app && npm install && npm run build`, output: app/dist).
#
# Cloudflare Pages dashboard settings for THIS project:
#   Build command:           bash build.sh
#   Build output directory:  dist
# ============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT"

echo "==> Staging landing-site output (dist/)"
rm -rf dist
mkdir -p dist/site

cp index.html   dist/index.html
cp privacy.html dist/privacy.html
cp terms.html   dist/terms.html
cp -R site/.    dist/site/

# Cloudflare Pages headers — long cache on /site/assets and /site/fonts.
[ -f _headers ] && cp _headers dist/_headers

# Disable Pages Functions for this project. The repo still has the
# tombstoned functions/ dir from the pre-split routing experiments; this
# empty-include _routes.json tells Cloudflare to bundle but never invoke
# them. Cleanup pass: `git rm -r functions/` once we're confident.
[ -f _routes.json ] && cp _routes.json dist/_routes.json

# Redirects.
#   - Old /admin/dcr/* and /admin/dcr-legacy/* paths from the pre-split
#     era 301 to admin.abhinayacinemas.com so existing bookmarks survive.
#   - /v2/* bookmarks (pre-cutover) bounce the same way.
cat > dist/_redirects <<'REDIRECTS'
# Pre-cutover bookmarks → admin subdomain.
/v2/*                  https://admin.abhinayacinemas.com/:splat           301

# Subdomain-split bookmarks. The admin console lived at /admin/dcr/* on
# the apex from 2025-12 through 2026-06-04; this rule preserves those
# bookmarks indefinitely.
/admin/dcr/*           https://admin.abhinayacinemas.com/:splat           301
/admin/dcr-legacy/*    https://admin.abhinayacinemas.com/legacy/:splat    301
REDIRECTS

echo "==> Done"
ls -la dist
