// ============================================================================
// After-show message image card — verbatim port of the legacy drawShowCard()
// (Abhinaya DCR Tool, Cloud build). Produces a 760-px wide canvas card in
// the brand palette with red/amber/blue stripe on the left edge.
//
// Public API:
//   showMessageData(state, entry, showIdx, ce?) → data object
//   buildShowText(data)                         → plain-text version
//   drawShowCard(canvas, data, logo, cinemaName)→ paints onto the canvas
// ============================================================================

import { computeEntry, mergedEntries, N } from "./engine";
import { isLastShowOfDay } from "./schedule";
import { fmtTime } from "./format";
import type { AppState, ComputedEntry, Entry } from "./types";

const ORD_WORDS = [
  "FIRST", "SECOND", "THIRD", "FOURTH", "FIFTH", "SIXTH",
  "SEVENTH", "EIGHTH", "NINTH", "TENTH", "ELEVENTH", "TWELFTH",
];

export interface ShowCardClass {
  name: string;
  tickets: number;
}
export interface ShowCardData {
  i: number;
  ordinal: string;
  time: string;
  screen: string;
  movie: string;
  date: string;
  classes: ShowCardClass[];
  amount: string;          // money0 already applied
  online: number | string;
  last: boolean;
  sum: {
    gross: string;
    net: string;
    tnet: string;
    ds: string;
    es: string;
  };
}

function showOrdinal(state: AppState, entry: Entry, showIdx: number): string {
  const list: Array<{ key: string; t: string }> = [];
  mergedEntries(state, entry)
    .filter((e) => e.screenId === entry.screenId && (e.date ?? "") === (entry.date ?? ""))
    .forEach((e) => {
      (e.shows ?? []).forEach((sh, i) => {
        list.push({ key: `${e.id}__${i}`, t: sh.showtime || "99:99" });
      });
    });
  list.sort((a, b) => a.t.localeCompare(b.t));
  const idx = list.findIndex((x) => x.key === `${entry.id}__${showIdx}`);
  if (idx < 0) return `SHOW ${showIdx + 1}`;
  return idx < ORD_WORDS.length ? `${ORD_WORDS[idx]} SHOW` : `SHOW ${idx + 1}`;
}

const money0 = (n: number) => String(Math.round(N(n)));
const money2 = (n: number) => (Math.round(N(n) * 100) / 100).toFixed(2);

/** Indian grouping (12,34,567.89). Mirrors legacy grp(). */
function grp(v: string | number): string {
  let s = String(v);
  if (s === "" || s === "—") return s;
  const neg = s.charAt(0) === "-";
  if (neg) s = s.slice(1);
  const dot = s.indexOf(".");
  const ip = dot < 0 ? s : s.slice(0, dot);
  const dp = dot < 0 ? "" : s.slice(dot);
  if (!/^\d+$/.test(ip)) return (neg ? "-" : "") + s;
  const last3 = ip.length > 3 ? ip.slice(-3) : ip;
  let rest = ip.length > 3 ? ip.slice(0, -3) : "";
  rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  const out = rest ? rest + "," + last3 : last3;
  return (neg ? "-" : "") + out + dp;
}

export function showMessageData(
  state: AppState,
  entry: Entry,
  showIdx: number,
  ce?: ComputedEntry,
): ShowCardData | null {
  const computed = ce ?? computeEntry(state, entry);
  const raw = (entry.shows ?? [])[showIdx];
  const cs = (computed.shows ?? [])[showIdx];
  if (!raw || !cs) return null;
  const amt = cs.totals.grossColl - cs.totals.tmc - cs.totals.cess;
  return {
    i: showIdx,
    ordinal: showOrdinal(state, entry, showIdx),
    time: fmtTime(raw.showtime ?? ""),
    screen: (computed.screen?.name ?? "").toUpperCase(),
    movie: (computed.movie?.name ?? "").toUpperCase(),
    date: entry.date ?? "",
    classes: cs.rows.map((r) => ({ name: r.cls, tickets: N(r.tickets) || 0 })),
    amount: money0(amt),
    online: raw.online ?? "",
    // Auto-detected from the schedule (latest scheduled showtime for this
    // movie+screen+day); falls back to the stored flag for legacy days.
    last: isLastShowOfDay(state, entry, showIdx),
    sum: {
      gross: money0(computed.today.grossColl),
      net:   money2(computed.today.netShare),
      tnet:  money2(computed.total.netShare),
      ds:    money2(computed.total.distShare),
      es:    money2(computed.total.exShare),
    },
  };
}

export function buildShowText(d: ShowCardData): string {
  const head = [d.screen, d.movie, d.time].filter(Boolean).join(" — ");
  const L: string[] = [head];
  d.classes.forEach((c) => L.push(`${c.name.toUpperCase()} :- ${c.tickets}`));
  L.push(`₹ ${d.amount}`);
  L.push(`online: ${d.online !== "" && d.online != null ? d.online : ""}`);
  if (d.last) {
    L.push("");
    L.push(`Gross : ${d.sum.gross}`);
    L.push(`Net : ${d.sum.net}`);
    L.push(`T net : ${d.sum.tnet}`);
    L.push(`Ds : ${d.sum.ds}`);
    L.push(`Es : ${d.sum.es}`);
  }
  return L.join("\n");
}

const CARD_FONT =
  '"Barlow Semi Condensed","Roboto Condensed","Arial Narrow",Arial,sans-serif';

interface DrawBlock {
  h: number;
  fn?: (ctx: CanvasRenderingContext2D, y: number) => void;
}

