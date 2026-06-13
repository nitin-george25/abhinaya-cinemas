// ============================================================================
// /projects/renovations — card grid of renovation projects.
//
// Each card shows location / area / type, status and a live progress bar.
// Owner + manager can create a new project; clicking a card opens its detail
// (Gantt + checklist). Per-project edit rights are enforced by RLS.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Card, CardBody } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { Field, Input, Select } from "../../components/ui/Input";
import { useSync } from "../../lib/hooks/SyncContext";
import {
  createProject,
  listProjects,
  listSubtasks,
  listTasks,
  projectProgressPct,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUSES,
  type Project,
  type ProjectStatus,
} from "../../lib/projects";

const STATUS_TONE: Record<ProjectStatus, "neutral" | "amber" | "green" | "red" | "blue"> = {
  planning: "blue",
  active: "amber",
  on_hold: "red",
  completed: "green",
  archived: "neutral",
};

export default function RenovationsPage() {
  const { state } = useSync();
  const navigate = useNavigate();
  const canCreate = state.role === "owner" || state.role === "manager";

  const [projects, setProjects] = useState<Project[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const ps = await listProjects("renovation");
      setProjects(ps);
      // Per-project progress (small N — a handful of projects).
      const pairs = await Promise.all(
        ps.map(async (p) => {
          const [tasks, subs] = await Promise.all([listTasks(p.id), listSubtasks(p.id)]);
          return [p.id, projectProgressPct(tasks, subs)] as const;
        }),
      );
      setProgress(Object.fromEntries(pairs));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold">Renovations</h1>
          <p className="text-sm text-ink-muted">Capital projects & technical upgrades.</p>
        </div>
        {canCreate ? (
          <Button onClick={() => setShowNew(true)}>New project</Button>
        ) : null}
      </div>

      {err ? (
        <Card><CardBody><p className="text-sm text-red-600">{err}</p></CardBody></Card>
      ) : null}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : projects.length === 0 ? (
        <Card><CardBody><p className="text-sm text-ink-muted">No projects yet.</p></CardBody></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const pct = progress[p.id] ?? 0;
            const meta = [p.location, p.area, p.projectType ? `Type: ${p.projectType}` : null]
              .filter(Boolean).join(" · ");
            return (
              <button
                key={p.id}
                onClick={() => navigate(`/projects/renovations/${p.id}`)}
                className="text-left"
              >
                <Card className="h-full transition-shadow hover:shadow-md">
                  <CardBody className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-display font-semibold leading-snug">{p.name}</h2>
                      <Badge tone={STATUS_TONE[p.status]}>{PROJECT_STATUS_LABEL[p.status]}</Badge>
                    </div>
                    {meta ? <p className="text-xs text-ink-muted">{meta}</p> : null}
                    {p.summary ? (
                      <p className="text-sm text-ink-soft line-clamp-2">{p.summary}</p>
                    ) : null}
                    <div>
                      <div className="flex justify-between text-xs text-ink-muted mb-1">
                        <span>Progress</span><span>{pct}%</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-paper overflow-hidden">
                        <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    {p.startDate || p.targetFinish ? (
                      <p className="text-xs text-ink-muted">
                        {p.startDate ?? "—"} → {p.targetFinish ?? "—"}
                      </p>
                    ) : null}
                  </CardBody>
                </Card>
              </button>
            );
          })}
        </div>
      )}

      {showNew ? (
        <NewProjectDialog
          cinemaId={state.cinemaId}
          createdBy={state.email ?? ""}
          onClose={() => setShowNew(false)}
          onCreated={(id) => { setShowNew(false); navigate(`/projects/renovations/${id}`); }}
        />
      ) : null}
    </div>
  );
}

function NewProjectDialog({
  cinemaId, createdBy, onClose, onCreated,
}: {
  cinemaId: string | null;
  createdBy: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("HQ");
  const [area, setArea] = useState("");
  const [projectType, setProjectType] = useState("Technical Upgrade");
  const [summary, setSummary] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("active");
  const [startDate, setStartDate] = useState("");
  const [targetFinish, setTargetFinish] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) { setErr("Project name is required."); return; }
    if (!cinemaId) { setErr("No cinema context — try reloading."); return; }
    setBusy(true); setErr(null);
    try {
      const p = await createProject({
        cinemaId,
        name: name.trim(),
        location: location.trim() || null,
        area: area.trim() || null,
        projectType: projectType.trim() || null,
        summary: summary.trim() || null,
        status,
        startDate: startDate || null,
        targetFinish: targetFinish || null,
        createdBy,
      });
      onCreated(p.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-xl"
      title="New project"
      actions={
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={() => void submit()} disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {err ? <p className="text-sm text-red-600">{err}</p> : null}
        <Field label="Project name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Audi 2 — Seating Refresh" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Location"><Input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
          <Field label="Area"><Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Audi 1" /></Field>
          <Field label="Type"><Input value={projectType} onChange={(e) => setProjectType(e.target.value)} /></Field>
        </div>
        <Field label="Summary">
          <Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="One-line scope" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Start"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
          <Field label="Target finish"><Input type="date" value={targetFinish} onChange={(e) => setTargetFinish(e.target.value)} /></Field>
        </div>
      </div>
    </Modal>
  );
}
