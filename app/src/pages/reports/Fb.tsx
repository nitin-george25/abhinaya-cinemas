// ============================================================================
// Route page: /reports/fb — Daily F&B sales report.
//
// Verification-focused: every day in the filtered range shows totals + every
// item sold that day. Grand totals at the top, CSV export at the bottom.
// Built primarily for cross-checking the historical Excel backfill against
// what landed in fb_entries, but useful for ongoing reconciliation too.
// ============================================================================

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";

import { useSync } from "../../lib/hooks/SyncContext";
import { fmtINR, fmtInt } from "../../lib/dashboard";
import { N } from "../../lib/engine";
import { weekday } from "../../lib/format";
import { downloadCsv } from "../../lib/csv";
import type { DateISO, FbEntry, FbItem } from "../../lib/types";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";

interface Filters {
  from: DateISO | "";
  to: DateISO | "";
  itemQuery: string;
}

function defaultFrom(): DateISO {
  const d = new Date();
  d.setDate(d.getDate() - 89);
  return format(d, "yyyy-MM-dd") as DateISO;
}
function defaultTo(): DateISO {
  return format(new Date(), "yyyy-MM-dd") as DateISO;
}

export default function ReportsFbPage() {
  const { state } = useSync();
  const appState = state.appState;

  const [filters, setFilters] = useState<Filters>({
    from: defaultFrom(),
    to: defaultTo(),
    itemQuery: "",
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const rows = useMemo<FbEntry[]>(() => {
    if (!appState) return [];
    let r = (appState.fbEntries ?? []).slice();
    if (filters.from) r = r.filter((e) => e.date >= filters.from);
    if (filters.to)   r = r.filter((e) => e.date <= filters.to);
    if (filters.itemQuery.trim()) {
      const q = filters.itemQuery.trim().toLowerCase();
      r = r.filter((e) =>
        (e.items ?? []).some((it) => it.name.toLowerCase().includes(q)),
      );
    }
    r.sort((a, b) => b.date.localeCompare(a.date));
    return r;
  }, [appState, filters]);

  const totals = useMemo(() => rollup(rows), [rows]);

  if (!appState) {
    return (
      <Card>
        <CardBody className="text-sm text-ink-muted">Loading cloud data…</CardBody>
      </Card>
    );
  }

  function toggle(date: string) {
    setExpanded((p) => ({ ...p, [date]: !p[date] }));
  }
  function expandAll() {
    const next: Record<string, boolean> = {};
    rows.forEach((r) => { next[r.date] = true; });
    setExpanded(next);
  }
  function collapseAll() {
    setExpanded({});
  }

  function exportCsv() {
    const out: Array<Array<string | number>> = [];
    out.push([
      "Date", "Weekday", "Food Sales", "Beverages Sales", "Net",
      "Tax", "Total with Tax", "Bills", "Items count",
      "Item", "Item Qty", "Item Net Amount", "Item Category",
    ]);
    for (const e of rows) {
      const s = e.summary ?? {};
      const itemsArr = e.items ?? [];
      const dayRow: Array<string | number> = [
        e.date,
        weekday(e.date),
        N(s.foodSales),
        N(s.beveragesSales),
        N(s.grossSales),
        N(s.addTax),
        N(s.netSalesWithTax),
        s.bills == null ? "" : N(s.bills),
        itemsArr.length,
        "", "", "", "",
      ];
      out.push(dayRow);
      itemsArr.forEach((it) => {
        out.push([
          e.date, weekday(e.date),
          "", "", "", "", "", "", "",
          it.name, N(it.qty), N(it.netAmount), it.category ?? "",
        ]);
      });
    }
    const filename = `fb_daily_report_${filters.from || "start"}_${filters.to || "end"}.csv`;
    downloadCsv(filename, out);
  }

  return (
    <div className="space-y-5 max-w-7xl">
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight">F&amp;B daily sales report</h2>
        <p className="text-sm text-ink-muted mt-1">
          Every day in the selected range with totals and item-level detail.
          Use this to verify imported numbers against your POS or Excel source.
        </p>
      </div>

      <FilterBar
        filters={filters}
        onChange={setFilters}
        onReset={() => setFilters({ from: defaultFrom(), to: defaultTo(), itemQuery: "" })}
      />

      <PeriodTotals count={rows.length} totals={totals} />

      <div className="flex flex-wrap gap-2 print:hidden">
        <Button variant="secondary" size="sm" onClick={expandAll}>Expand all</Button>
        <Button variant="secondary" size="sm" onClick={collapseAll}>Collapse all</Button>
        <Button variant="secondary" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
          Export CSV
        </Button>
      </div>

      <DailyTable
        rows={rows}
        expanded={expanded}
        onToggle={toggle}
        itemFilter={filters.itemQuery.trim().toLowerCase()}
      />
    </div>
  );
}

// ── filters ────────────────────────────────────────────────────────────

function FilterBar({
  filters,
  onChange,
  onReset,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  onReset: () => void;
}) {
  const dirty = filters.from !== defaultFrom() || filters.to !== defaultTo() || !!filters.itemQuery;
  return (
    <Card>
      <CardBody className="grid gap-3 sm:grid-cols-4 items-end">
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
        <Field label="Item contains" hint="Filter days to those that sold this item">
          <Input
            type="text"
            placeholder="e.g. popcorn"
            value={filters.itemQuery}
            onChange={(e) => onChange({ ...filters, itemQuery: e.target.value })}
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

// ── period totals card ─────────────────────────────────────────────────

interface RollupTotals {
  food: number;
  bev: number;
  net: number;
  tax: number;
  total: number;
  bills: number;
  itemCount: number;
}

function rollup(rows: FbEntry[]): RollupTotals {
  return rows.reduce<RollupTotals>(
    (a, e) => {
      const s = e.summary ?? {};
      return {
        food: a.food + N(s.foodSales),
        bev: a.bev + N(s.beveragesSales),
        net: a.net + N(s.grossSales),
        tax: a.tax + N(s.addTax),
        total: a.total + N(s.netSalesWithTax),
        bills: a.bills + (s.bills == null ? 0 : N(s.bills)),
        itemCount: a.itemCount + (e.items?.length ?? 0),
      };
    },
    { food: 0, bev: 0, net: 0, tax: 0, total: 0, bills: 0, itemCount: 0 },
  );
}

function PeriodTotals({ count, totals }: { count: number; totals: RollupTotals }) {
  if (count === 0) {
    return (
      <Card>
        <CardBody className="text-sm text-ink-muted">
          No F&amp;B days in the selected range.
        </CardBody>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Period totals</CardTitle>
        <span className="text-xs text-ink-muted">
          {count} day{count === 1 ? "" : "s"} · {fmtInt(totals.itemCount)} item rows
        </span>
      </CardHeader>
      <CardBody className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
        <TotalCell label="Food" value={fmtINR(totals.food)} />
        <TotalCell label="Beverages" value={fmtINR(totals.bev)} />
        <TotalCell label="Net" value={fmtINR(totals.net)} bold />
        <TotalCell label="Tax" value={fmtINR(totals.tax)} />
        <TotalCell label="Total w/ Tax" value={fmtINR(totals.total)} bold />
        <TotalCell label="Bills" value={fmtInt(totals.bills)} />
      </CardBody>
    </Card>
  );
}

function TotalCell({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-ink-muted">{label}</div>
      <div className={"tabular-nums " + (bold ? "font-semibold text-base" : "text-sm")}>
        {value}
      </div>
    </div>
  );
}

// ── table ──────────────────────────────────────────────────────────────

function DailyTable({
  rows,
  expanded,
  onToggle,
  itemFilter,
}: {
  rows: FbEntry[];
  expanded: Record<string, boolean>;
  onToggle: (date: string) => void;
  itemFilter: string;
}) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardBody className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-ink-muted border-b border-line">
                <th className="w-8 px-3 py-3"></th>
                <th className="text-left px-3 py-3 font-semibold whitespace-nowrap">Date</th>
                <th className="text-right px-3 py-3 font-semibold whitespace-nowrap">Food</th>
                <th className="hidden sm:table-cell text-right px-3 py-3 font-semibold whitespace-nowrap">Beverages</th>
                <th className="text-right px-3 py-3 font-semibold whitespace-nowrap">Net</th>
                <th className="hidden md:table-cell text-right px-3 py-3 font-semibold whitespace-nowrap">Tax</th>
                <th className="hidden md:table-cell text-right px-3 py-3 font-semibold whitespace-nowrap">Total</th>
                <th className="hidden lg:table-cell text-right px-3 py-3 font-semibold whitespace-nowrap">Bills</th>
                <th className="text-right px-3 py-3 font-semibold whitespace-nowrap">Items</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <DayRows
                  key={e.id}
                  entry={e}
                  open={!!expanded[e.date]}
                  onToggle={() => onToggle(e.date)}
                  itemFilter={itemFilter}
                />
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

function DayRows({
  entry, open, onToggle, itemFilter,
}: {
  entry: FbEntry;
  open: boolean;
  onToggle: () => void;
  itemFilter: string;
}) {
  const s = entry.summary ?? {};
  const items = entry.items ?? [];
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-line last:border-b-0 hover:bg-paper/60 cursor-pointer"
      >
        <td className="px-3 py-3 text-center text-ink-muted">
          {items.length > 0 ? (open ? "▾" : "▸") : ""}
        </td>
        <td className="px-3 py-3 whitespace-nowrap">
          <div>{niceDate(entry.date)}</div>
          <div className="text-xs text-ink-muted">{weekday(entry.date)}</div>
        </td>
        <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
          {fmtINR(N(s.foodSales))}
        </td>
        <td className="hidden sm:table-cell px-3 py-3 text-right tabular-nums whitespace-nowrap">
          {fmtINR(N(s.beveragesSales))}
        </td>
        <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap font-medium">
          {fmtINR(N(s.grossSales))}
        </td>
        <td className="hidden md:table-cell px-3 py-3 text-right tabular-nums whitespace-nowrap text-ink-muted">
          {fmtINR(N(s.addTax))}
        </td>
        <td className="hidden md:table-cell px-3 py-3 text-right tabular-nums whitespace-nowrap">
          {fmtINR(N(s.netSalesWithTax))}
        </td>
        <td className="hidden lg:table-cell px-3 py-3 text-right tabular-nums whitespace-nowrap">
          {s.bills == null ? "—" : fmtInt(N(s.bills))}
        </td>
        <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap text-ink-muted">
          {fmtInt(items.length)}
        </td>
      </tr>

      {open && items.length > 0 ? (
        <tr className="bg-paper/40 border-b border-line">
          <td></td>
          <td colSpan={8} className="px-3 py-3">
            <ItemDetail items={items} itemFilter={itemFilter} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ItemDetail({ items, itemFilter }: { items: FbItem[]; itemFilter: string }) {
  const visible = itemFilter
    ? items.filter((it) => it.name.toLowerCase().includes(itemFilter))
    : items;
  // Sort by netAmount desc so the biggest items are at the top.
  const sorted = [...visible].sort((a, b) => N(b.netAmount) - N(a.netAmount));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-ink-muted">
            <th className="text-left py-1.5 pr-3 font-semibold">Item</th>
            <th className="hidden sm:table-cell text-left py-1.5 px-2 font-semibold w-32">Category</th>
            <th className="text-right py-1.5 px-2 font-semibold w-20">Qty</th>
            <th className="text-right py-1.5 pl-2 font-semibold w-28">Amount</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((it, i) => (
            <tr key={i} className="border-t border-line">
              <td className="py-1.5 pr-3">{it.name}</td>
              <td className="hidden sm:table-cell py-1.5 px-2 text-ink-muted capitalize">
                {it.category ?? "—"}
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums">{fmtInt(N(it.qty))}</td>
              <td className="py-1.5 pl-2 text-right tabular-nums">{fmtINR(N(it.netAmount))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function niceDate(d: DateISO | undefined): string {
  if (!d) return "—";
  try { return format(parseISO(d), "d MMM yyyy"); } catch { return d; }
}
