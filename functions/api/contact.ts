// ============================================================================
// SUPERSEDED — the contact endpoint moved to a Supabase Edge Function.
//
// Authoritative location: supabase/functions/contact/index.ts
// Called from the marketing site via window.sbClient.functions.invoke('contact').
//
// This file remains only so a stale Cloudflare deploy doesn't leave a
// dangling /api/contact route — it returns 410 Gone with a hint. Safe to
// delete once /functions/ is no longer scanned by the Pages build.
// ============================================================================

interface Env {}

export const onRequest: PagesFunction<Env> = async () =>
  new Response(
    JSON.stringify({
      error: "Endpoint moved. The marketing site now calls the Supabase Edge Function 'contact' directly.",
    }),
    {
      status: 410,
      headers: { "Content-Type": "application/json" },
    },
  );
