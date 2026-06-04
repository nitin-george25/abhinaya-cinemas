// ============================================================================
// /admin/dcr-legacy/* routing middleware.
//
// Same pattern as /admin/dcr/_middleware.ts — uses env.ASSETS.fetch()
// instead of next(new Request(...)) to avoid Cloudflare's .html-stripping
// 301 redirect loop. See that file's header comment for details.
//
// Will be removed once the legacy console is retired (Phase C6.4).
// ============================================================================

interface Env {
  ASSETS: Fetcher;
}

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const url = new URL(request.url);

  if (/\.[a-z0-9]+$/i.test(url.pathname)) {
    return next();
  }

  const shellUrl = new URL('/admin/dcr-legacy/index.html', url.origin);
  return env.ASSETS.fetch(new Request(shellUrl, request));
};
