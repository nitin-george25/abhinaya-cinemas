// ============================================================================
// Modal primitive — backdrop + centred panel + escape/backdrop close +
// body-scroll lock while open.
//
// Render via portal so the modal escapes its parent's stacking / overflow.
// Print-friendly: the modal panel becomes a static block on print so its
// contents flow normally onto the page (the existing print stylesheet
// hides the rest of the app shell).
// ============================================================================

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Tailwind max-width class (e.g. "max-w-3xl"). Defaults to a wide panel. */
  maxWidth?: string;
  /** Modal title shown in the header. */
  title?: ReactNode;
  /** Optional right-aligned actions in the header (buttons etc). */
  actions?: ReactNode;
  children: ReactNode;
}

export function Modal({
  open,
  onClose,
  maxWidth = "max-w-[1180px]",
  title,
  actions,
  children,
}: Props) {
  // ESC closes; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      // The container handles backdrop + centering. print:static + print:p-0
      // so the contents flow into the printable page on Cmd-P.
      className={cn(
        "fixed inset-0 z-50 flex items-start justify-center",
        "bg-ink/40 backdrop-blur-sm p-4 sm:p-8 overflow-y-auto",
        "print:static print:bg-transparent print:p-0 print:backdrop-blur-none print:overflow-visible",
      )}
      onClick={onClose}
    >
      <div
        // Stop the click from reaching the backdrop.
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "w-full",
          maxWidth,
          "bg-white rounded-2xl shadow-card border border-line",
          "max-h-[calc(100vh-4rem)] sm:max-h-[calc(100vh-6rem)] flex flex-col",
          "print:max-h-none print:max-w-none print:shadow-none print:border-0 print:rounded-none",
        )}
      >
        {title || actions ? (
          <div className="px-5 py-3 border-b border-line flex items-center justify-between gap-3 shrink-0 print:hidden">
            <div className="font-semibold tracking-tight truncate">{title}</div>
            <div className="flex items-center gap-2">{actions}</div>
          </div>
        ) : null}
        <div className="flex-1 overflow-y-auto p-5 print:p-0 print:overflow-visible">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
