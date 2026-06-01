// ============================================================================
// Sidebar — dark, role-filtered nav with two-level groups.
//
// Top-level items are either leaves (with `to`) or groups (with `children`).
// Groups expand/collapse on click and auto-expand when one of their child
// routes is active. Active highlight on parent + child.
// ============================================================================

import { useMemo, useState, useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "../ui/cn";
import {
  IconDashboard,
  IconEntry,
  IconFB,
  IconActivity,
  IconBackup,
  IconSettings,
  IconChevronDown,
} from "../icons";
import type { Role } from "../../lib/hooks/useSupabaseSync";

type IconCmp = typeof IconDashboard;

interface NavLeaf {
  kind: "leaf";
  to: string;
  label: string;
  Icon?: IconCmp;
  roles: Role[];
}
interface NavGroup {
  kind: "group";
  id: string;
  label: string;
  Icon: IconCmp;
  roles: Role[];
  children: NavLeaf[];
}
type NavItem = NavLeaf | NavGroup;

const OWNER_MANAGER: Role[] = ["owner", "manager"];
const OWNER_ONLY: Role[] = ["owner"];
const ALL: Role[] = ["owner", "manager", "daily_manager", "accountant"];
// Day-to-day data-entry roles: can write BO + F&B but nothing else.
const ENTRY_ROLES: Role[] = ["owner", "manager", "daily_manager"];
const BO_HISTORY_ROLES: Role[] = ["owner", "manager", "daily_manager", "accountant"];

const NAV: NavItem[] = [
  {
    kind: "leaf",
    to: "/dashboard",
    label: "Dashboard",
    Icon: IconDashboard,
    roles: OWNER_MANAGER,
  },
  {
    kind: "group",
    id: "box-office",
    label: "Box Office",
    Icon: IconEntry,
    roles: ALL,
    children: [
      { kind: "leaf", to: "/box-office/entry",   label: "Entry",   roles: ENTRY_ROLES },
      { kind: "leaf", to: "/box-office/history", label: "History", roles: BO_HISTORY_ROLES },
    ],
  },
  {
    kind: "group",
    id: "fb",
    label: "F&B",
    Icon: IconFB,
    roles: ENTRY_ROLES,
    children: [
      { kind: "leaf", to: "/fb/entry",      label: "Entry",      roles: ENTRY_ROLES },
      { kind: "leaf", to: "/fb/history",    label: "History",    roles: ENTRY_ROLES },
      { kind: "leaf", to: "/fb/menu-items", label: "Menu Items", roles: OWNER_ONLY },
    ],
  },
  {
    kind: "group",
    id: "settings",
    label: "Settings",
    Icon: IconSettings,
    roles: OWNER_MANAGER,
    children: [
      { kind: "leaf", to: "/settings/movies",  label: "Movies",            roles: OWNER_MANAGER },
      { kind: "leaf", to: "/settings/screens", label: "Screens & Classes", roles: OWNER_MANAGER },
      { kind: "leaf", to: "/settings/tax",     label: "Tax & Rep Batta",   roles: OWNER_MANAGER },
      { kind: "leaf", to: "/settings/users",   label: "Users",             roles: OWNER_ONLY },
    ],
  },
  { kind: "leaf", to: "/activity", label: "Activity Log", Icon: IconActivity, roles: OWNER_MANAGER },
  { kind: "leaf", to: "/backup",   label: "Backup",       Icon: IconBackup,   roles: OWNER_MANAGER },
];

function roleLabel(role: Role): string {
  switch (role) {
    case "owner":         return "owner";
    case "manager":       return "manager";
    case "daily_manager": return "daily manager";
    case "accountant":    return "accountant";
  }
}

function filterForRole(items: NavItem[], role: Role): NavItem[] {
  const out: NavItem[] = [];
  for (const item of items) {
    if (!item.roles.includes(role)) continue;
    if (item.kind === "group") {
      const kids = item.children.filter((c) => c.roles.includes(role));
      if (kids.length === 0) continue;
      out.push({ ...item, children: kids });
    } else {
      out.push(item);
    }
  }
  return out;
}

export function Sidebar({ role }: { role: Role }) {
  const visible = useMemo(() => filterForRole(NAV, role), [role]);
  const location = useLocation();

  // Auto-expand the group whose child matches the current path. Manual
  // toggles override until the route changes again.
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
      {/* Brand — fixed h-14 to match the header's height. */}
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

      {/* Nav */}
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

      {/* Footer caption */}
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
          "w-full flex items-center gap-3 mx-2 px-3 py-2 rounded-lg text-sm transition-colors",
          // Wrapper button has its own width via mx-2 + w-full; offset.
          "text-left",
          isAnyChildActive
            ? "text-amber-300"
            : "text-white/70 hover:text-white hover:bg-white/5",
        )}
        style={{ width: "calc(100% - 1rem)" }}
      >
        <group.Icon className="w-4 h-4 shrink-0" />
        <span className="flex-1">{group.label}</span>
        <IconChevronDown
          className={cn(
            "w-3.5 h-3.5 transition-transform",
            open ? "rotate-0" : "-rotate-90",
          )}
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
