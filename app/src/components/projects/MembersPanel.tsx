// ============================================================================
// MembersPanel — project assignment UI.
//
//   • Owner assigns the project manager (a manager-role user).
//   • Project manager / owner assign further members (managers, daily mgrs).
//   • Assigned members are the only people who can tick tasks (RLS-enforced).
// ============================================================================

import { useEffect, useState } from "react";

import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Select } from "../ui/Input";
import { listUsers, type ListedUser } from "../../lib/users";
import {
  assignMember, removeMember, setProjectManager, type ProjectMember,
} from "../../lib/projects";

export function MembersPanel({
  projectId, members, projectManagerEmail, currentUserEmail,
  canAssignPM, canManageMembers, onChanged,
}: {
  projectId: string;
  members: ProjectMember[];
  projectManagerEmail: string | null;
  currentUserEmail: string;
  canAssignPM: boolean;      // owner only
  canManageMembers: boolean; // PM or owner
  onChanged: () => void;
}) {
  const [users, setUsers] = useState<ListedUser[]>([]);
  const [pmPick, setPmPick] = useState("");
  const [memberPick, setMemberPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!canAssignPM && !canManageMembers) return;
    listUsers().then(setUsers).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [canAssignPM, canManageMembers]);

  const label = (email: string) => {
    const u = users.find((x) => x.email.toLowerCase() === email.toLowerCase());
    return u?.fullName || u?.username || email;
  };

  const managers = users.filter((u) => u.role === "manager");
  const assignable = users.filter((u) => u.role === "manager" || u.role === "daily_manager");
  const memberEmails = new Set(members.map((m) => m.userEmail.toLowerCase()));

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr(null);
    try { await fn(); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      {err ? <p className="text-sm text-red-600">{err}</p> : null}

      <ul className="space-y-1.5">
        {members.length === 0 ? (
          <li className="text-sm text-ink-muted">No one assigned yet.</li>
        ) : members.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2">
              {label(m.userEmail)}
              {m.roleInProject === "project_manager" ? (
                <Badge tone="amber">Project manager</Badge>
              ) : null}
              {m.userEmail.toLowerCase() === currentUserEmail.toLowerCase() ? (
                <span className="text-xs text-ink-muted">(you)</span>
              ) : null}
            </span>
            {canManageMembers && m.roleInProject !== "project_manager" ? (
              <button
                className="text-xs text-red-600 hover:underline disabled:opacity-50"
                disabled={busy}
                onClick={() => void run(() => removeMember(projectId, m.userEmail))}
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {canAssignPM ? (
        <div className="flex items-end gap-2 border-t border-line pt-3">
          <label className="flex-1 text-xs">
            <span className="mb-1 block uppercase tracking-wide text-ink-muted">Project manager</span>
            <Select value={pmPick} onChange={(e) => setPmPick(e.target.value)} disabled={busy}>
              <option value="">
                {projectManagerEmail ? `Current: ${label(projectManagerEmail)}` : "Select a manager…"}
              </option>
              {managers.map((u) => (
                <option key={u.email} value={u.email}>{u.fullName || u.username || u.email}</option>
              ))}
            </Select>
          </label>
          <Button
            size="sm"
            disabled={busy || !pmPick}
            onClick={() => void run(async () => {
              await setProjectManager(projectId, pmPick, currentUserEmail);
              setPmPick("");
            })}
          >
            {projectManagerEmail ? "Change" : "Assign"}
          </Button>
        </div>
      ) : null}

      {canManageMembers ? (
        <div className="flex items-end gap-2 border-t border-line pt-3">
          <label className="flex-1 text-xs">
            <span className="mb-1 block uppercase tracking-wide text-ink-muted">Add member</span>
            <Select value={memberPick} onChange={(e) => setMemberPick(e.target.value)} disabled={busy}>
              <option value="">Select a manager / daily manager…</option>
              {assignable
                .filter((u) => !memberEmails.has(u.email.toLowerCase()))
                .map((u) => (
                  <option key={u.email} value={u.email}>
                    {(u.fullName || u.username || u.email)} · {u.role === "manager" ? "Manager" : "Daily manager"}
                  </option>
                ))}
            </Select>
          </label>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !memberPick}
            onClick={() => void run(async () => {
              await assignMember(projectId, memberPick, "member", currentUserEmail);
              setMemberPick("");
            })}
          >
            Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}
