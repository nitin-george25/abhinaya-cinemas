import { useLocation } from "react-router-dom";
import { useSync } from "../../lib/hooks/SyncContext";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { IconAlert, IconCheck, IconSignOut, IconSpinner } from "../icons";
import { getEnv } from "../../lib/supabase";

const ROUTE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/entry":     "Today's entry",
  "/history":   "History",
  "/fb":        "F&B sales",
  "/activity":  "Activity log",
  "/backup":    "Backup",
  "/settings":  "Settings",
};

export function Header() {
  const { state, signOut } = useSync();
  const loc = useLocation();
  // Match the longest known prefix — sub-routes keep the parent's title.
  const title =
    Object.entries(ROUTE_TITLES)
      .filter(([p]) => loc.pathname.startsWith(p))
      .sort((a, b) => b[0].length - a[0].length)[0]?.[1] ?? "Console";

  const env = (() => { try { return getEnv().name; } catch { return null; } })();

  return (
    <header className="border-b border-line bg-paper-card">
      <div className="px-6 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="font-semibold tracking-tight text-base truncate">{title}</h1>
          {env === "staging" ? (
            <Badge tone="amber" className="shrink-0">TEST</Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <SyncPill />
          <UserMenu
            label={state.fullName ?? state.username ?? state.email}
            onSignOut={signOut}
          />
        </div>
      </div>
    </header>
  );
}

function SyncPill() {
  const { state } = useSync();
  if (state.saveState === "saving") {
    return (
      <Badge tone="amber" className="gap-1.5">
        <IconSpinner className="w-3 h-3" />
        Saving…
      </Badge>
    );
  }
  if (state.saveState === "error") {
    return (
      <Badge tone="red" className="gap-1.5">
        <IconAlert className="w-3 h-3" />
        Sync error
      </Badge>
    );
  }
  return (
    <Badge tone="green" className="gap-1.5">
      <IconCheck className="w-3 h-3" />
      Synced
    </Badge>
  );
}

function UserMenu({
  label,
  onSignOut,
}: {
  label: string | null;
  onSignOut: () => Promise<void>;
}) {
  if (!label) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-ink-muted hidden sm:inline truncate max-w-[200px]">
        {label}
      </span>
      <Button
        size="sm"
        variant="ghost"
        title="Sign out"
        onClick={() => { void onSignOut(); }}
      >
        <IconSignOut className="w-4 h-4" />
      </Button>
    </div>
  );
}
