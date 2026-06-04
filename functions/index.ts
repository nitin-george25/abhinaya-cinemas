// ============================================================================
// Root URL handler — serves the landing page (/home.html).
//
// Why a Function instead of just an _redirects rule:
//
//   1. The Cloudflare Pages project has SPA-fallback enabled at the platform
//      level. With a dist/index.html present it intercepts every unmatched
//      path; without one it 404s. _redirects rules SHOULD bridge the gap but
//      have proven flaky on this project (the repo-root _redirects is iCloud-
//      locked at 0 bytes, and Cloudflare's build sometimes reads from there
//      instead of dist/_redirects).
//
//   2. A Pages Function at `functions/index.ts` is authoritative for `/` and
//      `/index.html` — Cloudflare always routes there before consulting
//      static files or _redirects, so it can't be overridden by any of the
//      project's other config layers.
//
// `_routes.json` must include `/` so this function actually runs.
// ============================================================================

export const onRequest: PagesFunction = async ({ request, next }) => {
  const url = new URL(request.url);
  // Rewrite to /home.html and let Cloudflare's static handler serve it.
  const homeUrl = new URL('/home.html', url.origin);
  return next(new Request(homeUrl, request));
};
