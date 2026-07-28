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
            + Add SOP
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
        <AddSopModal
          defaultAreaId={area?.id ?? DEFAULT_SOP_AREA_ID}
          onClose={() => setAddOpen(false)}
          onAdded={async (sop) => {
            setAddOpen(false);
            await reload();
            navigate(`/operations/sops/${sop.areaId}/${sop.id}`);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Modal form to add an SOP. Owner/manager only (the button that opens it is
 * gated, and RLS enforces it on both the table and the bucket).
 */
function AddSopModal({
  defaultAreaId,
  onClose,
  onAdded,
}: {
  defaultAreaId: string;
  onClose: () => void;
  onAdded: (sop: Sop) => void | Promise<void>;
}) {
  const { state } = useSync();

  const [areaId, setAreaId] = useState(defaultAreaId);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState("v1.0");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const areaDef = SOP_AREA_DEFS.find((a) => a.id === areaId);

  const canSubmit =
    code.trim().length > 0 && title.trim().length > 0 && !!file && !busy;

  async function submit() {
    if (!state.cinemaId) {
      setErr("No cinema in context — reload and try again.");
      return;
    }
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const sop = await addSop(
        state.cinemaId,
        { areaId, code, title, description, version, file },
        state.email ?? "system",
      );
      await onAdded(sop);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-lg"
      title="Add an SOP"
      actions={
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-ink-muted hover:text-ink"
        >
          Close
        </button>
      }
    >
      <div className="space-y-4">
        <Field label="Area">
          <Select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            {SOP_AREA_DEFS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.fullName}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Code"
          hint={
            areaDef
              ? `As printed on the document, e.g. ${areaDef.prefix}-01.`
              : "As printed on the document."
          }
        >
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={areaDef ? `${areaDef.prefix}-01` : "BO-01"}
            autoFocus
          />
        </Field>

        <Field label="Title">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Counter Opening & Cash Float Set-up"
          />
        </Field>

        <Field
          label="Description"
          hint="Optional — the daily check or metric this SOP feeds."
        >
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Float verified & signed"
          />
        </Field>

        <Field label="Version">
          <Input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="v1.0"
          />
        </Field>

        <Field label="Document" hint="The signed-off SOP PDF.">
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-paper-card file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-line/30"
          />
        </Field>

        {err ? <p className="text-sm text-red-600">{err}</p> : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {busy ? "Uploading…" : "Add SOP"}
          </Button>
        </div>
      </div>
    </Modal>
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
