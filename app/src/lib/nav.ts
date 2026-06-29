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
  IconCash,
  IconFinance,
  IconProjects,
  IconOperations,
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
// A labelled, collapsible cluster of leaves *inside* a group (one level deep).
export interface NavSubGroup {
  kind: "subgroup";
  id: string;
  label: string;
  roles: Role[];
  children: NavLeaf[];
}
export type NavChild = NavLeaf | NavSubGroup;
export interface NavGroup {
  kind: "group";
  id: string;
  label: string;
  Icon: IconCmp;
  roles: Role[];
  children: NavChild[];
}
export type NavItem = NavLeaf | NavGroup;

const OWNER_MANAGER: Role[] = ["owner", "manager"];
const OWNER_ONLY: Role[] = ["owner"];
const ENTRY_ROLES: Role[] = ["owner", "manager", "daily_manager"];
const BO_HISTORY_ROLES: Role[] = ["owner", "manager", "daily_manager", "accountant"];
const REPORT_ROLES: Role[] = ["owner", "manager", "accountant"];
const ALL: Role[] = ["owner", "manager", "daily_manager", "accountant"];

// Cash management roles
const CASH_LEDGER_ROLES: Role[] = ["owner", "manager", "accountant"];
const CASH_PAYMENTS_ROLES: Role[] = ["owner", "manager", "accountant"];
const PETTY_QUEUE_ROLES: Role[] = ["owner", "manager", "daily_manager"];

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
      { kind: "leaf", to: "/box-office/schedule", label: "Schedule", roles: ENTRY_ROLES },
      { kind: "leaf", to: "/box-office/entry",    label: "Entry",   roles: ENTRY_ROLES },
      { kind: "leaf", to: "/box-office/history",  label: "History", roles: BO_HISTORY_ROLES },
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
    // Operations — on-the-ground running of the cinema: staff rosters and the
    // daily SOP checklists. Visible to anyone who runs a shift; manage/approve
    // rights are gated per-feature (owner/manager) by the pages + RLS.
    kind: "group",
    id: "operations",
    label: "Operations",
    Icon: IconOperations,
    roles: ENTRY_ROLES,
    children: [
      {
        // Rosters — weekly staff rosters. Daily Manager Roster is the first;
        // other staff rosters can be added as further leaves later.
        kind: "subgroup",
        id: "operations-rosters",
        label: "Rosters",
        roles: ENTRY_ROLES,
        children: [
          { kind: "leaf", to: "/operations/rosters/daily-managers", label: "Daily Manager Roster", roles: ENTRY_ROLES },
        ],
      },
      // Moved here from F&B — the daily SOP checklists.
      { kind: "leaf", to: "/operations/checklist", label: "Checklists", roles: ENTRY_ROLES },
    ],
  },
  {
    kind: "group",
    id: "reports",
    label: "Reports",
    Icon: IconHistory,
    roles: REPORT_ROLES,
    children: [
      {
        // Box Office reports — day-wise collections + the end-of-run
        // picture-ending settlement statement. Routes stay under /reports/*.
        kind: "subgroup",
        id: "reports-box-office",
        label: "Box Office",
        roles: REPORT_ROLES,
        children: [
          { kind: "leaf", to: "/reports/box-office",     label: "Collections",    roles: REPORT_ROLES },
          { kind: "leaf", to: "/reports/picture-ending", label: "Picture Ending", roles: REPORT_ROLES },
        ],
      },
      { kind: "leaf", to: "/reports/fb",             label: "F&B",            roles: REPORT_ROLES },
      {
        // POS reports — over the daily till closings (cash_* schema). The
        // cash-closing summary spans every unit's counters for one business
        // day. Route lives under /reports/pos/*.
        kind: "subgroup",
        id: "reports-pos",
        label: "POS",
        roles: REPORT_ROLES,
        children: [
          { kind: "leaf", to: "/reports/pos/cash-closing", label: "Cash Closing", roles: REPORT_ROLES },
        ],
      },
      {
        // Finance reports — read-only views over the bank-side money.
        // Routes stay under /cash/* ; only the menu placement changed.
        kind: "subgroup",
        id: "reports-finance",
        label: "Finance",
        roles: REPORT_ROLES,
        children: [
          { kind: "leaf", to: "/cash/reports", label: "Cashflow",    roles: CASH_LEDGER_ROLES },
          { kind: "leaf", to: "/cash/ledger",  label: "Bank Ledger", roles: CASH_LEDGER_ROLES },
        ],
      },
    ],
  },
  {
    // Floor cash — the till and petty cash handled daily at the cinema.
    // Visible to cashier/daily_manager; back-office money lives under Finance.
    kind: "group",
    id: "cash",
    label: "Cash",
    Icon: IconCash,
    roles: ["owner", "manager", "daily_manager", "accountant", "cashier"],
    children: [
      // Cashier sees this so they can find closings awaiting their signature
      // and raise petty expenses in the same surface as everyone else.
      { kind: "leaf", to: "/cash/closings", label: "Cash Closing",   roles: ["owner", "manager", "daily_manager", "accountant", "cashier"] },
      // Day's closing summary report — same page as Reports › POS › Cash
      // Closing. Management view, so narrower than the Cash group's roles.
      { kind: "leaf", to: "/cash/closing-summary", label: "Closing Summary", roles: REPORT_ROLES },
      { kind: "leaf", to: "/cash/petty",    label: "Petty Expenses", roles: [...PETTY_QUEUE_ROLES, "accountant"] },
      { kind: "leaf", to: "/cash/petty/mine", label: "My Expenses",  roles: ["owner", "manager", "daily_manager", "cashier"] },
    ],
  },
  {
    // Finance — back-office money movement and reporting (bank-side).
    // Routes stay under /cash/* ; only the menu grouping changed.
    kind: "group",
    id: "finance",
    label: "Finance",
    Icon: IconFinance,
    roles: REPORT_ROLES,
    children: [
      // Purchase invoices (Zoho Books Bills) — accounts payable register.
      { kind: "leaf", to: "/invoices",         label: "Invoices",    roles: REPORT_ROLES },
      { kind: "leaf", to: "/payments",         label: "Payments Inbox", roles: CASH_PAYMENTS_ROLES },
      { kind: "leaf", to: "/payments/create",  label: "Make a Payment", roles: CASH_PAYMENTS_ROLES },
      { kind: "leaf", to: "/payments/quotations", label: "Asset Quotations", roles: CASH_PAYMENTS_ROLES },
      { kind: "leaf", to: "/payments/advances", label: "Advances", roles: CASH_PAYMENTS_ROLES },
      { kind: "leaf", to: "/cash/payments",    label: "Payments (legacy)", roles: CASH_PAYMENTS_ROLES },
      { kind: "leaf", to: "/cash/settlements", label: "Settlements", roles: CASH_PAYMENTS_ROLES },
    ],
  },
  {
    // Project Management — renovations & capital projects. Visible to anyone
    // who can be assigned to a project; per-project edit rights are enforced
    // by RLS (only the owner + assigned members can tick).
    kind: "group",
    id: "project-management",
    label: "Project Management",
    Icon: IconProjects,
    roles: ENTRY_ROLES,
    children: [
      { kind: "leaf", to: "/projects/renovations", label: "Renovations", roles: ENTRY_ROLES },
    ],
  },
  {
    kind: "group",
    id: "settings",
    label: "Settings",
    Icon: IconSettings,
    roles: ["owner", "manager", "accountant"],
    children: [
      {
        // Box Office catalog — the films and the distributors they settle with.
        kind: "subgroup",
        id: "settings-box-office",
        label: "Box Office",
        roles: OWNER_MANAGER,
        children: [
          { kind: "leaf", to: "/settings/movies",       label: "Movies",       roles: OWNER_MANAGER },
          { kind: "leaf", to: "/settings/distributors", label: "Distributors", roles: OWNER_MANAGER },
        ],
      },
      { kind: "leaf", to: "/settings/screens", label: "Screens & Classes", roles: OWNER_MANAGER },
      { kind: "leaf", to: "/settings/tax",     label: "Tax & Rep Batta",   roles: OWNER_MANAGER },
      { kind: "leaf", to: "/settings/cash",    label: "Cash",              roles: ["owner", "accountant"] },
      { kind: "leaf", to: "/settings/payment-types", label: "Payment Types", roles: OWNER_ONLY },
      { kind: "leaf", to: "/settings/users",   label: "Users",             roles: OWNER_MANAGER },
      { kind: "leaf", to: "/settings/whatsapp", label: "WhatsApp",          roles: OWNER_ONLY },
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
      const kids: NavChild[] = [];
      for (const child of item.children) {
        if (!child.roles.includes(role)) continue;
        if (child.kind === "subgroup") {
          const subKids = child.children.filter((c) => c.roles.includes(role));
          if (subKids.length === 0) continue;
          kids.push({ ...child, children: subKids });
        } else {
          kids.push(child);
        }
      }
      if (kids.length === 0) continue;
      out.push({ ...item, children: kids });
    } else {
      out.push(item);
    }
  }
  return out;
}

