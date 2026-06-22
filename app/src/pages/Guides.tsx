import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Modal } from "../components/ui/Modal";
import { Button } from "../components/ui/Button";
import { Field, Input, Select } from "../components/ui/Input";
import { useSync } from "../lib/hooks/SyncContext";
import {
  GUIDE_CATEGORY_DEFS,
  DEFAULT_GUIDE_CATEGORY_ID,
  groupGuides,
  listGuides,
  addGuide,
  type Guide,
} from "../lib/guides";

/**
 * Guides — in-app help, reached via the book icon in the header. Top-level
 * category sub-tabs (Box Office, F&B, …); each lists its guides, and the
 * selected guide renders its embedded walkthrough. Available to every role;
 * owners/managers can add new guides via the "Add guide" button.
 *
 * Guides are loaded from Supabase (see lib/guides + migration guides_00_schema)
 * so additions are persistent and visible to everyone.
 *
 * Category and guide live in the URL so each has its own shareable link:
 *   /guides/:categoryId               → a category ("type")
 *   /guides/:categoryId/:guideId      → a single guide
 * The route is canonicalised on load (a bare /guides, or an unknown/partial
 * id, redirects to the resolved category + first guide), so a copied link
 * always reopens exactly what the sender was looking at.
 */
export default function GuidesPage() {
  const navigate = useNavigate();
  const { state } = useSync();
  const canEdit = state.role === "owner" || state.role === "manager";

  const { categoryId, guideId } = useParams<{
    categoryId?: string;
    guideId?: string;
  }>();

  const [guides, setGuides] = useState<Guide[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const reload = useCallback(async () => {
    if (!state.cinemaId) return;
    const rows = await listGuides(state.cinemaId);
    setGuides(rows);
    setLoaded(true);
  }, [state.cinemaId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const categories = useMemo(() => groupGuides(guides), [guides]);

  // Default to the first category that actually has content, else the first.
  const defaultCat = useMemo(
    () => categories.find((c) => c.guides.length > 0) ?? categories[0],
    [categories],
  );

  const category = categories.find((c) => c.id === categoryId) ?? defaultCat;
  const activeGuide =
    category?.guides.find((g) => g.id === guideId) ??
    category?.guides[0] ??
    null;

  // Canonical path for what's actually being shown. Keeping the URL in sync
  // with the resolved selection is what makes every link shareable.
  const canonicalPath = category
    ? activeGuide
      ? `/guides/${category.id}/${activeGuide.id}`
      : `/guides/${category.id}`
    : "/guides";

  useEffect(() => {
    // Wait until guides have loaded before canonicalising, otherwise a bare
    // /guides briefly redirects to the first (empty) category before the real
    // content arrives.
    if (!loaded) return;
    const current = guideId
      ? `/guides/${categoryId}/${guideId}`
      : categoryId
        ? `/guides/${categoryId}`
        : "/guides";
    if (current !== canonicalPath) {
      navigate(canonicalPath, { replace: true });
    }
  }, [loaded, canonicalPath, categoryId, guideId, navigate]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-3xl font-bold tracking-tight">Guides</h2>
          <p className="text-ink-muted mt-1 leading-relaxed">
            Step-by-step walkthroughs for everyday tasks in the console.
          </p>
        </div>
        {canEdit ? (
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => setAddOpen(true)}
          >
            + Add guide
          </Button>
        ) : null}
      </div>

      {/* Category sub-tabs */}
      <div className="border-b border-line">
        <nav className="-mb-px flex gap-1 overflow-x-auto">
          {categories.map((c) => {
            const active = c.id === category?.id;
            return (
              <button
                key={c.id}
                onClick={() => navigate(`/guides/${c.id}`)}
                className={
                  "shrink-0 border-b-2 px-3.5 py-2 text-sm font-medium transition-colors " +
                  (active
                    ? "border-amber-500 text-ink"
                    : "border-transparent text-ink-muted hover:text-ink")
                }
              >
                {c.label}
                {c.guides.length > 0 ? (
                  <span className="ml-1.5 text-xs text-ink-muted">
                    {c.guides.length}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Body */}
      {!category || category.guides.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-paper-card px-6 py-16 text-center">
          <p className="text-sm text-ink-muted">
            {loaded
              ? "No guides here yet — they'll appear as we add them."
              : "Loading guides…"}
          </p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-[220px_1fr]">
          {/* Guide list for the active category */}
          <aside className="space-y-1">
            {category.guides.map((g) => {
              const active = g.id === activeGuide?.id;
              return (
                <button
                  key={g.id}
                  onClick={() => navigate(`/guides/${category.id}/${g.id}`)}
                  className={
                    "w-full rounded-md px-3 py-2 text-left text-sm transition-colors " +
                    (active
                      ? "bg-line/50 font-medium text-ink"
                      : "text-ink-muted hover:bg-line/30 hover:text-ink")
                  }
                >
                  {g.title}
                </button>
              );
            })}
          </aside>

          {/* Selected guide + embedded walkthrough */}
          {activeGuide ? (
            <section className="min-w-0 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-ink">
                    {activeGuide.title}
                  </h3>
                  {activeGuide.description ? (
                    <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                      {activeGuide.description}
                    </p>
                  ) : null}
                </div>
                <CopyLinkButton
                  path={`/guides/${category.id}/${activeGuide.id}`}
                />
              </div>
              <div
                className="relative w-full overflow-hidden rounded-lg border border-line bg-paper-card"
                style={{ height: "72vh", minHeight: 480 }}
              >
                <iframe
                  key={activeGuide.id}
                  src={activeGuide.embedUrl}
                  title={activeGuide.title}
                  loading="lazy"
                  allow="fullscreen"
                  className="absolute inset-0 h-full w-full"
                  style={{ border: 0 }}
                />
              </div>
            </section>
          ) : null}
        </div>
      )}

      {addOpen ? (
        <AddGuideModal
          defaultCategoryId={category?.id ?? DEFAULT_GUIDE_CATEGORY_ID}
          onClose={() => setAddOpen(false)}
          onAdded={async (guide) => {
            setAddOpen(false);
            await reload();
            navigate(`/guides/${guide.categoryId}/${guide.id}`);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Modal form to add a guide. Owner/manager only (the button that opens it is
 * gated, and RLS enforces it server-side).
 */
function AddGuideModal({
  defaultCategoryId,
  onClose,
  onAdded,
}: {
  defaultCategoryId: string;
  onClose: () => void;
  onAdded: (guide: Guide) => void | Promise<void>;
}) {
  const { state } = useSync();

  const [categoryId, setCategoryId] = useState(defaultCategoryId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [embedUrl, setEmbedUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit =
    title.trim().length > 0 && embedUrl.trim().length > 0 && !busy;

  async function submit() {
    if (!state.cinemaId) {
      setErr("No cinema in context — reload and try again.");
      return;
    }
    if (!/^https?:\/\//i.test(embedUrl.trim())) {
      setErr("Enter a full embed URL starting with http(s)://");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const guide = await addGuide(
        state.cinemaId,
        { categoryId, title, description, embedUrl },
        state.email ?? "system",
      );
      await onAdded(guide);
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
      title="Add a guide"
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
        <Field label="Category">
          <Select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            {GUIDE_CATEGORY_DEFS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Title">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Record a Cash Deposit"
            autoFocus
          />
        </Field>

        <Field
          label="Description"
          hint="Optional — a one-line summary shown above the walkthrough."
        >
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this guide covers"
          />
        </Field>

        <Field
          label="Embed link"
          hint="The Scribe /embed/ URL, e.g. https://scribehow.com/embed/…"
        >
          <Input
            value={embedUrl}
            onChange={(e) => setEmbedUrl(e.target.value)}
            placeholder="https://scribehow.com/embed/…"
          />
        </Field>

        {err ? <p className="text-sm text-red-600">{err}</p> : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {busy ? "Adding…" : "Add guide"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Copies the absolute URL for the given in-app path to the clipboard and
 * briefly confirms. Used to share a single guide.
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
      className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-line/30 hover:text-ink"
    >
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}
