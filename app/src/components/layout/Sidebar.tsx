// ============================================================================
// Sidebar — desktop-only dark nav (hidden on < md). Mobile uses MobileNav.tsx.
// ============================================================================

import { useMemo, useState, useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "../ui/cn";
import { IconChevronDown } from "../icons";
import { NAV, filterForRole, roleLabel, type NavGroup, type NavLeaf } from "../../lib/nav";
import type { Role } from "../../lib/hooks/useSupabaseSync";

export function Sidebar({ role }: { role: Role }) {
  const visible = useMemo(() => filterForRole(NAV, role), [role]);
  const location = useLocation();

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
    <aside className="hidden md:flex md:flex-col w-60 shrink-0 bg-ink text-white">
      <div className="h-14 px-5 flex items-center gap-3 border-b border-white/10 shrink-0">
        <img
          src="/admin/dcr/img/logomark-white.png"
          alt="Abhinaya Cinemas"
          className="h-7 w-auto shrink-0"
        />
        <div className="leading-tight min-w-0">
          <div className="font-display text-[13px] font-bold tracking-wider truncate">ABHINAYA</div>
          <div className="text-[10px] text-white/50 tracking-wider truncate">CINEMAS · CONSOLE</div>
        </div>
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

      <div className="px-5 py-3 border-t border-white/10 text-[10px] uppercase tracking-wider text-white/30">
        v2 preview · {roleLabel(role)}
      </div>
    </aside>
  );
}

function LeafLink({ item }: { item: NavLeaf }) {
  const { to, label, Icon } = item;
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 mx-2 px-3 py-2 rounded-lg text-sm transition-colors",
          isActive
            ? "bg-amber-400/15 text-amber-300"
            : "text-white/70 hover:text-white hover:bg-white/5",
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
          "w-full flex items-center gap-3 mx-2 px-3 py-2 rounded-lg text-sm transition-colors text-left",
          isAnyChildActive
            ? "text-amber-300"
            : "text-white/70 hover:text-white hover:bg-white/5",
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
                  "block px-3 py-1.5 rounded-md text-[13px] transition-colors",
                  isActive
                    ? "bg-amber-400/15 text-amber-300"
                    : "text-white/60 hover:text-white hover:bg-white/5",
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
