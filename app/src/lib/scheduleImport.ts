// ============================================================================
// Vista schedule import — turn a Vista "session" export (a 2D cell grid read
// from .xls / .xlsx / .csv) into ShowSchedule rows.
//
// This module is PURE (no SheetJS): it takes an already-decoded `string[][]`
// grid so it's fully unit-testable. ScheduleImportModal does the file → grid
// step with SheetJS, then hands the grid here.
//
// Vista's report layout (one day, one or more screens):
//   Date: | 25 Jun 2026 | …
//   <blank>
//   Screen | Film | Session Id | Show | Showing | … | Price Card | Sold | …
//   ANU                                                          ← screen group header
//          | Balan:The Boy | 24711 | 1 | 11:00 am | … | ANU SPE … | 47 | …
//          | …                                                    ← show rows
//          |               |       |   |          |   |           | 83  ← subtotal (Film blank)
//   Total :                | 4 …                                   ← grand total
// ============================================================================

import { uid } from "./mappers";
import type { DateISO, ShowSchedule, TimeHHMM, UUID } from "./types";

export interface VistaShowRow {
  screen: string;
  film: string;
  showtime: TimeHHMM;   // HH:MM 24h
  priceCard: string;
  sessionId?: string;
  sold?: number;
  /** The raw "Showing" cell, kept for warnings. */
  showingRaw: string;
}

