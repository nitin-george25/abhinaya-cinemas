// ============================================================================
// CSV exports — DCR CSV + Tally CSV.
//
// Direct port of admin/dcr/js/01-box-office.js dcrCsvRows() + tallyCsvRows().
// CSV escaping matches Excel's expectations (BOM + CRLF + double-quoted cells
// when needed).
// ============================================================================

import { weekday, fmtTime } from "./format";
import { N } from "./engine";
import type { Cinema, ComputedEntry } from "./types";

type Row = Array<string | number | null | undefined>;

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Trigger a CSV file download in the browser. */
export function downloadCsv(filename: string, rows: Row[]): void {
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  // BOM so Excel picks up UTF-8 cleanly.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  // Free the URL after a tick so Firefox processes the download.
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}

/** Per-ticket printed price as a clean number (integer or fixed-2 decimal). */
function fmtPrice(p: unknown): string {
  const n = N(p);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// ── DCR CSV ────────────────────────────────────────────────────────────

export function dcrCsvRows(C: ComputedEntry, cinema: Cinema): Row[] {
  if (!C.movie || !C.screen) {
    throw new Error("DCR CSV: movie and screen are required.");
  }
  const g = C.grand;
  const R: Row[] = [];

  R.push([cinema.name]);
  R.push(["GSTIN : " + cinema.gstin]);
  R.push(["DAILY COLLECTION REPORT"]);
  R.push([]);
  R.push(["Picture", C.movie.name, "", "Date", C.entry.date ?? ""]);
  R.push(["Distributor", C.movie.distributor ?? "", "", "Running Day", String(C.runningDay ?? "")]);
  R.push(["Screen", C.screen.name, "", "Week Day", weekday(C.entry.date)]);
  R.push([]);
  R.push([
    "Show", "Class", "Total Seats", "POA", "Sl From", "Sl To",
    "Tkts Sold", "Gross Collection", "Total POA",
    "TMC", "Cess", "E-Tax", "Total", "GST",
  ]);

  C.shows.forEach((s, i) => {
    s.rows.forEach((r) =>
      R.push([
        `Show ${i + 1} ${fmtTime(s.showtime)}`,
        r.cls, r.seats,
        r.poa.toFixed(2),
        r.from as string | number, r.to as string | number,
        r.tickets,
        r.grossColl.toFixed(2),
        r.totalPOA.toFixed(2),
        r.tmc.toFixed(2),
        r.cess.toFixed(2),
        r.etax.toFixed(2),
        r.total.toFixed(2),
        r.gst.toFixed(2),
      ]),
    );
    R.push([
      "", `Show ${i + 1} Total`, "", "", "", "",
      s.totals.tickets,
      s.totals.grossColl.toFixed(2),
      s.totals.totalPOA.toFixed(2),
      s.totals.tmc.toFixed(2),
      s.totals.cess.toFixed(2),
      s.totals.etax.toFixed(2),
      s.totals.total.toFixed(2),
      s.totals.gst.toFixed(2),
    ]);
  });

  R.push([
    "", "GRAND TOTAL", "", "", "", "",
    g.tickets,
    g.grossColl.toFixed(2),
    g.totalPOA.toFixed(2),
    g.tmc.toFixed(2),
    g.cess.toFixed(2),
    g.etax.toFixed(2),
    g.total.toFixed(2),
    g.gst.toFixed(2),
  ]);
  R.push([]);

  R.push(["Settlement (today)"]);
  R.push(["Total GST", g.gst.toFixed(2)]);
  R.push(["Rep. Batta", g.repBatta.toFixed(2)]);
  R.push(["Fund", C.fund.toFixed(2)]);
  R.push(["Net Share", C.today.netShare.toFixed(2)]);
  R.push([`DS Distributor (${C.share}%)`, C.today.distShare.toFixed(2)]);
  R.push([`ES Exhibitor (${100 - C.share}%)`, C.today.exShare.toFixed(2)]);
  R.push([]);

  R.push([
    "Period", "Gross Coll", "TMC", "Cess", "Fund", "Rep.Batta",
    "Net Share", "Dist.Share", "Ex.Share", "E-Tax", "Total GST", "Audience",
  ]);
  const cr = (o: ComputedEntry["today"]): Row => [
    o.grossColl.toFixed(2), o.tmc.toFixed(2), o.cess.toFixed(2),
    o.fund.toFixed(2), o.repBatta.toFixed(2),
    o.netShare.toFixed(2), o.distShare.toFixed(2), o.exShare.toFixed(2),
    o.etax.toFixed(2), o.gst.toFixed(2), o.audience,
  ];
  R.push(["Previous", ...cr(C.previous)]);
  R.push(["Today's",  ...cr(C.today)]);
  R.push(["Total",    ...cr(C.total)]);

  return R;
}

// ── Tally CSV — for the accountant's Tally import ──────────────────────

export function tallyCsvRows(C: ComputedEntry): Row[] {
  if (!C.movie || !C.screen) {
    throw new Error("Tally CSV: movie and screen are required.");
  }
  const R: Row[] = [["filim", "Distributor", "Show", "Class", "From ", "To"]];
  C.shows.forEach((s, i) => {
    s.rows.forEach((r) => {
      if (r.tickets > 0) {
        R.push([
          C.movie!.name,
          C.movie!.distributor ?? "",
          `Show ${i + 1}`,
          `${C.screen!.name} ${r.cls} ₹ ${fmtPrice(r.gross)}`,
          r.from as string | number,
          r.to as string | number,
        ]);
      }
    });
  });
  return R;
}

export function dcrCsvFilename(C: ComputedEntry): string {
  const m = (C.movie?.name ?? "movie").replace(/\s+/g, "_");
  return `DCR_${m}_${C.entry.date ?? ""}.csv`;
}

export function tallyCsvFilename(C: ComputedEntry): string {
  const m = (C.movie?.name ?? "movie").replace(/\s+/g, "_");
  return `Tally_${m}_${C.entry.date ?? ""}.csv`;
}
