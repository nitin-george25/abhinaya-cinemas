import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

/**
 * Small confirmation modal for destructive actions — replaces the browser
 * `confirm()` so the copy, styling, and button emphasis are ours.
 *
 * Rendered through a portal to <body> (like Modal) so `position: fixed` is
 * always relative to the viewport — otherwise a transformed/clipping ancestor
 * (e.g. a settings table row) becomes the containing block and the dialog
 * mis-centres and clips its text. Escape cancels; body scroll is locked while
 * open (nests correctly under a parent Modal that also locks it).
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Delete",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  /** Body content — explain exactly what will happen. */
  children: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0" onClick={busy ? undefined : onCancel} aria-hidden="true" />
      <div className="relative bg-paper-card rounded-2xl shadow-xl w-full max-w-sm max-h-[calc(100vh-2rem)] overflow-y-auto p-5 text-left">
        <h2 className="text-base font-semibold text-ink break-words">{title}</h2>
        <div className="text-sm text-ink-muted mt-2 space-y-2 break-words">{children}</div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
