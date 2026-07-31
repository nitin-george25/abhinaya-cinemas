// ============================================================================
// Sidebar — desktop-only dark nav (hidden on < md). Mobile uses MobileNav.tsx.
//
// Retracts to a 64px icon rail and opens to the full 240px column on hover,
// closing again when the pointer leaves. The open panel OVERLAYS the content
// rather than pushing it: the rail keeps its width in the layout, so the page
// underneath never reflows as the pointer crosses the nav.
//
// Hover alone would strand keyboard users, so focus moving into the nav opens
// it too, and the footer carries a pin that locks it open. The pin is
// remembered across sessions — someone who wants a permanent nav should say so
// once, not every visit.
// ============================================================================

import { useMemo, useState, useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "../ui/cn";
import { IconChevronDown, IconSidebar } from "../icons";
import { NAV, filterForRole, groupLeafTos, roleLabel, type NavGroup, type NavLeaf, type NavSubGroup } from "../../lib/nav";
import type { Role } from "../../lib/hooks/useSupabaseSync";

const PIN_KEY = "ac.sidebar.pinned";

function readPinned(): boolean {
  try {
    return localStorage.getItem(PIN_KEY) === "1";
  } catch {
    // Private mode / storage disabled — start from the rail.
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

  const [pinned, setPinned] = useState(readPinned);
  const [hovering, setHovering] = useState(false);
  const open = pinned || hovering;

  useEffect(() => {
    try {
      localStorage.setItem(PIN_KEY, pinned ? "1" : "0");
    } catch {
      // Not being able to remember the preference is not worth failing over.
    }
  }, [pinned]);

  return (
    // The spacer holds the rail's width in the layout; the fixed panel is what
    // actually grows, over the content. `hidden` also hides the panel, which
    // is how this stays desktop-only.
    <aside className={cn("hidden shrink-0 md:block", pinned ? "w-60" : "w-16")}>
      <div
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocusCapture={() => setHovering(true)}
        onBlurCapture={(e) => {
          // Only close once focus has actually left the nav — moving between
          // its own links fires blur too.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setHovering(false);
          }
        }}
        className={cn(
          // Fixed to the viewport, so the nav (and its pin) stay reachable on
          // a long page instead of scrolling away with the content.
          "fixed inset-y-0 left-0 z-30 flex flex-col overflow-hidden bg-ink text-white",
          "transition-[width] duration-200 ease-out",
          open ? "w-60" : "w-16",
          !pinned && hovering ? "shadow-2xl shadow-black/40" : null,
        )}
      >
        <div
          className={cn(
            "h-14 flex items-center gap-3 border-b border-white/10 shrink-0",
            open ? "px-5" : "justify-center px-0",
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
          {open ? (
            <div className="leading-tight min-w-0">
              <div className="font-display text-[13px] font-bold tracking-wider truncate">ABHINAYA</div>
              <div className="text-[10px] text-white/50 tracking-wider truncate">CINEMAS · CONSOLE</div>
            </div>
          ) : null}
        </div>

        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3">
          {visible.map((item) =>
            item.kind === "leaf" ? (
              <LeafLink key={item.to} item={item} collapsed={!open} />
            ) : (
              <Group
                key={item.id}
                group={item}
                collapsed={!open}
                open={open && openId === item.id}
                onToggle={() =>
                  setOpenId((p) => (p === item.id ? null : item.id))
                }
              />
            ),
          )}
        </nav>

        <div
          className={cn(
            "flex items-center gap-2 border-t border-white/10 py-3",
            open ? "px-5" : "justify-center px-0",
          )}
        >
          {open ? (
            <span className="flex-1 truncate text-[10px] uppercase tracking-wider text-white/30">
              v2 preview · {roleLabel(role)}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setPinned((p) => !p)}
            title={pinned ? "Unpin menu" : "Keep menu open"}
            aria-label={pinned ? "Unpin menu" : "Keep menu open"}
            aria-pressed={pinned}
            className={cn(
              "shrink-0 rounded-md p-1.5 transition-colors hover:bg-white/5 hover:text-white",
              pinned ? "text-amber-300" : "text-white/40",
            )}
          >
            <IconSidebar className="w-4 h-4" />
          </button>
        </div>
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
