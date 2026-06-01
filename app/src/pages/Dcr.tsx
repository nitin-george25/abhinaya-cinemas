import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";

import { useSync } from "../lib/hooks/SyncContext";
import { computeEntry } from "../lib/engine";
import { findEntry } from "../lib/entry";
import { downloadDcrPdf } from "../lib/pdf";
import { LOGO_DATA_URL } from "../assets/logo";
import {
  dcrCsvFilename,
  dcrCsvRows,
  downloadCsv,
  tallyCsvFilename,
  tallyCsvRows,
} from "../lib/csv";

import { DcrView } from "../components/dcr/DcrView";
import { Card, CardBody } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import type { UUID } from "../lib/types";

/**
 * Standalone DCR view. Reached from the Entry page ("View DCR") or History
 * (later). Renders the on-screen DCR and exposes PDF / CSV / Tally CSV
 * downloads driven by the same computeEntry the editor uses.
 */
export default function DcrPage() {
  const { state } = useSync();
  const { date, movieId, screenId } = useParams<{
    date: string;
    movieId: string;
    screenId: string;
  }>();
  const appState = state.appState;

  const computed = useMemo(() => {
    if (!appState || !date || !movieId || !screenId) return null;
    const entry = findEntry(appState, date, movieId as UUID, screenId as UUID);
    if (!entry) return null;
    return computeEntry(appState, entry);
  }, [appState, date, movieId, screenId]);

  if (!appState) {
    return (
      <Card>
        <CardBody className="text-sm text-ink-muted">Loading cloud data…</CardBody>
      </Card>
    );
  }

  if (!computed) {
    return (
      <Card>
        <CardBody className="text-center py-10 space-y-3">
          <h2 className="text-lg font-semibold">No entry found</h2>
          <p className="text-sm text-ink-muted">
            There's no entry for this date / movie / screen combination.
          </p>
          <Link className="text-amber-600 underline text-sm" to="/entry">
            Back to entry
          </Link>
        </CardBody>
      </Card>
    );
  }

  function dlPdf() {
    if (!computed) return;
    downloadDcrPdf(computed, {
      cinema: appState!.cinema,
      tax: appState!.tax,
      logoDataUrl: LOGO_DATA_URL,
    });
  }
  function dlCsv() {
    if (!computed) return;
    downloadCsv(dcrCsvFilename(computed), dcrCsvRows(computed, appState!.cinema));
  }
  function dlTally() {
    if (!computed) return;
    const rows = tallyCsvRows(computed);
    if (rows.length < 2) {
      alert("No sold tickets with serials to export yet.");
      return;
    }
    downloadCsv(tallyCsvFilename(computed), rows);
  }

  return (
    <div className="space-y-5 max-w-[1200px]">
      {/* Action bar — hidden on print so the DCR fills the page */}
      <div className="flex items-center justify-between gap-3 print:hidden">
        <div>
          <h2 className="font-display text-3xl font-bold tracking-tight">DCR</h2>
          <p className="text-sm text-ink-muted mt-1">
            {computed.movie?.name} · {computed.screen?.name} · {computed.entry.date}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => window.print()}>
            Print
          </Button>
          <Button variant="secondary" size="sm" onClick={dlCsv}>
            CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={dlTally}>
            Tally CSV
          </Button>
          <Button onClick={dlPdf}>Download PDF</Button>
        </div>
      </div>

      <div id="dcr-printable">
        <DcrView
          computed={computed}
          cinema={appState.cinema}
          tax={appState.tax}
        />
      </div>
    </div>
  );
}