export interface ParsedVistaSchedule {
  date: DateISO | null;
  dateRaw: string | null;
  rows: VistaShowRow[];
  warnings: string[];
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

/** "11:00 am" / "2:00 PM" / "23:00" → "HH:MM" (24h). Null if unparseable. */
export function parseVistaTime(raw: string): TimeHHMM | null {
  const m = /(\d{1,2}):(\d{2})\s*(am|pm)?/i.exec(String(raw ?? "").trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  const ap = m[3]?.toLowerCase();
  if (ap === "am") { if (h === 12) h = 0; }
  else if (ap === "pm") { if (h !== 12) h += 12; }
  if (h > 23) return null;
  return `${pad(h)}:${pad(min)}`;
}

/** "25 Jun 2026" / "25/06/2026" / "2026-06-25" → "YYYY-MM-DD". Null otherwise. */
export function parseVistaDate(raw: string): DateISO | null {
  const s = String(raw ?? "").trim();
  let m: RegExpExecArray | null;
  // ISO
  if ((m = /(\d{4})-(\d{2})-(\d{2})/.exec(s))) {
    return `${m[1]}-${m[2]}-${m[3]}`;
  }
  // DD Mon YYYY  (Vista's default, e.g. "25 Jun 2026")
  if ((m = /(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/.exec(s))) {
    const mon = MONTHS[(m[2] ?? "").slice(0, 3).toLowerCase()];
    if (mon) return `${m[3]}-${pad(mon)}-${pad(Number(m[1]))}`;
  }
  // DD/MM/YYYY or DD-MM-YYYY (Indian day-first)
  if ((m = /(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s))) {
    return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  }
  return null;
}

const cell = (grid: string[][], r: number, c: number): string =>
  String(grid[r]?.[c] ?? "").trim();

interface HeaderCols {
  screen: number; film: number; session: number;
  showing: number; priceCard: number; sold: number;
}

/** Find the header row + the column index of each field we care about. */
function locateHeader(grid: string[][]): { row: number; cols: HeaderCols } | null {
  for (let r = 0; r < Math.min(grid.length, 30); r++) {
    const row = grid[r] ?? [];
    const lower = row.map((v) => String(v ?? "").trim().toLowerCase());
    if (lower.includes("film") && (lower.includes("showing") || lower.includes("show"))) {
      const find = (...names: string[]) =>
        lower.findIndex((v) => names.includes(v));
      return {
        row: r,
        cols: {
          screen: find("screen"),
          film: find("film"),
          session: find("session id", "sessionid", "session"),
          showing: find("showing", "show time", "showtime"),
          priceCard: find("price card", "pricecard", "price"),
          sold: find("sold"),
        },
      };
    }
  }
  return null;
}

/** Parse a Vista session grid into a one-day schedule. */
export function parseVistaWorkbook(grid: string[][]): ParsedVistaSchedule {
  const warnings: string[] = [];

  // ── date (search the first rows for "Date:" or a date-looking token) ──
  let dateRaw: string | null = null;
  outer: for (let r = 0; r < Math.min(grid.length, 8); r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const v = cell(grid, r, c);
      if (/^date\b/i.test(v)) {
        // date may be in the same cell ("Date: 25 Jun 2026") or the next cell
        dateRaw = v.replace(/^date\s*:?\s*/i, "").trim() || cell(grid, r, c + 1);
        if (dateRaw) break outer;
      }
    }
  }
  // Fallback: first cell anywhere in the top rows that parses as a date.
  if (!dateRaw) {
    for (let r = 0; r < Math.min(grid.length, 8) && !dateRaw; r++) {
      for (const v of grid[r] ?? []) {
        if (parseVistaDate(String(v))) { dateRaw = String(v).trim(); break; }
      }
    }
  }
  const date = dateRaw ? parseVistaDate(dateRaw) : null;
  if (dateRaw && !date) warnings.push(`Couldn't read the date "${dateRaw}".`);

  // ── header ──
  const header = locateHeader(grid);
  if (!header) {
    warnings.push("Couldn't find the column header row (Screen / Film / Showing).");
    return { date, dateRaw, rows: [], warnings };
  }
  const { cols } = header;

  // ── rows ──
  const rows: VistaShowRow[] = [];
  let currentScreen = "";
  for (let r = header.row + 1; r < grid.length; r++) {
    const screenCell = cols.screen >= 0 ? cell(grid, r, cols.screen) : "";
    const film = cols.film >= 0 ? cell(grid, r, cols.film) : "";

    // Grand total row ends the table.
    if (/^total\b/i.test(screenCell)) break;

    // A screen group header: a screen name with no film on the row.
    if (screenCell && !film) { currentScreen = screenCell; continue; }
    if (screenCell && film) currentScreen = screenCell; // screen-per-row layout

    // Subtotal / blank rows have no film.
    if (!film) continue;

    const showingRaw = cols.showing >= 0 ? cell(grid, r, cols.showing) : "";
    const showtime = parseVistaTime(showingRaw);
    if (!showtime) {
      warnings.push(`Skipped "${film}" — unreadable show time "${showingRaw}".`);
      continue;
    }
    const soldStr = cols.sold >= 0 ? cell(grid, r, cols.sold).replace(/,/g, "") : "";
    rows.push({
      screen: currentScreen,
      film,
      showtime,
      priceCard: cols.priceCard >= 0 ? cell(grid, r, cols.priceCard) : "",
      sessionId: cols.session >= 0 ? cell(grid, r, cols.session) || undefined : undefined,
      sold: soldStr ? Number(soldStr) : undefined,
      showingRaw,
    });
  }

  if (rows.length === 0 && warnings.length === 0) {
    warnings.push("No show rows found in the file.");
  }
  return { date, dateRaw, rows, warnings };
}

// ── catalog matching ───────────────────────────────────────────────────

/** Lowercase, strip everything but a–z 0–9 — for tolerant name matching. */
export const normalizeName = (s: string): string =>
  String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Exact (normalized) name match against a catalog list; null if none. */
export function matchByName<T extends { id: string; name: string }>(
  name: string,
  items: T[],
): string | null {
  const n = normalizeName(name);
  if (!n) return null;
  const hit = items.find((it) => normalizeName(it.name) === n);
  return hit ? hit.id : null;
}

/**
 * Pull the slash-separated price tokens out of a Vista price-card label, e.g.
 * "ANU SPE (25) 150/140/105" → [150, 140, 105]. Only the run of numbers joined
 * by "/" is taken, so a standalone code like the "(25)" seat count is ignored.
 */
export function extractPriceTokens(label: string): number[] {
  const m = /(\d+(?:\s*\/\s*\d+)+)/.exec(String(label ?? ""));
  if (!m || !m[1]) return [];
  return m[1].split("/").map((x) => Number(x.trim())).filter((n) => n > 0);
}

const sortedPositive = (xs: number[]): number[] =>
  xs.filter((n) => n > 0).sort((a, b) => a - b);

/**
 * Match a Vista price-card label to one of a screen's price cards by comparing
 * the SET of printed prices (order-independent) — e.g. "…150/140/105" matches a
 * card priced {150, 140, 105} regardless of class order or label. Falls back to
 * a name match when the label carries no price tokens. Returns null if nothing
 * matches (or the price set is ambiguous across cards is resolved to the first).
 */
export function matchPriceCard(
  label: string,
  cards: Array<{ id: string; name: string; prices: Record<string, number> }>,
): string | null {
  const tokens = sortedPositive(extractPriceTokens(label));
  if (tokens.length) {
    const eq = (a: number[], b: number[]) =>
      a.length === b.length && a.every((v, i) => v === b[i]);
    const hit = cards.find((c) => eq(sortedPositive(Object.values(c.prices ?? {})), tokens));
    if (hit) return hit.id;
  }
  return matchByName(label, cards);
}

// ── row building ───────────────────────────────────────────────────────

export interface ImportMapping {
  /** file screen name → catalog screenId */
  screens: Record<string, UUID>;
  /** file film name → catalog movieId */
  films: Record<string, UUID>;
  /** `${fileScreen}||${filePriceCard}` → catalog priceCardId (optional) */
  priceCards: Record<string, UUID>;
}

export const priceCardKey = (screen: string, priceCard: string): string =>
  `${screen}||${priceCard}`;

/**
 * Turn parsed Vista rows + a catalog mapping into ShowSchedule rows for `date`.
 * Rows whose screen or film isn't mapped are returned in `skipped` (the modal
 * keeps the user from confirming until those are resolved). Position is the
 * chronological index within each screen.
 */
export function buildScheduleRows(
  parsed: ParsedVistaSchedule,
  date: DateISO,
  mapping: ImportMapping,
  cinemaId: UUID,
): { rows: ShowSchedule[]; skipped: VistaShowRow[] } {
  const skipped: VistaShowRow[] = [];
  const draft: Array<Omit<ShowSchedule, "position">> = [];

  for (const r of parsed.rows) {
    const screenId = mapping.screens[r.screen];
    const movieId = mapping.films[r.film];
    if (!screenId || !movieId) { skipped.push(r); continue; }
    draft.push({
      id: uid(),
      cinemaId,
      date,
      screenId,
      movieId,
      priceCardId: mapping.priceCards[priceCardKey(r.screen, r.priceCard)],
      showtime: r.showtime,
      cancelled: false,
    });
  }

  // Position = chronological index within each screen.
  const byScreen: Record<string, Array<Omit<ShowSchedule, "position">>> = {};
  for (const d of draft) (byScreen[d.screenId] ??= []).push(d);
  const rows: ShowSchedule[] = [];
  for (const list of Object.values(byScreen)) {
    list
      .sort((a, b) => a.showtime.localeCompare(b.showtime))
      .forEach((d, i) => rows.push({ ...d, position: i }));
  }
  return { rows, skipped };
}
