// ============================================================================
// Route page: /settings/notifications — owner-only digest email recipients.
//
// Recipients for the four scheduled digests used to live only in Supabase
// secrets (DIGEST_TO / PM_DIGEST_TO), so changing who gets the morning cash
// email meant CLI access. They now live in the config blob at
// config.cinema.digests.<key>, which the Edge Functions read via
// supabase/functions/_shared/digest-recipients.ts.
//
// Resolution order in the functions (first non-empty wins):
//   ?to= test override  >  the list on this page  >  the env var  >  hardcoded
//
// So an empty list here is not "send to nobody" — it means "keep doing whatever
// you were doing before this page existed". That is deliberate: it makes the
// page safe to ship without first migrating every environment's secrets.
//
// "Send test" invokes the live function with a `to` of just the signed-in user,
// which bypasses both the saved list and the enabled switch. It sends a REAL
// email so the whole path (config -> function -> Resend) is proven end to end.
// ============================================================================

import { useState } from "react";

import { useSync } from "../../lib/hooks/SyncContext";
import { getSupabase } from "../../lib/supabase";
import type { Cinema, DigestChannelConfig, DigestsConfig } from "../../lib/types";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Field } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { DesktopBetterBanner } from "../../components/layout/DesktopBetterBanner";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Keys must match DigestKey in supabase/functions/_shared/digest-recipients.ts. */
type DigestKey = keyof DigestsConfig;

interface DigestMeta {
  key: DigestKey;
  /** Edge Function name, used by the Send test button. */
  fn: string;
  label: string;
  schedule: string;
  blurb: string;
  /** Which env var still applies while the list below is empty. */
  envVar: string;
}

const DIGESTS: DigestMeta[] = [
  {
    key: "cashClosing",
    fn: "cash-closing-digest",
    label: "Cash closing",
    schedule: "7:00 AM daily",
    blurb:
      "Previous day's cash: sale, cash to bank, discrepancy, per-unit and per-cashier breakdown, petty expenses.",
    envVar: "CASH_DIGEST_TO",
  },
  {
    key: "daily",
    fn: "daily-digest",
    label: "DCR daily digest",
    schedule: "10:00 AM daily",
    blurb: "Previous day's box office collection and F&B, with 7-day averages.",
    envVar: "DIGEST_TO",
  },
  {
    key: "weekly",
    fn: "weekly-digest",
    label: "Weekly digest",
    schedule: "11:00 AM Mondays",
    blurb: "Last Mon–Sun week versus the week before.",
    envVar: "DIGEST_TO",
  },
  {
    key: "pm",
    fn: "pm-digest",
    label: "Project management",
    schedule: "9:30 AM daily · 9:45 AM Mondays",
    blurb:
      "Active project status. Normally routed per project team — a list here OVERRIDES that and sends every project to these addresses instead.",
    envVar: "PM_DIGEST_TO",
  },
];

/** Textarea styling matched to the Input primitive's fieldBase. */
const TEXTAREA_CLASS =
  "block w-full rounded-lg border border-line bg-white px-3 py-2 text-base sm:text-sm " +
  "placeholder:text-ink-muted text-ink " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400/60 focus:border-amber-400";

