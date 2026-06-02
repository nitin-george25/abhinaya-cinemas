// ============================================================================
// Navigation tree — single source of truth for the sidebar + mobile drawer.
//
// NavLeaf = a direct route. NavGroup = an expandable container with children.
// Role gates exist at both levels. filterForRole() prunes by the caller's role.
// ============================================================================

import {
  IconDashboard,
  IconEntry,
  IconFB,
  IconActivity,
  IconBackup,
  IconSettings,
  IconHistory,
} from "../components/icons";
import type { Role } from "./hooks/useSupabaseSync";

type IconCmp = typeof IconDashboard;

export interface NavLeaf {
  kind: "leaf";
  to: string;
  label: string;
  Icon?: IconCmp;
  roles: Role[];
}
export interface NavGroup {
  kind: "group";
  id: string;
  label: string;
  Icon: IconCmp;
  roles: Role[];
  children: NavLeaf[];
}
export type NavItem = NavLeaf | NavGroup;

const OWNER_MANAGER: Role[] = ["owner", "manager"];
const OWNER_ONLY: Role[] = ["owner"];
const ENTRY_ROLES: Role[] = ["owner", "manager", "daily_manager"];
const BO_HISTORY_ROLES: Role[] = ["owner", "manager", "daily_manager", "accountant"];
const REPORT_ROLES: Role[] = ["owner", "manager", "accountant"];
const ALL: Role[] = ["owner", "manager", "daily_manager", "accountant"];

export const NAV: NavItem[] = [
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
    id: "reports",
    label: "Reports",
    Icon: IconHistory,
    roles: REPORT_ROLES,
    children: [
      { kind: "leaf", to: "/reports/box-office", label: "Box Office", roles: REPORT_ROLES },
      { kind: "leaf", to: "/reports/fb",         label: "F&B",        roles: REPORT_ROLES },
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

export function filterForRole(items: NavItem[], role: Role): NavItem[] {
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

/** Human-readable label for the user's role (used in chrome footers, badges). */
export function roleLabel(role: Role): string {
  switch (role) {
    case "owner":         return "owner";
    case "manager":       return "manager";
    case "daily_manager": return "daily manager";
    case "accountant":    return "accountant";
  }
}

/** Resolve the page title for a given pathname by matching the longest NAV prefix. */
export function titleForPath(pathname: string): string {
  const candidates: Array<[string, string]> = [];
  for (const item of NAV) {
    if (item.kind === "leaf") {
      candidates.push([item.to, item.label]);
    } else {
      candidates.push([`/${item.id}`, item.label]);
      for (const child of item.children) {
        candidates.push([child.to, `${item.label} · ${child.label}`]);
      }
    }
  }
  const match = candidates
    .filter(([p]) => pathname.startsWith(p))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return match?.[1] ?? "Console";
}
