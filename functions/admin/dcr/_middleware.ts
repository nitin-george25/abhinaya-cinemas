// ============================================================================
// /admin/dcr/* routing middleware.
//
// Serves the React app shell for any URL under /admin/dcr/ that isn't a
// real asset, via the serveShell() helper. React Router 6 inside the app
// then matches the path client-side and renders the right page.
//
// See ../../_lib/serve-shell.ts for why we don't use the simpler patterns
// (next(rewriteRequest) or returning env.ASSETS's response directly) — both
// cause infinite redirect loops with Cloudflare's URL cleanup layer.
//
// Asset requests (URLs ending in .js, .css, .png, .ico, .woff2, .json, etc.)
// are passed through unchanged so Vite's hashed bundles at
// /admin/dcr/assets/* still serve via the normal static handler.
// ============================================================================

import { serveShell } from "../../_lib/serve-shell";

interface Env {
  ASSETS: Fetcher;
}

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const url = new URL(request.url);

  // Static asset → pass through unchanged.
  if (/\.[a-z0-9]+$/i.test(url.pathname)) {
    return next();
  }

  // React Router path → serve the app shell.
  return serveShell("/admin/dcr/index.html", url.origin, env.ASSETS);
};
