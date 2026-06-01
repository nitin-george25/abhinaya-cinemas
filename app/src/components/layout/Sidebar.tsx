import { NavLink } from "react-router-dom";
import { cn } from "../ui/cn";
import {
  IconDashboard,
  IconEntry,
  IconHistory,
  IconFB,
  IconActivity,
  IconBackup,
  IconSettings,
} from "../icons";
import type { Role } from "../../lib/hooks/useSupabaseSync";

interface NavItem {
  to: string;
  label: string;
  Icon: typeof IconDashboard;
  /** Roles allowed to see this nav item. */
  roles: Role[];
}

const ALL: Role[] = ["owner", "manager", "accountant"];

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard",    Icon: IconDashboard, roles: ["owner", "manager"] },
  { to: "/entry",     label: "Entry",        Icon: IconEntry,     roles: ["owner", "manager"] },
  { to: "/history",   label: "History",      Icon: IconHistory,   roles: ALL },
  { to: "/fb",        label: "F&B",          Icon: IconFB,        roles: ["owner", "manager"] },
  { to: "/activity",  label: "Activity Log", Icon: IconActivity,  roles: ["owner", "manager"] },
  { to: "/backup",    label: "Backup",       Icon: IconBackup,    roles: ["owner", "manager"] },
  { to: "/settings",  label: "Settings",     Icon: IconSettings,  roles: ["owner"] },
];

export function Sidebar({ role }: { role: Role }) {
  const visible = NAV.filter((n) => n.roles.includes(role));
  return (
    <aside className="hidden md:flex md:flex-col w-60 shrink-0 bg-ink text-white">
      {/* Brand — fixed h-14 to match the header's height so the bottom edge
       *  of this block and the bottom edge of the header sit on the same
       *  baseline. Logo bumped to h-10 to fill the row with more presence. */}
      <div className="h-14 px-5 flex items-center gap-3 border-b border-white/10 shrink-0">
        <img
          src="/admin/dcr/img/logomark-white.png"
          alt="Abhinaya Cinemas"
          className="h-10 w-auto shrink-0"
        />
        <div className="leading-tight min-w-0">
          <div className="font-display text-[13px] font-bold tracking-wider truncate">ABHINAYA</div>
          <div className="text-[10px] text-white/50 tracking-wider truncate">CINEMAS · CONSOLE</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3">
        {visible.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 mx-2 px-3 py-2 rounded-lg text-sm",
                "transition-colors",
                isActive
                  ? "bg-amber-400/15 text-amber-300"
                  : "text-white/70 hover:text-white hover:bg-white/5",
              )
            }
          >
            <Icon className="w-4 h-4" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer caption */}
      <div className="px-5 py-3 border-t border-white/10 text-[10px] uppercase tracking-wider text-white/30">
        v2 preview · {role}
      </div>
    </aside>
  );
}
