// ============================================================================
// /admin/dcr/* routing middleware.
//
// Serves the React app shell (/admin/dcr/index.html) for any URL under
// /admin/dcr/ that isn't a real asset. React Router 6 inside the app then
// matches the path client-side and renders the right page.
//
// Why a Function instead of an _redirects rule:
//   The Cloudflare Pages project has SPA-fallback at the platform level
//   that interferes with _redirects 200 rewrites for the /admin/dcr/*
//   prefix (the project-level fallback serves the root index.html before
//   the subpath _redirects rule fires). A Pages Function runs deterministic-
//   ally before any of that, so it always wins.
//
// Asset requests (anything with a file extension — .js, .css, .png, .ico,
// .woff2, .json) fall through to the static handler via `next()` so Vite's
// hashed bundle files at /admin/dcr/assets/* still serve directly.
// ============================================================================

export const onRequest: PagesFunction = async ({ request, next }) => {
  const url = new URL(request.url);

  // Static asset → fall through to Cloudflare's static handler unchanged.
  if (/\.[a-z0-9]+$/i.test(url.pathname)) {
    return next();
  }

  // React Router path → serve the app shell. Vite's index.html has the
  // <script type="module"> tag that loads main.tsx, which boots React
  // Router 6 with basename "/admin/dcr".
  const shellUrl = new URL('/admin/dcr/index.html', url.origin);
  return next(new Request(shellUrl, request));
};