/** Flatten a group's leaf routes, descending one level into subgroups. */
export function groupLeafTos(group: NavGroup): string[] {
  const tos: string[] = [];
  for (const c of group.children) {
    if (c.kind === "subgroup") tos.push(...c.children.map((l) => l.to));
    else tos.push(c.to);
  }
  return tos;
}

/** Human-readable label for the user's role (used in chrome footers, badges). */
export function roleLabel(role: Role): string {
  switch (role) {
    case "owner":         return "owner";
    case "manager":       return "manager";
    case "daily_manager": return "daily manager";
    case "accountant":    return "accountant";
    case "cashier":       return "cashier";
  }
}

/** Resolve the page title for a given pathname by matching the longest NAV prefix. */
export function titleForPath(pathname: string): string {
  // Guides lives outside the sidebar NAV (it's reached from the header).
  if (pathname === "/guides" || pathname.startsWith("/guides/")) return "Guides";
  const candidates: Array<[string, string]> = [];
  for (const item of NAV) {
    if (item.kind === "leaf") {
      candidates.push([item.to, item.label]);
    } else {
      candidates.push([`/${item.id}`, item.label]);
      for (const child of item.children) {
        if (child.kind === "subgroup") {
          for (const leaf of child.children) {
            candidates.push([leaf.to, `${item.label} · ${leaf.label}`]);
          }
        } else {
          candidates.push([child.to, `${item.label} · ${child.label}`]);
        }
      }
    }
  }
  const match = candidates
    .filter(([p]) => pathname.startsWith(p))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return match?.[1] ?? "Console";
}
