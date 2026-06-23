// ============================================================================
// Picture Ending Statement — PDF generator.
//
// Portrait A4 settlement document handed to a distributor at end of run.
// Reuses the DCR PDF's brand language (accent stripe, logo, cream/ink
// palette). Structure mirrors the physical statement:
//   header → party meta → weekly run table → credit/debit cascade → footer.
//
// Money math is done in pictureEnding.ts; this only renders.
// ============================================================================

import jsPDF from "jspdf";

import { money } from "./format";
import type { PictureEndingComputed } from "./pictureEnding";
import type { CinemaProfile } from "./cinemaProfile";
import { formatCinemaAddress } from "./cinemaProfile";

export interface PictureEndingPdfOpts {
  cinema: CinemaProfile;
  logoDataUrl?: string;
  statementNo?: number;
}

type RGB = [number, number, number];
const INK: RGB = [24, 24, 24];
const CREAM: RGB = [240, 239, 230];
const MUT: RGB = [118, 113, 95];
const LINE: RGB = [150, 150, 150];
const WHITE: RGB = [255, 255, 255];
const RED: RGB = [249, 56, 32];
const AMBER: RGB = [247, 182, 31];
const BLUE: RGB = [52, 136, 192];

/** YYYY-MM-DD → DD.MM.YYYY (statement house style). Empty in → "". */
function dmy(iso?: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** Money without trailing ".00" noise but always 2dp when fractional. */
function amt(x: number): string {
  return money(x) || "0.00";
}

/** Generate + download. Returns the filename used. */
export function downloadPictureEndingPdf(
  computed: PictureEndingComputed,
  opts: PictureEndingPdfOpts,
): string {
  const doc = buildPictureEndingPdf(computed, opts);
  const safeMovie = (computed.movie.name || "movie").replace(/\s+/g, "_");
  const no = opts.statementNo != null ? `_${opts.statementNo}` : "";
  const filename = `PictureEnding${no}_${safeMovie}_${computed.inputs.statementDate}.pdf`;
  doc.save(filename);
  return filename;
}

/** PDF as a Blob — for in-browser preview (caller makes/revokes the URL). */
export function pictureEndingPdfBlob(
  computed: PictureEndingComputed,
  opts: PictureEndingPdfOpts,
): Blob {
  return buildPictureEndingPdf(computed, opts).output("blob");
}

/** Build the jsPDF document (no download — useful for tests / preview). */
export function buildPictureEndingPdf(
  C: PictureEndingComputed,
  opts: PictureEndingPdfOpts,
): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const M = 30;
  const CW = PW - 2 * M;
  const x0 = M;
  const cinema = opts.cinema;
  const t = C.totals;
  const inp = C.inputs;

  const fc = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  const dc = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
  const tc = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const F = (sz: number, bold?: boolean) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(sz);
  };

  let y = M;
  const ensure = (h: number) => {
    if (y + h > PH - M) {
      doc.addPage();
      y = M;
    }
  };

  // ── brand accent stripe ────────────────────────────────────────────────
  const seg = CW / 3;
  fc(RED); doc.rect(x0, y, seg, 6, "F");
  fc(AMBER); doc.rect(x0 + seg, y, seg, 6, "F");
  fc(BLUE); doc.rect(x0 + 2 * seg, y, CW - 2 * seg, 6, "F");
  y += 14;

  // ── header: logo (left), cinema identity (centre) ──────────────────────
  if (opts.logoDataUrl) {
    try {
      const lh = 26;
      doc.addImage(opts.logoDataUrl, "PNG", x0, y, lh * (620 / 137), lh);
    } catch {
      /* logo is nice-to-have */
    }
  }
  F(15, true); tc(INK);
  doc.text(cinema.name || "Abhinaya Cinemas", PW / 2, y + 12, { align: "center" });
  F(7.5, false); tc(MUT);
  const idLines = [
    formatCinemaAddress(cinema),
    [cinema.phone ? "Ph: " + cinema.phone : "", cinema.email ? "Email: " + cinema.email : ""]
      .filter(Boolean).join("   "),
    [cinema.gstin ? "GSTIN: " + cinema.gstin : "", cinema.pan ? "PAN: " + cinema.pan : ""]
      .filter(Boolean).join("   "),
    [cinema.arn ? "ARN: " + cinema.arn : "", cinema.tan ? "TAN: " + cinema.tan : ""]
      .filter(Boolean).join("   "),
  ].filter((l) => l && l.trim());
  let hy = y + 22;
  idLines.forEach((l) => { doc.text(l, PW / 2, hy, { align: "center" }); hy += 9; });
  y = hy + 4;

  // ── title bar ──────────────────────────────────────────────────────────
  fc(INK); doc.rect(x0, y, CW, 18, "F");
  F(10.5, true); tc(WHITE);
  doc.text("PICTURE ENDING STATEMENT", PW / 2, y + 12.5, { align: "center" });
  y += 26;

  // ── party meta — two key/value columns ─────────────────────────────────
  const titleLine = C.movie.name + (inp.movieFormat ? `  (${inp.movieFormat})` : "");
  const left: Array<[string, string]> = [
    ["Name of Picture", titleLine],
    ["Name of Distributor", C.distributor?.name ?? C.movie.distributor ?? ""],
    ["Provisional GST ID", C.distributor?.gstin ?? ""],
    ["PAN", C.distributor?.pan ?? ""],
    ["Email", C.distributor?.pocEmail ?? ""],
    ["Contact / Rep.", [C.distributor?.pocContact, inp.representative].filter(Boolean).join("  ·  ")],
  ];
  const right: Array<[string, string]> = [
    ["Date", dmy(inp.statementDate)],
    ["Statement No.", opts.statementNo != null ? String(opts.statementNo) : "—"],
    ["Name of Theatre", inp.theatreName || cinema.name || ""],
    ["Run", [dmy(C.runFrom), dmy(C.runTo)].filter(Boolean).join("  to  ")],
    ["GST Type", inp.taxKind === "inter" ? "IGST (inter-state)" : "SGST+CGST (in-state)"],
    ["Hold-over Date", C.holdOverDate ? dmy(C.holdOverDate) : "—"],
  ];
  const colW = (CW - 14) / 2;
  const kv = (x: number, w: number, pairs: Array<[string, string]>) => {
    const rh = 14;
    const labw = w * 0.4;
    pairs.forEach((p, i) => {
      const top = y + i * rh;
      fc(CREAM); doc.rect(x, top, labw, rh, "F");
      dc(LINE); doc.setLineWidth(0.5);
      doc.rect(x, top, w, rh);
      doc.line(x + labw, top, x + labw, top + rh);
      F(7.5, true); tc(INK); doc.text(p[0], x + 4, top + rh / 2 + 2.6);
      F(7.5, false);
      doc.text(doc.splitTextToSize(p[1] ?? "", w - labw - 8)[0] ?? "", x + labw + 4, top + rh / 2 + 2.6);
    });
  };
  kv(x0, colW, left);
  kv(x0 + colW + 14, colW, right);
  y += 6 * 14 + 12;

  // ── weekly run table ───────────────────────────────────────────────────
  const PCT = [18, 18, 10, 22, 12, 20]; // From, To, Days, Net, Share%, Share
  const W = PCT.map((p) => (p / 100) * CW);
  const xat = (i: number) => x0 + W.slice(0, i).reduce((a, b) => a + b, 0);
  const wAt = (i: number) => W[i] ?? 0;
  const HDR = ["From", "To", "Days", "Net", "Share %", "Share"];

  ensure(16 + (C.weeks.length + 1) * 14);
  fc(INK); doc.rect(x0, y, CW, 15, "F");
  F(7.6, true); tc(WHITE);
  HDR.forEach((h, i) => {
    const right = i >= 2;
    doc.text(h, right ? xat(i) + wAt(i) - 4 : xat(i) + 4, y + 10, right ? { align: "right" } : undefined);
  });
  y += 15;

  const cell = (s: string, i: number, top: number, bold?: boolean) => {
    const right = i >= 2;
    F(7.6, bold); tc(INK);
    doc.text(s, right ? xat(i) + wAt(i) - 4 : xat(i) + 4, top + 9.5, right ? { align: "right" } : undefined);
  };
  C.weeks.forEach((w) => {
    const rh = 14;
    dc(LINE); doc.setLineWidth(0.3); doc.rect(x0, y, CW, rh);
    cell(dmy(w.from), 0, y);
    cell(dmy(w.to), 1, y);
    cell(String(w.days), 2, y);
    cell(amt(w.net), 3, y);
    cell(w.sharePct.toFixed(w.sharePct % 1 === 0 ? 0 : 2) + "%", 4, y);
    cell(amt(w.share), 5, y);
    y += rh;
  });
  // weekly totals row
  fc(CREAM); doc.rect(x0, y, CW, 15, "F");
  dc(LINE); doc.rect(x0, y, CW, 15);
  cell("TOTAL", 0, y, true);
  cell(String(C.totalDays), 2, y, true);
  cell(amt(t.net), 3, y, true);
  cell(amt(t.share), 5, y, true);
  y += 23;

  // ── credit / debit cascade ─────────────────────────────────────────────
  const labW = CW * 0.62;
  const credX = x0 + labW + (CW - labW) / 2;     // centre of credit col
  const debX = x0 + CW;                           // right edge (debit col)
  const credR = x0 + labW + (CW - labW) / 2 - 4;  // right align inside credit col

  ensure(20);
  fc(INK); doc.rect(x0, y, CW, 16, "F");
  F(8, true); tc(WHITE);
  doc.text("Particulars", x0 + 4, y + 11);
  doc.text("Credit", credR + ((CW - labW) / 2) / 2, y + 11, { align: "right" });
  doc.text("Debit", debX - 4, y + 11, { align: "right" });
  y += 16;

  const ledger = (
    label: string,
    credit: number | null,
    debit: number | null,
    o: { bold?: boolean; shade?: boolean; muted?: boolean } = {},
  ) => {
    const rh = 14;
    ensure(rh);
    if (o.shade) { fc(CREAM); doc.rect(x0, y, CW, rh, "F"); }
    dc(LINE); doc.setLineWidth(0.3); doc.rect(x0, y, CW, rh);
    doc.line(x0 + labW, y, x0 + labW, y + rh);
    doc.line(credX + ((CW - labW) / 2) / 2, y, credX + ((CW - labW) / 2) / 2, y + rh);
    F(7.6, o.bold); tc(o.muted ? MUT : INK);
    doc.text(label, x0 + 4, y + 9.5);
    F(7.6, o.bold); tc(INK);
    if (credit != null) doc.text(amt(credit), credX + ((CW - labW) / 2) / 2 - 4, y + 9.5, { align: "right" });
    if (debit != null) doc.text(amt(debit), debX - 4, y + 9.5, { align: "right" });
    y += rh;
  };

  const gstHalf = inp.gstPct / 2;
  ledger("Total Share — taxable value", t.share, null);
  if (inp.taxKind === "inter") {
    ledger(`Share IGST @ ${inp.gstPct}%`, t.shareIgst, null);
  } else {
    ledger(`Share SGST @ ${gstHalf}%`, t.shareSgst, null);
    ledger(`Share CGST @ ${gstHalf}%`, t.shareCgst, null);
  }
  const pubLabel = C.holdOverDate
    ? `Publicity — ${inp.publicityPct}% of ex-share (${t.publicityDays} days, till hold-over ${dmy(C.holdOverDate)})`
    : `Publicity — ${inp.publicityPct}% of ex-share (${t.publicityDays} days)`;
  ledger(pubLabel, null, t.publicityBase);
  if (inp.taxKind === "inter") {
    ledger(`Publicity IGST @ ${inp.gstPct}%`, null, t.publicityIgst);
  } else {
    ledger(`Publicity SGST @ ${gstHalf}%`, null, t.publicitySgst);
    ledger(`Publicity CGST @ ${gstHalf}%`, null, t.publicityCgst);
  }
  ledger(`TDS @ ${inp.tdsPct}% on share + publicity`, null, t.tds);
  if (t.flexCharge) ledger("Flex display charge", null, t.flexCharge);
  if (t.holdOverAmount) ledger("Hold-over", null, t.holdOverAmount);
  inp.advances.forEach((a) => {
    const ref = [dmy(a.paidOn), a.bank, a.mode?.toUpperCase(), a.ref ? "Ch# " + a.ref : ""]
      .filter(Boolean).join("  ·  ");
    ledger("Advance — " + (ref || "payment"), null, a.amount, { muted: true });
  });

  ledger("TOTAL", t.credit, t.debit, { bold: true, shade: true });

  // ── balance payable ────────────────────────────────────────────────────
  ensure(18);
  fc(AMBER); doc.rect(x0, y, CW, 17, "F");
  F(8.5, true); tc(INK);
  doc.text("BALANCE PAYABLE TO DISTRIBUTOR", x0 + 4, y + 11.5);
  doc.text(amt(t.balance), debX - 4, y + 11.5, { align: "right" });
  y += 17;
  if (t.roundOff) {
    F(7, false); tc(MUT);
    doc.text(`(includes round-off ${amt(t.roundOff)}; gross ${amt(t.balanceBeforeRound)})`,
      debX - 4, y + 9, { align: "right" });
    y += 12;
  }
  y += 10;

  // ── footer notes + stripe ──────────────────────────────────────────────
  ensure(40);
  F(7, false); tc(MUT);
  doc.text("Computer generated statement — no signature required.", x0, y);
  y += 10;
  doc.text("When raising the GST invoice please send a copy to our email.", x0, y);
  y += 12;
  dc(LINE); doc.setLineWidth(0.5); doc.line(x0, y, x0 + CW, y);
  y += 5;
  const mw = 30 / 3;
  fc(RED); doc.rect(x0, y, mw, 5, "F");
  fc(AMBER); doc.rect(x0 + mw, y, mw, 5, "F");
  fc(BLUE); doc.rect(x0 + 2 * mw, y, mw, 5, "F");
  F(7, false); tc(MUT);
  doc.text("Abhinaya Cinemas — Picture Ending Statement", x0 + 36, y + 4.2);

  return doc;
}
