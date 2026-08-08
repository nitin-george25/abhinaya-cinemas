// ============================================================================
// admin-users — owner-only user management.
//
// One Edge Function with action routing. Actions:
//   • create        { username, pin, fullName, role }   PIN user
//   • grant_google  { email, fullName, role }           Google user (owner only)
//   • reset_pin     { username, pin }
//   • update_role   { username | email, role }
//   • remove        { username | email }
//
// Auth model:
//   • Caller's JWT (from the browser session) is verified via getUser().
//   • Caller's role is looked up in authorized_users.
//   • Only `owner` may invoke any action.
//   • Mutations themselves go through the SERVICE ROLE client.
//
// Username → email mapping:
//   <username>@local.abhinayacinemas.com
//   No real email is ever sent to this address; it's just Supabase's
//   identifier for the user.
//
// Google users:
//   authorized_users IS the access list — Google OAuth creates the
//   auth.users row on first sign-in and the app rejects any session whose
//   email has no row here. So `grant_google` only inserts the row; there is
//   no password and nothing to email. Restricted to @abhinayacinemas.com
//   addresses and to owner callers.
//
// Deploy: copy this file's contents into the Supabase dashboard
//   Edge Functions → Create function → admin-users
// Env vars needed: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
//   (the first two are set automatically; the anon key is also injected.)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const LOCAL_DOMAIN = "local.abhinayacinemas.com";
// Google sign-in is limited to the company Workspace domain. Anything else
// (gmail.com, a personal address) is rejected before it reaches the table.
const CONSOLE_DOMAIN = "abhinayacinemas.com";
const USERNAME_RE = /^[a-z0-9]([a-z0-9._-]{1,30}[a-z0-9])?$/i;
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const PIN_RE = /^\d{6}$/;
const ROLES = new Set(["owner", "manager", "daily_manager", "accountant", "cashier"]);

// Subset of roles a non-owner caller (manager) may create / edit / remove.
// Owners can touch any role; managers are limited to the till-side
// personas so they can't promote anyone above themselves.
const MANAGER_MANAGEABLE_ROLES = new Set(["cashier", "daily_manager"]);

type Role = "owner" | "manager" | "daily_manager" | "accountant" | "cashier";

interface CreateBody { action: "create"; username: string; pin: string; fullName: string; role: Role; }
interface GrantGoogleBody { action: "grant_google"; email: string; fullName: string; role: Role; }
interface ResetPinBody { action: "reset_pin"; username: string; pin: string; }
/** Target is identified by `username` (PIN user) or `email` (Google user). */
interface UpdateRoleBody { action: "update_role"; username?: string; email?: string; role: Role; }
interface RemoveBody { action: "remove"; username?: string; email?: string; }
type Body = CreateBody | GrantGoogleBody | ResetPinBody | UpdateRoleBody | RemoveBody;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const usernameToEmail = (u: string) => `${u.toLowerCase()}@${LOCAL_DOMAIN}`;

/**
 * Resolve the row an action targets. PIN users come in as `username`,
 * Google users as `email` — both map onto authorized_users.email, which is
 * the table's identity.
 */
function resolveTarget(b: { username?: string; email?: string }): string | null {
  if (b.email) {
    const e = b.email.trim().toLowerCase();
    return EMAIL_RE.test(e) ? e : null;
  }
  if (b.username && USERNAME_RE.test(b.username)) return usernameToEmail(b.username);
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: "Supabase env vars not configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing authorization header" }, 401);

  // 1) Verify caller via the user's JWT
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes.user?.email) {
    return json({ error: "invalid session" }, 401);
  }
  const callerEmail = userRes.user.email.toLowerCase();

  // 2) Verify caller has user-admin rights. Owner can touch anyone;
  //    manager can touch only the till-side roles (cashier / daily_manager).
  //    Per-action target checks below enforce the scope.
  const svc = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: callerRow } = await svc
    .from("authorized_users")
    .select("role, cinema_ids")
    .eq("email", callerEmail)
    .maybeSingle();
  const callerRole = callerRow?.role as Role | undefined;
  // New users inherit the caller's cinema access. Without this the row
  // defaults to '{}' and cinema_access() fails every RLS check (symptom:
  // cashier sees an empty Unit dropdown in the petty expense form).
  const callerCinemaIds = (callerRow?.cinema_ids as string[] | null) ?? [];
  if (callerRole !== "owner" && callerRole !== "manager") {
    return json({ error: "owner or manager role required" }, 403);
  }

  // 3) Dispatch
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  switch (body.action) {
    case "create":       return await createUser(svc, body, callerRole, callerCinemaIds);
    case "grant_google": return await grantGoogle(svc, body, callerRole, callerCinemaIds);
    case "reset_pin":    return await resetPin(svc, body, callerRole);
    case "update_role":  return await updateRole(svc, body, callerRole);
    case "remove":       return await removeUser(svc, body, callerRole, callerEmail);
    default:
      return json({ error: "unknown action" }, 400);
  }
});

