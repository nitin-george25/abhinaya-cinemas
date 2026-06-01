import { useState, type FormEvent, type ReactNode } from "react";
import { useSync } from "../../lib/hooks/SyncContext";
import { Button } from "../ui/Button";
import { Input, Field } from "../ui/Input";
import { IconSpinner } from "../icons";
import { getEnv } from "../../lib/supabase";
import { signInWithUsername } from "../../lib/users";
import { cn } from "../ui/cn";

interface Props {
  message?: string;
}

/**
 * Full-page sign-in. Two methods, tabbed:
 *   • Google OAuth (existing flow — for staff with @abhinayacinemas.com)
 *   • Username + 6-digit PIN (created by the owner in Settings → Users)
 *
 * The brand chrome (three coloured bars + "ABHINAYA CINEMAS" / "Daily
 * Collection Report") wraps both tabs so it always reads as the same app.
 */
export function SignInScreen({ message }: Props) {
  const [tab, setTab] = useState<"google" | "username">("google");
  const env = (() => { try { return getEnv().name; } catch { return null; } })();

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink text-white px-6">
      <div className="max-w-sm w-full text-center">
        <div className="flex justify-center gap-1.5 mb-5">
          <i className="inline-block w-2.5 h-9 rounded-sm bg-red-500" />
          <i className="inline-block w-2.5 h-9 rounded-sm bg-amber-400" />
          <i className="inline-block w-2.5 h-9 rounded-sm bg-blue-500" />
        </div>
        <h1 className="font-display text-3xl font-bold tracking-wide">ABHINAYA CINEMAS</h1>
        <p className="text-sm text-white/60 mt-1">Daily Collection Report</p>

        {message ? (
          <p className="text-amber-400 text-sm mt-6 leading-relaxed">{message}</p>
        ) : null}

        {/* Tab switcher */}
        <div className="mt-8 inline-flex rounded-lg bg-white/5 p-1 text-sm">
          <TabBtn active={tab === "google"}   onClick={() => setTab("google")}>Google</TabBtn>
          <TabBtn active={tab === "username"} onClick={() => setTab("username")}>Username</TabBtn>
        </div>

        <div className="mt-5">
          {tab === "google" ? <GoogleTab env={env} /> : <UsernameTab />}
        </div>

        {env === "staging" ? (
          <p className="text-xs text-white/40 mt-6">
            Test environment — changes here do not affect live data.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-4 py-1.5 rounded-md font-medium transition-colors",
        active
          ? "bg-white text-ink"
          : "text-white/70 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

// ── Google tab ─────────────────────────────────────────────────────────

function GoogleTab({ env }: { env: "prod" | "staging" | null }) {
  const { signIn } = useSync();
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      const redirectTo =
        env === "prod"
          ? "https://www.abhinayacinemas.com/v2/"
          : location.origin + "/v2/";
      await signIn(redirectTo);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button onClick={go} disabled={busy} variant="secondary" className="w-full">
      {busy ? <IconSpinner className="w-4 h-4" /> : null}
      Sign in with Google
    </Button>
  );
}

// ── Username + PIN tab ─────────────────────────────────────────────────

function UsernameTab() {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await signInWithUsername(username, pin);
      if (!res.ok) setError(res.error ?? "Sign-in failed.");
      // On success, useSupabaseSync's onAuthStateChange fires and routes us
      // into the app — nothing else to do here.
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={go} className="space-y-3 text-left">
      <Field label="Username">
        <Input
          autoFocus
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. ramu"
          className="bg-white/95 text-ink"
        />
      </Field>
      <Field label="6-digit PIN">
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="••••••"
          className="bg-white/95 text-ink tabular-nums tracking-[0.4em] text-center text-base"
        />
      </Field>

      {error ? (
        <p className="text-amber-400 text-sm leading-snug">{error}</p>
      ) : null}

      <Button
        type="submit"
        disabled={busy || !username || pin.length !== 6}
        className="w-full"
      >
        {busy ? <IconSpinner className="w-4 h-4" /> : null}
        Sign in
      </Button>

      <p className="text-xs text-white/50 text-center">
        Ask the owner if you don't have a username yet.
      </p>
    </form>
  );
}
