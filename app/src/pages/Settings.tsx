// ============================================================================
// Settings section components.
//
// Each section is exported and rendered by its own route page under
// /settings/<slug>. The legacy all-in-one SettingsPage default export is
// retired in favor of dedicated routes (Movies, Screens & Classes, Tax,
// Users). MenuItemsSection moved out to /fb/menu-items.
// ============================================================================

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { useSync } from "../lib/hooks/SyncContext";
import {
  adminUsers,
  isInternalEmail,
  listUsers,
  randomPin,
  USERNAME_RE,
  PIN_RE,
  type ListedUser,
  type Role,
} from "../lib/users";
import { fbProducts as fbProductsApi } from "../lib/fb";
import { fmtINR } from "../lib/dashboard";
import { uid } from "../lib/mappers";
import type {
  ClassDef,
  FbProduct,
  Movie,
  PriceCard,
  Screen,
  ScreenClassAssignment,
  TaxConfig,
  UUID,
} from "../lib/types";

import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { Field, Input, Select } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { IconSpinner } from "../components/icons";

const ROLES: Role[] = ["owner", "manager", "daily_manager", "accountant", "cashier"];

/** Roles a manager (non-owner) can create / edit / remove. Mirrors the
 *  MANAGER_MANAGEABLE_ROLES set in the admin-users Edge Function so the
 *  UI shows what the server will actually accept. */
const MANAGER_ASSIGNABLE_ROLES: Role[] = ["daily_manager", "cashier"];

const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  manager: "Manager",
  daily_manager: "Daily Manager",
  accountant: "Accountant",
  cashier: "Cashier",
};

// ── users section ─────────────────────────────────────────────────────

export function UsersSection() {
  const { state } = useSync();
  const [users, setUsers] = useState<ListedUser[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await listUsers());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Owner = full access; manager = limited to cashier + daily_manager
  // (server enforces the same scope, see admin-users Edge Function).
  const isOwner   = state.role === "owner";
  const isManager = state.role === "manager";
  if (!isOwner && !isManager) {
    return (
      <Card>
        <CardBody className="text-sm text-ink-muted">
          User management is restricted to owner and manager roles.
        </CardBody>
      </Card>
    );
  }
  const assignableRoles = isOwner ? ROLES : MANAGER_ASSIGNABLE_ROLES;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={load}
              disabled={loading}
            >
              {loading ? <IconSpinner className="w-4 h-4 mr-1" /> : null}
              Refresh
            </Button>
            <Button size="sm" onClick={() => setAdding((a) => !a)}>
              {adding ? "Cancel" : "+ Add user"}
            </Button>
          </div>
        </CardHeader>
        {adding ? (
          <CardBody className="border-b border-line bg-paper">
            <AddUserForm
              assignableRoles={assignableRoles}
              onCancel={() => setAdding(false)}
              onCreated={() => { setAdding(false); void load(); }}
            />
          </CardBody>
        ) : null}
        <CardBody className="p-0">
          {error ? (
            <p className="px-5 py-4 text-sm text-red-700 bg-red-50">{error}</p>
          ) : null}
          {!users ? (
            <p className="px-5 py-5 text-sm text-ink-muted">Loading users…</p>
          ) : users.length === 0 ? (
            <p className="px-5 py-5 text-sm text-ink-muted">No users yet.</p>
          ) : (
            <UsersTable
              users={users}
              onChanged={load}
              assignableRoles={assignableRoles}
              isOwner={isOwner}
            />
          )}
        </CardBody>
      </Card>

      <p className="text-xs text-ink-muted">
        Username login uses the email{" "}
        <code>&lt;username&gt;@local.abhinayacinemas.com</code> internally — no real
        email is ever sent there. PINs are 6 digits. Owner can manage any role;
        manager can manage cashier and daily-manager users only. The server
        enforces the same scope.
      </p>
    </div>
  );
}

// ── table ─────────────────────────────────────────────────────────────

