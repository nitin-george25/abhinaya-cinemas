// ============================================================================
// Sidebar — desktop-only dark nav (hidden on < md). Mobile uses MobileNav.tsx.
//
// Collapsible: the full nav is a 240px column, collapsed it is a 64px rail of
// group icons. The choice is remembered across sessions, since it is a working
// preference (a wide table or a side-by-side document reads better with the
// nav out of the way) rather than something to re-pick every visit.
// ============================================================================

import { useMemo, useState, useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "../ui/cn";
import { IconChevronDown, IconSidebar } from "../icons";
import { NAV, filterForRole, groupLeafTos, roleLabel, type NavGroup, type NavLeaf, type NavSubGroup } from "../../lib/nav";
import type { Role } from "../../lib/hooks/useSupabaseSync";

const COLLAPSE_KEY = "ac.sidebar.collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    // Private mode / storage disabled — default to the full nav.
    return false;
  }
}

export function Sidebar({ role }: { role: Role }) {
  const visible = useMemo(() => filterForRole(NAV, role), [role]);
  const location = useLocation();

  const activeGroupId = useMemo(() => {
    for (const item of visible) {
      if (item.kind === "group" && groupLeafTos(item).some((to) => location.pathname.startsWith(to))) {
        return item.id;
      }
    }
    return null;
  }, [visible, location.pathname]);

  const [openId, setOpenId] = useState<string | null>(activeGroupId);
  useEffect(() => {
    if (activeGroupId) setOpenId(activeGroupId);
  }, [activeGroupId]);

  const [collapsed, setCollapsed] = useState(readCollapsed);
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      // Not being able to remember the preference is not worth failing over.
    }
  }, [collapsed]);

  /** Opening a group from the rail expands the nav so its children are usable. */
  function openFromRail(id: string) {
    setCollapsed(false);
    setOpenId(id);
  }

  return (
    <aside
      className={cn(
        "hidden md:flex md:flex-col shrink-0 bg-ink text-white transition-[width] duration-200",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div
        className={cn(
          "h-14 flex items-center gap-3 border-b border-white/10 shrink-0",
          collapsed ? "justify-center px-0" : "px-5",
        )}
      >
        {/* Logomark — the ?v=2 cache-buster forces browsers to refetch even
            though /img/* is marked `immutable` in _headers. The
            asset on disk was unintentionally swapped to a 2084x2084
            square; restored to the original 238x200 in this commit. */}
        <img
          src="/img/logomark-white.png?v=2"
          alt="Abhinaya Cinemas"
          className="h-7 w-auto shrink-0"
        />
        {!collapsed ? (
          <div className="leading-tight min-w-0">
            <div className="font-display text-[13px] font-bold tracking-wider truncate">ABHINAYA</div>
            <div className="text-[10px] text-white/50 tracking-wider truncate">CINEMAS · CONSOLE</div>
          </div>
        ) : null}
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        {visible.map((item) =>
          item.kind === "leaf" ? (
            <LeafLink key={item.to} item={item} collapsed={collapsed} />
          ) : (
            <Group
              key={item.id}
              group={item}
              collapsed={collapsed}
              open={!collapsed && openId === item.id}
              onToggle={() =>
                collapsed
                  ? openFromRail(item.id)
                  : setOpenId((p) => (p === item.id ? null : item.id))
              }
            />
          ),
        )}
      </nav>

      <div
        className={cn(
          "flex items-center gap-2 border-t border-white/10 py-3",
          collapsed ? "justify-center px-0" : "px-5",
        )}
      >
        {!collapsed ? (
          <span className="flex-1 truncate text-[10px] uppercase tracking-wider text-white/30">
            v2 preview · {roleLabel(role)}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand menu" : "Collapse menu"}
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          aria-expanded={!collapsed}
          className="shrink-0 rounded-md p-1.5 text-white/40 transition-colors hover:bg-white/5 hover:text-white"
        >
          <IconSidebar className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
}

function LeafLink({ item, collapsed }: { item: NavLeaf; collapsed: boolean }) {
  const { to, label, Icon } = item;
  return (
    <NavLink
      to={to}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 mx-2 rounded-lg py-2 text-sm transition-colors",
          collapsed ? "justify-center px-0" : "px-3",
          isActive
            ? "bg-amber-400/15 text-amber-300"
            : "text-white/70 hover:text-white hover:bg-white/5",
        )
      }
    >
      {Icon ? <Icon className="w-4 h-4 shrink-0" /> : <span className="w-4" />}
      {!collapsed ? <span>{label}</span> : null}
    </NavLink>
  );
}

function Group({
  group,
  open,
  collapsed,
  onToggle,
}: {
  group: NavGroup;
  open: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const location = useLocation();
  const isAnyChildActive = groupLeafTos(group).some((to) =>
    location.pathname.startsWith(to),
  );
  return (
    <div className="mb-0.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        title={collapsed ? group.label : undefined}
        className={cn(
          "w-full flex items-center gap-3 mx-2 py-2 rounded-lg text-sm transition-colors text-left",
          collapsed ? "justify-center px-0" : "px-3",
          isAnyChildActive
            ? "text-amber-300"
            : "text-white/70 hover:text-white hover:bg-white/5",
          // On the rail there is no open state to show, so mark the group the
          // user is actually inside — otherwise the rail gives no bearings.
          collapsed && isAnyChildActive ? "bg-amber-400/15" : null,
        )}
        style={{ width: "calc(100% - 1rem)" }}
      >
        <group.Icon className="w-4 h-4 shrink-0" />
        {!collapsed ? (
          <>
            <span className="flex-1">{group.label}</span>
            <IconChevronDown
              className={cn("w-3.5 h-3.5 transition-transform", open ? "rotate-0" : "-rotate-90")}
            />
          </>
        ) : null}
      </button>
      {open && !collapsed ? (
        <div className="mt-0.5 pl-7 pr-2 space-y-0.5">
          {group.children.map((c) =>
            c.kind === "subgroup" ? (
              <SubGroup key={c.id} sub={c} />
            ) : (
              <SubLink key={c.to} to={c.to} label={c.label} />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

function SubLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "block px-3 py-1.5 rounded-md text-[13px] transition-colors",
          isActive
            ? "bg-amber-400/15 text-amber-300"
            : "text-white/60 hover:text-white hover:bg-white/5",
        )
      }
    >
      {label}
    </NavLink>
  );
}

function SubGroup({ sub }: { sub: NavSubGroup }) {
  const location = useLocation();
  const anyActive = sub.children.some((c) => location.pathname.startsWith(c.to));
  const [open, setOpen] = useState(anyActive);
  useEffect(() => {
    if (anyActive) setOpen(true);
  }, [anyActive]);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] transition-colors text-left",
          anyActive ? "text-amber-300" : "text-white/55 hover:text-white hover:bg-white/5",
        )}
      >
        <span className="flex-1">{sub.label}</span>
        <IconChevronDown
          className={cn("w-3 h-3 transition-transform", open ? "rotate-0" : "-rotate-90")}
        />
      </button>
      {open ? (
        <div className="mt-0.5 pl-3 space-y-0.5">
          {sub.children.map((c) => (
            <SubLink key={c.to} to={c.to} label={c.label} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
