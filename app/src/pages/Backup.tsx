// ============================================================================
// Backup — manual JSON snapshot of the full cloud state.
//
// Why this exists even though everything is in Supabase: cheap insurance.
// One click and you've got a portable JSON file of every entry, every F&B
// day, every config record. If a bad import or schema migration wipes
// data, you import it back and the next push deltas put it back in the
// cloud.
//
// Export = anyone authorized. Import = owner only (destructive).
// ============================================================================

import { useCallback, useState } from "react";

import { useSync } from "../lib/hooks/SyncContext";
import { todayIso } from "../lib/dates";
import type { AppState } from "../lib/types";

import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { DesktopBetterBanner } from "../components/layout/DesktopBetterBanner";

const LAST_EXPORT_KEY = "abhinaya_dcr_last_export";

export default function BackupPage() {
  const { state, setAppState } = useSync();
  const appState = state.appState;

  const [lastExport, setLastExport] = useState<string | null>(() => {
    try { return localStorage.getItem(LAST_EXPORT_KEY); } catch { return null; }
  });
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const onExport = useCallback(() => {
    if (!appState) return;
    const blob = new Blob([JSON.stringify(appState, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `abhinaya_dcr_backup_${todayIso()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 0);
    const now = new Date().toISOString();
    try { localStorage.setItem(LAST_EXPORT_KEY, now); } catch {}
    setLastExport(now);
  }, [appState]);

  function pickImport() {
    if (state.role !== "owner") {
      alert("Only the owner can import a backup. It replaces cloud data.");
      return;
    }
    setImportError(null);
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "application/json,.json";
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const parsed = JSON.parse(String(rd.result ?? "")) as Partial<AppState>;
          handleImport(parsed);
        } catch (e) {
          setImportError("That doesn't look like a valid backup file (couldn't parse JSON).");
        }
      };
      rd.onerror = () => setImportError("Couldn't read that file.");
      rd.readAsText(f);
    };
    inp.click();
  }

  function handleImport(parsed: Partial<AppState>) {
    if (!appState) return;
    // Basic shape check — must look at least vaguely like an AppState.
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.entries)) {
      setImportError(
        "This file is missing the expected fields. Pick a backup made from this app.",
      );
      return;
    }
    const summary = describe(parsed);
    if (
      !confirm(
        `Importing will REPLACE current cloud data with this file:\n\n` +
        `${summary}\n\n` +
        `Anything in the cloud that isn't in this file will be DELETED on next push.\n\n` +
        `Continue?`,
      )
    ) {
      return;
    }
    setImporting(true);
    // Merge over current state so we never accidentally produce an invalid
    // AppState (e.g. missing fbProducts). Fields present in the import win.
    const next: AppState = {
      ...appState,
      ...parsed,
      // Always keep the local draft (it's not in the snapshot).
      draft: appState.draft,
      // Guard the arrays against undefined.
      entries:    Array.isArray(parsed.entries)    ? parsed.entries    : [],
      fbEntries:  Array.isArray(parsed.fbEntries)  ? parsed.fbEntries  : [],
      fbProducts: Array.isArray(parsed.fbProducts) ? parsed.fbProducts : [],
    };
    setAppState(next);
    setImporting(false);
    setImportError(null);
    alert(
      "Imported. The cloud is being updated now — give it a few seconds and " +
      "check Activity or another device.",
    );
  }

  if (!appState) {
    return (
      <Card>
        <CardBody className="text-sm text-ink-muted">Loading cloud data…</CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <DesktopBetterBanner />
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight">Backup</h2>
        <p className="text-sm text-ink-muted mt-1">
          Export the full cloud snapshot as a JSON file. Owner can import
          a snapshot to restore.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Snapshot</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <LastExportLine iso={lastExport} />

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={onExport}>Export snapshot (.json)</Button>
            <Button
              variant="secondary"
              onClick={pickImport}
              disabled={state.role !== "owner" || importing}
              title={
                state.role === "owner"
                  ? "Import a backup — REPLACES cloud data"
                  : "Owner only"
              }
            >
              Import from file…
            </Button>
          </div>

          {importError ? (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {importError}
            </div>
          ) : null}

          <div className="rounded-lg bg-paper border border-line p-4 text-sm text-ink-muted">
            <p className="mb-1.5"><b>What's in the snapshot</b></p>
            <ul className="list-disc pl-5 space-y-0.5 text-[13px]">
              <li>Cinema config, tax rates, screens, classes, price cards</li>
              <li>Movies + serial starts + opening balances</li>
              <li>Every BO entry (every show, every ticket count)</li>
              <li>Every F&amp;B day (summary + items)</li>
              <li>F&amp;B product catalog</li>
            </ul>
            <p className="text-[12px] mt-2">
              Excluded: auth users (managed in Supabase), local drafts.
            </p>
          </div>
        </CardBody>
      </Card>

      <CountsCard state={appState} />
    </div>
  );
}

// ── last-export indicator (red / amber / green) ────────────────────────

function LastExportLine({ iso }: { iso: string | null }) {
  if (!iso) {
    return (
      <p className="flex items-center gap-2 text-sm">
        <span className="text-red-600">●</span>
        <b>You haven't exported a backup yet.</b>
      </p>
    );
  }
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const now = new Date();
  const diffH = (now.getTime() - then.getTime()) / 3_600_000;
  const diffD = Math.floor(diffH / 24);

  let tone: "green" | "amber" | "red" = "green";
  let label: string;
  if (diffH < 24) {
    label = `Last exported today (${then.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })})`;
  } else if (diffD === 1) {
    label = "Last exported yesterday";
  } else if (diffD < 8) {
    label = `Last exported ${diffD} days ago`;
    tone = "amber";
  } else {
    label = `Last exported ${diffD} days ago — please back up soon`;
    tone = "red";
  }

  const dot =
    tone === "green" ? "text-green-700" :
    tone === "amber" ? "text-amber-600" :
    "text-red-600";
  return (
    <p className="flex items-center gap-2 text-sm">
      <span className={dot}>●</span>
      <span className={tone === "red" ? "font-medium text-red-700" : ""}>{label}</span>
    </p>
  );
}

// ── counts (handy sanity check before export) ──────────────────────────

function CountsCard({ state }: { state: AppState }) {
  const fbItemCount = (state.fbEntries ?? []).reduce(
    (a, e) => a + (e.items?.length ?? 0),
    0,
  );
  const rows: Array<[string, number]> = [
    ["Movies",        (state.movies ?? []).length],
    ["Screens",       (state.screens ?? []).length],
    ["Price cards",   (state.screens ?? []).reduce((a, s) => a + (s.priceCards?.length ?? 0), 0)],
    ["BO entries",    (state.entries ?? []).length],
    ["F&B days",      (state.fbEntries ?? []).length],
    ["F&B items",     fbItemCount],
    ["F&B products",  (state.fbProducts ?? []).length],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>What you're backing up right now</CardTitle>
        <Badge tone="neutral">live</Badge>
      </CardHeader>
      <CardBody className="p-0">
        <table className="w-full text-sm">
          <tbody>
            {rows.map(([label, count]) => (
              <tr key={label} className="border-b border-line last:border-b-0">
                <td className="px-5 py-2 text-ink-muted">{label}</td>
                <td className="px-5 py-2 text-right tabular-nums">{count.toLocaleString("en-IN")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}

// ── helpers ────────────────────────────────────────────────────────────

function describe(p: Partial<AppState>): string {
  const lines = [
    `${(p.entries ?? []).length} BO entries`,
    `${(p.fbEntries ?? []).length} F&B days`,
    `${(p.movies ?? []).length} movies`,
    `${(p.screens ?? []).length} screens`,
    `${(p.fbProducts ?? []).length} F&B products`,
  ];
  return lines.join(" · ");
}

