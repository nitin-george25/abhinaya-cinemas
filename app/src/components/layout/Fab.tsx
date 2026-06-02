// ============================================================================
// Floating Action Button (mobile only). Bottom-right "+" expands a small
// popover with the daily-ops shortcuts:
//   • Enter BO day  → opens BoQuickAddModal (date prefilled)
//   • Upload F&B CSV → opens DsrUploadModal directly
//
// Both stay in-place — no navigation. Hides on screens >= md (sidebar covers it).
// ============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { cn } from "../ui/cn";
import type { Role } from "../../lib/hooks/useSupabaseSync";

import { BoQuickAddModal } from "../entry/BoQuickAddModal";
import { DsrUploadModal } from "../fb/DsrUploadModal";

import { useSync } from "../../lib/hooks/SyncContext";
import { upsertFbEntry } from "../../lib/fb";
import type { FbEntry } from "../../lib/types";

interface Props {
  role: Role;
}

type ActionId = "bo" | "dsr";

interface Action {
  id: ActionId;
  label: string;
  roles: Role[];
}

const ACTIONS: Action[] = [
  { id: "bo",  label: "Enter BO show",  roles: ["owner", "manager", "daily_manager"] },
  { id: "dsr", label: "Upload F&B CSV", roles: ["owner", "manager", "daily_manager"] },
];

export function Fab({ role }: Props) {
  const { state, setAppState } = useSync();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<ActionId | null>(null);
  const location = useLocation();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close the popover (not the modals) on route change.
  useEffect(() => { setOpen(false); }, [location.pathname, location.search]);

  // Outside click / ESC closes the popover only.
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

  const items = useMemo(() => ACTIONS.filter((a) => a.roles.includes(role)), [role]);
  const existingFbDates = useMemo(
    () => new Set((state.appState?.fbEntries ?? []).map((e) => e.date)),
    [state.appState?.fbEntries],
  );

  function handleDsrImport(entry: FbEntry) {
    if (!state.appState) return;
    setAppState(upsertFbEntry(state.appState, entry));
    setActive(null);
  }

  if (items.length === 0) return null;

  return (
    <>
      <div
        ref={wrapRef}
        className="md:hidden fixed right-4 z-40"
        style={{ bottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        {open ? (
          <div className="absolute bottom-16 right-0 w-56 rounded-2xl bg-paper-card border border-line shadow-xl overflow-hidden">
            {items.map((a) => (
              <button
                key={a.id}
                onClick={() => { setOpen(false); setActive(a.id); }}
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
            "w-14 h-14 rounded-full bg-ink text-white shadow-lg",
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

      <BoQuickAddModal
        open={active === "bo"}
        onClose={() => setActive(null)}
      />
      <DsrUploadModal
        open={active === "dsr"}
        onClose={() => setActive(null)}
        onImport={handleDsrImport}
        existingDates={existingFbDates}
      />
    </>
  );
}
