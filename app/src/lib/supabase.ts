// ============================================================================
// Supabase client singleton.
//
// One client per page load. Holds the auth session in localStorage and
// auto-refreshes the JWT. Used by everything that talks to the cloud:
// auth, pull, push, realtime subscriptions.
// ============================================================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { detectEnv, type SupabaseEnv } from "./env";

let _client: SupabaseClient | null = null;
let _env: SupabaseEnv | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  _env = detectEnv();
  if (!_env.anonKey) {
    throw new Error(
      `Supabase anon key missing for ${_env.name}. Set ` +
        `VITE_SUPABASE_ANON_${_env.name.toUpperCase()} in the Cloudflare ` +
        `Pages env, or hard-code it in env.ts for first-deploy convenience.`,
    );
  }
  _client = createClient(_env.url, _env.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return _client;
}

export function getEnv(): SupabaseEnv {
  if (!_env) getSupabase();
  return _env!;
}

/** Reset (useful for tests). Not used in app code. */
export function _resetSupabase(): void {
  _client = null;
  _env = null;
}
