// ============================================================================
// Environment detection.
//
// Mirrors admin/dcr/js/02-cloud.js exactly:
//   PROD     = served from the abhinayacinemas.com custom domain
//   STAGING  = anything else (Cloudflare *.pages.dev previews + branch alias,
//              localhost, leftover *.netlify.app URLs)
//
// Hostname allowlist beats pattern-matching — it's robust against future
// hosting changes. If we ever move off Cloudflare, only this constant moves.
// ============================================================================

export const PROD_HOSTS = ["abhinayacinemas.com", "www.abhinayacinemas.com"];

export type EnvName = "prod" | "staging";

export interface SupabaseEnv {
  name: EnvName;
  url: string;
  anonKey: string;
}

// Fallback values, identical to what's committed in admin/dcr/js/02-cloud.js.
// Anon (publishable) keys are PUBLIC by Supabase's own classification — they
// are meant to ship to the browser. Row-level security on the database is
// what actually controls access; the anon key just identifies which project
// is being talked to. Hardcoding them here keeps the deploy zero-config.
const PROD_FALLBACK = {
  url: "https://xkmjygegtpmmwwnyoufn.supabase.co",
  anonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrbWp5Z2VndHBtbXd3bnlvdWZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4ODI2NTEsImV4cCI6MjA5NTQ1ODY1MX0.ILYBoN4OqFGIatTCTJ3hhfbGj6n8Q6e5LAhOVDDuTgo",
};
const STAGING_FALLBACK = {
  url: "https://lctkvmpzijaspaytunkm.supabase.co",
  anonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjdGt2bXB6aWphc3BheXR1bmttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNTU0NDgsImV4cCI6MjA5NTYzMTQ0OH0.YeYegXQvX0l0FMABDgljs_bV_t9C66x77Y3kj2YZ55A",
};

/**
 * Decide which Supabase project this page should talk to.
 *
 * Vite env vars (optional — set in Cloudflare Pages → Settings → Environment
 * variables if you want to override the committed fallbacks):
 *   VITE_SUPABASE_URL_PROD      — prod project URL
 *   VITE_SUPABASE_ANON_PROD     — prod anon (publishable) key
 *   VITE_SUPABASE_URL_STAGING   — staging project URL
 *   VITE_SUPABASE_ANON_STAGING  — staging anon (publishable) key
 *
 * If no env var is set, falls back to the value committed above — keeps
 * first deploy / branch previews working without dashboard-side config.
 */
export function detectEnv(hostname: string = location.hostname): SupabaseEnv {
  const isProd = PROD_HOSTS.includes(hostname);

  if (isProd) {
    return {
      name: "prod",
      url: import.meta.env.VITE_SUPABASE_URL_PROD ?? PROD_FALLBACK.url,
      anonKey:
        import.meta.env.VITE_SUPABASE_ANON_PROD ?? PROD_FALLBACK.anonKey,
    };
  }

  return {
    name: "staging",
    url: import.meta.env.VITE_SUPABASE_URL_STAGING ?? STAGING_FALLBACK.url,
    anonKey:
      import.meta.env.VITE_SUPABASE_ANON_STAGING ?? STAGING_FALLBACK.anonKey,
  };
}

export const IS_PROD = (hostname: string = location.hostname): boolean =>
  PROD_HOSTS.includes(hostname);