/**
 * For non-owner callers, verify the target user (and the new role, if any)
 * fall inside MANAGER_MANAGEABLE_ROLES. Owners bypass this check.
 */
async function authoriseTarget(
  svc: Svc,
  callerRole: Role,
  targetEmail: string,
  newRole?: Role,
): Promise<string | null> {
  if (callerRole === "owner") return null;
  if (newRole && !MANAGER_MANAGEABLE_ROLES.has(newRole)) {
    return "Manager can only assign cashier or daily_manager roles.";
  }
  // Google identities are owner territory regardless of the role they
  // currently hold — a manager must not be able to re-point staff access.
  if (!targetEmail.endsWith(`@${LOCAL_DOMAIN}`)) {
    return "Only an owner can manage Google users.";
  }
  // For actions on existing users (reset_pin / update_role / remove),
  // check the target's current role isn't owner/manager/accountant.
  const { data } = await svc
    .from("authorized_users")
    .select("role")
    .eq("email", targetEmail)
    .maybeSingle();
  const targetRole = (data as { role?: Role } | null)?.role;
  if (targetRole && !MANAGER_MANAGEABLE_ROLES.has(targetRole)) {
    return "Manager can only manage cashier and daily_manager users.";
  }
  return null;
}

// ── actions ────────────────────────────────────────────────────────────

type Svc = ReturnType<typeof createClient>;

async function createUser(
  svc: Svc,
  b: CreateBody,
  callerRole: Role,
  callerCinemaIds: string[],
): Promise<Response> {
  const v = validate(b);
  if (v) return json({ error: v }, 400);

  const email = usernameToEmail(b.username);
  const guard = await authoriseTarget(svc, callerRole, email, b.role);
  if (guard) return json({ error: guard }, 403);

  // Create the auth user with email_confirm so the user can sign in
  // immediately without an OTP / confirmation email round-trip.
  const { data: created, error: createErr } = await svc.auth.admin.createUser({
    email,
    password: b.pin,
    email_confirm: true,
    user_metadata: { username: b.username, full_name: b.fullName },
  });
  if (createErr) return json({ error: createErr.message }, 400);

  // Insert into authorized_users so the existing role-lookup works.
  // cinema_ids inherited from the caller — required for cinema_access()
  // RLS checks (operating_units, petty expenses, etc.).
  const { error: insertErr } = await svc.from("authorized_users").insert({
    email,
    role: b.role,
    full_name: b.fullName,
    username: b.username,
    cinema_ids: callerCinemaIds,
    // Owner/manager issued this PIN — force the user to pick their own
    // on first login (cleared by fn_clear_must_change_pin after change).
    must_change_pin: true,
  });
  if (insertErr) {
    // Roll back the auth user so we don't leave an orphan.
    await svc.auth.admin.deleteUser(created.user!.id);
    return json({ error: `insert failed: ${insertErr.message}` }, 400);
  }
  return json({ ok: true, email });
}

/**
 * Grant console access to a Google (Workspace) identity. Owner-only, and
 * only for @abhinayacinemas.com addresses — a row here is the entire grant,
 * so the domain check is the security boundary that keeps a stray gmail
 * address from being handed the books.
 */
