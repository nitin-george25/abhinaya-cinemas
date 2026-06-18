import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { GUIDE_CATEGORIES } from "../lib/guides";

/**
 * Guides — in-app help, reached via the book icon in the header. Top-level
 * category sub-tabs (Box Office, F&B, …); each lists its guides, and the
 * selected guide renders its embedded walkthrough. Available to every role.
 *
 * Category and guide live in the URL so each has its own shareable link:
 *   /guides/:categoryId               → a category ("type")
 *   /guides/:categoryId/:guideId      → a single guide
 * The route is canonicalised on load (a bare /guides, or an unknown/partial
 * id, redirects to the resolved category + first guide), so a copied link
 * always reopens exactly what the sender was looking at.
 */
export default function GuidesPage() {
  const categories = GUIDE_CATEGORIES;
  const navigate = useNavigate();
  const { categoryId, guideId } = useParams<{
    categoryId?: string;
    guideId?: string;
  }>();

  // Default to the first category that actually has content, else the first.
  const defaultCat = useMemo(
    () => categories.find((c) => c.guides.length > 0) ?? categories[0],
    [categories],
  );

  const category =
    categories.find((c) => c.id === categoryId) ?? defaultCat;
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
    const current = guideId
      ? `/guides/${categoryId}/${guideId}`
      : categoryId
        ? `/guides/${categoryId}`
        : "/guides";
    if (current !== canonicalPath) {
      navigate(canonicalPath, { replace: true });
    }
  }, [canonicalPath, categoryId, guideId, navigate]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-3xl font-bold tracking-tight">Guides</h2>
          <p className="text-ink-muted mt-1 leading-relaxed">
            Step-by-step walkthroughs for everyday tasks in the console.
          </p>
        </div>
        <CopyLinkButton path={canonicalPath} />
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
            No guides here yet — they'll appear as we add them.
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
    </div>
  );
}

/**
 * Copies the absolute URL for the given in-app path to the clipboard and
 * briefly confirms. Used to share a category or a single guide.
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
