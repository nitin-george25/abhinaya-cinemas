// ============================================================================
// Daily DSR upload — pick a single-day POS CSV, preview the parsed summary,
// confirm import. Port of admin/dcr/js/03-fb.js's fbDsrFile flow.
//
// Multi-day bulk PDF upload remains in /admin/dcr-legacy/ (the 800-LOC POS
// PDF parser). This handles the everyday flow: one day, one CSV, one click.
// ============================================================================

import { useState } from "react";

import { dsrToFbEntry, parseDsr, type ParsedDsr } from "../../lib/fb";
import { fmtINR, fmtInt } from "../../lib/dashboard";
import type { FbEntry } from "../../lib/types";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { IconSpinner } from "../icons";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called when the user confirms import. */
  onImport: (entry: FbEntry) => void;
  /** Existing entries — used to warn about overwriting an existing day. */
  existingDates: Set<string>;
}

export function DsrUploadModal({ open, onClose, onImport, existingDates }: Props) {
  const [parsed, setParsed] = useState<ParsedDsr | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setParsed(null);
    setFilename(null);
    setError(null);
    setBusy(false);
  }

  function pickFile() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "text/csv,.csv";
    inp.onchange = () => {
      const file = inp.files?.[0];
      if (!file) return;
      setFilename(file.name);
      setError(null);
      setBusy(true);
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const text = String(rd.result ?? "");
          const p = parseDsr(text);
          setParsed(p);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          setParsed(null);
        } finally {
          setBusy(false);
        }
      };
      rd.onerror = () => {
        setError("Couldn't read that file.");
        setBusy(false);
      };
      rd.readAsText(file);
    };
    inp.click();
  }

  function confirmImport() {
    if (!parsed) return;
    onImport(dsrToFbEntry(parsed));
    reset();
    onClose();
  }

  function close() {
    reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      maxWidth="max-w-2xl"
      title="Upload daily F&B sales (DSR CSV)"
      actions={
        <Button variant="ghost" size="sm" onClick={close} title="Close (Esc)">
          ✕
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">
          Pick a single-day POS export. We'll read the items + summary and
          show you a preview before saving. Multi-day or PDF exports still
          live on{" "}
          <a className="text-amber-600 underline" href="/admin/dcr-legacy/">
            the legacy console
          </a>.
        </p>

        <div className="flex items-center gap-3">
          <Button onClick={pickFile} disabled={busy} variant="primary">
            {busy ? <IconSpinner className="w-4 h-4" /> : null}
            {parsed ? "Pick a different file" : "Pick CSV"}
          </Button>
          {filename ? (
            <span className="text-sm text-ink-muted truncate">{filename}</span>
          ) : null}
        </div>

        {error ? (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            <b>Couldn't read that CSV: </b>{error}
          </div>
        ) : null}

        {parsed ? (
          <Preview parsed={parsed} duplicate={existingDates.has(parsed.date)} />
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={close}>Cancel</Button>
          <Button onClick={confirmImport} disabled={!parsed || busy}>
            {parsed && existingDates.has(parsed.date) ? "Replace day" : "Import"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── preview block ───────────────────────────────────────────────────────

function Preview({ parsed, duplicate }: { parsed: ParsedDsr; duplicate: boolean }) {
  const s = parsed.summary;
  return (
    <div className="space-y-3">
      {duplicate ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-ink-soft">
          <b>Heads up:</b> a day is already saved for {parsed.date}. Importing
          will replace it.
        </div>
      ) : null}

      <div className="rounded-lg border border-line bg-paper p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Badge tone="blue">{parsed.date}</Badge>
          <span className="text-sm text-ink-muted">
            {fmtInt(parsed.items.length)} items
          </span>
          {s.bills != null ? (
            <span className="text-sm text-ink-muted">
              · {fmtInt(s.bills)} bills
            </span>
          ) : null}
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm tabular-nums">
          <Row label="Gross Sales"           value={fmtINR(s.grossSales)} />
          <Row label="Food Sales"            value={fmtINR(s.foodSales)} />
          <Row label="Beverages Sales"       value={fmtINR(s.beveragesSales)} />
          {s.discount ? <Row label="Discount"      value={fmtINR(s.discount)} /> : null}
          {s.complimentary ? <Row label="Complimentary" value={fmtINR(s.complimentary)} /> : null}
          <Row label="Net Sales (no tax)"    value={fmtINR(s.netSalesWithoutTax)} />
          <Row label="Tax"                   value={fmtINR(s.addTax)} />
          <Row label="Net Sales (with tax)"  value={fmtINR(s.netSalesWithTax)} bold />
        </dl>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={bold ? "font-semibold" : ""}>{value}</dd>
    </div>
  );
}
