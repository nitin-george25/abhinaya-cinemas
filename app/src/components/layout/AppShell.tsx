import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { Header } from "./Header";
import { Fab } from "./Fab";
import type { Role } from "../../lib/hooks/useSupabaseSync";

interface Props {
  role: Role;
  children: ReactNode;
}

/**
 * Authenticated layout. Desktop: dark sidebar + light content. Mobile:
 * hamburger opens a slide-in drawer; FAB at bottom-right surfaces the
 * most-used actions.
 */
export function AppShell({ role, children }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen flex bg-paper">
      <Sidebar role={role} />
      <MobileNav role={role} open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header onMenuClick={() => setMenuOpen(true)} />
        <main
          className="flex-1 px-4 md:px-6 py-4 md:py-6 overflow-x-hidden"
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          {children}
        </main>
      </div>
      <Fab role={role} />
    </div>
  );
}
