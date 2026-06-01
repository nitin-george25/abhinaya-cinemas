// ============================================================================
// F&B Sales — daily summary view of fb_entries.
//
// READ-ONLY in /v2/ for this first pass — POS upload + manual entry remain
// in the legacy app at /admin/dcr/ until C6.2. The realtime subscription
// (set up in useSupabaseSync) means new days entered there appear here
// within ~700ms.
// ============================================================================

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";

import { useSync } from "../lib/hooks/SyncContext";
import { fmtINR, fmtInt } from "../lib/dashboard";
import { N } from "../lib/engine";
import { weekday } from "../lib/format";
import type { DateISO, FbEntry } from "../lib/types";

import { Card, CardBody } from "../components/ui/Card";
import { Field, Input } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";

interface Filters {
  from: DateISO | "";
  to: DateISO | "";
}
const EMPTY_FILTERS: Filters = { from: "", to: "" };

export default function FBPage() {
  const { state } = useSync();
  const appState = state.appState;
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const rows = useMemo<FbEntry[]>(() => {
    if (!appState) return [];
    let r = (appState.fbEntries ?? []).slice();
    if (filters.from) r = r.filter((e) => e.date >= filters.from);
    if (filters.to)   r = r.filter((e) => e.date <= filters.to);
    r.sort((a, b) => b.date.localeCompare(a.date));
    return r;
  }, [appState, filters]);

  if (!appState) {
    return (
      <Card>
        <CardBody className="text-sm text-ink-muted">Loading cloud data…</CardBody>
      </Card>
    );
  }

  const totals = rows.reduce(
    (a, e) => {
      const s = e.summary ?? {};
      return {
        net: a.net + N(s.grossSales),
        total: a.total + N(s.netSalesWithTax),
        tax: a.tax + N(s.addTax),
        bills: a.bills + (s.bills == null ? 0 : N(s.bills)),
        items: a.items + (e.items?.length ?? 0),
      };
    },
    { net: 0, total: 0, tax: 0, bills: 0, items: 0 },
  );

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-3xl font-bold tracking-tight">F&amp;B sales</h2>
          <p className="text-sm text-ink-muted mt-1">
            Read-only view of every F&amp;B day in the cloud. POS upload + manual
            entry remain on{" "}
            <a className="text-amber-600 underline" href="/admin/dcr-legacy/">
              the legacy console
            </a>{" "}
            for now.
          </p>
        </div>
      </div>

      <FilterBar
        filters={filters}
        onChange={setFilters}
        onReset={() => setFilters(EMPTY_FILTERS)}
      />

      <ResultsCount count={rows.length} totals={totals} />

      <FBTable rows={rows} />
    </div>
  );
}

// ── filter bar ─────────────────────────────────────────────────────────

function FilterBar({
  filters,
  onChange,
  onReset,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  onReset: () => void;
}) {
  const dirty = filters.from || filters.to;
  return (
    <Card>
      <CardBody className="grid gap-3 sm:grid-cols-3 items-end">
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

// ── totals strip ───────────────────────────────────────────────────────

function ResultsCount({
  count,
  totals,
}: {
  count: number;
  totals: { net: number; total: number; tax: number; bills: number; items: number };
}) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-3 text-sm">
      <div className="text-ink-muted">
        {count === 0 ? "No days match" : `${count} day${count === 1 ? "" : "s"}`}
      </div>
      {count > 0 ? (
        <div className="flex items-center gap-4 tabular-nums">
          <span><span className="text-ink-muted">Net:</span>   <b>{fmtINR(totals.net)}</b></span>
          <span><span className="text-ink-muted">Tax:</span>   <b>{fmtINR(totals.tax)}</b></span>
          <span><span className="text-ink-muted">Total:</span> <b>{fmtINR(totals.total)}</b></span>
          <span><span className="text-ink-muted">Bills:</span> <b>{fmtInt(totals.bills)}</b></span>
        </div>
      ) : null}
    </div>
  );
}

// ── table ──────────────────────────────────────────────────────────────

function FBTable({ rows }: { rows: FbEntry[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardBody className="py-10 text-center space-y-2">
          <Badge tone="neutral">Empty</Badge>
          <p className="text-sm text-ink-muted">No F&amp;B days match the filters.</p>
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
                <th className="text-right px-3 py-3 font-semibold whitespace-nowrap">Food</th>
                <th className="text-right px-3 py-3 font-semibold whitespace-nowrap">Beverages</th>
                <th className="text-right px-3 py-3 font-semibold whitespace-nowrap">Net</th>
                <th className="text-right px-3 py-3 font-semibold whitespace-nowrap">Tax</th>
                <th className="text-right px-3 py-3 font-semibold whitespace-nowrap">Total</th>
                <th className="text-right px-3 py-3 font-semibold whitespace-nowrap">Bills</th>
                <th className="text-right px-3 py-3 font-semibold whitespace-nowrap">Items</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const s = e.summary ?? {};
                return (
                  <tr
                    key={e.id}
                    className="border-b border-line last:border-b-0 hover:bg-paper/60"
                  >
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div>{niceDate(e.date)}</div>
                      <div className="text-xs text-ink-muted">{weekday(e.date)}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                      {fmtINR(N(s.foodSales))}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                      {fmtINR(N(s.beveragesSales))}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap font-medium">
                      {fmtINR(N(s.grossSales))}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-ink-muted">
                      {fmtINR(N(s.addTax))}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                      {fmtINR(N(s.netSalesWithTax))}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                      {s.bills == null ? "—" : fmtInt(N(s.bills))}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-ink-muted">
                      {fmtInt(e.items?.length ?? 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

function niceDate(d: DateISO | undefined): string {
  if (!d) return "—";
  try { return format(parseISO(d), "d MMM yyyy"); } catch { return d; }
}
