// ============================================================================
// Root URL handler — serves the landing page (/home.html).
//
// Uses the serveShell() helper which reads the asset content and returns
// it as a fresh 200 response. This sidesteps Cloudflare's .html-stripping
// URL cleanup that was causing infinite redirect loops with simpler
// rewrite patterns. See ./_lib/serve-shell.ts for the rationale.
//
// `_routes.json` must include "/" so this function actually runs.
// ============================================================================

import { serveShell } from "./_lib/serve-shell";

interface Env {
  ASSETS: Fetcher;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  return serveShell("/home.html", url.origin, env.ASSETS);
};
