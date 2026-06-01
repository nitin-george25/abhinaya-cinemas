// ============================================================================
// useSupabaseSync — React hook that replaces the localStorage + realtime
// juggling in admin/dcr/js/02-cloud.js.
//
// Lifecycle, mirroring the legacy boot sequence:
//   1. Read current auth session. If signed-out: state.status = "signed-out".
//   2. Look up the user's role in `authorized_users`. If not found:
//      state.status = "unauthorized".
//   3. Pull config + entries. state.status = "ready", state.appState set.
//   4. Subscribe to postgres_changes on `entries` + `config`.
//      Debounced re-pull on remote change (700ms) — same as legacy onRemote.
//   5. Expose:
//        • appState        — full AppState, updated on every pull
//        • saveDeltas()    — push only-what-changed (debounced 900ms)
//        • setAppState()   — replace local state (caller triggers saveDeltas)
//        • signOut()
//
// What this hook does NOT do (still legacy territory until later phases):
//   • Form-aware "soft refresh" gate (don't yank input mid-edit) — moves into
//     individual page components in C4.
//   • Status bar UI — moves into the app shell in C2.
//   • Import-from-JSON button — owner-only utility, moves into Settings in C6.
//
// Phase D will swap pull-all-on-change for a smarter subscription that only
// re-fetches the changed entry. For now, parity with legacy first.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabase } from "../supabase";
import {
  applyConfigPayload,
  cfgPayload,
  entryKey,
  entrySignature,
  entryToRow,
  fbRowToEntry,
  rowToEntry,
} from "../mappers";
import type {
  AuthorizedUserRow,
  ConfigRow,
  EntryRow,
  FbEntryRow,
} from "../db-types";
import type { AppState, Entry, FbEntry } from "../types";

export type SyncStatus =
  | "booting"
  | "signed-out"
  | "unauthorized"
  | "ready"
  | "error";

export type Role = AuthorizedUserRow["role"];

export interface SyncState {
  status: SyncStatus;
  email: string | null;
  /** Set when the user signed in via username + PIN. Null for Google users. */
  username: string | null;
  fullName: string | null;
  role: Role | null;
  appState: AppState | null;
  error: string | null;
  /** UI hint — "saving" while a push is in flight, "saved" after it lands. */
  saveState: "idle" | "saving" | "saved" | "error";
}

