// ============================================================================
// History — every entry in the cloud, filterable and clickable.
//
// Read-only. Clicking a row opens the same DcrModal the Entry page uses,
// so the operator (or accountant) can view + download the PDF / CSVs for
// any past day without leaving this page.
// ============================================================================

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { format, parseISO } from "date-fns";

import { useSync } from "../lib/hooks/SyncContext";
import { computeEntry } from "../lib/engine";
import { entryKey } from "../lib/mappers";
import { fetchEntriesPage } from "../lib/entriesApi";
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

/** Rows rendered per page. 50 keeps the DOM light now that the table
 *  holds the whole 2019-26 backfill (thousands of entries). */
const PAGE_SIZES = [25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 50;

interface Row {
  entry: Entry;
  computed: ComputedEntry;
}

export default function HistoryPage() {
  const { state, setAppState } = useSync();
  const appState = state.appState;
  const isOwner = state.role === "owner";

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [openRow, setOpenRow] = useState<Row | null>(null);
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  // Server-side pagination: only the visible page is fetched (and only
  // the visible page goes through the engine). `total` is the matching
  // row count across all pages, from PostgREST count: "exact".
  const [pageEntries, setPageEntries] = useState<Entry[]>([]);
  const [total, setTotal]             = useState(0);
  const [loading, setLoading]         = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void fetchEntriesPage(filters, page, pageSize).then((res) => {
      if (!alive) return;
      setPageEntries(res.entries);
      setTotal(res.total);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [filters, page, pageSize]);

  // Snap back to page 1 whenever the filters or page size change; clamp
  // if a filter shrank the set below the current page.
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => { setPage(1); }, [filters, pageSize]);
  useEffect(() => {
    if (!loading && page > pageCount) setPage(pageCount);
  }, [loading, page, pageCount]);

  const pageRows = useMemo<Row[]>(() => {
    if (!appState) return [];
    return pageEntries.map((entry) => ({ entry, computed: safeCompute(appState, entry) }));
  }, [appState, pageEntries]);

  if (!appState) {
    return (
      <Card>
        <CardBody className="text-sm text-ink-muted">Loading cloud data…</CardBody>
      </Card>
    );
  }

  // Owner-only: delete a DCR entry. Goes through the sync (remove from
  // appState → debounced push deletes the now-missing row from the DB),
  // matching how Settings/Entry deletes work, so the engine and cloud stay
  // consistent. The visible page is updated optimistically.
  function handleDelete(row: Row) {
    const { entry, computed } = row;
    const label = `${computed.movie?.name ?? entry.movieId} — ${niceDate(entry.date)}`;
    if (
      !window.confirm(
        `Delete the DCR for ${label}?\n\nThis permanently removes the entry from the cloud and can't be undone.`,
      )
    ) {
      return;
    }
    const key = entryKey(entry);
    setAppState({
      ...appState,
      entries: appState.entries.filter((e) => entryKey(e) !== key),
    });
    setPageEntries((prev) => prev.filter((e) => entryKey(e) !== key));
    setTotal((t) => Math.max(0, t - 1));
  }

  // Totals cover the rows on this page only — the share math lives in the
  // client-side engine (locked), so we don't aggregate the full filtered
  // set server-side.
  const pageTotal = pageRows.reduce(
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

      <ResultsCount count={total} loading={loading} total={pageTotal} />

      {loading && pageRows.length === 0 ? (
        <Card>
          <CardBody className="py-10 text-center text-sm text-ink-muted">
            Loading entries…
          </CardBody>
        </Card>
      ) : (
        <HistoryTable
          rows={pageRows}
          onSelect={setOpenRow}
          appState={appState}
          canDelete={isOwner}
          onDelete={handleDelete}
        />
      )}

      {total > 0 ? (
        <Pagination
          page={page}
          pageCount={pageCount}
          pageSize={pageSize}
          totalRows={total}
          onPage={setPage}
          onPageSize={setPageSize}
        />
      ) : null}

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
  loading,
  total,
}: {
  count: number;
  loading: boolean;
  total: { tickets: number; gross: number; netShare: number };
}) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-3 text-sm">
      <div className="text-ink-muted">
        {loading && count === 0
          ? "Loading…"
          : count === 0
          ? "No entries match"
          : `${fmtInt(count)} entr${count === 1 ? "y" : "ies"}`}
      </div>
      {count > 0 ? (
        <div className="flex items-center gap-4 tabular-nums">
          <span className="text-xs text-ink-muted uppercase tracking-wide">This page</span>
          <span><span className="text-ink-muted">Tickets:</span> <b>{fmtInt(total.tickets)}</b></span>
          <span><span className="text-ink-muted">Gross:</span>   <b>{fmtINR(total.gross)}</b></span>
          <span><span className="text-ink-muted">Net Share:</span> <b>{fmtINR(total.netShare)}</b></span>
        </div>
      ) : null}
    </div>
  );
}

