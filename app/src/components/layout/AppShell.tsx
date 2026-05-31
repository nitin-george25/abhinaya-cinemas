import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import type { Role } from "../../lib/hooks/useSupabaseSync";

interface Props {
  role: Role;
  children: ReactNode;
}

/**
 * The authenticated layout. Dark sidebar + light content area, the
 * Sellora-style "internal dashboard" composition we picked in C0.
 */
export function AppShell({ role, children }: Props) {
  return (
    <div className="min-h-screen flex bg-paper">
      <Sidebar role={role} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 px-6 py-6 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