export interface SyncApi {
  state: SyncState;
  /** Replace local state and queue a debounced push. */
  setAppState: (next: AppState) => void;
  /** Force a re-pull from cloud (e.g. after a manual import). */
  refresh: () => Promise<void>;
  /** Trigger Google OAuth flow. */
  signIn: (redirectTo?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const PUSH_DEBOUNCE_MS = 900;
const PULL_DEBOUNCE_MS = 700;

/**
 * Top-level sync hook. Mount once near the app root and pass the result down
 * via context. Owns its own internal "synced" map for delta detection so
 * pushes scale with edits, not with total entry count.
 */
export function useSupabaseSync(): SyncApi {
  const sb = useRef<SupabaseClient>(getSupabase()).current;

  const [state, setState] = useState<SyncState>({
    status: "booting",
    email: null,
    username: null,
    fullName: null,
    role: null,
    appState: null,
    error: null,
    saveState: "idle",
  });

  // The "what's in the cloud right now" cache — used to compute deltas.
  // Held in a ref so updates don't trigger re-renders.
  const synced = useRef<{ cfg: string | null; ent: Record<string, string> }>({
    cfg: null,
    ent: {},
  });

  // Debounce timers
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pullTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Most recent local state, accessible from async handlers without stale closures
  const localState = useRef<AppState | null>(null);

  // ── helpers ─────────────────────────────────────────────────────────

  const pullAll = useCallback(async (): Promise<AppState | null> => {
    try {
      const [cfgRes, entRes, fbRes] = await Promise.all([
        sb.from("config").select("data").eq("id", 1).maybeSingle(),
        sb.from("entries").select("*"),
        sb.from("fb_entries").select("*"),
      ]);

      const cfg = (cfgRes.data as Pick<ConfigRow, "data"> | null)?.data ?? null;
      const rows = ((entRes.data as EntryRow[]) || []);
      const entries: Entry[] = rows.map(rowToEntry);

      const fbRows = ((fbRes.data as FbEntryRow[]) || []);
      const fbEntries: FbEntry[] = fbRows.map(fbRowToEntry);

      // Build a fresh AppState. Catalog comes from cfg; entries from rows.
      // Leave `draft` alone — it's not synced; the caller manages it locally.
      const draft = localState.current?.draft ?? null;
      const base: AppState = {
        cinema: { name: "", gstin: "" },
        tax: localState.current?.tax ?? ({} as AppState["tax"]),
        classes: [],
        screens: [],
        movies: [],
        serialStarts: [],
        openings: [],
        entries,
        fbEntries,
        draft,
      };
      const next = applyConfigPayload(base, cfg);

      // Refresh delta cache so pushDeltas only sends what's actually new.
      synced.current.cfg = JSON.stringify(cfgPayload(next as AppState));
      synced.current.ent = {};
      entries.forEach((e) => {
        synced.current.ent[entryKey(e)] = entrySignature(e);
      });

      localState.current = next as AppState;
      return next as AppState;
    } catch (err) {
      console.error("Cloud pull failed", err);
      return null;
    }
  }, [sb]);

  const pushDeltas = useCallback(async (): Promise<void> => {
    const s = localState.current;
    if (!s) return;
    const role = state.role;
    if (role === "accountant") {
      setState((p) => ({ ...p, saveState: "saved" }));
      return;
    }
    const email = state.email ?? "";
    const ops: Array<PromiseLike<unknown>> = [];

    // Config — owners only.
    if (role === "owner") {
      const cur = JSON.stringify(cfgPayload(s));
      if (cur !== synced.current.cfg) {
        ops.push(
          sb.from("config").upsert({
            id: 1,
            data: cfgPayload(s),
            updated_by: email,
            updated_at: new Date().toISOString(),
          }).then((r) => {
            if (r.error) console.error(r.error);
            else synced.current.cfg = cur;
          }),
        );
      }
    }

    // Entries — upsert changes, delete missing.
    const curKeys: Record<string, true> = {};
    s.entries.forEach((e) => {
      const k = entryKey(e);
      const sig = entrySignature(e);
      curKeys[k] = true;
      if (synced.current.ent[k] !== sig) {
        ops.push(
          sb.from("entries").upsert(entryToRow(e, email), {
            onConflict: "entry_date,movie_id,screen_id",
          }).then((r) => {
            if (r.error) console.error(r.error);
            else synced.current.ent[k] = sig;
          }),
        );
      }
    });
    Object.keys(synced.current.ent).forEach((k) => {
      if (!curKeys[k]) {
        const [entry_date, movie_id, screen_id] = k.split("|");
        ops.push(
          sb.from("entries").delete().match({ entry_date, movie_id, screen_id })
            .then((r) => {
              if (r.error) console.error(r.error);
              else delete synced.current.ent[k];
            }),
        );
      }
    });

    if (!ops.length) {
      setState((p) => ({ ...p, saveState: "saved" }));
      return;
    }

    setState((p) => ({ ...p, saveState: "saving" }));
    try {
      await Promise.all(ops);
      setState((p) => ({ ...p, saveState: "saved" }));
    } catch (err) {
      console.error(err);
      setState((p) => ({ ...p, saveState: "error" }));
    }
  }, [sb, state.role, state.email]);

  // ── boot ────────────────────────────────────────────────────────────

  const boot = useCallback(async (): Promise<void> => {
    setState((p) => ({ ...p, status: "booting", error: null }));
    try {
      const { data } = await sb.auth.getUser();
      const user = data.user;
      if (!user) {
        setState((p) => ({ ...p, status: "signed-out", email: null, role: null }));
        return;
      }
      const email = (user.email ?? "").toLowerCase();
      const lookup = await sb
        .from("authorized_users")
        .select("email,role,full_name,username")
        .eq("email", email)
        .maybeSingle();
      if (lookup.error) console.error(lookup.error);
      const row = lookup.data as AuthorizedUserRow | null;
      if (!row) {
        setState((p) => ({
          ...p,
          status: "unauthorized",
          email,
          username: null,
          fullName: null,
          role: null,
          error: `${email} isn't on the access list yet — ask the owner to add your email.`,
        }));
        return;
      }
      const appState = await pullAll();
      setState((p) => ({
        ...p,
        status: appState ? "ready" : "error",
        email,
        username: row.username,
        fullName: row.full_name,
        role: row.role,
        appState,
        saveState: "saved",
        error: appState ? null : "Could not reach the database.",
      }));
    } catch (err) {
      console.error("boot failed", err);
      setState((p) => ({
        ...p,
        status: "error",
        error: "Could not reach the database. Check your connection.",
      }));
    }
  }, [sb, pullAll]);

  // Initial boot + auth-change listener.
  useEffect(() => {
    void boot();
    const sub = sb.auth.onAuthStateChange((evt) => {
      if (evt === "SIGNED_IN") void boot();
      if (evt === "SIGNED_OUT") {
        setState((p) => ({
          ...p,
          status: "signed-out",
          email: null,
          username: null,
          fullName: null,
          role: null,
          appState: null,
        }));
      }
    });
    return () => {
      sub.data.subscription.unsubscribe();
    };
    // boot is stable enough — we want a single boot on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime subscription — only mount once we're signed in + ready.
  useEffect(() => {
    if (state.status !== "ready") return;
    const channel = sb
      .channel("dcr-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "entries" },    onRemote)
      .on("postgres_changes", { event: "*", schema: "public", table: "config" },     onRemote)
      .on("postgres_changes", { event: "*", schema: "public", table: "fb_entries" }, onRemote)
      .subscribe();

    function onRemote(): void {
      if (pullTimer.current) clearTimeout(pullTimer.current);
      pullTimer.current = setTimeout(async () => {
        const next = await pullAll();
        if (next) setState((p) => ({ ...p, appState: next }));
      }, PULL_DEBOUNCE_MS);
    }

    return () => {
      void sb.removeChannel(channel);
      if (pullTimer.current) clearTimeout(pullTimer.current);
    };
  }, [sb, pullAll, state.status]);

  // ── API ────────────────────────────────────────────────────────────

  const setAppState = useCallback((next: AppState) => {
    localState.current = next;
    setState((p) => ({ ...p, appState: next, saveState: "saving" }));
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      void pushDeltas();
    }, PUSH_DEBOUNCE_MS);
  }, [pushDeltas]);

  const refresh = useCallback(async () => {
    const next = await pullAll();
    if (next) setState((p) => ({ ...p, appState: next }));
  }, [pullAll]);

  const signIn = useCallback(async (redirectTo?: string) => {
    await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo ?? location.origin + location.pathname },
    });
  }, [sb]);

  const signOut = useCallback(async () => {
    await sb.auth.signOut();
  }, [sb]);

  return { state, setAppState, refresh, signIn, signOut };
}
