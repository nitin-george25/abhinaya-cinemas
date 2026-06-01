import { useLocation } from "react-router-dom";
import { useSync } from "../../lib/hooks/SyncContext";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { IconAlert, IconCheck, IconSignOut, IconSpinner } from "../icons";
import { getEnv } from "../../lib/supabase";
import { titleForPath } from "../../lib/nav";

interface Props {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: Props) {
  const { state, signOut } = useSync();
  const loc = useLocation();
  const title = titleForPath(loc.pathname);

  const env = (() => { try { return getEnv().name; } catch { return null; } })();

  return (
    <header className="border-b border-line bg-paper-card">
      <div className="px-4 md:px-6 h-14 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onMenuClick}
            aria-label="Open menu"
            className="md:hidden -ml-2 p-2 rounded-md text-ink-muted hover:text-ink active:bg-line/40"
          >
            <HamburgerIcon />
          </button>
          <h1 className="font-semibold tracking-tight text-base truncate">{title}</h1>
          {env === "staging" ? (
            <Badge tone="amber" className="shrink-0">TEST</Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-2 md:gap-3 shrink-0">
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

function HamburgerIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      className="w-5 h-5"
    >
      <path d="M3 6h14M3 10h14M3 14h14" />
    </svg>
  );
}

function SyncPill() {
  const { state } = useSync();
  if (state.saveState === "saving") {
    return (
      <Badge tone="amber" className="gap-1.5">
        <IconSpinner className="w-3 h-3" />
        <span className="hidden sm:inline">Saving…</span>
      </Badge>
    );
  }
  if (state.saveState === "error") {
    return (
      <Badge tone="red" className="gap-1.5">
        <IconAlert className="w-3 h-3" />
        <span className="hidden sm:inline">Sync error</span>
      </Badge>
    );
  }
  return (
    <Badge tone="green" className="gap-1.5">
      <IconCheck className="w-3 h-3" />
      <span className="hidden sm:inline">Synced</span>
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
