// ============================================================================
// DCR PDF generator — port of admin/dcr/js/01-box-office.js dcrToPdf().
//
// LOCK STATUS: this is a legal document. Layout, columns, percentages,
// fonts, and color stripes must remain visually identical to the legacy
// output. The math itself comes from computeEntry() (LOCKED in C1) — we
// only render here.
//
// Differences from the legacy JS function (intentional, non-visual):
//   • Pure: takes (computed, opts) instead of reading window globals.
//   • Typed: jsPDF + ComputedEntry; no `any`.
//   • Uses our `money` / `int` / `fmtTime` instead of legacy helpers.
//   • Logo: opts.logoDataUrl (PNG data URL). Falls back silently if absent.
// ============================================================================

import jsPDF from "jspdf";

import { fmtTime, int, money } from "./format";
import { N } from "./engine";
import type {
  Cinema,
  ComputedEntry,
  TaxConfig,
} from "./types";

interface DcrPdfOpts {
  cinema: Cinema;
  tax: TaxConfig;
  /** Optional brand logo as a data: URL (PNG). Rendered top-left if present. */
  logoDataUrl?: string;
}

type RGB = [number, number, number];

const INK:   RGB = [24, 24, 24];
const CREAM: RGB = [240, 239, 230];
const MUT:   RGB = [118, 113, 95];
const LINE:  RGB = [150, 150, 150];
const GREY:  RGB = [150, 150, 150];
const WHITE: RGB = [255, 255, 255];
const RED:   RGB = [249, 56, 32];
const AMBER: RGB = [247, 182, 31];
const BLUE:  RGB = [52, 136, 192];

/** Generate the DCR PDF and trigger a download. Returns the filename used. */
export function downloadDcrPdf(
  computed: ComputedEntry,
  opts: DcrPdfOpts,
): string {
  const doc = buildDcrPdf(computed, opts);
  const safeMovie = ((computed.movie?.name ?? "movie") + "").replace(/\s+/g, "_");
  const filename = `DCR_${safeMovie}_${computed.entry.date ?? ""}.pdf`;
  doc.save(filename);
  return filename;
}

