// ============================================================================
// After-show WhatsApp message builder — port of legacy buildShowMessage().
//
// Output format (one show):
//   FIRST SHOW
//   SCREEN NAME
//   MOVIE NAME
//   CLASS :- tickets    (one line per class with non-zero tickets)
//   ₹ <gross minus TMC + Cess>
//
// If lastShow flag is set, appended with day + cumulative totals:
//   Gross : <today.grossColl>
//   Net : <today.netShare>
//   T net : <total.netShare>
//   Ds : <total.distShare>
//   Es : <total.exShare>
// ============================================================================

import { computeEntry, mergedEntries, N } from "./engine";
import type { AppState, ComputedEntry, Entry } from "./types";

const ORD_WORDS = [
  "FIRST", "SECOND", "THIRD", "FOURTH", "FIFTH", "SIXTH",
  "SEVENTH", "EIGHTH", "NINTH", "TENTH", "ELEVENTH", "TWELFTH",
];

function showOrdinal(state: AppState, entry: Entry, showIdx: number): string {
  // Rank the show within (date, screen) by showtime, ascending.
  const list: Array<{ key: string; t: string }> = [];
  mergedEntries(state, entry)
    .filter((e) => e.screenId === entry.screenId && (e.date ?? "") === (entry.date ?? ""))
    .forEach((e) => {
      (e.shows ?? []).forEach((sh, i) => {
        list.push({
          key: `${e.id}__${i}`,
          t: sh.showtime || "99:99",
        });
      });
    });
  list.sort((a, b) => a.t.localeCompare(b.t));
  const idx = list.findIndex((x) => x.key === `${entry.id}__${showIdx}`);
  if (idx < 0) return `SHOW ${showIdx + 1}`;
  return idx < ORD_WORDS.length ? `${ORD_WORDS[idx]} SHOW` : `SHOW ${idx + 1}`;
}

function money0(n: number): string {
  return String(Math.round(N(n)));
}
function money2(n: number): string {
  return (Math.round(N(n) * 100) / 100).toFixed(2);
}

export function buildShowMessage(
  state: AppState,
  entry: Entry,
  showIdx: number,
  ce?: ComputedEntry,
): string {
  const computed = ce ?? computeEntry(state, entry);
  const raw = (entry.shows ?? [])[showIdx];
  const cs = (computed.shows ?? [])[showIdx];
  if (!raw || !cs) return "";

  const lines: string[] = [];
  lines.push(showOrdinal(state, entry, showIdx));
  lines.push((computed.screen?.name ?? "").toUpperCase());
  lines.push((computed.movie?.name ?? "").toUpperCase());

  cs.rows.forEach((r) => {
    const tickets = N(r.tickets);
    if (tickets > 0) {
      lines.push(`${r.cls.toUpperCase()} :- ${tickets}`);
    }
  });

  // Amount = gross collection minus the fixed per-ticket TMC + Cess
  // (matches the legacy "amt = grossColl - tmc - cess" line).
  const amt = cs.totals.grossColl - cs.totals.tmc - cs.totals.cess;
  lines.push(`₹ ${money0(amt)}`);

  if (raw.lastShow) {
    lines.push("");
    lines.push(`Gross : ${money0(computed.today.grossColl)}`);
    lines.push(`Net : ${money2(computed.today.netShare)}`);
    lines.push(`T net : ${money2(computed.total.netShare)}`);
    lines.push(`Ds : ${money2(computed.total.distShare)}`);
    lines.push(`Es : ${money2(computed.total.exShare)}`);
  }

  return lines.join("\n");
}
