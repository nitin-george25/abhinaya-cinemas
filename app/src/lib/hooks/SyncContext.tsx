// ============================================================================
// SyncContext — share the useSupabaseSync result across the component tree.
//
// useSupabaseSync owns side-effects (auth listener, realtime subscription,
// debounced push). We want exactly one instance of it for the whole app, so
// it's mounted at the root via <SyncProvider> and any component can read it
// via useSync() without prop drilling.
// ============================================================================

import { createContext, useContext, type ReactNode } from "react";
import { useSupabaseSync, type SyncApi } from "./useSupabaseSync";

const SyncContext = createContext<SyncApi | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const sync = useSupabaseSync();
  return <SyncContext.Provider value={sync}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncApi {
  const ctx = useContext(SyncContext);
  if (!ctx) {
    throw new Error(
      "useSync() must be called inside a <SyncProvider>. Mount it once at " +
        "the app root.",
    );
  }
  return ctx;
}
