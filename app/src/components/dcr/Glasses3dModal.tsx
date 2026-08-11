// ============================================================================
// 3D glasses popup — one movie's whole-run rental income.
//
// Opened from the History page's per-row CTA. Reads the FULL local entry set
// (not History's current page), so the figures are the movie's entire run
// regardless of which page or filter the user is on.
//
// The rental is cinema-only income and is deliberately absent from the DCR —
// this popup and Reports → Box Office → 3D Glasses are where it is read.
// ============================================================================

import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { Link } from "react-router-dom";

import { fmtINR, fmtInt } from "../../lib/dashboard";
import { weekday } from "../../lib/format";
import { glassesForMovie } from "../../lib/glasses";
import type { AppState, DateISO, UUID } from "../../lib/types";

import { Modal } from "../ui/Modal";
import { Badge } from "../ui/Badge";

interface Props {
  open: boolean;
  onClose: () => void;
  appState: AppState;
  movieId: UUID;
  movieName: string;
}

export function Glasses3dModal({ open, onClose, appState, movieId, movieName }: Props) {
  const { rows, total } = useMemo(
    () => glassesForMovie(appState, movieId),
    [appState, movieId],
  );

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-2xl" title={`3D glasses — ${movieName}`}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider font-semibold text-ink-muted">
              Collected this run
            </div>
            <div className="text-3xl font-bold tabular-nums mt-0.5">
              {fmtINR(total.amount)}
            </div>
          </div>
          <div className="tabular-nums">
            <div className="text-[11px] text-ink-muted">Pairs</div>
            <div className="text-lg">{fmtInt(total.qty)}</div>
          </div>
          <div className="tabular-nums">
            <div className="text-[11px] text-ink-muted">Taxable</div>
            <div className="text-lg">{fmtINR(total.taxable)}</div>
          </div>
          <div className="tabular-nums">
            <div className="text-[11px] text-ink-muted">GST (incl.)</div>
            <div className="text-lg">{fmtINR(total.gst)}</div>
          </div>
        </div>

        <p className="text-[11px] text-ink-muted leading-snug border border-dashed border-line rounded-md p-3">
          Cinema-only income. Collected on top of the printed ticket price, so
          it is not part of Gross Collection or Net Share and carries no
          distributor share. It does not appear on the DCR.
        </p>

        {rows.length === 0 ? (
          <div className="py-8 text-center space-y-2">
            <Badge tone="neutral">No 3D shows</Badge>
            <p className="text-sm text-ink-muted">
              Nothing was charged for this movie.
            </p>
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto -mx-1">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-[11px] uppercase tracking-wider text-ink-muted border-b border-line">
                  <th className="text-left px-2 py-2 font-semibold">Date</th>
                  <th className="text-left px-2 py-2 font-semibold">Screen</th>
                  <th className="text-right px-2 py-2 font-semibold">Shows</th>
                  <th className="text-right px-2 py-2 font-semibold">Pairs</th>
                  <th className="text-right px-2 py-2 font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.date}-${r.screenId}`} className="border-b border-line last:border-b-0">
                    <td className="px-2 py-2 whitespace-nowrap">
                      {niceDate(r.date)}
                      <span className="text-ink-muted text-xs"> · {weekday(r.date)}</span>
                    </td>
                    <td className="px-2 py-2 text-xs text-ink-muted">{r.screenName}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtInt(r.shows)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtInt(r.qty)}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                      {fmtINR(r.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Link
          to="/reports/box-office/3d-glasses"
          onClick={onClose}
          className="inline-block text-sm text-amber-600 underline"
        >
          Full 3D glasses report →
        </Link>
      </div>
    </Modal>
  );
}

function niceDate(d: DateISO): string {
  if (!d) return "—";
  try { return format(parseISO(d), "d MMM yyyy"); } catch { return d; }
}
