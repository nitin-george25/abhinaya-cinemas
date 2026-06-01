// ============================================================================
// Formatting primitives.
//
// `money` and `int` match the legacy admin/dcr/js/01-box-office.js exactly:
//   money(x) → "1,234.56"            (Indian grouping, 2 dec, no symbol)
//   int(x)   → "1,234"                (Indian grouping, integer, no symbol)
//
// `fmtINR` / `fmtInt` (from dashboard.ts) DO add the "₹ " prefix — use them
// in the dashboard / KPI cards. Use `money` / `int` inside the DCR tables
// where headers carry the units.
// ============================================================================

export function money(x: unknown): string {
  if (x === "" || x === null || x === undefined) return "";
  const n = Number(x);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function int(x: unknown): string {
  if (x === "" || x === null || x === undefined) return "";
  const n = Number(x);
  if (!Number.isFinite(n)) return "";
  return Math.round(n).toLocaleString("en-IN");
}

/** 24h "HH:MM" → 12h "h:MM AM/PM"; empty → "". */
export function fmtTime(t: string | undefined): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  if (h == null || m == null) return "";
  const ap = h < 12 ? "AM" : "PM";
  let hh = h % 12;
  if (hh === 0) hh = 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ap}`;
}

/** YYYY-MM-DD → "Monday" etc.; empty/invalid → "". */
export function weekday(d: string | undefined): string {
  if (!d) return "";
  try {
    return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "long",
    });
  } catch {
    return "";
  }
}

/** Display the ticket-serial cell exactly like the legacy: "from–to" / "NA" / "". */
export function fmtSerialCell(
  from: number | string | undefined,
  to: number | string | undefined,
): string {
  if (from === "" || from == null) return "";
  if (to === "NA") return "NA";
  if (to === "" || to == null) return String(from);
  return `${from}–${to}`;
}
