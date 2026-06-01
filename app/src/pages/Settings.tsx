// ============================================================================
// Settings — owner-only. C6.1 will add Movies / Price Cards / Screens & Tax
// sub-pages; for now this is just the Users manager (new in Phase C6, paired
// with the username + PIN auth flow).
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

import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { Field, Input, Select } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { IconSpinner } from "../components/icons";

const ROLES: Role[] = ["owner", "manager", "accountant"];

export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight">Settings</h2>
        <p className="text-sm text-ink-muted mt-1">
          Owner only. Movies catalog, price cards, screens &amp; tax move here in
          the next phase.
        </p>
      </div>

      <UsersSection />
    </div>
  );
}

// ── users section ─────────────────────────────────────────────────────

function UsersSection() {
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

  if (state.role !== "owner") {
    return (
      <Card>
        <CardBody className="text-sm text-ink-muted">
          User management is owner-only.
        </CardBody>
      </Card>
    );
  }

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
            <UsersTable users={users} onChanged={load} />
          )}
        </CardBody>
      </Card>

      <p className="text-xs text-ink-muted">
        Username login uses the email{" "}
        <code>&lt;username&gt;@local.abhinayacinemas.com</code> internally — no real
        email is ever sent there. PINs are 6 digits. Owner role required for any
        change on this page; the server enforces it too.
      </p>
    </div>
  );
}

// ── table ─────────────────────────────────────────────────────────────

function UsersTable({
  users,
  onChanged,
}: {
  users: ListedUser[];
  onChanged: () => void;
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
            <UserRow key={u.email} user={u} onChanged={onChanged} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserRow({
  user,
  onChanged,
}: {
  user: ListedUser;
  onChanged: () => void;
}) {
  const isUsernameUser = isInternalEmail(user.email);
  const [busy, setBusy] = useState<string | null>(null);

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
        <Select
          value={user.role}
          onChange={(e) => void changeRole(e.target.value as Role)}
          disabled={!isUsernameUser || !!busy}
          className="w-36 h-8 text-sm"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </Select>
      </td>
      <td className="px-5 py-3 text-right">
        <div className="inline-flex items-center gap-2">
          {isUsernameUser ? (
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
          ) : (
            <span className="text-xs text-ink-muted">manage in Supabase</span>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── add user form ─────────────────────────────────────────────────────

function AddUserForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<Role>("manager");
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
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
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
