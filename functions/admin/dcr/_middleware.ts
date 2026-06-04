// ============================================================================
// /admin/dcr/* routing middleware.
//
// Serves the React app shell (/admin/dcr/index.html) for any URL under
// /admin/dcr/ that isn't a real asset. React Router 6 inside the app then
// matches the path client-side and renders the right page.
//
// Why env.ASSETS.fetch() instead of next(new Request(...)):
//   Cloudflare auto-strips `.html` and 301-redirects to the cleaned URL.
//   When we rewrite via next() to /admin/dcr/index.html, Cloudflare 301s
//   to /admin/dcr/, which then re-enters this middleware, which rewrites
//   to /admin/dcr/index.html again → infinite redirect loop.
//
//   env.ASSETS.fetch() bypasses the URL-cleanup layer and serves the
//   raw file content directly. No redirects.
//
// Asset requests (URLs ending in .js, .css, .png, .ico, .woff2, .json,
// etc.) are passed through unchanged so Vite's hashed bundles at
// /admin/dcr/assets/* still serve via the normal static handler.
// ============================================================================

interface Env {
  ASSETS: Fetcher;
}

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const url = new URL(request.url);

  // Static asset → pass through unchanged.
  if (/\.[a-z0-9]+$/i.test(url.pathname)) {
    return next();
  }

  // React Router path → serve the app shell from the static asset store.
  const shellUrl = new URL('/admin/dcr/index.html', url.origin);
  return env.ASSETS.fetch(new Request(shellUrl, request));
};