// ── pagination bar ─────────────────────────────────────────────────────

function Pagination({
  page,
  pageCount,
  pageSize,
  totalRows,
  onPage,
  onPageSize,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  totalRows: number;
  onPage: (p: number) => void;
  onPageSize: (s: number) => void;
}) {
  const first = (page - 1) * pageSize + 1;
  const last  = Math.min(page * pageSize, totalRows);
  return (
    <div className="flex items-center justify-between flex-wrap gap-3 text-sm">
      <div className="text-ink-muted tabular-nums">
        Showing {fmtInt(first)}–{fmtInt(last)} of {fmtInt(totalRows)}
      </div>
      <div className="flex items-center gap-2">
        <Select
          value={String(pageSize)}
          onChange={(e) => onPageSize(Number(e.target.value))}
          aria-label="Rows per page"
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>{s} / page</option>
          ))}
        </Select>
        <Button
          size="sm"
          variant="secondary"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          ← Prev
        </Button>
        <span className="text-ink-muted tabular-nums whitespace-nowrap">
          {page} / {pageCount}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
        >
          Next →
        </Button>
      </div>
    </div>
  );
}

// ── results table ──────────────────────────────────────────────────────

function HistoryTable({
  rows,
  onSelect,
  appState,
  canDelete,
  onDelete,
}: {
  rows: Row[];
  onSelect: (r: Row) => void;
  appState: AppState;
  canDelete: boolean;
  onDelete: (r: Row) => void;
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
                <th className="hidden md:table-cell text-left px-3 py-3 font-semibold">Screen</th>
                <th className="hidden lg:table-cell text-right px-3 py-3 font-semibold whitespace-nowrap">Shows</th>
                <th className="hidden lg:table-cell text-right px-3 py-3 font-semibold whitespace-nowrap">Tickets</th>
                <th className="text-right px-3 py-3 font-semibold whitespace-nowrap">Gross</th>
                <th className="hidden md:table-cell text-right px-3 py-3 font-semibold whitespace-nowrap">Net Share</th>
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
                  canDelete={canDelete}
                  onDelete={onDelete}
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
  canDelete,
  onDelete,
}: {
  row: Row;
  onSelect: (r: Row) => void;
  appState: AppState;
  canDelete: boolean;
  onDelete: (r: Row) => void;
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
      <td className="px-3 py-3 whitespace-nowrap">
        <div>{niceDate(entry.date)}</div>
        <div className="text-xs text-ink-muted">{weekday(entry.date)}</div>
      </td>
      <td className="px-3 py-3 font-medium">
        <div>{computed.movie?.name ?? entry.movieId}</div>
        <div className="md:hidden text-xs text-ink-muted">
          {computed.screen?.name ?? entry.screenId}
        </div>
      </td>
      <td className="hidden md:table-cell px-3 py-3">
        {computed.screen?.name ?? entry.screenId}
      </td>
      <td className="hidden lg:table-cell px-3 py-3 text-right tabular-nums">
        {fmtInt((entry.shows ?? []).length)}
      </td>
      <td className="hidden lg:table-cell px-3 py-3 text-right tabular-nums">
        {fmtInt(computed.today.audience)}
      </td>
      <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
        {fmtINR(computed.today.grossColl)}
      </td>
      <td className="hidden md:table-cell px-3 py-3 text-right tabular-nums whitespace-nowrap">
        {fmtINR(computed.today.netShare)}
      </td>
      <td className="px-3 py-3 text-right whitespace-nowrap">
        <div className="inline-flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={dlPdf} title="Download DCR PDF" className="hidden sm:inline-flex">
            PDF
          </Button>
          <Button size="sm" variant="ghost" onClick={dlTally} title="Download Tally CSV" className="hidden sm:inline-flex">
            Tally
          </Button>
          <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); onSelect(row); }}>
            View
          </Button>
          {canDelete ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => { e.stopPropagation(); onDelete(row); }}
              title="Delete this DCR"
              className="text-red-700"
            >
              Delete
            </Button>
          ) : null}
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
