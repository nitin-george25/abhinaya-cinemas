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
 * Sign-in. Dark page → white card → logo + form. Two tabs:
 *   • Google OAuth  — for staff with @abhinayacinemas.com
 *   • Username + 6-digit PIN — created by the owner in Settings → Users
 *
 * The white-logomark mark + "ABHINAYA CINEMAS" wordmark sit above the
 * card on the dark page; the form lives inside a white card so the
 * coloured wordmark logo doesn't need a dark variant.
 */
export function SignInScreen({ message }: Props) {
  const [tab, setTab] = useState<"google" | "username">("google");
  const env = (() => { try { return getEnv().name; } catch { return null; } })();

  return (
    <div className="min-h-screen relative overflow-hidden bg-ink text-white">
      {/* Soft decorative glow behind the card. Pure visual sugar — no
       *  semantic meaning, hidden from screen readers via aria-hidden. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{
          background:
            "radial-gradient(800px 400px at 50% 35%, rgba(247,182,31,0.18), transparent 60%)," +
            "radial-gradient(600px 300px at 50% 75%, rgba(52,136,192,0.14), transparent 70%)",
        }}
      />

      <div className="relative min-h-screen flex flex-col items-center justify-center px-4 py-10">
        {/* Brand chrome — sits ABOVE the card. The cream logomark reads
         *  cleanly on dark; the tagline is the only text up here. */}
        <div className="flex flex-col items-center text-center mb-6">
          <img
            src="/v2/img/logomark-white.png"
            alt="Abhinaya Cinemas"
            className="h-16 w-auto mb-3"
          />
          <p className="text-sm text-white/55 tracking-wide">
            Daily Collection Report Console
          </p>
        </div>

        {/* The card */}
        <div className="w-full max-w-sm bg-white text-ink rounded-2xl shadow-2xl overflow-hidden">
          {/* Color stripe — brand accent at the top of the card */}
          <div className="flex h-1">
            <div className="flex-1 bg-red-500" />
            <div className="flex-1 bg-amber-400" />
            <div className="flex-1 bg-blue-500" />
          </div>

          <div className="px-7 py-7 space-y-5">
            {/* Full color wordmark inside the card — works on white */}
            <img
              src="/v2/img/logo-color.png"
              alt="Abhinaya Cinemas"
              className="h-10 w-auto mx-auto"
            />
            <div className="text-center">
              <h2 className="font-display text-xl font-bold tracking-tight">
                Sign in
              </h2>
              <p className="text-sm text-ink-muted mt-1">
                Choose how you'd like to log in.
              </p>
            </div>

            {message ? (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-ink-soft">
                {message}
              </div>
            ) : null}

            {/* Tabs */}
            <div className="inline-flex w-full rounded-lg bg-paper p-1 text-sm border border-line">
              <TabBtn active={tab === "google"}   onClick={() => setTab("google")}>
                Google
              </TabBtn>
              <TabBtn active={tab === "username"} onClick={() => setTab("username")}>
                Username
              </TabBtn>
            </div>

            {tab === "google" ? <GoogleTab env={env} /> : <UsernameTab />}
          </div>
        </div>

        {/* Footer captions BELOW the card */}
        <div className="mt-6 text-center text-xs">
          {env === "staging" ? (
            <p className="text-amber-400 tracking-wider font-medium">
              ● TEST ENVIRONMENT — changes here don't affect live data
            </p>
          ) : (
            <p className="text-white/35">© Abhinaya Cinemas · Changanacherry</p>
          )}
        </div>
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
        "flex-1 px-3 py-1.5 rounded-md font-medium transition-colors",
        active
          ? "bg-white text-ink shadow-sm"
          : "text-ink-muted hover:text-ink",
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
    <div className="space-y-3">
      <Button
        onClick={go}
        disabled={busy}
        variant="primary"
        className="w-full"
      >
        {busy ? <IconSpinner className="w-4 h-4" /> : <GoogleGlyph />}
        Continue with Google
      </Button>
      <p className="text-xs text-ink-muted text-center leading-snug">
        Use your <span className="font-medium">@abhinayacinemas.com</span> Google
        account. Ask the owner to add you if you don't have access yet.
      </p>
    </div>
  );
}

function GoogleGlyph() {
  // Minimal Google "G" glyph as inline SVG. Could swap for the official
  // multi-coloured G later, but this monochrome version sits cleanly inside
  // the dark primary button.
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden>
      <path
        fill="currentColor"
        d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.3c1.9-1.8 3-4.4 3-7.3z M12 22c2.7 0 5-.9 6.7-2.5l-3.3-2.5c-.9.6-2.1 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1H3v2.6A10 10 0 0 0 12 22z M6.4 13.9a6 6 0 0 1 0-3.8V7.6H3a10 10 0 0 0 0 8.9l3.4-2.6z M12 6.4c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3 7.5l3.4 2.6c.8-2.4 3-4.1 5.6-4.1z"
      />
    </svg>
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={go} className="space-y-3">
      <Field label="Username">
        <Input
          autoFocus
          autoComplete="username"
          autoCapitalize="off"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. ramu"
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
          className="tabular-nums tracking-[0.4em] text-center text-base"
        />
      </Field>

      {error ? (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <Button
        type="submit"
        disabled={busy || !username || pin.length !== 6}
        className="w-full"
      >
        {busy ? <IconSpinner className="w-4 h-4" /> : null}
        Sign in
      </Button>

      <p className="text-xs text-ink-muted text-center leading-snug">
        Ask the owner if you don't have a username yet.
      </p>
    </form>
  );
}
