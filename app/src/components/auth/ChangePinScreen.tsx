import { useState, type FormEvent } from "react";
import { useSync } from "../../lib/hooks/SyncContext";
import { Button } from "../ui/Button";
import { Input, Field } from "../ui/Input";
import { changeOwnPin, PIN_RE } from "../../lib/users";

/**
 * Forced PIN change — shown instead of the app when the signed-in user is
 * still on the PIN the owner/manager issued them (authorized_users.
 * must_change_pin). Same dark-page / white-card chrome as SignInScreen.
 *
 * The user picks their own 6-digit PIN (typed twice). On success the DB
 * flag is cleared by changeOwnPin() and markPinChanged() releases the
 * gate in App.tsx without a full re-boot.
 */
export function ChangePinScreen() {
  const { state, signOut, markPinChanged } = useSync();
  const [pin, setPin]         = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!PIN_RE.test(pin)) {
      setErr("PIN must be exactly 6 digits.");
      return;
    }
    if (pin !== confirm) {
      setErr("PINs don't match — type the same 6 digits in both fields.");
      return;
    }
    setBusy(true);
    const res = await changeOwnPin(pin);
    setBusy(false);
    if (!res.ok) {
      setErr(res.error ?? "Could not change the PIN. Try again.");
      return;
    }
    markPinChanged();
  }

  return (
    <div className="min-h-screen relative overflow-hidden bg-ink text-white">
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
        <div className="flex flex-col items-center text-center mb-6">
          <img
            src="/img/logomark-white.png"
            alt="Abhinaya Cinemas"
            className="h-16 w-auto mb-3"
          />
          <p className="text-sm text-white/55 tracking-wide">
            Daily Collection Report Console
          </p>
        </div>

        <div className="w-full max-w-sm bg-white text-ink rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex h-1">
            <div className="flex-1 bg-red-500" />
            <div className="flex-1 bg-amber-400" />
            <div className="flex-1 bg-blue-500" />
          </div>

          <form className="px-7 py-7 space-y-5" onSubmit={(e) => void onSubmit(e)}>
            <div className="text-center">
              <h2 className="font-display text-xl font-bold tracking-tight">
                Choose your PIN
              </h2>
              <p className="text-sm text-ink-muted mt-1">
                {state.fullName ? `Hi ${state.fullName.split(" ")[0]} — you` : "You"}
                {"'re"} signed in with a PIN that was set for you. Pick your
                own 6-digit PIN before continuing.
              </p>
            </div>

            <Field label="New 6-digit PIN">
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="••••••"
                autoFocus
              />
            </Field>
            <Field label="Type it again">
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))}
                placeholder="••••••"
              />
            </Field>

            {err ? <div className="text-sm text-red-600">{err}</div> : null}

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Saving…" : "Set PIN and continue"}
            </Button>

            <button
              type="button"
              className="block text-xs text-ink-muted underline mx-auto"
              onClick={() => { void signOut(); }}
            >
              Sign out instead
            </button>
          </form>
        </div>

        <div className="mt-6 text-center text-xs">
          <p className="text-white/35">© Abhinaya Cinemas · Changanacherry</p>
        </div>
      </div>
    </div>
  );
}
