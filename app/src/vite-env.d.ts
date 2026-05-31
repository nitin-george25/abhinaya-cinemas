/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL_PROD?: string;
  readonly VITE_SUPABASE_ANON_PROD?: string;
  readonly VITE_SUPABASE_URL_STAGING?: string;
  readonly VITE_SUPABASE_ANON_STAGING?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
