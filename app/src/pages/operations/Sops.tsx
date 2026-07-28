import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { Field, Input, Select } from "../../components/ui/Input";
import { useSync } from "../../lib/hooks/SyncContext";
import {
  SOP_AREA_DEFS,
  DEFAULT_SOP_AREA_ID,
  groupSops,
  listSops,
  addSop,
  deleteSop,
  parseSopFileName,
  replaceSopDocument,
  type Sop,
} from "../../lib/sops";

/**
 * Standard Operating Procedures — the SOP library, under Operations. The
 * fourteen areas from the SOP Library Master Plan are the tab strip; each tab
 * lists its SOPs by code and renders the selected document inline.
 *
 * Available to everyone who runs a shift (the route gate is ENTRY_ROLES);
 * owners/managers can add and remove SOPs, which RLS enforces server-side.
 *
 * Area and SOP live in the URL so each has its own shareable link:
 *   /operations/sops/:areaId          → an area
 *   /operations/sops/:areaId/:sopId   → a single SOP
 * The route is canonicalised on load, so a link copied from here always
 * reopens exactly what the sender was looking at.
 */
export default function SopsPage() {
  const navigate = useNavigate();
  const { state } = useSync();
  const canEdit = state.role === "owner" || state.role === "manager";

  const { areaId, sopId } = useParams<{ areaId?: string; sopId?: string }>();

  const [sops, setSops] = useState<Sop[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const reload = useCallback(async () => {
    if (!state.cinemaId) return;
    const rows = await listSops(state.cinemaId);
    setSops(rows);
    setLoaded(true);
  }, [state.cinemaId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const areas = useMemo(() => groupSops(sops), [sops]);

  // Default to the first area that actually has documents, else the first.
  const defaultArea = useMemo(
    () => areas.find((a) => a.sops.length > 0) ?? areas[0],
    [areas],
  );

  const area = areas.find((a) => a.id === areaId) ?? defaultArea;
  const activeSop =
    area?.sops.find((s) => s.id === sopId) ?? area?.sops[0] ?? null;

  const canonicalPath = area
    ? activeSop
      ? `/operations/sops/${area.id}/${activeSop.id}`
      : `/operations/sops/${area.id}`
    : "/operations/sops";

  useEffect(() => {
    // Wait for the load, otherwise a bare /operations/sops briefly redirects to
    // the first (empty) area before the real content arrives.
    if (!loaded) return;
    const current = sopId
      ? `/operations/sops/${areaId}/${sopId}`
      : areaId
        ? `/operations/sops/${areaId}`
        : "/operations/sops";
    if (current !== canonicalPath) {
      navigate(canonicalPath, { replace: true });
    }
  }, [loaded, canonicalPath, areaId, sopId, navigate]);

  const total = sops.length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-3xl font-bold tracking-tight">
            Standard Operating Procedures
          </h2>
          <p className="text-ink-muted mt-1 leading-relaxed">
            The one Abhinaya standard — every documented procedure, filed by
            area. {total > 0 ? `${total} published.` : null}
          </p>
        </div>
        {canEdit ? (
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => setAddOpen(true)}
          >
            + Upload SOPs
          </Button>
        ) : null}
      </div>

      {/* Area tabs — the fourteen areas of the master plan. */}
      <div className="border-b border-line">
        <nav className="-mb-px flex gap-1 overflow-x-auto">
          {areas.map((a) => {
            const active = a.id === area?.id;
            return (
              <button
                key={a.id}
                onClick={() => navigate(`/operations/sops/${a.id}`)}
                title={a.fullName}
                className={
                  "shrink-0 border-b-2 px-3.5 py-2 text-sm font-medium transition-colors " +
                  (active
                    ? "border-amber-500 text-ink"
                    : "border-transparent text-ink-muted hover:text-ink")
                }
              >
                {a.label}
                {a.sops.length > 0 ? (
                  <span className="ml-1.5 text-xs text-ink-muted">
                    {a.sops.length}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Body */}
      {!area || area.sops.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-paper-card px-6 py-16 text-center">
          <p className="text-sm text-ink-muted">
            {!loaded
              ? "Loading SOPs…"
              : area
                ? `No SOPs written for ${area.fullName} yet.`
                : "No SOPs yet."}
          </p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-[260px_1fr]">
          {/* SOP list for the active area */}
          <aside className="space-y-1">
            <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
              {area.fullName}
            </p>
            {area.sops.map((s) => {
              const active = s.id === activeSop?.id;
              return (
                <button
                  key={s.id}
                  onClick={() => navigate(`/operations/sops/${area.id}/${s.id}`)}
                  className={
                    "w-full rounded-md px-3 py-2 text-left text-sm transition-colors " +
                    (active
                      ? "bg-line/50 font-medium text-ink"
                      : "text-ink-muted hover:bg-line/30 hover:text-ink")
                  }
                >
                  <span className="mr-2 font-mono text-xs text-ink-muted">
                    {s.code}
                  </span>
                  {s.title}
                </button>
              );
            })}
          </aside>

          {/* Selected SOP + inline document */}
          {activeSop ? (
            <section className="min-w-0 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-ink">
                    <span className="mr-2 font-mono text-sm text-ink-muted">
                      {activeSop.code}
                    </span>
                    {activeSop.title}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                    {activeSop.description
                      ? `${activeSop.description} · `
                      : null}
                    {activeSop.version}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <a
                    href={activeSop.docUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-line/30 hover:text-ink"
                  >
                    Open PDF
                  </a>
                  <CopyLinkButton
                    path={`/operations/sops/${area.id}/${activeSop.id}`}
                  />
                  {canEdit ? (
                    <DeleteSopButton
                      sop={activeSop}
                      onDeleted={async () => {
                        navigate(`/operations/sops/${area.id}`, {
                          replace: true,
                        });
                        await reload();
                      }}
                    />
                  ) : null}
                </div>
              </div>
              <div
                className="relative w-full overflow-hidden rounded-lg border border-line bg-paper-card"
                style={{ height: "72vh", minHeight: 480 }}
              >
                <iframe
                  key={activeSop.id}
                  src={activeSop.docUrl}
                  title={`${activeSop.code} ${activeSop.title}`}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full"
                  style={{ border: 0 }}
                />
              </div>
            </section>
          ) : null}
        </div>
      )}

      {addOpen ? (
        <UploadSopsModal
          defaultAreaId={area?.id ?? DEFAULT_SOP_AREA_ID}
          existing={sops}
          onClose={() => setAddOpen(false)}
          onDone={async (firstAdded) => {
            setAddOpen(false);
            await reload();
            if (firstAdded) {
              navigate(
                `/operations/sops/${firstAdded.areaId}/${firstAdded.id}`,
              );
            }
          }}
        />
      ) : null}
    </div>
  );
}

/** One queued document, as read off its file name and then edited. */
interface QueueRow {
  key: string;
  file: File;
  areaId: string;
  code: string;
  title: string;
  description: string;
  version: string;
  /** Set when a document with this area + code is already in the library. */
  existing: Sop | null;
  replace: boolean;
  open: boolean;
  status: "pending" | "working" | "done" | "failed" | "skipped";
  message: string | null;
}

/**
 * Upload one SOP or a whole folder of them. Owner/manager only (the button
 * that opens it is gated, and RLS enforces it on both the table and the
 * bucket).
 *
 * Dropping in files named to the library convention — "<CODE> <Title>.pdf",
 * per master plan §B3 — fills in the area, code, title and the SOP's linked
 * audit metric automatically, so loading a wave of thirty-odd documents is one
 * action rather than thirty forms. Everything read off a name stays editable,
 * and rows whose name doesn't parse are flagged open for the user to complete
 * rather than being guessed at or silently dropped.
 *
 * A code that is already in the library is skipped by default, with a
 * per-row option to replace the document instead — the §B3 revision path.
 */
function UploadSopsModal({
  defaultAreaId,
  existing,
  onClose,
  onDone,
}: {
  defaultAreaId: string;
  existing: Sop[];
  onClose: () => void;
  onDone: (firstAdded: Sop | null) => void | Promise<void>;
}) {
  const { state } = useSync();

  const [rows, setRows] = useState<QueueRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setErr(null);
    const next: QueueRow[] = [];
    for (const file of Array.from(files)) {
      const parsed = parseSopFileName(file.name);
      const areaId = parsed.areaId ?? defaultAreaId;
      const prior =
        existing.find(
          (s) =>
            s.areaId === areaId &&
            s.code.toUpperCase() === parsed.code.toUpperCase(),
        ) ?? null;
      // Anything the file name didn't answer is opened for the user to fill in.
      const needsAttention = !parsed.areaId || !parsed.code || !parsed.title;
      next.push({
        key: `${file.name}-${file.size}-${file.lastModified}`,
        file,
        areaId,
        code: parsed.code,
        title: parsed.title,
        description: parsed.description,
        version: "v1.0",
        existing: prior,
        replace: false,
        open: needsAttention,
        status: "pending",
        message: null,
      });
    }
    setRows((prev) => {
      const seen = new Set(prev.map((r) => r.key));
      return [...prev, ...next.filter((r) => !seen.has(r.key))];
    });
  }

  function patch(key: string, change: Partial<QueueRow>) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...change } : r)),
    );
  }

  const ready = rows.filter(
    (r) =>
      r.status === "pending" &&
      r.code.trim() &&
      r.title.trim() &&
      (!r.existing || r.replace),
  );
  const incomplete = rows.filter(
    (r) => r.status === "pending" && (!r.code.trim() || !r.title.trim()),
  );
  const willSkip = rows.filter(
    (r) => r.status === "pending" && r.existing && !r.replace,
  );

  async function upload() {
    if (!state.cinemaId) {
      setErr("No cinema in context — reload and try again.");
      return;
    }
    setBusy(true);
    setErr(null);
    const by = state.email ?? "system";
    let firstAdded: Sop | null = null;
    let done = 0;
    let failures = 0;

    // Sequential on purpose: thirty-eight parallel uploads is a good way to
    // get rate-limited, and a steady per-row progress line is more use than a
    // spinner that finishes all at once.
    for (const row of rows) {
      if (row.status !== "pending") continue;
      if (!row.code.trim() || !row.title.trim()) continue;
      if (row.existing && !row.replace) {
        patch(row.key, {
          status: "skipped",
          message: "Already in the library",
        });
        continue;
      }

      done++;
      setProgress(`${row.code || row.file.name} — ${done} of ${ready.length}`);
      patch(row.key, { status: "working", message: null });

      try {
        if (row.existing) {
          await replaceSopDocument(
            state.cinemaId,
            row.existing,
            {
              file: row.file,
              title: row.title,
              description: row.description,
              version: row.version,
            },
            by,
          );
          patch(row.key, { status: "done", message: "Replaced" });
        } else {
          const sop = await addSop(
            state.cinemaId,
            {
              areaId: row.areaId,
              code: row.code,
              title: row.title,
              description: row.description,
              file: row.file,
              version: row.version,
            },
            by,
          );
          if (!firstAdded) firstAdded = sop;
          patch(row.key, { status: "done", message: "Added" });
        }
      } catch (e) {
        failures++;
        patch(row.key, {
          status: "failed",
          message: e instanceof Error ? e.message : String(e),
          open: true,
        });
      }
    }

    setProgress(null);
    setBusy(false);

    // Anything that failed stays on screen with its reason so it can be fixed
    // and retried; a clean run closes out.
    if (failures === 0) {
      await onDone(firstAdded);
    } else {
      setErr(
        `${failures} of ${ready.length} could not be uploaded — see the rows below.`,
      );
    }
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      maxWidth="max-w-3xl"
      title={rows.length > 1 ? `Upload ${rows.length} SOPs` : "Upload an SOP"}
      actions={
        <button
          type="button"
          onClick={busy ? undefined : onClose}
          disabled={busy}
          className="text-sm text-ink-muted hover:text-ink disabled:opacity-50"
        >
          Close
        </button>
      }
    >
      <div className="space-y-4">
        <Field
          label="Documents"
          hint='Pick one PDF or select them all at once. Names like "BO-01 Counter Opening & Cash Float Set-up.pdf" are filed automatically.'
        >
          <input
            type="file"
            accept="application/pdf,.pdf"
            multiple
            disabled={busy}
            onChange={(e) => {
              addFiles(e.target.files);
              // Reset so re-picking the same file still fires a change.
              e.target.value = "";
            }}
            className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-paper-card file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-line/30"
          />
        </Field>

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
            Nothing queued yet.
          </p>
        ) : (
          <>
            <div className="max-h-[46vh] space-y-1.5 overflow-y-auto pr-1">
              {rows.map((row) => (
                <QueueRowCard
                  key={row.key}
                  row={row}
                  busy={busy}
                  onChange={(change) => patch(row.key, change)}
                  onRemove={() =>
                    setRows((prev) => prev.filter((r) => r.key !== row.key))
                  }
                />
              ))}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
              <span>{ready.length} to upload</span>
              {willSkip.length > 0 ? (
                <span>
                  {willSkip.length} already in the library — tick Replace to
                  overwrite
                </span>
              ) : null}
              {incomplete.length > 0 ? (
                <span className="text-amber-600">
                  {incomplete.length} need a code and title
                </span>
              ) : null}
            </div>
          </>
        )}

        {err ? <p className="text-sm text-red-600">{err}</p> : null}

        <div className="flex items-center justify-end gap-3 pt-1">
          {progress ? (
            <span className="mr-auto text-xs text-ink-muted">
              Uploading {progress}
            </span>
          ) : null}
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={upload} disabled={busy || ready.length === 0}>
            {busy
              ? "Uploading…"
              : ready.length > 1
                ? `Upload ${ready.length} SOPs`
                : "Upload"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** One row of the upload queue — collapsed when the file name said it all. */
function QueueRowCard({
  row,
  busy,
  onChange,
  onRemove,
}: {
  row: QueueRow;
  busy: boolean;
  onChange: (change: Partial<QueueRow>) => void;
  onRemove: () => void;
}) {
  const areaDef = SOP_AREA_DEFS.find((a) => a.id === row.areaId);
  const locked = busy || row.status === "done" || row.status === "working";

  const statusTint =
    row.status === "done"
      ? "border-emerald-300 bg-emerald-50/50"
      : row.status === "failed"
        ? "border-red-300 bg-red-50/50"
        : row.status === "skipped"
          ? "border-line bg-paper opacity-60"
          : "border-line bg-paper-card";

  return (
    <div className={`rounded-lg border px-3 py-2 ${statusTint}`}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange({ open: !row.open })}
          className="min-w-0 flex-1 text-left"
        >
          <span className="mr-2 font-mono text-xs text-ink-muted">
            {row.code || "??"}
          </span>
          <span className="text-sm text-ink">
            {row.title || row.file.name}
          </span>
          <span className="ml-2 text-xs text-ink-muted">
            {areaDef?.label ?? "unfiled"}
          </span>
        </button>

        {row.existing && row.status === "pending" ? (
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={row.replace}
              disabled={locked}
              onChange={(e) => onChange({ replace: e.target.checked })}
            />
            Replace
          </label>
        ) : null}

        {row.message ? (
          <span
            className={
              "shrink-0 text-xs " +
              (row.status === "failed" ? "text-red-600" : "text-ink-muted")
            }
          >
            {row.message}
          </span>
        ) : null}

        {row.status === "working" ? (
          <span className="shrink-0 text-xs text-ink-muted">…</span>
        ) : null}

        {!locked ? (
          <button
            type="button"
            onClick={onRemove}
            title="Remove from the queue"
            className="shrink-0 text-xs text-ink-muted hover:text-red-600"
          >
            ×
          </button>
        ) : null}
      </div>

      {row.open ? (
        <div className="mt-2 grid gap-2 border-t border-line pt-2 sm:grid-cols-2">
          <Field label="Area">
            <Select
              value={row.areaId}
              disabled={locked}
              onChange={(e) => onChange({ areaId: e.target.value })}
            >
              {SOP_AREA_DEFS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.fullName}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Code"
            hint={areaDef ? `As printed, e.g. ${areaDef.prefix}-01.` : undefined}
          >
            <Input
              value={row.code}
              disabled={locked}
              onChange={(e) => onChange({ code: e.target.value })}
              placeholder={areaDef ? `${areaDef.prefix}-01` : "BO-01"}
            />
          </Field>

          <Field label="Title">
            <Input
              value={row.title}
              disabled={locked}
              onChange={(e) => onChange({ title: e.target.value })}
            />
          </Field>

          <Field label="Version">
            <Input
              value={row.version}
              disabled={locked}
              onChange={(e) => onChange({ version: e.target.value })}
              placeholder="v1.0"
            />
          </Field>

          <div className="sm:col-span-2">
            <Field
              label="Description"
              hint="The daily check or metric this SOP feeds."
            >
              <Input
                value={row.description}
                disabled={locked}
                onChange={(e) => onChange({ description: e.target.value })}
                placeholder="e.g. Float verified & signed"
              />
            </Field>
          </div>

          <p className="text-xs text-ink-muted sm:col-span-2">
            {row.file.name} · {Math.round(row.file.size / 1024)} KB
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Removes an SOP after a confirm. Owner/manager only. */
function DeleteSopButton({
  sop,
  onDeleted,
}: {
  sop: Sop;
  onDeleted: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (
      !window.confirm(
        `Remove ${sop.code} ${sop.title} from the library? This deletes the document too.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await deleteSop(sop);
      await onDeleted();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={busy}
      className="inline-flex items-center rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
    >
      {busy ? "Removing…" : "Remove"}
    </button>
  );
}

/**
 * Copies the absolute URL for the given in-app path to the clipboard and
 * briefly confirms. Used to share a single SOP.
 */
function CopyLinkButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url =
      typeof window !== "undefined" ? window.location.origin + path : path;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API blocked (e.g. insecure context) — fall back to prompt.
      window.prompt("Copy this link:", url);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy a shareable link"
      className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-line/30 hover:text-ink"
    >
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}
