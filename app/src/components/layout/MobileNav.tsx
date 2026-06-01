// ============================================================================
// MobileNav — slide-in drawer for screens < md. Shares NAV tree with Sidebar.
//
// Closes on backdrop tap, ESC, or any route change. Body scroll locked while
// open. Inherits the dark sidebar palette so the brand carries through.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "../ui/cn";
import { IconChevronDown } from "../icons";
import { NAV, filterForRole, roleLabel, type NavGroup, type NavLeaf } from "../../lib/nav";
import type { Role } from "../../lib/hooks/useSupabaseSync";

interface Props {
  role: Role;
  open: boolean;
  onClose: () => void;
}

export function MobileNav({ role, open, onClose }: Props) {
  const visible = useMemo(() => filterForRole(NAV, role), [role]);
  const location = useLocation();

  // Close on route change.
  useEffect(() => {
    if (open) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // ESC + body scroll lock.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const activeGroupId = useMemo(() => {
    for (const item of visible) {
      if (item.kind === "group" && item.children.some((c) => location.pathname.startsWith(c.to))) {
        return item.id;
      }
    }
    return null;
  }, [visible, location.pathname]);

  const [openId, setOpenId] = useState<string | null>(activeGroupId);
  useEffect(() => {
    if (activeGroupId) setOpenId(activeGroupId);
  }, [activeGroupId]);

  return (
    <div
      className={cn(
        "md:hidden fixed inset-0 z-50",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-black/50 transition-opacity",
          open ? "opacity-100" : "opacity-0",
        )}
      />

      {/* Panel */}
      <aside
        className={cn(
          "absolute inset-y-0 left-0 w-72 max-w-[85%] bg-ink text-white",
          "shadow-2xl flex flex-col transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="h-14 px-5 flex items-center gap-3 border-b border-white/10 shrink-0">
          <img
            src="/admin/dcr/img/logomark-white.png"
            alt="Abhinaya Cinemas"
            className="h-7 w-auto shrink-0"
          />
          <div className="leading-tight min-w-0 flex-1">
            <div className="font-display text-[13px] font-bold tracking-wider truncate">ABHINAYA</div>
            <div className="text-[10px] text-white/50 tracking-wider truncate">CINEMAS · CONSOLE</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="text-white/70 hover:text-white p-1"
          >
            ✕
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3">
          {visible.map((item) =>
            item.kind === "leaf" ? (
              <LeafLink key={item.to} item={item} />
            ) : (
              <Group
                key={item.id}
                group={item}
                open={openId === item.id}
                onToggle={() => setOpenId((p) => (p === item.id ? null : item.id))}
              />
            ),
          )}
        </nav>

        <div
          className="px-5 py-3 border-t border-white/10 text-[10px] uppercase tracking-wider text-white/30"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          v2 preview · {roleLabel(role)}
        </div>
      </aside>
    </div>
  );
}

function LeafLink({ item }: { item: NavLeaf }) {
  const { to, label, Icon } = item;
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 mx-2 px-3 py-2.5 rounded-lg text-sm transition-colors",
          isActive
            ? "bg-amber-400/15 text-amber-300"
            : "text-white/70 active:bg-white/5",
        )
      }
    >
      {Icon ? <Icon className="w-4 h-4" /> : <span className="w-4" />}
      <span>{label}</span>
    </NavLink>
  );
}

function Group({
  group,
  open,
  onToggle,
}: {
  group: NavGroup;
  open: boolean;
  onToggle: () => void;
}) {
  const location = useLocation();
  const isAnyChildActive = group.children.some((c) =>
    location.pathname.startsWith(c.to),
  );
  return (
    <div className="mb-0.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "w-full flex items-center gap-3 mx-2 px-3 py-2.5 rounded-lg text-sm transition-colors text-left",
          isAnyChildActive ? "text-amber-300" : "text-white/70 active:bg-white/5",
        )}
        style={{ width: "calc(100% - 1rem)" }}
      >
        <group.Icon className="w-4 h-4 shrink-0" />
        <span className="flex-1">{group.label}</span>
        <IconChevronDown
          className={cn("w-3.5 h-3.5 transition-transform", open ? "rotate-0" : "-rotate-90")}
        />
      </button>
      {open ? (
        <div className="mt-0.5 pl-7 pr-2 space-y-0.5">
          {group.children.map((c) => (
            <NavLink
              key={c.to}
              to={c.to}
              className={({ isActive }) =>
                cn(
                  "block px-3 py-2 rounded-md text-[13px] transition-colors",
                  isActive ? "bg-amber-400/15 text-amber-300" : "text-white/60 active:bg-white/5",
                )
              }
            >
              {c.label}
            </NavLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}
