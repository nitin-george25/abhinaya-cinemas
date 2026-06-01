// ============================================================================
// History — every entry in the cloud, filterable and clickable.
//
// Read-only. Clicking a row opens the same DcrModal the Entry page uses,
// so the operator (or accountant) can view + download the PDF / CSVs for
// any past day without leaving this page.
// ============================================================================

import { useMemo, useState, type MouseEvent } from "react";
import { format, parseISO } from "date-fns";

import { useSync } from "../lib/hooks/SyncContext";
import { computeEntry } from "../lib/engine";
import { weekday } from "../lib/format";
import { fmtINR, fmtInt } from "../lib/dashboard";
import { downloadDcrPdf } from "../lib/pdf";
import {
  downloadCsv,
  tallyCsvFilename,
  tallyCsvRows,
} from "../lib/csv";
import { LOGO_DATA_URL } from "../assets/logo";
import type {
  AppState,
  ComputedEntry,
  DateISO,
  Entry,
  UUID,
} from "../lib/types";

import { Card, CardBody } from "../components/ui/Card";
import { Field, Input, Select } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { DcrModal } from "../components/dcr/DcrModal";

interface Filters {
  from: DateISO | "";
  to: DateISO | "";
  movieId: UUID | "";
  screenId: UUID | "";
}

const EMPTY_FILTERS: Filters = { from: "", to: "", movieId: "", screenId: "" };

interface Row {
  entry: Entry;
  computed: ComputedEntry;
}

export default function HistoryPage() {
  const { state } = useSync();
  const appState = state.appState;

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [openRow, setOpenRow] = useState<Row | null>(null);

  const rows = useMemo<Row[]>(() => {
    if (!appState) return [];
    let entries = appState.entries.slice();
    if (filters.from) entries = entries.filter((e) => (e.date ?? "") >= filters.from);
    if (filters.to)   entries = entries.filter((e) => (e.date ?? "") <= filters.to);
    if (filters.movieId)  entries = entries.filter((e) => e.movieId === filters.movieId);
    if (filters.screenId) entries = entries.filter((e) => e.screenId === filters.screenId);
    entries.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    return entries.map((entry) => ({ entry, computed: safeCompute(appState, entry) }));
  }, [appState, filters]);

  if (!appState) {
    return (
      <Card>
        <CardBody className="text-sm text-ink-muted">Loading cloud data…</CardBody>
      </Card>
    );
  }

  const total = rows.reduce(
    (a, r) => ({
      tickets: a.tickets + r.computed.today.audience,
      gross: a.gross + r.computed.today.grossColl,
      netShare: a.netShare + r.computed.today.netShare,
    }),
    { tickets: 0, gross: 0, netShare: 0 },
  );

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-3xl font-bold tracking-tight">History</h2>
          <p className="text-sm text-ink-muted mt-1">
            Every entry in the cloud. Click a row to view, download as PDF, or
            export to CSV / Tally.
          </p>
        </div>
      </div>

      <FilterBar
        appState={appState}
        filters={filters}
        onChange={setFilters}
        onReset={() => setFilters(EMPTY_FILTERS)}
      />

      <ResultsCount count={rows.length} total={total} />

      <HistoryTable rows={rows} onSelect={setOpenRow} appState={appState} />

      {openRow ? (
        <DcrModal
          open={!!openRow}
          onClose={() => setOpenRow(null)}
          computed={openRow.computed}
          appState={appState}
        />
      ) : null}
    </div>
  );
}

// ── filter bar ─────────────────────────────────────────────────────────

