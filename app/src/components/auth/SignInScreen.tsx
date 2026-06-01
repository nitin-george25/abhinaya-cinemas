import { useState } from "react";
import { useSync } from "../../lib/hooks/SyncContext";
import { Button } from "../ui/Button";
import { IconSpinner } from "../icons";
import { getEnv } from "../../lib/supabase";

interface Props {
  message?: string;
}

/**
 * Full-page sign-in. Echoes the visual chrome of the legacy login overlay:
 * the three coloured bars + "ABHINAYA CINEMAS" / "Daily Collection Report"
 * heading, then a single Google sign-in button.
 */
export function SignInScreen({ message }: Props) {
  const { signIn } = useSync();
  const [busy, setBusy] = useState(false);
  const env = (() => {
    try { return getEnv().name; } catch { return null; }
  })();

  async function go() {
    setBusy(true);
    try {
      // On prod, send users to the prod URL post-OAuth. Everywhere else,
      // stay on the same hostname.
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

        <Button
          onClick={go}
          disabled={busy}
          variant="secondary"
          className="mt-8 w-full"
        >
          {busy ? <IconSpinner className="w-4 h-4" /> : null}
          Sign in with Google
        </Button>

        {env === "staging" ? (
          <p className="text-xs text-white/40 mt-6">
            Test environment — changes here do not affect live data.
          </p>
        ) : null}
      </div>
    </div>
  );
}
