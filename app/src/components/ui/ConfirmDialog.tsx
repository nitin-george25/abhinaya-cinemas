import type { ReactNode } from "react";
import { Button } from "./Button";

/**
 * Small confirmation modal for destructive actions — replaces the browser
 * `confirm()` so the copy, styling, and button emphasis are ours. Same
 * backdrop pattern as ClosingFormDialog (click outside cancels).
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
  /** Body content — explain exactly what will be removed. */
  children: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-4"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0" onClick={onCancel} aria-hidden="true" />
      <div className="relative bg-paper-card rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <div className="text-sm text-ink-muted mt-1 space-y-2">{children}</div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
