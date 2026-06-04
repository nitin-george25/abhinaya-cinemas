// ============================================================================
// Root URL handler — serves the landing page (/home.html).
//
// Uses env.ASSETS.fetch() instead of next(new Request(...)) because
// Cloudflare's auto URL-cleanup strips `.html` and 301-redirects to the
// cleaned URL when the rewritten target ends in .html. That triggers the
// Function again with the cleaned URL → another rewrite to /home.html →
// another 301 → infinite redirect loop ("too many redirects").
//
// env.ASSETS is the binding to the deployment's static asset store.
// Fetching through it returns the raw file content with no URL
// normalization or redirect side-effects.
//
// `_routes.json` must include "/" so this function actually runs.
// ============================================================================

interface Env {
  ASSETS: Fetcher;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const homeUrl = new URL('/home.html', url.origin);
  return env.ASSETS.fetch(new Request(homeUrl, request));
};
