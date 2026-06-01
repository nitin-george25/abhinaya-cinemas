import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";

import { useSync } from "../lib/hooks/SyncContext";
import {
  aggregateBO,
  aggregateFB,
  buildDateList,
  fmtINR,
  fmtInt,
  resolvePeriod,
  type PresetId,
} from "../lib/dashboard";
import type { DateISO } from "../lib/types";

import { KpiCard } from "../components/dashboard/KpiCard";
import { PeriodSelector } from "../components/dashboard/PeriodSelector";
import { RevenueChart } from "../components/dashboard/RevenueChart";
import { RollupTable } from "../components/dashboard/RollupTable";
import { Card, CardBody } from "../components/ui/Card";

type Custom = { from: DateISO; to: DateISO } | null;

export default function Dashboard() {
  const { state } = useSync();
  const appState = state.appState;

  const [preset, setPreset] = useState<PresetId>("last30");
  const [custom, setCustom] = useState<Custom>(null);

  // Resolve current + comparison periods + run aggregations.
  const view = useMemo(() => {
    if (!appState) return null;
    const period = resolvePeriod(preset, appState, custom ?? undefined);
    const dates = buildDateList(period);
    const prevPeriod = {
      from: period.prevFrom,
      to: period.prevTo,
      days: period.days,
      prevFrom: period.prevFrom,
      prevTo: period.prevTo,
    };
    const cur = aggregateBO(appState, period);
    const prev = aggregateBO(appState, prevPeriod);
    const fbCur  = aggregateFB(appState, period,     cur.totals.audience);
    const fbPrev = aggregateFB(appState, prevPeriod, prev.totals.audience);
    return { period, dates, cur, prev, fbCur, fbPrev };
  }, [appState, preset, custom]);

  if (!appState) {
    return (
      <Card>
        <CardBody className="text-sm text-ink-muted">Loading cloud data…</CardBody>
      </Card>
    );
  }
  if (!view) return null;

  const { period, dates, cur, prev, fbCur, fbPrev } = view;
  const combinedCur  = cur.totals.grossColl + fbCur.totals.net;
  const combinedPrev = prev.totals.grossColl + fbPrev.totals.net;
  const rangeLabel = `${niceDate(period.from)} → ${niceDate(period.to)} · ${period.days} day${period.days === 1 ? "" : "s"} · vs ${niceDate(period.prevFrom)} → ${niceDate(period.prevTo)}`;

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-sm text-ink-muted mt-1">
            Read-only snapshot of cloud data — box office + F&amp;B.
          </p>
        </div>
      </div>

      <PeriodSelector
        preset={preset}
        custom={custom}
        rangeLabel={rangeLabel}
        onChange={({ preset: p, custom: c }) => {
          setPreset(p);
          if (c) setCustom(c);
          else if (p !== "custom") setCustom(null);
        }}
      />

      {/* KPI strip — combined revenue + BO core + F&B core */}
      <div className="space-y-3">
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
          <KpiCard
            label="Combined Revenue"
            value={combinedCur}
            prevValue={combinedPrev}
            format="inr"
            sublabel="BO + F&B"
          />
          <KpiCard
            label="Tickets sold"
            value={cur.totals.audience}
            prevValue={prev.totals.audience}
            format="int"
          />
          <KpiCard
            label="BO Gross"
            value={cur.totals.grossColl}
            prevValue={prev.totals.grossColl}
            format="inr"
          />
          <KpiCard
            label="ATP"
            value={cur.totals.atp}
            prevValue={prev.totals.atp}
            format="inr2"
            sublabel="₹ / ticket"
          />
          <KpiCard
            label="Occupancy"
            value={cur.totals.occupancyPct}
            prevValue={prev.totals.occupancyPct}
            format="pct"
          />
        </div>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
          <KpiCard
            label="Net Share"
            value={cur.totals.netShare}
            prevValue={prev.totals.netShare}
            format="inr"
            sublabel="after taxes & fund"
          />
          <KpiCard
            label="F&B Net"
            value={fbCur.totals.net}
            prevValue={fbPrev.totals.net}
            format="inr"
          />
          <KpiCard
            label="SPH"
            value={fbCur.totals.sph}
            prevValue={fbPrev.totals.sph}
            format="inr2"
            sublabel="₹ / ticket"
          />
          <KpiCard
            label="F&B Bills"
            value={fbCur.totals.bills}
            prevValue={fbPrev.totals.bills}
            format="int"
          />
          <KpiCard
            label="F&B Tax"
            value={fbCur.totals.tax}
            prevValue={fbPrev.totals.tax}
            format="inr"
            sublabel="GST etc."
          />
        </div>
      </div>

      {/* Chart */}
      <RevenueChart dates={dates} bo={cur} />

      {/* Two-column rollups */}
      <div className="grid gap-6 lg:grid-cols-2">
        <RollupTable
          title="Top movies"
          subtitle={`${cur.byMovie.length} in period`}
          rows={cur.byMovie}
          limit={10}
          cols={[
            { header: "Movie", render: (m) => <span className="font-medium">{m.movieName}</span> },
            { header: "Days", align: "right", render: (m) => fmtInt(m.daysPlayed) },
            { header: "Tickets", align: "right", render: (m) => fmtInt(m.audience) },
            { header: "Gross", align: "right", render: (m) => fmtINR(m.grossColl) },
            { header: "Net Share", align: "right", render: (m) => fmtINR(m.netShare) },
          ]}
        />
        <RollupTable
          title="By screen"
          subtitle={`${cur.byScreen.length} screen${cur.byScreen.length === 1 ? "" : "s"}`}
          rows={cur.byScreen}
          cols={[
            { header: "Screen", render: (s) => <span className="font-medium">{s.screenName}</span> },
            { header: "Shows", align: "right", render: (s) => fmtInt(s.showCount) },
            { header: "Tickets", align: "right", render: (s) => fmtInt(s.audience) },
            { header: "Gross", align: "right", render: (s) => fmtINR(s.grossColl) },
            { header: "Occ%", align: "right", render: (s) => occPctCell(s.audience, s.seatsAvailable) },
          ]}
        />
      </div>

      <CategoryMixCard categories={fbCur.byCategory} />
    </div>
  );
}

function CategoryMixCard({
  categories,
}: {
  categories: Array<{ category: string; net: number; qty: number }>;
}) {
  if (!categories.length) return null;
  const total = categories.reduce((a, c) => a + c.net, 0);
  if (!total) return null;
  return (
    <Card>
      <CardBody>
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="font-semibold tracking-tight">F&amp;B category mix</h3>
          <span className="text-xs text-ink-muted">{fmtINR(total)} total</span>
        </div>
        <ul className="space-y-2">
          {categories.slice(0, 8).map((c) => {
            const pct = (c.net / total) * 100;
            return (
              <li key={c.category} className="space-y-1">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{c.category}</span>
                  <span className="tabular-nums text-ink-muted">
                    {fmtINR(c.net)} · {pct.toFixed(1)}%
                  </span>
                </div>
                <div className="h-1.5 bg-paper rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-400"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

function niceDate(d: DateISO): string {
  try {
    return format(parseISO(d), "d MMM");
  } catch {
    return d;
  }
}

function occPctCell(audience: number, seats: number): string {
  if (!seats) return "—";
  return ((audience / seats) * 100).toFixed(1) + "%";
}
