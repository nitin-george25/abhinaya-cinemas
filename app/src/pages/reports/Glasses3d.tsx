// ============================================================================
// Route page: /reports/box-office/3d-glasses — 3D glasses rental income.
//
// The rental is cinema-only income: collected on top of the printed ticket
// price, never in Gross Collection, never split with the distributor. It is
// deliberately absent from the DCR, which is the box-office record a
// distributor is settled against — this report is where the money is read
// instead.
//
// Movie-wise rollup first (how much did each 3D title earn in glasses), then
// the day-by-day detail behind it. GST is broken out because the rate is
// collected inclusive, so the taxable/GST split is what the return needs.
// ============================================================================

import { Fragment, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";

import { useSync } from "../../lib/hooks/SyncContext";
import { fmtINR, fmtInt } from "../../lib/dashboard";
import { weekday } from "../../lib/format";
import { downloadCsv } from "../../lib/csv";
import { glasses3dConfig } from "../../lib/engine";
import {
  filterByDate,
  glassesByMovie,
  glassesDayRows,
  glassesTotals,
  type GlassesDayRow,
  type GlassesTotals,
} from "../../lib/glasses";
import type { DateISO } from "../../lib/types";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";

function defaultFrom(): DateISO {
  const d = new Date();
  d.setDate(d.getDate() - 89);
  return format(d, "yyyy-MM-dd") as DateISO;
}
function defaultTo(): DateISO {
  return format(new Date(), "yyyy-MM-dd") as DateISO;
}

export default function ReportsGlasses3dPage() {
  const { state } = useSync();
  const appState = state.appState;

  const [from, setFrom] = useState<DateISO>(defaultFrom());
  const [to, setTo] = useState<DateISO>(defaultTo());
  const [openMovie, setOpenMovie] = useState<string | null>(null);

  // Every 3D day the cinema has ever had — cheap, because glassesDayRows skips
  // entries with no 3D show entirely. Re-filtered by date below.
  const allRows = useMemo(
    () => (appState ? glassesDayRows(appState, appState.entries) : []),
    [appState],
  );
  const rows = useMemo(() => filterByDate(allRows, from, to), [allRows, from, to]);
  const byMovie = useMemo(() => glassesByMovie(rows), [rows]);
  const totals = useMemo(() => glassesTotals(rows), [rows]);

  if (!appState) {
    return (
      <Card>
        <CardBody className="text-sm text-ink-muted">Loading cloud data…</CardBody>
      </Card>
    );
  }

  const cfg = glasses3dConfig(appState);

  function exportCsv() {
    const out: Array<Array<string | number>> = [];
    out.push(["3D glasses rental — cinema-only income (not shared with distributor)"]);
    out.push([`Range`, from || "start", "to", to || "end"]);
    out.push([]);
    out.push(["Movie", "First day", "Last day", "Days", "Pairs", "Amount", "Taxable", "GST"]);
    byMovie.forEach((m) =>
      out.push([
        m.movieName, m.firstDay, m.lastDay, m.days, m.qty,
        m.amount.toFixed(2), m.taxable.toFixed(2), m.gst.toFixed(2),
      ]),
    );
    out.push([]);
    out.push(["Date", "Weekday", "Movie", "Screen", "Shows", "Pairs", "Amount", "Taxable", "GST"]);
    rows.forEach((r) =>
      out.push([
        r.date, weekday(r.date), r.movieName, r.screenName, r.shows, r.qty,
        r.amount.toFixed(2), r.taxable.toFixed(2), r.gst.toFixed(2),
      ]),
    );
    out.push([]);
    out.push([
      "TOTAL", "", "", "", "", totals.qty,
      totals.amount.toFixed(2), totals.taxable.toFixed(2), totals.gst.toFixed(2),
    ]);
    downloadCsv(`3d_glasses_${from || "start"}_${to || "end"}.csv`, out);
  }

  return (
    <div className="space-y-5 max-w-7xl">
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight">
          3D glasses rental
        </h2>
        <p className="text-sm text-ink-muted mt-1">
          Glasses collected on top of the printed ticket price on 3D shows.
          This is cinema-only income — it is not part of Gross Collection or
          Net Share, carries no distributor share, and does not appear on the
          DCR. Currently {fmtINR(cfg.rate)} per pair, inclusive of{" "}
          {cfg.gstPct}% GST.
        </p>
      </div>

      <Card>
        <CardBody className="grid gap-3 sm:grid-cols-4 items-end">
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value as DateISO)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value as DateISO)} />
          </Field>
          <div className="sm:col-span-2 flex gap-2">
            <Button
              variant="ghost"
              size="md"
              disabled={from === defaultFrom() && to === defaultTo()}
              onClick={() => { setFrom(defaultFrom()); setTo(defaultTo()); }}
            >
              Reset
            </Button>
            <Button variant="secondary" size="md" onClick={exportCsv} disabled={rows.length === 0}>
              Export CSV
            </Button>
          </div>
        </CardBody>
      </Card>

      <TotalsStrip totals={totals} days={rows.length} movies={byMovie.length} />

      {rows.length === 0 ? (
        <Card>
          <CardBody className="py-10 text-center space-y-2">
            <Badge tone="neutral">Nothing yet</Badge>
            <p className="text-sm text-ink-muted">
              No 3D shows in this range. Shows are marked 3D on the Schedule
              page, or with the <strong>+ 3D glasses</strong> button on Entry.
            </p>
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>By movie</CardTitle>
              <span className="text-xs text-ink-muted">
                Click a row for its day-by-day detail
              </span>
            </CardHeader>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-ink-muted border-b border-line">
                      <th className="text-left px-3 py-3 font-semibold">Movie</th>
                      <th className="hidden md:table-cell text-left px-3 py-3 font-semibold whitespace-nowrap">Run</th>
                      <th className="text-right px-3 py-3 font-semibold">Days</th>
                      <th className="text-right px-3 py-3 font-semibold">Pairs</th>
                      <th className="hidden lg:table-cell text-right px-3 py-3 font-semibold">Taxable</th>
                      <th className="hidden lg:table-cell text-right px-3 py-3 font-semibold">GST</th>
                      <th className="text-right px-3 py-3 font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byMovie.map((m) => {
                      const open = openMovie === m.movieId;
                      const detail = rows.filter((r) => r.movieId === m.movieId);
                      return (
                        <Fragment key={m.movieId}>
                          <tr
                            onClick={() => setOpenMovie(open ? null : m.movieId)}
                            className="border-b border-line hover:bg-paper cursor-pointer"
                          >
                            <td className="px-3 py-3 font-medium">
                              <span className="text-ink-muted mr-1.5">{open ? "▾" : "▸"}</span>
                              {m.movieName}
                            </td>
                            <td className="hidden md:table-cell px-3 py-3 text-xs text-ink-muted whitespace-nowrap">
                              {niceDate(m.firstDay)} – {niceDate(m.lastDay)}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums">{fmtInt(m.days)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{fmtInt(m.qty)}</td>
                            <td className="hidden lg:table-cell px-3 py-3 text-right tabular-nums">{fmtINR(m.taxable)}</td>
                            <td className="hidden lg:table-cell px-3 py-3 text-right tabular-nums">{fmtINR(m.gst)}</td>
                            <td className="px-3 py-3 text-right tabular-nums font-semibold whitespace-nowrap">
                              {fmtINR(m.amount)}
                            </td>
                          </tr>
                          {open
                            ? detail.map((d) => (
                                <tr key={`${m.movieId}-${d.date}-${d.screenId}`} className="border-b border-line bg-paper/60">
                                  <td className="px-3 py-2 pl-8 text-xs">
                                    {niceDate(d.date)}
                                    <span className="text-ink-muted"> · {weekday(d.date)} · {d.screenName}</span>
                                  </td>
                                  <td className="hidden md:table-cell px-3 py-2 text-xs text-ink-muted">
                                    {d.shows} {d.shows === 1 ? "show" : "shows"}
                                  </td>
                                  <td className="px-3 py-2" />
                                  <td className="px-3 py-2 text-right tabular-nums text-xs">{fmtInt(d.qty)}</td>
                                  <td className="hidden lg:table-cell px-3 py-2 text-right tabular-nums text-xs">{fmtINR(d.taxable)}</td>
                                  <td className="hidden lg:table-cell px-3 py-2 text-right tabular-nums text-xs">{fmtINR(d.gst)}</td>
                                  <td className="px-3 py-2 text-right tabular-nums text-xs whitespace-nowrap">{fmtINR(d.amount)}</td>
                                </tr>
                              ))
                            : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>

          <DayTable rows={rows} />
        </>
      )}
    </div>
  );
}

