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

/**
 * Decide which Supabase project this page should talk to.
 *
 * Vite env vars (set in Cloudflare Pages → Settings → Environment variables):
 *   VITE_SUPABASE_URL_PROD      — prod project URL
 *   VITE_SUPABASE_ANON_PROD     — prod anon (publishable) key
 *   VITE_SUPABASE_URL_STAGING   — staging project URL
 *   VITE_SUPABASE_ANON_STAGING  — staging anon (publishable) key
 *
 * Falls back to the values committed in the legacy 02-cloud.js so this works
 * out of the box on first deploy without dashboard-side env config.
 */
export function detectEnv(hostname: string = location.hostname): SupabaseEnv {
  const isProd = PROD_HOSTS.includes(hostname);

  if (isProd) {
    return {
      name: "prod",
      url: import.meta.env.VITE_SUPABASE_URL_PROD ??
        "https://xkmjygegtpmmwwnyoufn.supabase.co",
      anonKey: import.meta.env.VITE_SUPABASE_ANON_PROD ?? "",
    };
  }

  return {
    name: "staging",
    url: import.meta.env.VITE_SUPABASE_URL_STAGING ??
      "https://lctkvmpzijaspaytunkm.supabase.co",
    anonKey: import.meta.env.VITE_SUPABASE_ANON_STAGING ?? "",
  };
}

export const IS_PROD = (hostname: string = location.hostname): boolean =>
  PROD_HOSTS.includes(hostname);
