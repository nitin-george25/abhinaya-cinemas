// ============================================================================
// /admin/dcr-legacy/* routing middleware. Same pattern as the dcr one —
// see ../../_lib/serve-shell.ts for the redirect-loop rationale. Will be
// removed once the legacy console is retired (Phase C6.4).
// ============================================================================

import { serveShell } from "../../_lib/serve-shell";

interface Env {
  ASSETS: Fetcher;
}

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const url = new URL(request.url);
  if (/\.[a-z0-9]+$/i.test(url.pathname)) {
    return next();
  }
  return serveShell("/admin/dcr-legacy/index.html", url.origin, env.ASSETS);
};
