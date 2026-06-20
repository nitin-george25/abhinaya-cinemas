// ============================================================================
// Route page: /fb/entry — manual day entry + DSR upload.
//
// Click "+ Add F&B day" to open FbEntryForm modal. Click "Upload daily CSV"
// to open the DsrUploadModal. Below the actions, the most recent 7 days are
// shown as a quick reference — clicking a row opens the edit modal.
// ============================================================================

import { useMemo, useState } from "react";

import { useSync } from "../../lib/hooks/SyncContext";
import { upsertFbEntry } from "../../lib/fb";
import type { DateISO, FbEntry } from "../../lib/types";

import { Card, CardBody } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { FbEntryForm } from "../../components/fb/FbEntryForm";
import { DsrUploadModal } from "../../components/fb/DsrUploadModal";

export default function FBEntryPage() {
  const { state, setAppState } = useSync();
  const appState = state.appState;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<FbEntry | null>(null);
  const [uploading, setUploading] = useState(false);

  const recent = useMemo<FbEntry[]>(() => {
    if (!appState) return [];
    return [...(appState.fbEntries ?? [])]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 7);
  }, [appState]);

  if (!appState) {
    return (
      <Card>
        <CardBody className="text-sm text-ink-muted">Loading cloud data…</CardBody>
      </Card>
    );
  }

  const canEdit =
    state.role === "owner" ||
    state.role === "manager" ||
    state.role === "daily_manager";

  function handleSave(entry: FbEntry) {
    if (!appState) return;
    const conflict = appState.fbEntries.find(
      (e) => e.date === entry.date && e.id !== entry.id,
    );
    if (conflict) {
      alert(`An F&B day already exists for ${entry.date}. Open History to edit it.`);
      return;
    }
    setAppState(upsertFbEntry(appState, entry));
    setAdding(false);
    setEditing(null);
  }

  function handleImport(entry: FbEntry) {
    if (!appState) return;
    setAppState(upsertFbEntry(appState, entry));
    setUploading(false);
  }

  const existingDates = new Set(appState.fbEntries.map((e) => e.date));

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight">F&amp;B entry</h2>
        <p className="text-sm text-ink-muted mt-1">
          Add a day manually, or upload the POS DSR CSV. Bulk multi-day PDF
          import still lives at{" "}
          <a className="text-amber-600 underline" href="/admin/dcr-legacy/">
            the legacy console
          </a>
          .
        </p>
      </div>

      {canEdit ? (
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setAdding(true)}>+ Add F&amp;B day</Button>
          <Button variant="secondary" onClick={() => setUploading(true)}>
            Upload daily CSV
          </Button>
        </div>
      ) : null}

      <RecentDays
        rows={recent}
        canEdit={canEdit}
        onSelect={(e) => canEdit && e.source !== "zoho" && setEditing(e)}
      />

      <FbEntryForm
        open={adding}
        onClose={() => setAdding(false)}
        onSave={handleSave}
      />
      <FbEntryForm
        open={!!editing}
        initial={editing}
        onClose={() => setEditing(null)}
        onSave={handleSave}
      />
      <DsrUploadModal
        open={uploading}
        onClose={() => setUploading(false)}
        onImport={handleImport}
        existingDates={existingDates}
      />
    </div>
  );
}

function RecentDays({
  rows,
  canEdit,
  onSelect,
}: {
  rows: FbEntry[];
  canEdit: boolean;
  onSelect: (e: FbEntry) => void;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardBody className="py-10 text-center space-y-2">
          <Badge tone="neutral">Empty</Badge>
          <p className="text-sm text-ink-muted">No F&amp;B days yet. Add one above.</p>
        </CardBody>
      </Card>
    );
  }
  return (
    <Card>
      <CardBody className="p-0">
        <div className="px-5 py-3 text-[11px] uppercase tracking-wider text-ink-muted border-b border-line">
          Recent 7 days
        </div>
        <ul>
          {rows.map((e) => (
            <li
              key={e.id}
              onClick={() => onSelect(e)}
              className={
                "px-5 py-3 border-b border-line last:border-b-0 hover:bg-paper/60 flex justify-between text-sm " +
                (canEdit && e.source !== "zoho" ? "cursor-pointer" : "")
              }
            >
              <span className="flex items-center gap-2">
                {niceDate(e.date)}
                {e.source === "zoho" ? <Badge tone="blue">Zoho</Badge> : null}
              </span>
              <span className="tabular-nums text-ink-muted">
                {e.summary?.netSalesWithTax != null
                  ? `₹ ${e.summary.netSalesWithTax.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : "—"}
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function niceDate(d: DateISO | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch {
    return d;
  }
}
