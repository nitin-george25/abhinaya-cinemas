// ============================================================================
// Picture Ending Statement — CSV/spreadsheet export.
//
// Mirrors the columns of the statement the distributor expects (From, To,
// Days, Net, Share %, Share + the credit/debit cascade). Amounts are emitted
// as raw numbers so Excel treats them numerically. Use with downloadCsv().
// ============================================================================

import type { PictureEndingComputed } from "./pictureEnding";
import type { CinemaProfile } from "./cinemaProfile";
import { formatCinemaAddress } from "./cinemaProfile";

type Row = Array<string | number | null | undefined>;

function dmy(iso?: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

export function pictureEndingCsvFilename(c: PictureEndingComputed, statementNo?: number): string {
  const safe = (c.movie.name || "movie").replace(/\s+/g, "_");
  const no = statementNo != null ? `_${statementNo}` : "";
  return `PictureEnding${no}_${safe}_${c.inputs.statementDate}.csv`;
}

export function pictureEndingCsvRows(
  c: PictureEndingComputed,
  cinema: CinemaProfile,
  statementNo?: number,
): Row[] {
  const t = c.totals;
  const inp = c.inputs;
  const R: Row[] = [];

  // ── header / identity ──
  R.push([cinema.name]);
  if (formatCinemaAddress(cinema)) R.push([formatCinemaAddress(cinema)]);
  R.push([
    [cinema.gstin ? "GSTIN: " + cinema.gstin : "", cinema.pan ? "PAN: " + cinema.pan : "",
     cinema.arn ? "ARN: " + cinema.arn : "", cinema.tan ? "TAN: " + cinema.tan : ""]
      .filter(Boolean).join("   "),
  ]);
  R.push(["PICTURE ENDING STATEMENT"]);
  R.push([]);

  // ── party meta ──
  R.push(["Name of Picture", c.movie.name + (inp.movieFormat ? `  (${inp.movieFormat})` : ""),
    "", "Date", dmy(inp.statementDate)]);
  R.push(["Name of Distributor", c.distributor?.name ?? c.movie.distributor ?? "",
    "", "Statement No.", statementNo != null ? statementNo : ""]);
  R.push(["Provisional GST ID", c.distributor?.gstin ?? "",
    "", "Name of Theatre", inp.theatreName || cinema.name]);
  R.push(["PAN", c.distributor?.pan ?? "",
    "", "Run", [dmy(c.runFrom), dmy(c.runTo)].filter(Boolean).join(" to ")]);
  R.push(["Email", c.distributor?.pocEmail ?? "",
    "", "GST Type", inp.taxKind === "inter" ? "IGST (inter-state)" : "SGST+CGST (in-state)"]);
  R.push(["Representative", inp.representative || c.distributor?.pocName || "",
    "", "Hold-over Date", c.holdOverDate ? dmy(c.holdOverDate) : ""]);
  R.push([]);

  // ── weekly run table ──
  R.push(["From", "To", "Days", "Net", "Share %", "Share"]);
  c.weeks.forEach((w) => {
    R.push([dmy(w.from), dmy(w.to), w.days, w.net, w.sharePct, w.share]);
  });
  R.push(["TOTAL", "", c.totalDays, t.net, "", t.share]);
  R.push([]);

  // ── credit / debit cascade ──
  R.push(["Particulars", "Credit", "Debit"]);
  R.push(["Total Share — taxable value", t.share, ""]);
  if (inp.taxKind === "inter") {
    R.push([`Share IGST @ ${inp.gstPct}%`, t.shareIgst, ""]);
  } else {
    R.push([`Share SGST @ ${inp.gstPct / 2}%`, t.shareSgst, ""]);
    R.push([`Share CGST @ ${inp.gstPct / 2}%`, t.shareCgst, ""]);
  }
  R.push([`Publicity — ${inp.publicityPct}% of ex-share`, "", t.publicityBase]);
  if (inp.taxKind === "inter") {
    R.push([`Publicity IGST @ ${inp.gstPct}%`, "", t.publicityIgst]);
  } else {
    R.push([`Publicity SGST @ ${inp.gstPct / 2}%`, "", t.publicitySgst]);
    R.push([`Publicity CGST @ ${inp.gstPct / 2}%`, "", t.publicityCgst]);
  }
  R.push([`TDS @ ${inp.tdsPct}% on share + publicity`, "", t.tds]);
  if (t.flexCharge) R.push(["Flex display charge", "", t.flexCharge]);
  if (t.holdOverAmount) R.push(["Hold-over", "", t.holdOverAmount]);
  inp.advances.forEach((a) => {
    const ref = [dmy(a.paidOn), a.bank, a.mode?.toUpperCase(), a.ref ? "Ch# " + a.ref : ""]
      .filter(Boolean).join(" · ");
    R.push(["Advance — " + (ref || "payment"), "", a.amount]);
  });
  R.push(["TOTAL", t.credit, t.debit]);
  R.push([]);
  R.push(["BALANCE PAYABLE TO DISTRIBUTOR", t.balance, ""]);
  if (t.roundOff) R.push(["Round off", t.roundOff, ""]);
  R.push([]);
  R.push(["Computer generated statement — no signature required."]);
  R.push(["When raising the GST invoice please send a copy to our email."]);

  return R;
}
