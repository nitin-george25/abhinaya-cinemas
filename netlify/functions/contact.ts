// ============================================================================
// SUPERSEDED — moved to Cloudflare Pages Functions.
//
// The contact form endpoint now lives at functions/api/contact.ts and is
// served at /api/contact by Cloudflare Pages. This file is kept only to
// avoid breaking any stale references; safe to delete.
// ============================================================================

export default async (): Promise<Response> =>
  new Response(
    JSON.stringify({
      error: "Endpoint moved. Use POST /api/contact instead.",
    }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  );