/** Build the jsPDF document without triggering a download (useful for tests). */
export function buildDcrPdf(C: ComputedEntry, opts: DcrPdfOpts): jsPDF {
  if (!C.movie || !C.screen) {
    throw new Error("DCR PDF: movie and screen are required.");
  }

  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const M = 24;
  const CW = PW - 2 * M;
  const x0 = M;
  const tax = opts.tax;

  // Drawing helpers — wrap jsPDF's stateful setters.
  const fc = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  const dc = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
  const tc = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const F = (sz: number, bold?: boolean) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(sz);
  };

  // Layout metrics (in points before scaling).
  const stripeH = 6, gStripe = 10;
  const brandH = 26, gBrand = 8;
  const metaRH = 13, metaH = 3 * metaRH, gMeta = 10;
  const barH = 13, hdrH = 13, rowH = 11.5, totH = 11.5, gShow = 7;
  const grandH = 13, gGrand = 10;
  const sumRH = 11.5, termsH = 30, gSum = 8, footH = 16;

  // Only render shows that actually sold something — keeps the page tidy.
  const shows = (C.shows || []).filter(
    (s) => s.totals && s.totals.tickets > 0,
  );

  // Natural height — used to compute a single scale-down factor `k` so the
  // whole DCR fits on one A4 landscape page. Matches the legacy behavior.
  let natural = stripeH + gStripe + brandH + gBrand + metaH + gMeta;
  shows.forEach((s) => {
    natural += barH + hdrH + (s.rows || []).length * rowH + totH + gShow;
  });
  natural += grandH + gGrand;
  const settleH = 7 * sumRH + 6 + termsH;
  const cumH = 4 * sumRH;
  const summaryH = Math.max(settleH, cumH);
  natural += summaryH + gSum + footH;
  const k = Math.min(1, (PH - 2 * M) / natural);
  const sc = (v: number) => v * k;

  // Vertical-centre text in a row of height `h` with font size `fs`.
  const rowText = (s: string, x: number, yTop: number, h: number, fs: number, al?: "left" | "right" | "center") =>
    doc.text(String(s), x, yTop + h / 2 + fs * 0.34, al ? { align: al } : undefined);

  let y = M;

  // ── brand accent stripe ───────────────────────────────────────────────
  const seg = CW / 3;
  fc(RED);   doc.rect(x0, y, seg, sc(stripeH), "F");
  fc(AMBER); doc.rect(x0 + seg, y, seg, sc(stripeH), "F");
  fc(BLUE);  doc.rect(x0 + 2 * seg, y, CW - 2 * seg, sc(stripeH), "F");
  y += sc(stripeH) + sc(gStripe);

  // ── brand header: logo (left) / cinema name (centre) / title (right) ─
  if (opts.logoDataUrl) {
    try {
      const lh = sc(24);
      const lw = lh * (620 / 137);                     // logo aspect
      doc.addImage(opts.logoDataUrl, "PNG", x0, y, lw, lh);
    } catch {
      // Silently ignore — logo is nice-to-have, not legally required.
    }
  }
  F(sc(14), true);  tc(INK); doc.text(opts.cinema.name || "Abhinaya Cinemas", PW / 2, y + sc(13), { align: "center" });
  F(sc(8),  false); tc(MUT); doc.text("GSTIN " + (opts.cinema.gstin || ""), PW / 2, y + sc(22), { align: "center" });
  F(sc(11), true);  tc(INK); doc.text("DAILY COLLECTION REPORT", PW - M, y + sc(13), { align: "right" });
  y += sc(brandH) + sc(gBrand);

  // ── meta block — two key/value tables side-by-side ───────────────────
  const half = (CW - sc(14)) / 2;
  const kv = (x: number, w: number, pairs: Array<[string, string]>) => {
    const rh = sc(metaRH);
    const labw = w * 0.42;
    pairs.forEach((p, i) => {
      const top = y + i * rh;
      fc(CREAM); doc.rect(x, top, labw, rh, "F");
      dc(LINE); doc.setLineWidth(0.5);
      doc.rect(x, top, w, rh);
      doc.line(x + labw, top, x + labw, top + rh);
      F(sc(8), true);  tc(INK); doc.text(p[0], x + 4, top + rh / 2 + sc(8) * 0.34);
      F(sc(8), false);          doc.text(p[1] ?? "", x + labw + 4, top + rh / 2 + sc(8) * 0.34);
    });
  };
  let wk = "";
  try {
    wk = new Date((C.entry.date ?? "") + "T00:00:00")
      .toLocaleDateString("en-US", { weekday: "long" });
  } catch {
    /* leave empty */
  }
  kv(x0, half, [
    ["Name of the Picture", C.movie.name],
    ["Name of the Distributor", C.movie.distributor || ""],
    ["Screen", C.screen.name],
  ]);
  kv(x0 + half + sc(14), half, [
    ["Date", C.entry.date || ""],
    ["Running Day", String(C.runningDay || "")],
    ["Week Day", wk],
  ]);
  y += sc(metaH) + sc(gMeta);

  // ── shows ─────────────────────────────────────────────────────────────
  const PCT = [13, 6, 7, 6, 6, 7, 10, 9, 6, 6, 7, 9, 8];   // must sum to 100
  const W = PCT.map((p) => (p / 100) * CW);
  const TW = W.reduce((a, b) => a + b, 0);
  const xat = (i: number) => x0 + W.slice(0, i).reduce((a, b) => a + b, 0);
  const HDR = ["Class", "Seats", "POA", "From", "To", "Tkts", "Gross", "Total POA", "TMC", "Cess", "E-Tax", "Total", "GST"];

  shows.forEach((sh, idx) => {
    const t = sh.totals;
    fc(INK); doc.rect(x0, y, TW, sc(barH), "F");
    F(sc(8), true); tc(WHITE);
    rowText(
      "SHOW " + (idx + 1) + "   ·   SHOW TIME " + (fmtTime(sh.showtime) || "—") +
        (sh.card ? "   ·   " + sh.card.name : ""),
      x0 + 5, y, sc(barH), sc(8), "left",
    );
    rowText("No. of Free Pass: " + (sh.freePass || 0), x0 + TW - 5, y, sc(barH), sc(8), "right");
    y += sc(barH);

    // column-header row (cream background)
    fc(CREAM); doc.rect(x0, y, TW, sc(hdrH), "F");
    dc(LINE); doc.setLineWidth(0.4); doc.rect(x0, y, TW, sc(hdrH));
    F(sc(6.6), true); tc(INK);
    HDR.forEach((h, i) => {
      const right = i >= 1;
      const cw = W[i]!;
      rowText(h, right ? xat(i) + cw - 3 : xat(i) + 3, y, sc(hdrH), sc(6.6), right ? "right" : "left");
    });
    y += sc(hdrH);

    // body + totals row
    const drow = (cells: string[], isTot: boolean) => {
      const h = isTot ? sc(totH) : sc(rowH);
      if (isTot) { fc(CREAM); doc.rect(x0, y, TW, h, "F"); }
      F(sc(6.6), isTot); tc(INK);
      cells.forEach((v, i) => {
        const right = i >= 1;
        const cw = W[i]!;
        rowText(v, right ? xat(i) + cw - 3 : xat(i) + 3, y, h, sc(6.6), right ? "right" : "left");
      });
      dc(LINE); doc.setLineWidth(0.3); doc.line(x0, y + h, x0 + TW, y + h);
      y += h;
    };
    (sh.rows || []).forEach((r) =>
      drow(
        [
          r.cls,
          int(r.seats),
          money(r.poa),
          r.from !== "" && r.from != null ? int(r.from) : "",
          r.to === "NA" ? "NA" : r.to !== "" && r.to != null ? int(r.to) : "",
          int(r.tickets),
          money(r.grossColl),
          money(r.totalPOA),
          money(r.tmc),
          money(r.cess),
          money(r.etax),
          money(r.total),
          money(r.gst),
        ],
        false,
      ),
    );
    drow(
      [
        "Total", "", "", "", "",
        int(t.tickets),
        money(t.grossColl),
        money(t.totalPOA),
        money(t.tmc),
        money(t.cess),
        money(t.etax),
        money(t.total),
        money(t.gst),
      ],
      true,
    );
    y += sc(gShow);
  });

  // ── grand total (amber, matching on-screen) ──────────────────────────
  const g = C.grand;
  fc(AMBER); doc.rect(x0, y, TW, sc(grandH), "F"); F(sc(6.9), true); tc(INK);
  const gc = [
    "GRAND TOTAL", "", "", "", "",
    int(g.tickets), money(g.grossColl), money(g.totalPOA),
    money(g.tmc), money(g.cess), money(g.etax), money(g.total), money(g.gst),
  ];
  gc.forEach((v, i) => {
    const right = i >= 1;
    const cw = W[i]!;
    rowText(v, right ? xat(i) + cw - 3 : xat(i) + 3, y, sc(grandH), sc(6.9), right ? "right" : "left");
  });
  y += sc(grandH) + sc(gGrand);

  // ── summary: settlement (left) + cumulative (right) ──────────────────
  const summaryTop = y;
  const srowH = sc(sumRH);
  const leftW = CW * 0.44;
  const rightW = CW - leftW - sc(14);
  const rightX = x0 + leftW + sc(14);
  const sp = N(C.share);

  // left header
  fc(INK); doc.rect(x0, y, leftW, srowH, "F");
  F(sc(7.5), true); tc(WHITE);
  doc.text("Settlement (today)", x0 + leftW / 2, y + srowH / 2 + sc(7.5) * 0.34, { align: "center" });
  y += srowH;
  const setRows: Array<[string, string]> = [
    ["Total GST", money(g.gst)],
    ["Rep. Batta", money(C.today.repBatta)],
    ["Fund", money(C.fund)],
    ["Net Share", money(C.today.netShare)],
    ["DS - Distributor (" + sp + "%)", money(C.today.distShare)],
    ["ES - Exhibitor (" + (100 - sp) + "%)", money(C.today.exShare)],
  ];
  setRows.forEach((p) => {
    const labw = leftW * 0.62;
    fc(CREAM); doc.rect(x0, y, labw, srowH, "F");
    dc(LINE); doc.setLineWidth(0.4);
    doc.rect(x0, y, leftW, srowH);
    doc.line(x0 + labw, y, x0 + labw, y + srowH);
    F(sc(7.5), true);  tc(INK); doc.text(p[0], x0 + 4, y + srowH / 2 + sc(7.5) * 0.34);
    F(sc(7.5), false);           doc.text(p[1], x0 + leftW - 4, y + srowH / 2 + sc(7.5) * 0.34, { align: "right" });
    y += srowH;
  });
  y += sc(6);
  const th = sc(termsH);
  dc(GREY); doc.setLineWidth(0.5);
  if ((doc as unknown as { setLineDashPattern?: Function }).setLineDashPattern) {
    (doc as unknown as { setLineDashPattern: (p: number[], n: number) => void }).setLineDashPattern([2, 2], 0);
  }
  doc.rect(x0, y, leftW, th);
  if ((doc as unknown as { setLineDashPattern?: Function }).setLineDashPattern) {
    (doc as unknown as { setLineDashPattern: (p: number[], n: number) => void }).setLineDashPattern([], 0);
  }
  F(sc(6.5), false); tc(MUT);
  const tl = [
    "TERMS: Net Share = Gross - GST - TMC - Cess - E-Tax - Fund - Rep.Batta.",
    "DS/ES split on Net Share. E-Tax/GST by ticket price:",
    `> ${tax.threshold}: ${tax.above.etaxPct}% E-Tax / ${tax.above.gstPct}% GST;   <= ${tax.threshold}: ${tax.below.etaxPct}% / ${tax.below.gstPct}%.`,
  ];
  tl.forEach((ln, i) => doc.text(ln, x0 + 5, y + sc(9) + i * sc(8.5)));
  const leftBottom = y + th;

  // ── right cumulative ────────────────────────────────────────────────
  y = summaryTop;
  const SHd = ["", "Gross Coll", "TMC", "Cess", "Fund", "Rep.Batta", "Net Share", "Dist.Share", "Ex.Share", "E-Tax", "Total GST", "Aud"];
  const SP = [12, 9, 6, 6, 6, 8, 11, 11, 11, 8, 9, 8];
  let SW = SP.map((p) => (p / 100) * CW);
  const sclR = rightW / SW.reduce((a, b) => a + b, 0);
  SW = SW.map((w) => w * sclR);
  const STW = SW.reduce((a, b) => a + b, 0);
  const sxat = (i: number) => rightX + SW.slice(0, i).reduce((a, b) => a + b, 0);

  fc(INK); doc.rect(rightX, y, STW, srowH, "F");
  F(sc(6.2), true); tc(WHITE);
  SHd.forEach((h, i) => {
    const right = i >= 1;
    const cw = SW[i]!;
    doc.text(String(h), right ? sxat(i) + cw - 2 : sxat(i) + 2, y + srowH / 2 + sc(6.2) * 0.34, right ? { align: "right" } : undefined);
  });
  y += srowH;

  const cumRow = (label: string, o: ComputedEntry["today"], shade: boolean) => {
    if (shade) { fc(CREAM); doc.rect(rightX, y, STW, srowH, "F"); }
    const cells: string[] = [
      label,
      int(o.grossColl), int(o.tmc), int(o.cess),
      int(o.fund), int(o.repBatta),
      money(o.netShare), money(o.distShare), money(o.exShare),
      int(o.etax), money(o.gst), int(o.audience),
    ];
    cells.forEach((v, i) => {
      const right = i >= 1;
      const cw = SW[i]!;
      F(sc(6.2), i === 0 || shade); tc(INK);
      doc.text(String(v), right ? sxat(i) + cw - 2 : sxat(i) + 2, y + srowH / 2 + sc(6.2) * 0.34, right ? { align: "right" } : undefined);
    });
    dc(LINE); doc.setLineWidth(0.3); doc.line(rightX, y + srowH, rightX + STW, y + srowH);
    y += srowH;
  };
  cumRow("Previous", C.previous, false);
  cumRow("Today's",  C.today,    false);
  cumRow("Total",    C.total,    true);
  const rightBottom = y;

  y = Math.max(leftBottom, rightBottom) + sc(gSum);

  // ── foot ────────────────────────────────────────────────────────────
  dc(LINE); doc.setLineWidth(0.5);
  doc.line(x0, y, x0 + CW, y);
  y += sc(4);
  const mw = sc(30) / 3;
  fc(RED);   doc.rect(x0, y, mw, sc(5), "F");
  fc(AMBER); doc.rect(x0 + mw, y, mw, sc(5), "F");
  fc(BLUE);  doc.rect(x0 + 2 * mw, y, mw, sc(5), "F");
  F(sc(7), false); tc(MUT);
  doc.text("Abhinaya Cinemas - Daily Collection Report", x0 + sc(34), y + sc(4.2));

  return doc;
}
