// ============================================================================
// DCR popup — same DcrView + same download buttons as the standalone
// /v2/dcr/... page, but as an overlay so the entry editor stays mounted
// underneath.
// ============================================================================

import { DcrView } from "./DcrView";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { downloadDcrPdf } from "../../lib/pdf";
import { LOGO_DATA_URL } from "../../assets/logo";
import {
  dcrCsvFilename,
  dcrCsvRows,
  downloadCsv,
  tallyCsvFilename,
  tallyCsvRows,
} from "../../lib/csv";
import type { AppState, ComputedEntry } from "../../lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  computed: ComputedEntry;
  appState: AppState;
}

export function DcrModal({ open, onClose, computed, appState }: Props) {
  if (!computed.movie || !computed.screen) return null;

  function dlPdf() {
    downloadDcrPdf(computed, {
      cinema: appState.cinema,
      tax: appState.tax,
      logoDataUrl: LOGO_DATA_URL,
    });
  }
  function dlCsv() {
    downloadCsv(dcrCsvFilename(computed), dcrCsvRows(computed, appState.cinema));
  }
  function dlTally() {
    const rows = tallyCsvRows(computed);
    if (rows.length < 2) {
      alert(
        "No sold tickets with serials to export yet. Enter tickets and make " +
          "sure a serial starting point exists.",
      );
      return;
    }
    downloadCsv(tallyCsvFilename(computed), rows);
  }

  // The modal is portal'd to <body> so it sits beside (not inside) #root.
  // For browser print to capture ONLY the DCR, we temporarily hide the
  // main app tree during the print dialog and restore on dismissal.
  // (Primary PDF path is the Download PDF button → jsPDF.)
  function printDcr() {
    const root = document.getElementById("root");
    const prev = root?.style.display ?? "";
    if (root) root.style.display = "none";
    try {
      window.print();
    } finally {
      if (root) root.style.display = prev;
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="truncate">
          DCR · {computed.movie.name} · {computed.screen.name} · {computed.entry.date}
        </span>
      }
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={printDcr}>
            Print
          </Button>
          <Button variant="secondary" size="sm" onClick={dlCsv}>CSV</Button>
          <Button variant="secondary" size="sm" onClick={dlTally}>Tally CSV</Button>
          <Button size="sm" onClick={dlPdf}>Download PDF</Button>
          <Button variant="ghost" size="sm" onClick={onClose} title="Close (Esc)">
            ✕
          </Button>
        </>
      }
    >
      <div id="dcr-printable">
        <DcrView computed={computed} cinema={appState.cinema} tax={appState.tax} />
      </div>
    </Modal>
  );
}