async function grantGoogle(
  svc: Svc,
  b: GrantGoogleBody,
  callerRole: Role,
  callerCinemaIds: string[],
): Promise<Response> {
  if (callerRole !== "owner") {
    return json({ error: "Only an owner can grant Google access." }, 403);
  }

  const email = (b.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: "Enter a valid email address." }, 400);
  if (!email.endsWith(`@${CONSOLE_DOMAIN}`)) {
    return json({ error: `Email must be on @${CONSOLE_DOMAIN}.` }, 400);
  }
  if (email.endsWith(`@${LOCAL_DOMAIN}`)) {
    return json({ error: "That is a username login, not a Google address." }, 400);
  }
  if (!b.fullName || b.fullName.trim().length < 2) return json({ error: "Full name required." }, 400);
  if (!ROLES.has(b.role)) return json({ error: "Invalid role." }, 400);

  const { data: existing } = await svc
    .from("authorized_users")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  if (existing) return json({ error: `${email} already has access.` }, 409);

  // No auth user is created: Google OAuth mints auth.users on first
  // sign-in. cinema_ids is inherited from the granting owner, same as
  // createUser — an empty array fails every cinema_access() RLS check.
  const { error } = await svc.from("authorized_users").insert({
    email,
    role: b.role,
    full_name: b.fullName.trim(),
    username: null,
    cinema_ids: callerCinemaIds,
    must_change_pin: false,
  });
  if (error) return json({ error: `insert failed: ${error.message}` }, 400);
  return json({ ok: true, email });
}

async function resetPin(svc: Svc, b: ResetPinBody, callerRole: Role): Promise<Response> {
  if (!USERNAME_RE.test(b.username)) return json({ error: "invalid username" }, 400);
  if (!PIN_RE.test(b.pin)) return json({ error: "PIN must be exactly 6 digits" }, 400);

  const email = usernameToEmail(b.username);
  const guard = await authoriseTarget(svc, callerRole, email);
  if (guard) return json({ error: guard }, 403);

  const user = await findAuthUser(svc, email);
  if (!user) return json({ error: "user not found" }, 404);

  const { error } = await svc.auth.admin.updateUserById(user.id, { password: b.pin });
  if (error) return json({ error: error.message }, 400);

  // A reset PIN is owner/manager-issued too — force a change on next
  // login. Non-fatal if the column write fails; the PIN itself is set.
  await svc
    .from("authorized_users")
    .update({ must_change_pin: true })
    .eq("email", email);

  return json({ ok: true });
}

async function updateRole(svc: Svc, b: UpdateRoleBody, callerRole: Role): Promise<Response> {
  const email = resolveTarget(b);
  if (!email) return json({ error: "invalid username or email" }, 400);
  if (!ROLES.has(b.role)) return json({ error: "invalid role" }, 400);

  const guard = await authoriseTarget(svc, callerRole, email, b.role);
  if (guard) return json({ error: guard }, 403);

  const { error } = await svc
    .from("authorized_users")
    .update({ role: b.role })
    .eq("email", email);
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}

async function removeUser(
  svc: Svc,
  b: RemoveBody,
  callerRole: Role,
  callerEmail: string,
): Promise<Response> {
  const email = resolveTarget(b);
  if (!email) return json({ error: "invalid username or email" }, 400);
  // Removing your own row locks you out of the console with no way back
  // in through the UI. Refuse it outright.
  if (email === callerEmail) {
    return json({ error: "You cannot remove your own access." }, 400);
  }

  const guard = await authoriseTarget(svc, callerRole, email);
  if (guard) return json({ error: guard }, 403);

  const user = await findAuthUser(svc, email);
  if (user) {
    const { error } = await svc.auth.admin.deleteUser(user.id);
    if (error) return json({ error: error.message }, 400);
  }
  // Delete the authorized_users row too (cascade isn't set up).
  await svc.from("authorized_users").delete().eq("email", email);
  return json({ ok: true });
}

// ── helpers ────────────────────────────────────────────────────────────

function validate(b: CreateBody): string | null {
  if (!USERNAME_RE.test(b.username)) {
    return "Username must be 2–32 chars, letters/digits/._- only, starting and ending with letter/digit.";
  }
  if (!PIN_RE.test(b.pin)) return "PIN must be exactly 6 digits.";
  if (!b.fullName || b.fullName.length < 2) return "Full name required.";
  if (!ROLES.has(b.role)) return "Invalid role.";
  return null;
}

async function findAuthUser(svc: Svc, email: string) {
  // The admin API doesn't expose `getUserByEmail` directly — list + filter.
  // For our scale (low double-digit users) one page is plenty.
  const { data, error } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) return null;
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}
