import { useState } from "react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Badge } from "../ui/Badge";
import type { PresetId } from "../../lib/dashboard";
import type { DateISO } from "../../lib/types";

const PRESETS: Array<[PresetId, string, string]> = [
  // [id, full label, short label for mobile]
  ["last7",     "Last 7 days",  "7d"],
  ["last30",    "Last 30 days", "30d"],
  ["last90",    "Last 90 days", "90d"],
  ["thisMonth", "This month",   "Month"],
  ["all",       "All time",     "All"],
  ["custom",    "Custom",       "Custom"],
];

interface Props {
  preset: PresetId;
  custom: { from: DateISO; to: DateISO } | null;
  rangeLabel: string;
  onChange: (next: { preset: PresetId; custom?: { from: DateISO; to: DateISO } }) => void;
}

/**
 * Pills on every viewport — smaller on mobile (h-7, text-xs, short labels)
 * with wrap. The wide-form range badge moves below the pills on mobile so
 * it never pushes the row over the viewport.
 */
export function PeriodSelector({ preset, custom, rangeLabel, onChange }: Props) {
  const [from, setFrom] = useState(custom?.from ?? "");
  const [to, setTo] = useState(custom?.to ?? "");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map(([id, full, short]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              if (id !== "custom") onChange({ preset: id });
              else onChange({ preset: id, custom: { from: from || "", to: to || "" } });
            }}
            className={
              // Smaller pills on mobile to fit two rows of choices on a phone.
              "h-7 px-2.5 text-xs sm:h-8 sm:px-3 sm:text-sm " +
              "rounded-lg font-medium transition-colors " +
              (preset === id
                ? "bg-ink text-white"
                : "bg-white text-ink-muted hover:text-ink hover:bg-paper border border-line")
            }
          >
            {/* Short label on mobile, full on sm+. */}
            <span className="sm:hidden">{short}</span>
            <span className="hidden sm:inline">{full}</span>
          </button>
        ))}
        <Badge tone="neutral" className="hidden sm:inline-flex ml-auto">{rangeLabel}</Badge>
      </div>

      {/* Range label drops below the pills on mobile so it doesn't crowd them. */}
      <div className="sm:hidden text-[11px] text-ink-muted leading-snug">
        {rangeLabel}
      </div>

      {preset === "custom" ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="block text-[11px] uppercase tracking-wider text-ink-muted">From</span>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full sm:w-44"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] uppercase tracking-wider text-ink-muted">To</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full sm:w-44"
            />
          </label>
          <Button
            onClick={() => {
              if (!from || !to) return;
              if (from > to) return;
              onChange({ preset: "custom", custom: { from, to } });
            }}
            disabled={!from || !to || from > to}
            className="w-full sm:w-auto"
          >
            Apply
          </Button>
        </div>
      ) : null}
    </div>
  );
}
