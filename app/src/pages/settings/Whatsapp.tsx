// ============================================================================
// Route page: /settings/whatsapp — owner-only WhatsApp Cloud API config.
//
// Owner sets:
//   • Recipient phone (E.164, e.g. +919876543210)
//   • Auto-send on Last show of day toggle
//   • Template name + language
//
// "Send test message" composes a synthetic show and calls the live Edge
// Function so the operator can verify Meta credentials + template approval
// before going live.
// ============================================================================

import { useCallback, useEffect, useState } from "react";

import { useSync } from "../../lib/hooks/SyncContext";
import { getSupabase } from "../../lib/supabase";
import type { Cinema, WhatsappConfig } from "../../lib/types";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { DesktopBetterBanner } from "../../components/layout/DesktopBetterBanner";

const E164_RE = /^\+\d{8,15}$/;

export default function SettingsWhatsappPage() {
  const { state, setAppState } = useSync();
  const appState = state.appState;

  if (!appState || state.role !== "owner") {
    return (
      <Card>
        <CardBody className="text-sm text-ink-muted">
          WhatsApp settings can only be edited by the owner.
        </CardBody>
      </Card>
    );
  }

  const cinema: Cinema = appState.cinema;
  const wa: WhatsappConfig = cinema.whatsapp ?? {};

  function patchWa(patch: Partial<WhatsappConfig>) {
    const next: WhatsappConfig = { ...wa, ...patch };
    setAppState({
      ...appState!,
      cinema: { ...cinema, whatsapp: next },
    });
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <DesktopBetterBanner />
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight">WhatsApp</h2>
        <p className="text-sm text-ink-muted mt-1">
          Cloud API integration for after-show messages. Configure the
          recipient phone, enable auto-send on the last show of the day,
          and run a test to confirm credentials.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recipient &amp; template</CardTitle>
          <span className="text-xs text-ink-muted">stored in config.cinema.whatsapp</span>
        </CardHeader>
        <CardBody className="space-y-4">
          <Field label="Recipient phone (E.164)" hint='Include country code, e.g. "+919876543210". Only one number; forwards to a WhatsApp group are manual.'>
            <Input
              value={wa.recipient ?? ""}
              placeholder="+919876543210"
              onChange={(e) => patchWa({ recipient: e.target.value.trim() })}
              className="max-w-xs"
            />
            {wa.recipient && !E164_RE.test(wa.recipient) ? (
              <span className="block text-xs text-red-600 mt-1">
                Not a valid E.164 number (must start with + and 8–15 digits).
              </span>
            ) : null}
          </Field>

          <Field label="Template name" hint='Approved name in Meta Business Manager. Default "show_collection_v1".'>
            <Input
              value={wa.templateName ?? ""}
              placeholder="show_collection_v1"
              onChange={(e) => patchWa({ templateName: e.target.value.trim() })}
              className="max-w-xs"
            />
          </Field>

          <Field label="Template language" hint='ISO code. Default "en".'>
            <Input
              value={wa.templateLang ?? ""}
              placeholder="en"
              onChange={(e) => patchWa({ templateLang: e.target.value.trim() })}
              className="max-w-[120px]"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!wa.autoSendOnLastShow}
              onChange={(e) => patchWa({ autoSendOnLastShow: e.target.checked })}
            />
            Auto-send when "Last show of day" is ticked &amp; saved
          </label>
        </CardBody>
      </Card>

      <TestSendCard recipient={wa.recipient ?? ""} disabled={!E164_RE.test(wa.recipient ?? "")} />

      <RecentLogCard />
    </div>
  );
}

function TestSendCard({ recipient, disabled }: { recipient: string; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");

  async function runTest() {
    if (!recipient) return;
    setBusy(true);
    setResult("Sending…");
    try {
      const sb = getSupabase();
      const fn = await sb.functions.invoke("send-whatsapp-show", {
        body: {
          recipient,
          // Placeholder image (Meta requires a reachable URL on the template
          // header). Operator can swap this for a hosted test PNG.
          mediaUrl: "https://placehold.co/760x440/png?text=Abhinaya+Cinemas+Test",
          text: "Test message from Abhinaya Cinemas console.",
        },
      });
      if (fn.error) {
        const body = (fn.data as { error?: string } | null) ?? null;
        setResult(`Failed — ${body?.error ?? fn.error.message}`);
      } else {
        const out = fn.data as { ok?: boolean; messageId?: string; error?: string };
        setResult(out.ok
          ? `Sent ✓ (message id ${out.messageId ?? "—"})`
          : `Failed — ${out.error ?? "unknown"}`);
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
        <CardTitle>Send test message</CardTitle>
        <span className="text-xs text-ink-muted">Verifies env vars + template approval</span>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-ink-muted">
          Uses a placeholder image to confirm the round-trip to Meta. Check
          the recipient phone — the message should land within a few seconds.
        </p>
        <div className="flex items-center gap-3">
          <Button onClick={() => void runTest()} disabled={disabled || busy || !recipient}>
            {busy ? "Sending…" : "Send test"}
          </Button>
          {result ? <span className="text-sm text-ink-muted">{result}</span> : null}
        </div>
      </CardBody>
    </Card>
  );
}

interface LogRow {
  id: string;
  sent_at: string;
  recipient: string;
  status: string;
  meta_message_id: string | null;
  error: string | null;
  entry_date: string | null;
}

function RecentLogCard() {
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const sb = getSupabase();
      const r = await sb
        .from("whatsapp_log")
        .select("id, sent_at, recipient, status, meta_message_id, error, entry_date")
        .order("sent_at", { ascending: false })
        .limit(30);
      if (r.error) throw r.error;
      setRows((r.data as LogRow[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent sends</CardTitle>
        <Button size="sm" variant="ghost" onClick={() => void load()}>Refresh</Button>
      </CardHeader>
      <CardBody className="p-0">
        {error ? (
          <p className="px-5 py-4 text-sm text-red-700">{error}</p>
        ) : rows == null ? (
          <p className="px-5 py-4 text-sm text-ink-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-muted">No sends yet.</p>
        ) : (
          <ul>
            {rows.map((r) => (
              <li
                key={r.id}
                className="px-5 py-3 border-b border-line last:border-b-0 flex items-center justify-between gap-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="font-medium">
                    {r.recipient}
                    {r.entry_date ? <span className="text-ink-muted ml-2">· {r.entry_date}</span> : null}
                  </div>
                  <div className="text-xs text-ink-muted truncate">
                    {new Date(r.sent_at).toLocaleString("en-IN")}
                    {r.error ? <> · {r.error}</> : null}
                  </div>
                </div>
                <Badge tone={r.status === "sent" ? "green" : "red"}>
                  {r.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