/** Verbatim port of legacy drawShowCard. 760-px wide, retina-scaled. */
export function drawShowCard(
  canvas: HTMLCanvasElement,
  d: ShowCardData,
  logo: HTMLImageElement | null,
  cinemaName = "Abhinaya Cinemas",
): void {
  const W = 760, BAR = 14, PAD = 44 + BAR, RIGHT = W - 44, scale = 2;
  const DC = {
    bg: "#181818", text: "#FBFBF6", muted: "#9E988B", line: "#3A3936",
    red: "#F93820", amber: "#F7B61F", blue: "#3488C0",
  };
  const hasLogo = !!(logo && logo.complete && logo.naturalWidth > 0);
  const logoH = hasLogo ? 40 : 0;

  const B: DrawBlock[] = [];
  const gap = (h: number) => B.push({ h });
  const rule = () =>
    B.push({
      h: 1,
      fn: (ctx, y) => {
        ctx.strokeStyle = DC.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PAD, y + 0.5);
        ctx.lineTo(RIGHT, y + 0.5);
        ctx.stroke();
      },
    });
  const T = (
    ctx: CanvasRenderingContext2D,
    txt: string, x: number, y: number,
    size: number, wt: string, col: string,
    align: CanvasTextAlign, ls = 0,
  ) => {
    ctx.font = `${wt} ${size}px ${CARD_FONT}`;
    ctx.fillStyle = col;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    try { (ctx as unknown as { letterSpacing: string }).letterSpacing = `${ls}px`; } catch { /* */ }
    ctx.fillText(txt, x, y);
    try { (ctx as unknown as { letterSpacing: string }).letterSpacing = "0px"; } catch { /* */ }
  };

  gap(34);
  B.push({
    h: 46,
    fn: (ctx, y) => {
      T(ctx, d.movie, PAD, y + 23, 40, "700", DC.text, "left", 0);
      if (hasLogo && logo) {
        const ar = logo.naturalWidth / logo.naturalHeight;
        const lw = logoH * ar;
        ctx.drawImage(logo, RIGHT - lw, y + (46 - logoH) / 2, lw, logoH);
      }
    },
  });
  gap(8);
  B.push({
    h: 22,
    fn: (ctx, y) => {
      const sub = [d.screen, d.time].filter(Boolean).join("    ·    ");
      T(ctx, sub, PAD, y + 11, 18, "600", DC.muted, "left", 3);
    },
  });
  gap(28); rule(); gap(22);

  d.classes.forEach((cl, idx) => {
    B.push({
      h: 46,
      fn: (ctx, y) => {
        T(ctx, cl.name.toUpperCase(), PAD, y + 23, 21, "500", DC.text, "left", 1.5);
        T(ctx, String(cl.tickets), RIGHT, y + 23, 26, "600", DC.text, "right", 0);
        if (idx < d.classes.length - 1) {
          ctx.strokeStyle = DC.line;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(PAD, y + 46);
          ctx.lineTo(RIGHT, y + 46);
          ctx.stroke();
        }
      },
    });
  });

  gap(20); rule(); gap(20);
  B.push({
    h: 50,
    fn: (ctx, y) => {
      T(ctx, "COLLECTION", PAD, y + 26, 14, "600", DC.muted, "left", 3);
      T(ctx, "₹ " + grp(d.amount), RIGHT, y + 25, 38, "700", DC.text, "right", 0);
    },
  });
  gap(8);
  B.push({
    h: 32,
    fn: (ctx, y) => {
      T(ctx, "ONLINE", PAD, y + 16, 14, "600", DC.muted, "left", 3);
      const ov =
        d.online !== "" && d.online != null ? "₹ " + grp(d.online) : "—";
      T(ctx, ov, RIGHT, y + 16, 22, "600", DC.text, "right", 0);
    },
  });

  if (d.last) {
    gap(22); rule(); gap(18);
    B.push({
      h: 20,
      fn: (ctx, y) => T(ctx, "DAY SUMMARY", PAD, y + 10, 13, "700", DC.blue, "left", 3),
    });
    gap(10);
    const rows: Array<[string, string]> = [
      ["Gross", d.sum.gross],
      ["Net", d.sum.net],
      ["Total net", d.sum.tnet],
      ["Distributor (Ds)", d.sum.ds],
      ["Exhibitor (Es)", d.sum.es],
    ];
    rows.forEach((rw) =>
      B.push({
        h: 33,
        fn: (ctx, y) => {
          T(ctx, rw[0], PAD, y + 16, 18, "500", DC.muted, "left", 0);
          T(ctx, grp(rw[1]), RIGHT, y + 16, 18, "700", DC.text, "right", 0);
        },
      }),
    );
  }

  gap(22); rule(); gap(14);
  B.push({
    h: 20,
    fn: (ctx, y) => {
      const footer = `${cinemaName}    ·    ${d.date}`;
      T(ctx, footer, PAD, y + 10, 14, "500", DC.muted, "left", 1);
    },
  });
  gap(30);

  let H = 0;
  B.forEach((b) => { H += b.h; });
  H = Math.round(H);

  canvas.width = W * scale;
  canvas.height = H * scale;
  canvas.style.width = `${W}px`;
  canvas.style.height = "auto";
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  ctx.fillStyle = DC.bg;
  ctx.fillRect(0, 0, W, H);
  const seg = H / 3;
  ctx.fillStyle = DC.red;   ctx.fillRect(0, 0,     BAR, seg);
  ctx.fillStyle = DC.amber; ctx.fillRect(0, seg,   BAR, seg);
  ctx.fillStyle = DC.blue;  ctx.fillRect(0, 2*seg, BAR, H - 2*seg);

  let y = 0;
  B.forEach((b) => { if (b.fn) b.fn(ctx, y); y += b.h; });
}

/** Safe filename fragment — `[^A-Za-z0-9]` → `_`, trimmed of edges. */
export function safeName(s: string): string {
  return String(s || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
