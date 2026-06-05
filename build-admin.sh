#!/usr/bin/env bash
# ============================================================================
# Cloudflare Pages build script — ADMIN DCR CONSOLE.
#
# This builds the React/Vite admin app for the separate Cloudflare Pages
# project that serves admin.abhinayacinemas.com. The landing site has its
# own build script (./build.sh) and its own Pages project.
#
# Cloudflare Pages dashboard settings for the admin project:
#   Build command:           bash build-admin.sh
#   Build output directory:  app/dist
# ============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT/app"

echo "==> Building React admin app (app/)"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi
npm run build

echo "==> Done"
ls -la dist | head -20
