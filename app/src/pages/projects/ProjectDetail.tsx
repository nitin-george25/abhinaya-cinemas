// ============================================================================
// /projects/renovations/:id — project detail: Gantt + phased checklist with
// per-task file attachments and subtasks, plus members + audit trail.
//
// Edit rights (mirrors the DB RLS):
//   • tick tasks/subtasks, upload files → owner + assigned members
//   • add subtasks, manage members, edit structure → owner + project manager
//   • assign the project manager → owner only
// A task can only be marked done once it has at least one attachment.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Input } from "../../components/ui/Input";
import { useSync } from "../../lib/hooks/SyncContext";
import { ProjectGantt } from "../../components/projects/ProjectGantt";
import { MembersPanel } from "../../components/projects/MembersPanel";
import { FinancesPanel } from "../../components/projects/FinancesPanel";
import {
  addSubtask, deleteSubtask, deleteTaskFile, listAudit, loadProjectBundle,
  projectProgressPct, setSubtaskDone, setTaskDone, taskCompletion, uploadTaskFile,
  PROJECT_STATUS_LABEL,
  type ProjectAuditEntry, type ProjectBundle, type ProjectPhase, type ProjectSubtask,
  type ProjectTask, type ProjectTaskFile,
} from "../../lib/projects";

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit",
  });

const AUDIT_VERB: Record<string, string> = {
  task_checked: "completed task",
  task_unchecked: "reopened task",
  subtask_checked: "completed subtask",
  subtask_unchecked: "reopened subtask",
};

type TabKey = "timeline" | "checklist" | "finances" | "team";
const TABS: { key: TabKey; label: string }[] = [
  { key: "timeline", label: "Timeline" },
  { key: "checklist", label: "Checklist" },
  { key: "finances", label: "Finances" },
  { key: "team", label: "Team" },
];