function UsersTable({
  users,
  onChanged,
  assignableRoles,
  isOwner,
}: {
  users: ListedUser[];
  onChanged: () => void;
  assignableRoles: Role[];
  isOwner: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-ink-muted border-b border-line">
            <th className="text-left px-5 py-3 font-semibold">Name</th>
            <th className="text-left px-5 py-3 font-semibold">Identity</th>
            <th className="text-left px-5 py-3 font-semibold">Role</th>
            <th className="text-right px-5 py-3 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <UserRow
              key={u.email}
              user={u}
              onChanged={onChanged}
              assignableRoles={assignableRoles}
              isOwner={isOwner}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserRow({
  user,
  onChanged,
  assignableRoles,
  isOwner,
}: {
  user: ListedUser;
  onChanged: () => void;
  assignableRoles: Role[];
  isOwner: boolean;
}) {
  const isUsernameUser = isInternalEmail(user.email);
  const [busy, setBusy] = useState<string | null>(null);
  // For managers: rows holding a role outside their scope are read-only.
  const canManageThisRow = isOwner || assignableRoles.includes(user.role);

  async function withBusy(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try { await fn(); } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function changeRole(role: Role) {
    if (!isUsernameUser || !user.username) {
      alert("Role changes for Google users must be done in Supabase directly.");
      return;
    }
    if (role === user.role) return;
    await withBusy("role", async () => {
      await adminUsers.updateRole(user.username!, role);
      onChanged();
    });
  }

  async function resetPin() {
    if (!isUsernameUser || !user.username) return;
    const pin = prompt(
      `Set a new 6-digit PIN for ${user.username}.\n\nClick OK with an empty field to auto-generate.`,
      "",
    );
    if (pin === null) return;
    const newPin = pin.trim() === "" ? randomPin() : pin.trim();
    if (!PIN_RE.test(newPin)) {
      alert("PIN must be exactly 6 digits.");
      return;
    }
    await withBusy("pin", async () => {
      await adminUsers.resetPin(user.username!, newPin);
      alert(`New PIN for ${user.username}: ${newPin}\n\nShare with the user.`);
    });
  }

  async function remove() {
    const label = user.username ?? user.email;
    if (!confirm(`Remove ${label}? They'll lose access immediately.`)) return;
    if (!isUsernameUser || !user.username) {
      alert("Google users must be removed from Supabase directly.");
      return;
    }
    await withBusy("remove", async () => {
      await adminUsers.remove(user.username!);
      onChanged();
    });
  }

  return (
    <tr className="border-b border-line last:border-b-0 hover:bg-paper/60">
      <td className="px-5 py-3">
        <div className="font-medium">{user.fullName ?? "—"}</div>
      </td>
      <td className="px-5 py-3">
        {isUsernameUser ? (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[13px]">{user.username}</span>
            <Badge tone="neutral">username</Badge>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[13px]">{user.email}</span>
            <Badge tone="blue">Google</Badge>
          </div>
        )}
      </td>
      <td className="px-5 py-3">
        {canManageThisRow ? (
          <Select
            value={user.role}
            onChange={(e) => void changeRole(e.target.value as Role)}
            disabled={!isUsernameUser || !!busy}
            className="w-36 h-8 text-sm"
          >
            {/* Always include the user's current role so the picker isn't
                blank even if the manager can't change to a wider set. */}
            {(assignableRoles.includes(user.role) ? assignableRoles : [user.role, ...assignableRoles])
              .map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
          </Select>
        ) : (
          <span className="text-sm">{ROLE_LABELS[user.role]}</span>
        )}
      </td>
      <td className="px-5 py-3 text-right">
        <div className="inline-flex items-center gap-2">
          {isUsernameUser && canManageThisRow ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void resetPin()}
                disabled={!!busy}
              >
                {busy === "pin" ? <IconSpinner className="w-4 h-4" /> : "Reset PIN"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void remove()}
                disabled={!!busy}
                className="text-red-700"
              >
                {busy === "remove" ? <IconSpinner className="w-4 h-4" /> : "Remove"}
              </Button>
            </>
          ) : !isUsernameUser ? (
            <span className="text-xs text-ink-muted">manage in Supabase</span>
          ) : (
            <span className="text-xs text-ink-muted">owner only</span>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── add user form ─────────────────────────────────────────────────────

function AddUserForm({
  assignableRoles,
  onCancel,
  onCreated,
}: {
  assignableRoles: Role[];
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  // Default to the first role the current user can assign — owner gets
  // "manager"; manager-tier caller gets "daily_manager".
  const [role, setRole] = useState<Role>(
    assignableRoles.includes("manager") ? "manager" : assignableRoles[0] ?? "cashier",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!fullName.trim()) return "Full name required.";
    if (!USERNAME_RE.test(username.trim())) {
      return "Username must be letters/digits/._- only.";
    }
    if (!PIN_RE.test(pin)) return "PIN must be exactly 6 digits.";
    return null;
  }

  async function go(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const v = validate();
    if (v) { setError(v); return; }
    setBusy(true);
    try {
      await adminUsers.create({
        username: username.trim(),
        pin,
        fullName: fullName.trim(),
        role,
      });
      alert(
        `Created ${username}.\n\nShare these credentials:\n\nUsername: ${username}\nPIN: ${pin}`,
      );
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={go} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
      <Field label="Full name">
        <Input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Ramu R."
        />
      </Field>
      <Field label="Username">
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          placeholder="ramu"
          autoCapitalize="off"
        />
      </Field>
      <Field label="6-digit PIN">
        <div className="flex gap-2">
          <Input
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className="tabular-nums"
          />
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={() => setPin(randomPin())}
            title="Generate random PIN"
          >
            ↻
          </Button>
        </div>
      </Field>
      <Field label="Role">
        <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {assignableRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </Select>
      </Field>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy} className="flex-1">
          {busy ? <IconSpinner className="w-4 h-4" /> : null}
          Create
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
      {error ? (
        <p className="col-span-full text-sm text-red-700">{error}</p>
      ) : null}
    </form>
  );
}

// ============================================================================
// Menu items section — owner-only editor on top of fb_products.
// Inserts / updates / deletes call Supabase directly (RLS enforces
// owner-only writes); the realtime subscription picks the change up via
// useSupabaseSync's onRemote pull so the UI re-renders within ~700ms.
// ============================================================================

export function MenuItemsSection() {
  const { state } = useSync();
  const appState = state.appState;
  const products = appState?.fbProducts ?? [];
  const [adding, setAdding] = useState(false);

  if (state.role !== "owner") {
    return (
      <Card>
        <CardBody className="text-sm text-ink-muted">
          F&amp;B menu items can only be edited by the owner.
        </CardBody>
      </Card>
    );
  }

  const sorted = [...products].sort((a, b) => {
    const c = a.category.localeCompare(b.category);
    if (c) return c;
    return a.name.localeCompare(b.name);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>F&amp;B menu items</CardTitle>
        <Button size="sm" onClick={() => setAdding((a) => !a)}>
          {adding ? "Cancel" : "+ Add item"}
        </Button>
      </CardHeader>
      {adding ? (
        <CardBody className="border-b border-line bg-paper">
          <AddProductForm
            onCancel={() => setAdding(false)}
            onCreated={() => setAdding(false)}
          />
        </CardBody>
      ) : null}
      <CardBody className="p-0">
        {sorted.length === 0 ? (
          <p className="px-5 py-5 text-sm text-ink-muted">
            No products yet. Add one above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-ink-muted border-b border-line">
                  <th className="text-left  px-5 py-3 font-semibold w-20">Item #</th>
                  <th className="text-left  px-5 py-3 font-semibold">Name</th>
                  <th className="text-left  px-5 py-3 font-semibold w-44">Category</th>
                  <th className="text-right px-5 py-3 font-semibold w-32">Default rate</th>
                  <th className="text-right px-5 py-3 font-semibold w-24">GST %</th>
                  <th className="text-right px-5 py-3 font-semibold w-32">Status</th>
                  <th className="text-right px-5 py-3 font-semibold w-20"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => (
                  <ProductRow key={p.id} product={p} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ProductRow({ product }: { product: FbProduct }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(product.name);
  const [category, setCategory] = useState(product.category);
  const [rate, setRate] = useState(String(product.defaultRate));
  const [gst, setGst] = useState(String(product.defaultGstPct));

  async function save() {
    setBusy(true);
    try {
      await fbProductsApi.update(product.id, {
        name: name.trim(),
        category: category.trim(),
        defaultRate: Number(rate) || 0,
        defaultGstPct: Number(gst) || 0,
      });
      setEditing(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    setBusy(true);
    try {
      await fbProductsApi.update(product.id, { isActive: !product.isActive });
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${product.name}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      await fbProductsApi.remove(product.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <tr className="border-b border-line bg-amber-50/40">
        <td className="px-5 py-2 text-[11px] text-ink-muted">{product.posItemNumber ?? "—"}</td>
        <td className="px-5 py-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" />
        </td>
        <td className="px-5 py-2">
          <Input value={category} onChange={(e) => setCategory(e.target.value)} className="h-8" />
        </td>
        <td className="px-5 py-2">
          <Input
            type="number" min={0} step={0.01}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="h-8 text-right"
          />
        </td>
        <td className="px-5 py-2">
          <Input
            type="number" min={0} max={100} step={0.01}
            value={gst}
            onChange={(e) => setGst(e.target.value)}
            className="h-8 text-right"
          />
        </td>
        <td />
        <td className="px-5 py-2 text-right whitespace-nowrap">
          <Button size="sm" onClick={() => void save()} disabled={busy}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </Button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-line hover:bg-paper/60">
      <td className="px-5 py-2 text-[11px] text-ink-muted">{product.posItemNumber ?? "—"}</td>
      <td className="px-5 py-2 font-medium">{product.name}</td>
      <td className="px-5 py-2 text-ink-muted">{product.category || "—"}</td>
      <td className="px-5 py-2 text-right tabular-nums">{fmtINR(product.defaultRate)}</td>
      <td className="px-5 py-2 text-right tabular-nums">{product.defaultGstPct}%</td>
      <td className="px-5 py-2 text-right">
        <Badge tone={product.isActive ? "green" : "neutral"}>
          {product.isActive ? "active" : "inactive"}
        </Badge>
      </td>
      <td className="px-5 py-2 text-right whitespace-nowrap">
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={busy}>
          Edit
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void toggleActive()} disabled={busy}>
          {product.isActive ? "Hide" : "Show"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void remove()} disabled={busy} className="text-red-700">
          ×
        </Button>
      </td>
    </tr>
  );
}

function AddProductForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (id: UUID) => void;
}) {
  const { state } = useSync();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [rate, setRate] = useState("");
  const [gst, setGst] = useState("5");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError("Name required."); return; }
    if (!state.cinemaId) {
      setError("No cinema loaded yet — wait for sync to complete, then retry.");
      return;
    }
    setBusy(true);
    try {
      const id = await fbProductsApi.create({
        name: name.trim(),
        category: category.trim(),
        defaultRate: Number(rate) || 0,
        defaultGstPct: Number(gst) || 0,
      }, state.cinemaId);
      onCreated(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={go} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Popcorn — Large" />
      </Field>
      <Field label="Category">
        <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Snacks" />
      </Field>
      <Field label="Default rate">
        <Input
          type="number" min={0} step={0.01}
          value={rate} onChange={(e) => setRate(e.target.value)}
          placeholder="0.00" className="text-right"
        />
      </Field>
      <Field label="GST %">
        <Input
          type="number" min={0} max={100} step={0.01}
          value={gst} onChange={(e) => setGst(e.target.value)}
          className="text-right"
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy} className="flex-1">
          {busy ? <IconSpinner className="w-4 h-4" /> : null}
          Add
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
      {error ? <p className="col-span-full text-sm text-red-700">{error}</p> : null}
    </form>
  );
}

// ============================================================================
// Movies / Price Cards / Screens & Tax — all owner+manager. State edits
// flow through setAppState; the existing config-push delta upserts the
// catalog JSONB on Supabase. No schema, no sync changes.
// ============================================================================

function canEditCatalog(role: Role | null): boolean {
  return role === "owner" || role === "manager";
}

// ── Movies ─────────────────────────────────────────────────────────────

export function MoviesSection() {
  const { state, setAppState } = useSync();
  const appState = state.appState;
  if (!appState || !canEditCatalog(state.role)) return null;

  const [adding, setAdding] = useState(false);

  function save(next: Movie) {
    if (!appState) return;
    const others = appState.movies.filter((m) => m.id !== next.id);
    setAppState({ ...appState, movies: [...others, next] });
  }
  function remove(id: UUID) {
    if (!appState) return;
    const m = appState.movies.find((x) => x.id === id);
    if (!confirm(`Delete "${m?.name ?? id}"? Existing entries keep their movieId reference.`)) return;
    setAppState({ ...appState, movies: appState.movies.filter((x) => x.id !== id) });
  }

  const sorted = [...appState.movies].sort((a, b) => {
    return (b.release ?? "").localeCompare(a.release ?? "") || a.name.localeCompare(b.name);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Movies</CardTitle>
        <Button size="sm" onClick={() => setAdding((a) => !a)}>
          {adding ? "Cancel" : "+ Add movie"}
        </Button>
      </CardHeader>
      {adding ? (
        <CardBody className="border-b border-line bg-paper">
          <MovieForm
            onCancel={() => setAdding(false)}
            onSave={(m) => { save(m); setAdding(false); }}
          />
        </CardBody>
      ) : null}
      <CardBody className="p-0">
        {sorted.length === 0 ? (
          <p className="px-5 py-5 text-sm text-ink-muted">No movies yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-ink-muted border-b border-line">
                  <th className="text-left px-5 py-3 font-semibold">Name</th>
                  <th className="text-left px-5 py-3 font-semibold w-48">Distributor</th>
                  <th className="text-left px-5 py-3 font-semibold w-32">Release</th>
                  <th className="text-right px-5 py-3 font-semibold w-24">Share %</th>
                  <th className="text-right px-5 py-3 font-semibold w-32"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => (
                  <MovieRow key={m.id} movie={m} onSave={save} onRemove={remove} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function MovieRow({
  movie,
  onSave,
  onRemove,
}: {
  movie: Movie;
  onSave: (m: Movie) => void;
  onRemove: (id: UUID) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(movie.name);
  const [dist, setDist] = useState(movie.distributor ?? "");
  const [release, setRelease] = useState(movie.release ?? "");
  const [share, setShare] = useState(String(movie.share ?? 0));

  function save() {
    onSave({
      ...movie,
      name: name.trim(),
      distributor: dist.trim() || undefined,
      release: release || undefined,
      share: Number(share) || 0,
    });
    setEditing(false);
  }

  if (editing) {
    return (
      <tr className="border-b border-line bg-amber-50/40">
        <td className="px-5 py-2"><Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" /></td>
        <td className="px-5 py-2"><Input value={dist} onChange={(e) => setDist(e.target.value)} className="h-8" /></td>
        <td className="px-5 py-2"><Input type="date" value={release} onChange={(e) => setRelease(e.target.value)} className="h-8" /></td>
        <td className="px-5 py-2">
          <Input
            type="number" min={0} max={100} step={0.01}
            value={share} onChange={(e) => setShare(e.target.value)}
            className="h-8 text-right"
          />
        </td>
        <td className="px-5 py-2 text-right whitespace-nowrap">
          <Button size="sm" onClick={save}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-b border-line hover:bg-paper/60">
      <td className="px-5 py-2 font-medium">{movie.name}</td>
      <td className="px-5 py-2 text-ink-muted">{movie.distributor ?? "—"}</td>
      <td className="px-5 py-2 text-ink-muted tabular-nums">{movie.release ?? "—"}</td>
      <td className="px-5 py-2 text-right tabular-nums">{movie.share}%</td>
      <td className="px-5 py-2 text-right whitespace-nowrap">
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
        <Button size="sm" variant="ghost" onClick={() => onRemove(movie.id)} className="text-red-700">×</Button>
      </td>
    </tr>
  );
}

function MovieForm({ onCancel, onSave }: { onCancel: () => void; onSave: (m: Movie) => void }) {
  const [name, setName] = useState("");
  const [dist, setDist] = useState("");
  const [release, setRelease] = useState("");
  const [share, setShare] = useState("60");
  const [error, setError] = useState<string | null>(null);

  function go(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Name required."); return; }
    onSave({
      id: uid(),
      name: name.trim(),
      distributor: dist.trim() || undefined,
      release: release || undefined,
      share: Number(share) || 0,
    });
  }

  return (
    <form onSubmit={go} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Empuraan" /></Field>
      <Field label="Distributor"><Input value={dist} onChange={(e) => setDist(e.target.value)} placeholder="Ashirvad Cinemas" /></Field>
      <Field label="Release date"><Input type="date" value={release} onChange={(e) => setRelease(e.target.value)} /></Field>
      <Field label="Share %">
        <Input type="number" min={0} max={100} step={0.01} value={share} onChange={(e) => setShare(e.target.value)} className="text-right" />
      </Field>
      <div className="flex items-center gap-2">
        <Button type="submit" className="flex-1">Add</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
      {error ? <p className="col-span-full text-sm text-red-700">{error}</p> : null}
    </form>
  );
}

// ── Price Cards (per screen) ──────────────────────────────────────────

export function PriceCardsSection() {
  const { state, setAppState } = useSync();
  const appState = state.appState;
  if (!appState || !canEditCatalog(state.role)) return null;

  const screens = appState.screens;
  const [screenId, setScreenId] = useState<UUID>(screens[0]?.id ?? "");
  const screen = screens.find((s) => s.id === screenId);

  function mutate(next: PriceCard[]) {
    if (!appState || !screen) return;
    const updatedScreen: Screen = { ...screen, priceCards: next };
    setAppState({
      ...appState,
      screens: appState.screens.map((s) => s.id === screen.id ? updatedScreen : s),
    });
  }

  function addCard() {
    if (!screen) return;
    const prices: Record<UUID, number> = {};
    screen.classes.forEach((a) => { prices[a.classId] = 0; });
    mutate([...(screen.priceCards ?? []), { id: uid(), name: `Card ${(screen.priceCards?.length ?? 0) + 1}`, prices }]);
  }

  function updateCard(card: PriceCard) {
    if (!screen) return;
    mutate((screen.priceCards ?? []).map((c) => c.id === card.id ? card : c));
  }

  function deleteCard(id: UUID) {
    if (!screen) return;
    if (!confirm("Delete this price card? Existing entries that reference it keep their data.")) return;
    mutate((screen.priceCards ?? []).filter((c) => c.id !== id));
  }

  if (screens.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Price cards</CardTitle></CardHeader>
        <CardBody className="text-sm text-ink-muted">Add a screen first.</CardBody>
      </Card>
    );
  }

  const cls = screen ? resolveClasses(appState.classes, screen.classes) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Price cards</CardTitle>
        <div className="flex items-center gap-2">
          <Select
            value={screenId}
            onChange={(e) => setScreenId(e.target.value as UUID)}
            className="h-8 text-sm w-44"
          >
            {screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Button size="sm" onClick={addCard}>+ Add card</Button>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        {!screen || (screen.priceCards ?? []).length === 0 ? (
          <p className="px-5 py-5 text-sm text-ink-muted">No price cards yet for this screen.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-ink-muted border-b border-line">
                  <th className="text-left px-5 py-3 font-semibold w-40">Card</th>
                  {cls.map((c) => (
                    <th key={c.id} className="text-right px-5 py-3 font-semibold">{c.name}</th>
                  ))}
                  <th className="text-right px-5 py-3 font-semibold w-12"></th>
                </tr>
              </thead>
              <tbody>
                {(screen.priceCards ?? []).map((card) => (
                  <PriceCardRow
                    key={card.id}
                    card={card}
                    classes={cls}
                    onSave={updateCard}
                    onRemove={() => deleteCard(card.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function PriceCardRow({
  card,
  classes,
  onSave,
  onRemove,
}: {
  card: PriceCard;
  classes: Array<{ id: UUID; name: string }>;
  onSave: (c: PriceCard) => void;
  onRemove: () => void;
}) {
  return (
    <tr className="border-b border-line hover:bg-paper/60">
      <td className="px-5 py-2">
        <Input
          value={card.name}
          onChange={(e) => onSave({ ...card, name: e.target.value })}
          className="h-8"
        />
      </td>
      {classes.map((c) => (
        <td key={c.id} className="px-5 py-2">
          <Input
            type="number" min={0} step={0.01}
            value={card.prices[c.id] ?? 0}
            onChange={(e) =>
              onSave({ ...card, prices: { ...card.prices, [c.id]: Number(e.target.value) || 0 } })
            }
            className="h-8 text-right"
          />
        </td>
      ))}
      <td className="px-5 py-2 text-right">
        <Button size="sm" variant="ghost" onClick={onRemove} className="text-red-700">×</Button>
      </td>
    </tr>
  );
}

// ── Screens & class assignments ───────────────────────────────────────

export function ScreensSection() {
  const { state, setAppState } = useSync();
  const appState = state.appState;
  if (!appState || !canEditCatalog(state.role)) return null;

  function update(next: Screen) {
    if (!appState) return;
    setAppState({
      ...appState,
      screens: appState.screens.map((s) => s.id === next.id ? next : s),
    });
  }

  function addScreen() {
    if (!appState) return;
    const newScreen: Screen = {
      id: uid(),
      name: `Screen ${appState.screens.length + 1}`,
      classes: appState.classes.map((c) => ({ classId: c.id, seats: 100 })),
      priceCards: [],
    };
    setAppState({ ...appState, screens: [...appState.screens, newScreen] });
  }

  function removeScreen(id: UUID) {
    if (!appState) return;
    const s = appState.screens.find((x) => x.id === id);
    if (!confirm(`Delete "${s?.name ?? id}"? Existing entries that reference it keep their screenId; you'll see "—" in their rows.`)) return;
    setAppState({ ...appState, screens: appState.screens.filter((x) => x.id !== id) });
  }

  function addClass() {
    if (!appState) return;
    const name = prompt("New class name (e.g. Royale, Lounge, Prime):");
    if (!name) return;
    const cls: ClassDef = { id: uid(), name: name.trim(), gstPct: 18 };
    // Add to every screen as an assignment with 0 seats too — keeps assignments well-formed.
    const updatedScreens = appState.screens.map((s) => ({
      ...s,
      classes: [...s.classes, { classId: cls.id, seats: 0 }],
      priceCards: s.priceCards.map((c) => ({ ...c, prices: { ...c.prices, [cls.id]: 0 } })),
    }));
    setAppState({ ...appState, classes: [...appState.classes, cls], screens: updatedScreens });
  }

  function removeClass(id: UUID) {
    if (!appState) return;
    const c = appState.classes.find((x) => x.id === id);
    if (!confirm(`Delete class "${c?.name ?? id}"? It's removed from every screen + price card.`)) return;
    const updatedScreens = appState.screens.map((s) => ({
      ...s,
      classes: s.classes.filter((a) => a.classId !== id),
      priceCards: s.priceCards.map((card) => {
        const prices = { ...card.prices };
        delete prices[id];
        return { ...card, prices };
      }),
    }));
    setAppState({
      ...appState,
      classes: appState.classes.filter((x) => x.id !== id),
      screens: updatedScreens,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Screens &amp; classes</CardTitle>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={addClass}>+ Add class</Button>
          <Button size="sm" onClick={addScreen}>+ Add screen</Button>
        </div>
      </CardHeader>
      <CardBody className="space-y-5">
        {/* Class catalog */}
        <div>
          <div className="text-[11px] uppercase tracking-wider text-ink-muted mb-2">
            Master class catalog
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {appState.classes.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 text-sm">
                <span className="font-medium">{c.name}</span>
                <button
                  type="button"
                  onClick={() => removeClass(c.id)}
                  className="text-ink-muted hover:text-red-700 text-base leading-none"
                  title="Remove class"
                >×</button>
              </span>
            ))}
            {appState.classes.length === 0 ? (
              <span className="text-sm text-ink-muted">No classes defined yet.</span>
            ) : null}
          </div>
        </div>

        {/* Per-screen rows */}
        {appState.screens.length === 0 ? (
          <p className="text-sm text-ink-muted">No screens yet.</p>
        ) : (
          <div className="space-y-3">
            {appState.screens.map((s) => (
              <ScreenEditor
                key={s.id}
                screen={s}
                classes={appState.classes}
                onSave={update}
                onRemove={() => removeScreen(s.id)}
              />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ScreenEditor({
  screen,
  classes,
  onSave,
  onRemove,
}: {
  screen: Screen;
  classes: ClassDef[];
  onSave: (s: Screen) => void;
  onRemove: () => void;
}) {
  function setName(name: string) { onSave({ ...screen, name }); }
  function setSeats(classId: UUID, seats: number) {
    const has = screen.classes.find((a) => a.classId === classId);
    const updated: ScreenClassAssignment[] = has
      ? screen.classes.map((a) => a.classId === classId ? { ...a, seats } : a)
      : [...screen.classes, { classId, seats }];
    onSave({ ...screen, classes: updated });
  }
  function toggleClass(classId: UUID, on: boolean) {
    if (on) setSeats(classId, 0);
    else onSave({ ...screen, classes: screen.classes.filter((a) => a.classId !== classId) });
  }

  return (
    <div className="rounded-xl border border-line bg-paper p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Input value={screen.name} onChange={(e) => setName(e.target.value)} className="w-56 h-9 font-medium" />
        <span className="text-xs text-ink-muted">{screen.classes.length} class{screen.classes.length === 1 ? "" : "es"}</span>
        <span className="ml-auto">
          <Button size="sm" variant="ghost" onClick={onRemove} className="text-red-700">Delete screen</Button>
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {classes.map((c) => {
          const a = screen.classes.find((x) => x.classId === c.id);
          const on = !!a;
          return (
            <div key={c.id} className="flex items-center gap-2 rounded-lg bg-white border border-line px-3 py-2">
              <label className="flex items-center gap-2 text-sm flex-1">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => toggleClass(c.id, e.target.checked)}
                />
                <span className="font-medium">{c.name}</span>
              </label>
              <Input
                type="number" min={0}
                value={on ? a!.seats : ""}
                disabled={!on}
                onChange={(e) => setSeats(c.id, Number(e.target.value) || 0)}
                className="h-8 w-24 text-right"
                placeholder="seats"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Tax slabs ─────────────────────────────────────────────────────────

export function TaxSection() {
  const { state, setAppState } = useSync();
  const appState = state.appState;
  if (!appState || !canEditCatalog(state.role)) return null;

  const tax = appState.tax;

  function update(patch: Partial<TaxConfig>) {
    if (!appState) return;
    setAppState({ ...appState, tax: { ...tax, ...patch } });
  }
  function updateAbove(patch: Partial<TaxConfig["above"]>) {
    update({ above: { ...tax.above, ...patch } });
  }
  function updateBelow(patch: Partial<TaxConfig["below"]>) {
    update({ below: { ...tax.below, ...patch } });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tax slabs &amp; Rep Batta</CardTitle>
      </CardHeader>
      <CardBody className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Slab threshold (₹)" hint="Tickets > this use the ABOVE slab">
            <Input
              type="number" min={0} step={0.01}
              value={tax.threshold}
              onChange={(e) => update({ threshold: Number(e.target.value) || 0 })}
              className="text-right"
            />
          </Field>
          <Field label="TMC (₹ / ticket)">
            <Input
              type="number" min={0} step={0.01}
              value={tax.tmc}
              onChange={(e) => update({ tmc: Number(e.target.value) || 0 })}
              className="text-right"
            />
          </Field>
          <Field label="Cess (₹ / ticket)">
            <Input
              type="number" min={0} step={0.01}
              value={tax.cess}
              onChange={(e) => update({ cess: Number(e.target.value) || 0 })}
              className="text-right"
            />
          </Field>
        </div>

        <div className="rounded-xl border border-line bg-paper p-4 space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted">
            Above-threshold slab (gross &gt; ₹{tax.threshold})
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="E-Tax %">
              <Input type="number" min={0} max={100} step={0.01}
                value={tax.above.etaxPct}
                onChange={(e) => updateAbove({ etaxPct: Number(e.target.value) || 0 })}
                className="text-right" />
            </Field>
            <Field label="GST %">
              <Input type="number" min={0} max={100} step={0.01}
                value={tax.above.gstPct}
                onChange={(e) => updateAbove({ gstPct: Number(e.target.value) || 0 })}
                className="text-right" />
            </Field>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-paper p-4 space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted">
            Below-or-equal-threshold slab (gross ≤ ₹{tax.threshold})
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="E-Tax %">
              <Input type="number" min={0} max={100} step={0.01}
                value={tax.below.etaxPct}
                onChange={(e) => updateBelow({ etaxPct: Number(e.target.value) || 0 })}
                className="text-right" />
            </Field>
            <Field label="GST %">
              <Input type="number" min={0} max={100} step={0.01}
                value={tax.below.gstPct}
                onChange={(e) => updateBelow({ gstPct: Number(e.target.value) || 0 })}
                className="text-right" />
            </Field>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-5">
          <Field label="Rep Day (₹ / show)">
            <Input type="number" min={0} step={0.01}
              value={tax.repDay}
              onChange={(e) => update({ repDay: Number(e.target.value) || 0 })}
              className="text-right" />
          </Field>
          <Field label="Rep Night (₹ / show)">
            <Input type="number" min={0} step={0.01}
              value={tax.repNight}
              onChange={(e) => update({ repNight: Number(e.target.value) || 0 })}
              className="text-right" />
          </Field>
          <Field label="Rep 1 show (₹)">
            <Input type="number" min={0} step={0.01}
              value={tax.rep1}
              onChange={(e) => update({ rep1: Number(e.target.value) || 0 })}
              className="text-right" />
          </Field>
          <Field label="Rep 2–4 (₹)">
            <Input type="number" min={0} step={0.01}
              value={tax.rep2}
              onChange={(e) => update({ rep2: Number(e.target.value) || 0 })}
              className="text-right" />
          </Field>
          <Field label="Rep 5+ (₹)">
            <Input type="number" min={0} step={0.01}
              value={tax.rep5}
              onChange={(e) => update({ rep5: Number(e.target.value) || 0 })}
              className="text-right" />
          </Field>
        </div>
      </CardBody>
    </Card>
  );
}

// ── helpers ───────────────────────────────────────────────────────────

function resolveClasses(
  catalog: ClassDef[],
  assignments: ScreenClassAssignment[],
): Array<{ id: UUID; name: string }> {
  const order = catalog.map((c) => c.id);
  return assignments
    .map((a) => {
      const c = catalog.find((x) => x.id === a.classId);
      return c ? { id: a.classId, name: c.name } : null;
    })
    .filter((x): x is { id: UUID; name: string } => x !== null)
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}