function FilterBar({
  appState,
  filters,
  onChange,
  onReset,
}: {
  appState: AppState;
  filters: Filters;
  onChange: (f: Filters) => void;
  onReset: () => void;
}) {
  const dirty =
    filters.from || filters.to || filters.movieId || filters.screenId;
  return (
    <Card>
      <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
        <Field label="From">
          <Input
            type="date"
            value={filters.from}
            onChange={(e) => onChange({ ...filters, from: e.target.value as DateISO })}
          />
        </Field>
        <Field label="To">
          <Input
            type="date"
            value={filters.to}
            onChange={(e) => onChange({ ...filters, to: e.target.value as DateISO })}
          />
        </Field>
        <Field label="Movie">
          <Select
            value={filters.movieId}
            onChange={(e) => onChange({ ...filters, movieId: e.target.value as UUID })}
          >
            <option value="">All movies</option>
            {appState.movies.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Screen">
          <Select
            value={filters.screenId}
            onChange={(e) => onChange({ ...filters, screenId: e.target.value as UUID })}
          >
            <option value="">All screens</option>
            {appState.screens.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
        <div>
          <Button
            variant="ghost"
            size="md"
            disabled={!dirty}
            onClick={onReset}
            className="w-full sm:w-auto"
          >
            Reset
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

// ── count + totals strip ───────────────────────────────────────────────

function ResultsCount({
  count,
  total,
}: {
  count: number;
  total: { tickets: number; gross: number; netShare: number };
}) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-3 text-sm">
      <div className="text-ink-muted">
        {count === 0 ? "No entries match" : `${count} entr${count === 1 ? "y" : "ies"}`}
      </div>
      {count > 0 ? (
        <div className="flex items-center gap-4 tabular-nums">
          <span><span className="text-ink-muted">Tickets:</span> <b>{fmtInt(total.tickets)}</b></span>
          <span><span className="text-ink-muted">Gross:</span>   <b>{fmtINR(total.gross)}</b></span>
          <span><span className="text-ink-muted">Net Share:</span> <b>{fmtINR(total.netShare)}</b></span>
        </div>
      ) : null}
    </div>
  );
}

// ── results table ──────────────────────────────────────────────────────

function HistoryTable({
  rows,
  onSelect,
  appState,
}: {
  rows: Row[];
  onSelect: (r: Row) => void;
  appState: AppState;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardBody className="py-10 text-center space-y-2">
          <Badge tone="neutral">Empty</Badge>
          <p className="text-sm text-ink-muted">
            Nothing matches the current filters.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-ink-muted border-b border-line">
                <th className="text-left px-3 py-3 font-semibold whitespace-nowrap">Date</th>
                <th className="text-left px-3 py-3 font-semibold">Movie</th>
                <th className="text-left px-3 py-3 font-semibold">Screen</th>
                <th className="text-right px-3 py-3 font-semibold whitespace-nowrap">Shows</th>
                <th className="text-right px-3 py-3 font-semibold whitespace-nowrap">Tickets</th>
                <th className="text-right px-3 py-3 font-semibold whitespace-nowrap">Gross</th>
                <th className="text-right px-3 py-3 font-semibold whitespace-nowrap">Net Share</th>
                <th className="text-right px-3 py-3 font-semibold whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <HistoryRow
                  key={row.entry.id}
                  row={row}
                  onSelect={onSelect}
                  appState={appState}
                />
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

function HistoryRow({
  row,
  onSelect,
  appState,
}: {
  row: Row;
  onSelect: (r: Row) => void;
  appState: AppState;
}) {
  const { entry, computed } = row;

  // Stop row-click bubbling from triggering View when the user actually
  // hits one of the per-row action buttons.
  function dlPdf(e: MouseEvent) {
    e.stopPropagation();
    downloadDcrPdf(computed, {
      cinema: appState.cinema,
      tax: appState.tax,
      logoDataUrl: LOGO_DATA_URL,
    });
  }
  function dlTally(e: MouseEvent) {
    e.stopPropagation();
    const csv = tallyCsvRows(computed);
    if (csv.length < 2) {
      alert(
        "No sold tickets with serials to export yet. Enter tickets and make " +
          "sure a serial starting point exists.",
      );
      return;
    }
    downloadCsv(tallyCsvFilename(computed), csv);
  }

  return (
    <tr
      onClick={() => onSelect(row)}
      className="border-b border-line last:border-b-0 hover:bg-paper cursor-pointer"
    >
      <td className="px-3 py-2.5 whitespace-nowrap">
        <div>{niceDate(entry.date)}</div>
        <div className="text-xs text-ink-muted">{weekday(entry.date)}</div>
      </td>
      <td className="px-3 py-2.5 font-medium">
        {computed.movie?.name ?? entry.movieId}
      </td>
      <td className="px-3 py-2.5">
        {computed.screen?.name ?? entry.screenId}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {fmtInt((entry.shows ?? []).length)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {fmtInt(computed.today.audience)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
        {fmtINR(computed.today.grossColl)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
        {fmtINR(computed.today.netShare)}
      </td>
      <td className="px-3 py-2.5 text-right whitespace-nowrap">
        <div className="inline-flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={dlPdf} title="Download DCR PDF">
            PDF
          </Button>
          <Button size="sm" variant="ghost" onClick={dlTally} title="Download Tally CSV">
            Tally
          </Button>
          <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); onSelect(row); }}>
            View
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ── helpers ────────────────────────────────────────────────────────────

function niceDate(d: DateISO | undefined): string {
  if (!d) return "—";
  try { return format(parseISO(d), "d MMM yyyy"); } catch { return d; }
}

function safeCompute(state: AppState, entry: Entry): ComputedEntry {
  // computeEntry shouldn't throw on real data, but defensive: caller treats
  // .movie / .screen as optional anyway.
  return computeEntry(state, entry);
}
