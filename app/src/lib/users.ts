// ============================================================================
// Username/PIN auth — client-side helpers + admin API wrapper.
//
//  • signInWithUsername — transforms username → internal email and calls
//    Supabase's standard signInWithPassword. PIN is the password.
//  • adminUsers.create / grantGoogle / resetPin / updateRole / remove —
//    wraps the admin-users Edge Function. Owner-only on the server
//    (create / reset_pin also allow manager for till-side roles).
//  • listUsers — direct SELECT from authorized_users (RLS allows owner reads).
//
// Validation matches what the Edge Function enforces (no point asking the
// user to roundtrip just to learn their PIN was 5 digits).
// ============================================================================

import { getSupabase } from "./supabase";
import type { AuthorizedUserRow } from "./db-types";

export const LOCAL_DOMAIN = "local.abhinayacinemas.com";
/** Google sign-in is limited to the company Workspace domain. */
export const CONSOLE_DOMAIN = "abhinayacinemas.com";
export const USERNAME_RE = /^[a-z0-9]([a-z0-9._-]{1,30}[a-z0-9])?$/i;
export const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
export const PIN_RE = /^\d{6}$/;

export type Role = AuthorizedUserRow["role"];

export const usernameToEmail = (u: string): string =>
  `${u.toLowerCase().trim()}@${LOCAL_DOMAIN}`;

export const isInternalEmail = (email: string | null | undefined): boolean =>
  !!email && email.toLowerCase().endsWith(`@${LOCAL_DOMAIN}`);

/**
 * True for a real Workspace address the owner may grant Google access to.
 * `@local.` is excluded explicitly — it ends with the console domain too.
 */
export const isConsoleDomainEmail = (email: string): boolean => {
  const e = email.trim().toLowerCase();
  return EMAIL_RE.test(e) && e.endsWith(`@${CONSOLE_DOMAIN}`) && !isInternalEmail(e);
};

/** Extract the username from an internal email; null for real emails. */
export function usernameFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const lower = email.toLowerCase();
  const suffix = `@${LOCAL_DOMAIN}`;
  if (!lower.endsWith(suffix)) return null;
  return lower.slice(0, -suffix.length);
}

// ── sign-in ────────────────────────────────────────────────────────────

export interface SignInResult {
  ok: boolean;
  error?: string;
}

export async function signInWithUsername(
  username: string,
  pin: string,
): Promise<SignInResult> {
  const u = username.trim();
  if (!USERNAME_RE.test(u)) {
    return { ok: false, error: "Username must be letters/digits/._- only." };
  }
  if (!PIN_RE.test(pin)) {
    return { ok: false, error: "PIN must be exactly 6 digits." };
  }
  const sb = getSupabase();
  const { error } = await sb.auth.signInWithPassword({
    email: usernameToEmail(u),
    password: pin,
  });
  if (error) {
    // Mask "Invalid login credentials" → friendlier text. Other Supabase
    // errors (rate limit, etc.) pass through with their original wording.
    const msg = /invalid login/i.test(error.message)
      ? "Wrong username or PIN."
      : error.message;
    return { ok: false, error: msg };
  }
  return { ok: true };
}

// ── change own PIN (forced on first login) ─────────────────────────────

/**
 * Replace the signed-in user's PIN with one they chose themselves, then
 * clear the `must_change_pin` flag. PIN-auth users only — the PIN is the
 * Supabase password, so this is a plain password update on the current
 * session. The flag is cleared via a SECURITY DEFINER RPC because
 * authorized_users has no self-UPDATE policy (and shouldn't — it would
 * let users edit their own role).
 */
export async function changeOwnPin(pin: string): Promise<SignInResult> {
  if (!PIN_RE.test(pin)) {
    return { ok: false, error: "PIN must be exactly 6 digits." };
  }
  const sb = getSupabase();
  const { error } = await sb.auth.updateUser({ password: pin });
  if (error) {
    // Supabase rejects a password identical to the current one — surface
    // that case in PIN vocabulary instead of "New password should be
    // different from the old password."
    const msg = /different from the old/i.test(error.message)
      ? "New PIN must be different from the one you were given."
      : error.message;
    return { ok: false, error: msg };
  }
  const { error: rpcErr } = await sb.rpc("fn_clear_must_change_pin");
  if (rpcErr) return { ok: false, error: rpcErr.message };
  return { ok: true };
}

// ── admin API (owner-only on the server) ───────────────────────────────

export interface CreatePayload {
  username: string;
  pin: string;
  fullName: string;
  role: Role;
}

export interface GrantGooglePayload {
  email: string;
  fullName: string;
  role: Role;
}

/**
 * How an admin action names its target row: PIN users by username, Google
 * users by email. Exactly one is sent; the server resolves both onto
 * authorized_users.email.
 */
export type UserTarget = { username: string } | { email: string };

// `payload` is widened to `object` (instead of Record<string, unknown>) so
// strict-typed interfaces like CreatePayload assign cleanly without a cast.
// At runtime we just spread it into the JSON body.
async function invoke<T>(action: string, payload: object): Promise<T> {
  const sb = getSupabase();
  const { data, error } = await sb.functions.invoke("admin-users", {
    body: { action, ...payload },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(String(data.error));
  return data as T;
}

export const adminUsers = {
  create: (p: CreatePayload) => invoke<{ ok: true; email: string }>("create", p),
  /** Owner-only. Adds a @abhinayacinemas.com address to the access list;
   *  the auth user appears by itself on their first Google sign-in. */
  grantGoogle: (p: GrantGooglePayload) =>
    invoke<{ ok: true; email: string }>("grant_google", p),
  resetPin: (username: string, pin: string) =>
    invoke<{ ok: true }>("reset_pin", { username, pin }),
  updateRole: (target: UserTarget, role: Role) =>
    invoke<{ ok: true }>("update_role", { ...target, role }),
  remove: (target: UserTarget) => invoke<{ ok: true }>("remove", target),
};

// ── list (direct read; admin-users isn't needed) ───────────────────────

export interface ListedUser {
  email: string;
  username: string | null;
  fullName: string | null;
  role: Role;
}

export async function listUsers(): Promise<ListedUser[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("authorized_users")
    .select("email, username, full_name, role")
    .order("username", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const row = r as { email: string; username: string | null; full_name: string | null; role: Role };
    return {
      email: row.email,
      username: row.username,
      fullName: row.full_name,
      role: row.role,
    };
  });
}

/** Cryptographically OK random 6-digit PIN (for the "generate" button). */
export function randomPin(): string {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  const n = (a[0]! % 1_000_000).toString().padStart(6, "0");
  return n;
}
