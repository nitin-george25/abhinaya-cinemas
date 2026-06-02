// ============================================================================
// DesktopBetterBanner — dismissible amber banner shown on screens < md.
// Hint for admin pages (Settings, Backup, Users, Activity) that the layout
// is built for desktop. Doesn't block usage.
// ============================================================================

import { useState } from "react";

export function DesktopBetterBanner({
  storageKey = "abh.dcr.desktopHintDismissed",
}: {
  /** Local storage key — different pages can share or use distinct keys. */
  storageKey?: string;
}) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });
  if (dismissed) return null;

  function dismiss() {
    try { localStorage.setItem(storageKey, "1"); } catch {/* */}
    setDismissed(true);
  }

  return (
    <div className="md:hidden rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-sm flex items-start gap-3">
      <div className="flex-1 text-ink-soft">
        <b>Best on desktop.</b> This page has wide tables and small controls;
        use a laptop for serious editing.
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="text-ink-muted hover:text-ink shrink-0 px-1"
      >
        ✕
      </button>
    </div>
  );
}