// ── totals ─────────────────────────────────────────────────────────────

function TotalsStrip({
  totals,
  days,
  movies,
}: {
  totals: GlassesTotals;
  days: number;
  movies: number;
}) {
  return (
    <Card>
      <CardBody className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <Tile label="Collected" value={fmtINR(totals.amount)} highlight />
        <Tile label="Pairs issued" value={fmtInt(totals.qty)} />
        <Tile label="Taxable value" value={fmtINR(totals.taxable)} />
        <Tile label="GST (inclusive)" value={fmtINR(totals.gst)} />
        <Tile label="3D days · movies" value={`${fmtInt(days)} · ${fmtInt(movies)}`} />
      </CardBody>
    </Card>
  );
}

function Tile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-ink-muted font-semibold">
        {label}
      </div>
      <div className={"tabular-nums mt-1 " + (highlight ? "text-2xl font-bold" : "text-lg")}>
        {value}
      </div>
    </div>
  );
}

// ── day detail ─────────────────────────────────────────────────────────

function DayTable({ rows }: { rows: GlassesDayRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Day by day</CardTitle>
        <Badge tone="neutral">{rows.length} {rows.length === 1 ? "day" : "days"}</Badge>
      </CardHeader>
      <CardBody className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-ink-muted border-b border-line">
                <th className="text-left px-3 py-3 font-semibold whitespace-nowrap">Date</th>
                <th className="text-left px-3 py-3 font-semibold">Movie</th>
                <th className="hidden md:table-cell text-left px-3 py-3 font-semibold">Screen</th>
                <th className="hidden lg:table-cell text-right px-3 py-3 font-semibold">Shows</th>
                <th className="text-right px-3 py-3 font-semibold">Pairs</th>
                <th className="hidden lg:table-cell text-right px-3 py-3 font-semibold">Taxable</th>
                <th className="hidden lg:table-cell text-right px-3 py-3 font-semibold">GST</th>
                <th className="text-right px-3 py-3 font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.date}-${r.movieId}-${r.screenId}`} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div>{niceDate(r.date)}</div>
                    <div className="text-xs text-ink-muted">{weekday(r.date)}</div>
                  </td>
                  <td className="px-3 py-3 font-medium">
                    <div>{r.movieName}</div>
                    <div className="md:hidden text-xs text-ink-muted">{r.screenName}</div>
                  </td>
                  <td className="hidden md:table-cell px-3 py-3">{r.screenName}</td>
                  <td className="hidden lg:table-cell px-3 py-3 text-right tabular-nums">{fmtInt(r.shows)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmtInt(r.qty)}</td>
                  <td className="hidden lg:table-cell px-3 py-3 text-right tabular-nums">{fmtINR(r.taxable)}</td>
                  <td className="hidden lg:table-cell px-3 py-3 text-right tabular-nums">{fmtINR(r.gst)}</td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold whitespace-nowrap">
                    {fmtINR(r.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

function niceDate(d: DateISO): string {
  if (!d) return "—";
  try { return format(parseISO(d), "d MMM yyyy"); } catch { return d; }
}
