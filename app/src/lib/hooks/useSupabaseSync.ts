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
  fbEntryKey,
  fbEntrySignature,
  fbEntryToRow,
  fbProductRowToProduct,
  fbRowToEntry,
  rowToEntry,
} from "../mappers";
import {
  catalogCacheFromAppState,
  emptyCatalogSyncCache,
  pushCatalogDeltas,
  readCatalog,
  type CatalogSyncCache,
} from "../mappers/catalog";
import type {
  AuthorizedUserRow,
  ConfigRow,
  EntryRow,
  FbEntryRow,
  FbProductRow,
} from "../db-types";
import type { AppState, Entry, FbEntry, FbProduct } from "../types";

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
  /** Resolved at boot once the cinemas table is reachable. Required for
   *  cinema-scoped writes (fb_products.create, future direct-table edits). */
  cinemaId: string | null;
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
    cinemaId: null,
    error: null,
    saveState: "idle",
  });

  // The "what's in the cloud right now" cache — used to compute deltas.
  // Held in a ref so updates don't trigger re-renders.
  const synced = useRef<{
    cfg: string | null;
    ent: Record<string, string>;
    fb: Record<string, string>;
    /** Cinema id resolved at boot — used for cinema-scoped writes (Phase 3). */
    cinemaId: string | null;
    /** Catalog sync cache for new-table delta detection. */
    catalog: CatalogSyncCache;
  }>({
    cfg: null,
    ent: {},
    fb: {},
    cinemaId: null,
    catalog: emptyCatalogSyncCache(),
  });

  // Debounce timers
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pullTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Most recent local state, accessible from async handlers without stale closures
  const localState = useRef<AppState | null>(null);

  // ── helpers ─────────────────────────────────────────────────────────

  const pullAll = useCallback(async (): Promise<AppState | null> => {
    try {
      // Phase 3: pull catalog from the normalized tables. If that fails
      // (empty tables, RLS, etc.) fall back to public.config.data so the
      // app stays usable while the migration is in flight.
      const [catalogRes, cfgRes, entRes, fbRes, prodRes] = await Promise.all([
        readCatalog(sb).catch((err) => {
          console.error("readCatalog failed; falling back to config.data", err);
          return null;
        }),
        sb.from("config").select("data").eq("id", 1).maybeSingle(),
        sb.from("entries").select("*"),
        sb.from("fb_entries").select("*"),
        sb.from("fb_products").select("*"),
      ]);

      const cfg = (cfgRes.data as Pick<ConfigRow, "data"> | null)?.data ?? null;
      const rows = ((entRes.data as EntryRow[]) || []);
      const entries: Entry[] = rows.map(rowToEntry);

      const fbRows = ((fbRes.data as FbEntryRow[]) || []);
      const fbEntries: FbEntry[] = fbRows.map(fbRowToEntry);

      const prodRows = ((prodRes.data as FbProductRow[]) || []);
      const fbProducts: FbProduct[] = prodRows.map(fbProductRowToProduct);

      // Build a fresh AppState. Catalog prefers the new tables; falls back
      // to config.data when the normalized read returned nothing.
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
        fbProducts,
        draft,
      };

      // Phase 3: config.data is authoritative for reads. The catalog
      // mirror in the new tables is for validation only — if it drifts
      // (RLS hiccup, partial write, etc.) we don't want stale reads to
      // erase a user's just-saved edit. catalogRes is queried only to
      // resolve cinemaId for the dual-write path.
      const next = applyConfigPayload(base, cfg) as AppState;
      synced.current.cinemaId = catalogRes?.cinemaId ?? null;
      synced.current.catalog  = catalogCacheFromAppState(next);

      // Refresh delta cache so pushDeltas only sends what's actually new.
      synced.current.cfg = JSON.stringify(cfgPayload(next));
      synced.current.ent = {};
      entries.forEach((e) => {
        synced.current.ent[entryKey(e)] = entrySignature(e);
      });
      synced.current.fb = {};
      fbEntries.forEach((e) => {
        synced.current.fb[fbEntryKey(e)] = fbEntrySignature(e);
      });

      localState.current = next;
      return next;
    } catch (err) {
      console.error("Cloud pull failed", err);
      return null;
    }
  }, [sb]);

  const pushDeltas = useCallback(async (): Promise<void> => {
    const s = localState.current;
    if (!s) return;
    const role = state.role;
    // Read-only / cash-only roles never push DCR state.
    if (role === "accountant" || role === "cashier") {
      setState((p) => ({ ...p, saveState: "saved" }));
      return;
    }
    const email = state.email ?? "";
    const ops: Array<PromiseLike<unknown>> = [];

    // Config + catalog mirror — owner OR manager. Daily managers and
    // accountants don't touch the catalog. (Legacy gate was owner-only,
    // which silently dropped manager-side catalog edits; 03b_relax_config_rls.sql
    // brings the DB policy in line with this code gate.)
    if (role === "owner" || role === "manager") {
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
        // Phase 3 dual-write: mirror to the new tables. Catalog-only.
        // Errors are logged inside pushCatalogDeltas — they DON'T fail the
        // sync, because config.data above is still the source of truth.
        if (synced.current.cinemaId) {
          ops.push(
            pushCatalogDeltas(sb, s, synced.current.cinemaId, email, synced.current.catalog)
              .then((nextCache) => { synced.current.catalog = nextCache; })
              .catch((err) => console.error("pushCatalogDeltas failed:", err)),
          );
        }
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
          sb.from("entries").upsert(entryToRow(e, email, synced.current.cinemaId), {
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

    // F&B entries — upsert changes, delete missing. Key is entry_date.
    const curFb: Record<string, true> = {};
    s.fbEntries.forEach((e) => {
      const k = fbEntryKey(e);
      const sig = fbEntrySignature(e);
      curFb[k] = true;
      if (synced.current.fb[k] !== sig) {
        ops.push(
          sb.from("fb_entries").upsert(fbEntryToRow(e, email, synced.current.cinemaId), {
            // After migration 06, fb_entries unique is (cinema_id, entry_date).
            // Sending both ensures the upsert resolves correctly on the new
            // schema. Pre-migration, cinema_id is null but the upsert still
            // matches on entry_date via the legacy unique.
            onConflict: "cinema_id,entry_date",
          }).then((r) => {
            if (r.error) console.error(r.error);
            else synced.current.fb[k] = sig;
          }),
        );
      }
    });
    Object.keys(synced.current.fb).forEach((k) => {
      if (!curFb[k]) {
        ops.push(
          sb.from("fb_entries").delete().eq("entry_date", k)
            .then((r) => {
              if (r.error) console.error(r.error);
              else delete synced.current.fb[k];
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
        cinemaId: synced.current.cinemaId,
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
    // realtime_version is a single-row sidecar that a Postgres trigger
    // bumps on every catalog change. Subscribing here means one channel
    // covers movies / screens / classes / etc. We still subscribe to the
    // legacy `config` table during Phase 3 so a backup-restore that
    // touches it triggers a refresh.
    const channel = sb
      .channel("dcr-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "entries" },          onRemote)
      .on("postgres_changes", { event: "*", schema: "public", table: "config" },           onRemote)
      .on("postgres_changes", { event: "*", schema: "public", table: "fb_entries" },       onRemote)
      .on("postgres_changes", { event: "*", schema: "public", table: "fb_products" },      onRemote)
      .on("postgres_changes", { event: "*", schema: "public", table: "realtime_version" }, onRemote)
      .subscribe();

    function onRemote(): void {
      if (pullTimer.current) clearTimeout(pullTimer.current);
      pullTimer.current = setTimeout(async () => {
        const next = await pullAll();
        if (next) setState((p) => ({ ...p, appState: next, cinemaId: synced.current.cinemaId }));
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
