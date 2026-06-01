// ============================================================================
// Floating Action Button (mobile only). Bottom-right "+" expands a small
// popover with the daily-ops shortcuts: enter BO, add F&B day, upload F&B CSV.
//
// Routes use ?action= query params so F&B Entry can auto-open the right modal.
// Hidden on routes where the action would be redundant (own page).
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "../ui/cn";
import type { Role } from "../../lib/hooks/useSupabaseSync";

interface Props {
  role: Role;
}

interface Action {
  label: string;
  to: string;
  /** Roles allowed to see this action. */
  roles: Role[];
}

const ACTIONS: Action[] = [
  { label: "Enter BO day",     to: "/box-office/entry",       roles: ["owner", "manager", "daily_manager"] },
  { label: "Add F&B day",      to: "/fb/entry?action=add",    roles: ["owner", "manager", "daily_manager"] },
  { label: "Upload F&B CSV",   to: "/fb/entry?action=upload", roles: ["owner", "manager", "daily_manager"] },
];

export function Fab({ role }: Props) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on route change.
  useEffect(() => { setOpen(false); }, [location.pathname, location.search]);

  // Close on outside click / ESC.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = ACTIONS.filter((a) => a.roles.includes(role));
  if (items.length === 0) return null;

  function go(to: string) {
    setOpen(false);
    navigate(to);
  }

  return (
    <div
      ref={wrapRef}
      className="md:hidden fixed right-4 z-40"
      style={{ bottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      {open ? (
        <div className="absolute bottom-16 right-0 w-56 rounded-2xl bg-paper-card border border-line shadow-xl overflow-hidden">
          {items.map((a) => (
            <button
              key={a.to}
              onClick={() => go(a.to)}
              className="w-full text-left px-4 py-3 text-sm border-b border-line last:border-b-0 active:bg-paper"
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}

      <button
        onClick={() => setOpen((p) => !p)}
        aria-label={open ? "Close quick actions" : "Open quick actions"}
        className={cn(
          "w-14 h-14 rounded-full bg-amber-500 text-ink shadow-lg",
          "flex items-center justify-center active:scale-95 transition-transform",
        )}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          className={cn("w-6 h-6 transition-transform", open ? "rotate-45" : "")}
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}
