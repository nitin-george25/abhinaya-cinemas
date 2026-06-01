// ============================================================================
// Activity Log — recent cloud changes across BO entries, F&B days,
// cinema config, and the F&B product catalog. Replaces the C2 placeholder.
//
// Direct Supabase query (via fetchActivity) — does NOT touch AppState.
// ============================================================================

import { useEffect, useMemo, useState } from "react";

import { useSync } from "../lib/hooks/SyncContext";
import {
  TYPE_LABELS,
  TYPE_TONES,
  absTime,
  applyActivityFilters,
  fetchActivity,
  relTime,
  uniqueUsers,
  type ActivityEvent,
  type ActivityFilters,
  type ActivityType,
} from "../lib/activity";
import type { DateISO } from "../lib/types";

import { Card, CardBody } from "../components/ui/Card";
import { Field, Input, Select } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { IconSpinner } from "../components/icons";

const EMPTY_FILTERS: ActivityFilters = {
  user: "",
  type: "",
  from: "",
  to: "",
};

export default function ActivityPage() {
  const { state } = useSync();
  const appState = state.appState;

  const [items, setItems] = useState<ActivityEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<ActivityFilters>(EMPTY_FILTERS);

  async function load() {
    if (!appState) return;
    setLoading(true);
    try {
      const events = await fetchActivity(appState);
      setItems(events);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (appState && items === null) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState]);

  const visible = useMemo(
    () => (items ? applyActivityFilters(items, filters) : []),
    [items, filters],
  );
  const users = useMemo(() => (items ? uniqueUsers(items) : []), [items]);

  if (!appState) {
    return (
      <Card>
        <CardBody className="text-sm text-ink-muted">Loading cloud data…</CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-3xl font-bold tracking-tight">Activity log</h2>
          <p className="text-sm text-ink-muted mt-1">
            Recent changes across BO entries, F&amp;B days, cinema config, and
            the product catalog. Last 200 of each.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
          {loading ? <IconSpinner className="w-4 h-4 mr-1" /> : null}
          Refresh
        </Button>
      </div>

      <FilterBar
        filters={filters}
        users={users}
        onChange={setFilters}
        onReset={() => setFilters(EMPTY_FILTERS)}
      />

      <div className="text-sm text-ink-muted">
        {loading && items === null ? "Loading…" :
          `${visible.length} event${visible.length === 1 ? "" : "s"}` +
          (items && visible.length !== items.length ? ` of ${items.length}` : "")}
      </div>

      <ActivityTable items={visible} />
    </div>
  );
}

// ── filter bar ─────────────────────────────────────────────────────────

function FilterBar({
  filters,
  users,
  onChange,
  onReset,
}: {
  filters: ActivityFilters;
  users: string[];
  onChange: (f: ActivityFilters) => void;
  onReset: () => void;
}) {
  const dirty = filters.user || filters.type || filters.from || filters.to;
  return (
    <Card>
      <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
        <Field label="User">
          <Select
            value={filters.user}
            onChange={(e) => onChange({ ...filters, user: e.target.value })}
          >
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </Select>
        </Field>
        <Field label="Type">
          <Select
            value={filters.type}
            onChange={(e) =>
              onChange({ ...filters, type: e.target.value as ActivityType | "" })
            }
          >
            <option value="">All types</option>
            <option value="bo">{TYPE_LABELS.bo}</option>
            <option value="fb">{TYPE_LABELS.fb}</option>
            <option value="cfg">{TYPE_LABELS.cfg}</option>
            <option value="cat">{TYPE_LABELS.cat}</option>
          </Select>
        </Field>
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

// ── table ──────────────────────────────────────────────────────────────

function ActivityTable({ items }: { items: ActivityEvent[] }) {
  if (items.length === 0) {
    return (
      <Card>
        <CardBody className="py-10 text-center space-y-2">
          <Badge tone="neutral">Empty</Badge>
          <p className="text-sm text-ink-muted">
            No matching activity. Adjust filters or refresh.
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
                <th className="text-left px-3 py-3 font-semibold w-28 whitespace-nowrap">When</th>
                <th className="text-left px-3 py-3 font-semibold w-28">Type</th>
                <th className="text-left px-3 py-3 font-semibold">Where</th>
                <th className="text-left px-3 py-3 font-semibold">What</th>
                <th className="text-left px-3 py-3 font-semibold">Who</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 200).map((it, i) => (
                <tr
                  key={i}
                  className="border-b border-line last:border-b-0 hover:bg-paper/60"
                >
                  <td className="px-3 py-2.5 text-ink-muted whitespace-nowrap" title={absTime(it.when)}>
                    {relTime(it.when)}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={TYPE_TONES[it.type]}>{TYPE_LABELS[it.type]}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">
                    {it.location} · {it.screen}
                  </td>
                  <td className="px-3 py-2.5">{it.text}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{it.who}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