export default function ProjectDetailPage() {
  const { id = "" } = useParams();
  const { state } = useSync();
  const navigate = useNavigate();
  const email = (state.email ?? "").toLowerCase();

  const [bundle, setBundle] = useState<ProjectBundle | null>(null);
  const [audit, setAudit] = useState<ProjectAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("timeline");

  const reload = useCallback(async () => {
    try {
      const [b, a] = await Promise.all([loadProjectBundle(id), listAudit(id)]);
      setBundle(b); setAudit(a);
      if (!b) setErr("Project not found.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void reload(); }, [reload]);

  const perms = useMemo(() => {
    const isOwner = state.role === "owner";
    const mine = bundle?.members.find((m) => m.userEmail.toLowerCase() === email);
    const isMember = isOwner || !!mine;
    const isPM = isOwner || mine?.roleInProject === "project_manager";
    return { isOwner, isMember, isPM };
  }, [bundle, email, state.role]);

  if (loading) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (err || !bundle) {
    return (
      <div className="space-y-3">
        <BackLink onClick={() => navigate("/projects/renovations")} />
        <Card><CardBody><p className="text-sm text-red-600">{err ?? "Not found."}</p></CardBody></Card>
      </div>
    );
  }

  const { project, members, phases, tasks, subtasks, files, budgetItems, invoices } = bundle;
  const pct = projectProgressPct(tasks, subtasks);
  const meta = [project.location, project.area, project.projectType ? `Type: ${project.projectType}` : null]
    .filter(Boolean).join(" · ");

  return (
    <div className="space-y-5">
      <BackLink onClick={() => navigate("/projects/renovations")} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-xl font-bold">{project.name}</h1>
            <Badge tone="neutral">{PROJECT_STATUS_LABEL[project.status]}</Badge>
          </div>
          {meta ? <p className="text-sm text-ink-muted">{meta}</p> : null}
          {project.summary ? <p className="mt-1 text-sm text-ink-soft max-w-3xl">{project.summary}</p> : null}
        </div>
        <div className="min-w-48">
          <div className="flex justify-between text-xs text-ink-muted mb-1">
            <span>Overall progress</span><span>{pct}%</span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-paper overflow-hidden">
            <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
          </div>
          {project.startDate || project.targetFinish ? (
            <p className="mt-1 text-xs text-ink-muted">{project.startDate ?? "—"} → {project.targetFinish ?? "—"}</p>
          ) : null}
        </div>
      </div>

      {/* View tabs */}
      <div className="flex flex-col gap-5 md:flex-row">
        <nav className="flex gap-1 overflow-x-auto md:w-44 md:shrink-0 md:flex-col md:gap-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                tab === t.key
                  ? "bg-amber-400/15 font-medium text-amber-700"
                  : "text-ink-muted hover:bg-paper hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {tab === "timeline" ? (
            <Card>
              <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
              <CardBody>
                <ProjectGantt
                  phases={phases}
                  tasks={tasks}
                  startDate={project.startDate}
                  targetFinish={project.targetFinish}
                />
              </CardBody>
            </Card>
          ) : null}

          {tab === "checklist" ? (
            <div className="space-y-4">
              {phases.map((ph) => (
                <PhaseChecklist
                  key={ph.id}
                  phase={ph}
                  tasks={tasks.filter((t) => t.phaseId === ph.id).sort((a, b) => a.seq - b.seq)}
                  subtasks={subtasks}
                  files={files}
                  projectId={project.id}
                  email={email}
                  canEdit={perms.isMember}
                  canManage={perms.isPM}
                  onChanged={reload}
                  onError={setErr}
                />
              ))}
            </div>
          ) : null}

          {tab === "finances" ? (
            <FinancesPanel
              projectId={project.id}
              budgetItems={budgetItems}
              invoices={invoices}
              email={email}
              canManage={perms.isPM}
              canUploadInvoice={perms.isMember}
              onChanged={reload}
              onError={setErr}
            />
          ) : null}

          {tab === "team" ? (
            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle>Team</CardTitle></CardHeader>
                <CardBody>
                  <MembersPanel
                    projectId={project.id}
                    members={members}
                    projectManagerEmail={project.projectManagerEmail}
                    currentUserEmail={email}
                    canAssignPM={perms.isOwner}
                    canManageMembers={perms.isPM}
                    onChanged={reload}
                  />
                </CardBody>
              </Card>

              <Card>
                <CardHeader><CardTitle>Activity trail</CardTitle></CardHeader>
                <CardBody>
                  {audit.length === 0 ? (
                    <p className="text-sm text-ink-muted">No activity yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {audit.map((a) => {
                        const code = a.detail?.code != null ? String(a.detail?.code) : "";
                        const name = a.detail?.name != null ? String(a.detail?.name) : "";
                        return (
                          <li key={a.id} className="text-xs">
                            <span className="font-medium">{a.actorEmail ?? "system"}</span>{" "}
                            {AUDIT_VERB[a.action] ?? a.action}
                            {code || name ? <> · {code ? `${code} ` : ""}{name}</> : null}
                            <span className="block text-ink-muted">{fmtDateTime(a.createdAt)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardBody>
              </Card>
            </div>
          ) : null}
        </div>
      </div>

    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-sm text-ink-muted hover:text-ink">
      ← Renovations
    </button>
  );
}

// ── one phase block ─────────────────────────────────────────────────────────
function PhaseChecklist({
  phase, tasks, subtasks, files, projectId, email, canEdit, canManage, onChanged, onError,
}: {
  phase: ProjectPhase;
  tasks: ProjectTask[];
  subtasks: ProjectSubtask[];
  files: ProjectTaskFile[];
  projectId: string;
  email: string;
  canEdit: boolean;
  canManage: boolean;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <Card>
      <CardHeader className="gap-2" style={{ borderLeft: `4px solid ${phase.color ?? "#999"}` }}>
        <CardTitle>{phase.name}</CardTitle>
      </CardHeader>
      <div className="divide-y divide-line">
        {tasks.map((t) => (
          <TaskItem
            key={t.id}
            task={t}
            subtasks={subtasks.filter((s) => s.taskId === t.id).sort((a, b) => a.seq - b.seq)}
            files={files.filter((f) => f.taskId === t.id)}
            projectId={projectId}
            email={email}
            canEdit={canEdit}
            canManage={canManage}
            onChanged={onChanged}
            onError={onError}
          />
        ))}
      </div>
    </Card>
  );
}

// ── one task row ────────────────────────────────────────────────────────────
function TaskItem({
  task, subtasks, files, projectId, email, canEdit, canManage, onChanged, onError,
}: {
  task: ProjectTask;
  subtasks: ProjectSubtask[];
  files: ProjectTaskFile[];
  projectId: string;
  email: string;
  canEdit: boolean;
  canManage: boolean;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [newSub, setNewSub] = useState("");
  const [showSubInput, setShowSubInput] = useState(false);

  const hasSubs = subtasks.length > 0;
  const pct = Math.round(taskCompletion(task, subtasks) * 100);
  // "Attachment required" gate: a leaf task needs ≥1 file before it can be ticked.
  const needsFile = !hasSubs && files.length === 0;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); onChanged(); }
    catch (e) { onError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const checked = hasSubs ? pct === 100 : task.done;

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 cursor-pointer accent-amber-500 disabled:cursor-not-allowed"
          checked={checked}
          disabled={!canEdit || busy || hasSubs || (needsFile && !task.done)}
          title={
            hasSubs ? "Completion comes from subtasks"
            : needsFile ? "Attach a file before completing this task"
            : undefined
          }
          onChange={() => void run(() => setTaskDone(task.id, !task.done))}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className={`text-sm ${checked ? "text-ink-muted line-through" : "text-ink"}`}>
              {task.code ? <strong className="mr-1">{task.code}</strong> : null}
              {task.name}
              {task.isMilestone ? <span className="ml-1" title="Milestone">◆</span> : null}
            </p>
            <span className="shrink-0 text-xs text-ink-muted">
              {task.startDate}{task.endDate && task.endDate !== task.startDate ? ` – ${task.endDate}` : ""}
            </span>
          </div>
          {task.note ? <p className="mt-0.5 text-xs text-ink-muted">{task.note}</p> : null}

          {/* Subtasks + rollup */}
          {hasSubs ? (
            <div className="mt-2">
              <div className="mb-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-paper overflow-hidden">
                  <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[11px] text-ink-muted">{pct}%</span>
              </div>
              <ul className="space-y-1">
                {subtasks.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 cursor-pointer accent-amber-500 disabled:cursor-not-allowed"
                      checked={s.done}
                      disabled={!canEdit || busy}
                      onChange={() => void run(() => setSubtaskDone(s.id, !s.done))}
                    />
                    <span className={s.done ? "text-ink-muted line-through" : ""}>{s.name}</span>
                    {canManage ? (
                      <button
                        className="text-ink-muted hover:text-red-600 disabled:opacity-50"
                        disabled={busy}
                        onClick={() => void run(() => deleteSubtask(s.id))}
                        title="Delete subtask"
                      >
                        ✕
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Attachments */}
          <div className="mt-2">
            {files.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {files.map((f) => (
                  <li key={f.id} className="flex items-center gap-1 rounded border border-line bg-paper px-2 py-0.5 text-[11px]">
                    <a href={f.fileUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                      {f.fileName ?? "file"}
                    </a>
                    {canManage ? (
                      <button
                        className="text-ink-muted hover:text-red-600 disabled:opacity-50"
                        disabled={busy}
                        onClick={() => void run(() => deleteTaskFile(f.id))}
                        title="Remove attachment"
                      >
                        ✕
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-amber-700">No attachment yet — required to complete.</p>
            )}
          </div>

          {/* Actions */}
          {canEdit || canManage ? (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {canEdit ? (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void run(async () => { await uploadTaskFile(projectId, task.id, file, email); });
                      e.target.value = "";
                    }}
                  />
                  <button
                    className="text-xs text-blue-700 hover:underline disabled:opacity-50"
                    disabled={busy}
                    onClick={() => fileRef.current?.click()}
                  >
                    {busy ? "Working…" : "+ Attach file"}
                  </button>
                </>
              ) : null}
              {canManage ? (
                showSubInput ? (
                  <span className="flex items-center gap-1">
                    <Input
                      className="h-7 text-xs"
                      value={newSub}
                      placeholder="Subtask…"
                      onChange={(e) => setNewSub(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newSub.trim()) {
                          void run(async () => {
                            await addSubtask(projectId, task.id, newSub.trim(), email, subtasks.length);
                            setNewSub(""); setShowSubInput(false);
                          });
                        }
                      }}
                    />
                    <Button
                      size="sm" variant="secondary"
                      disabled={busy || !newSub.trim()}
                      onClick={() => void run(async () => {
                        await addSubtask(projectId, task.id, newSub.trim(), email, subtasks.length);
                        setNewSub(""); setShowSubInput(false);
                      })}
                    >
                      Add
                    </Button>
                  </span>
                ) : (
                  <button
                    className="text-xs text-ink-muted hover:text-ink disabled:opacity-50"
                    disabled={busy}
                    onClick={() => setShowSubInput(true)}
                  >
                    + Subtask
                  </button>
                )
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
