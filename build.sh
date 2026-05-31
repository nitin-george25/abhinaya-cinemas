#!/usr/bin/env bash
# ============================================================================
# Cloudflare Pages build script.
#
# Combines two apps into a single deploy:
#   • Legacy vanilla console  → served at /admin/dcr/  (untouched during C0–C6)
#   • New React rewrite        → served at /v2/         (built by Vite)
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

# Legacy vanilla site → /admin/dcr/
cp -R admin dist/admin

# React app → /v2/  (Vite base is '/v2/', so asset URLs inside its index.html
# already point at /v2/assets/*. We just need to put the files at that path.)
mkdir -p dist/v2
cp -R app/dist/. dist/v2/

# Cloudflare Pages headers — copy from repo root if present
[ -f _headers ] && cp _headers dist/_headers

# Cloudflare Pages redirects — we always rewrite this file from build.sh
# because we need the SPA fallback for /v2/* to land on /v2/index.html so
# React Router can handle client-side routes. (The repo-root _redirects is
# kept empty / locked-by-iCloud on the author's machine; authoring it here
# means the rule lives in code, not in a finicky dotfile.)
cat > dist/_redirects <<'REDIRECTS'
# SPA fallback for the React app at /v2/ — any /v2/* request that doesn't
# match a real file is served the /v2/index.html shell with a 200 so React
# Router can pick up the path client-side.
/v2/*    /v2/index.html   200
REDIRECTS

# Friendly landing at /  →  legacy console for now
cat > dist/index.html <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Abhinaya Cinemas</title>
    <meta http-equiv="refresh" content="0; url=/admin/dcr/" />
    <meta name="robots" content="noindex" />
  </head>
  <body>
    <p><a href="/admin/dcr/">Open the console</a></p>
  </body>
</html>
HTML

echo "==> Done"
ls -la dist