/** One address per line in the box; stored as a string[]. */
function parseAddresses(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function SettingsNotificationsPage() {
  const { state, setAppState } = useSync();
  const appState = state.appState;

  if (!appState || state.role !== "owner") {
    return (
      <Card>
        <CardBody className="text-sm text-ink-muted">
          Notification settings can only be edited by the owner.
        </CardBody>
      </Card>
    );
  }

  const cinema: Cinema = appState.cinema;
  const digests: DigestsConfig = cinema.digests ?? {};

  function patchDigest(key: DigestKey, patch: Partial<DigestChannelConfig>) {
    const current: DigestChannelConfig = digests[key] ?? {};
    // Assign after the spread rather than using a computed key inside it —
    // a union-typed computed key widens the object past DigestsConfig.
    const next: DigestsConfig = { ...digests };
    next[key] = { ...current, ...patch };
    setAppState({
      ...appState!,
      cinema: { ...cinema, digests: next },
    });
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <DesktopBetterBanner />
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight">Notifications</h2>
        <p className="text-sm text-ink-muted mt-1">
          Who receives each scheduled digest email, and whether it goes out at
          all. Changes take effect on the next scheduled run — no redeploy
          needed.
        </p>
      </div>

      <Card>
        <CardBody className="text-sm text-ink-muted space-y-2">
          <p>
            Leaving a list empty does <strong>not</strong> stop the email. An
            empty list falls back to the environment variable configured in
            Supabase, and then to the built-in default list. To stop a digest,
            untick <em>Enabled</em>.
          </p>
          <p>
            <strong>Send test</strong> emails only you, ignoring both the saved
            list and the enabled switch. It is a real send, so it also confirms
            Resend is working.
          </p>
        </CardBody>
      </Card>

      {DIGESTS.map((d) => (
        <DigestCard
          key={d.key}
          meta={d}
          cfg={digests[d.key] ?? {}}
          myEmail={state.email ?? ""}
          onPatch={(patch) => patchDigest(d.key, patch)}
        />
      ))}
    </div>
  );
}

function DigestCard({
  meta,
  cfg,
  myEmail,
  onPatch,
}: {
  meta: DigestMeta;
  cfg: DigestChannelConfig;
  myEmail: string;
  onPatch: (patch: Partial<DigestChannelConfig>) => void;
}) {
  // Local text state so the operator can type freely (including blank lines)
  // without every keystroke rewriting the stored array.
  const [raw, setRaw] = useState<string>((cfg.to ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");

  const enabled = cfg.enabled !== false;
  const addresses = parseAddresses(raw);
  const invalid = addresses.filter((a) => !EMAIL_RE.test(a));

  function commit() {
    // Only write on blur, and only when something actually changed.
    const next = parseAddresses(raw);
    const prev = cfg.to ?? [];
    if (next.length === prev.length && next.every((a, i) => a === prev[i])) return;
    onPatch({ to: next });
  }

  async function sendTest() {
    if (!myEmail) return;
    setBusy(true);
    setResult("Sending…");
    try {
      const sb = getSupabase();
      const fn = await sb.functions.invoke(meta.fn, { body: { to: myEmail } });
      if (fn.error) {
        setResult(`Failed — ${fn.error.message}`);
      } else {
        const out = fn.data as { ok?: boolean; sentTo?: string[]; skipped?: string } | null;
        if (out?.skipped) setResult(`Skipped — ${out.skipped}`);
        else if (out?.ok) setResult(`Sent ✓ to ${(out.sentTo ?? [myEmail]).join(", ")}`);
        else setResult("Sent — no confirmation returned");
      }
    } catch (e) {
      setResult(`Failed — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{meta.label}</CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-muted">{meta.schedule}</span>
          {enabled ? <Badge tone="green">On</Badge> : <Badge tone="neutral">Off</Badge>}
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-ink-muted">{meta.blurb}</p>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onPatch({ enabled: e.target.checked })}
          />
          Enabled — send this digest on schedule
        </label>

        <Field
          label="Recipients"
          hint="One email address per line. Leave empty to keep using the Supabase env var."
        >
          <textarea
            className={TEXTAREA_CLASS}
            rows={3}
            spellCheck={false}
            value={raw}
            placeholder={`someone@abhinayacinemas.com\nsomeone.else@abhinayacinemas.com`}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={commit}
          />
          {invalid.length ? (
            <span className="block text-xs text-red-600 mt-1">
              Not a valid email address: {invalid.join(", ")}
            </span>
          ) : null}
          {addresses.length === 0 ? (
            <span className="block text-xs text-ink-muted mt-1">
              Empty — falling back to {meta.envVar}, then the built-in default list.
            </span>
          ) : (
            <span className="block text-xs text-ink-muted mt-1">
              {addresses.length} recipient{addresses.length === 1 ? "" : "s"}.
            </span>
          )}
        </Field>

        <div className="flex items-center gap-3">
          <Button onClick={() => void sendTest()} disabled={busy || !myEmail}>
            {busy ? "Sending…" : "Send test to me"}
          </Button>
          {result ? <span className="text-sm text-ink-muted">{result}</span> : null}
        </div>
      </CardBody>
    </Card>
  );
}
