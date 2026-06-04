// ============================================================================
// Shared helper for the routing Functions. Fetches a static HTML shell from
// the deployment's asset store and returns its content as a brand-new
// 200 response with explicit headers.
//
// Why this exists (and why it's the only reliable shape):
//
//   - next(new Request(rewriteUrl, request)) goes through Cloudflare's
//     URL-cleanup layer which 301-strips `.html`. That triggers the
//     middleware again on the cleaned URL → infinite loop.
//   - env.ASSETS.fetch(shellUrl) returns the asset, but Cloudflare can
//     still attach a redirect status to that response in some asset-store
//     configurations. Returning it directly re-exposes the 301 → loop.
//
// The pattern below sidesteps both issues:
//   1. Call env.ASSETS.fetch() to get the asset.
//   2. If it returns 3xx with a Location header, follow it ourselves inside
//      the Function — the browser never sees the redirect.
//   3. Read the final body bytes and return them as a fresh 200 response
//      with `Content-Type: text/html`. The browser sees only `200 + HTML`.
//
// Capped at 3 redirect hops so a misconfigured asset store can't burn CPU.
// ============================================================================

const MAX_REDIRECTS = 3;

export async function serveShell(
  shellPath: string,
  origin: string,
  assets: Fetcher,
): Promise<Response> {
  let url = new URL(shellPath, origin);
  let response: Response | null = null;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    response = await assets.fetch(url.toString());
    if (response.status < 300 || response.status >= 400) break;
    const loc = response.headers.get("Location");
    if (!loc) break;
    url = new URL(loc, origin);
  }

  if (!response) {
    return new Response("Shell not found", { status: 500 });
  }

  const body = await response.arrayBuffer();
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Match the headers Vite/static would set so cache behaviour is
      // identical to a direct static serve.
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
