import { useState } from "react";
import { Button } from "../ui/Button";
import { Input, Select } from "../ui/Input";
import { Badge } from "../ui/Badge";
import type { PresetId } from "../../lib/dashboard";
import type { DateISO } from "../../lib/types";

const PRESETS: Array<[PresetId, string]> = [
  ["last7",     "Last 7 days"],
  ["last30",    "Last 30 days"],
  ["last90",    "Last 90 days"],
  ["thisMonth", "This month"],
  ["all",       "All time"],
  ["custom",    "Custom"],
];

interface Props {
  preset: PresetId;
  custom: { from: DateISO; to: DateISO } | null;
  rangeLabel: string;
  onChange: (next: { preset: PresetId; custom?: { from: DateISO; to: DateISO } }) => void;
}

export function PeriodSelector({ preset, custom, rangeLabel, onChange }: Props) {
  const [from, setFrom] = useState(custom?.from ?? "");
  const [to, setTo] = useState(custom?.to ?? "");

  return (
    <div className="space-y-3">
      {/* Mobile: single dropdown. Desktop: pill row. */}
      <div className="sm:hidden flex items-center gap-2">
        <Select
          value={preset}
          onChange={(e) => {
            const id = e.target.value as PresetId;
            if (id !== "custom") onChange({ preset: id });
            else onChange({ preset: id, custom: { from: from || "", to: to || "" } });
          }}
          className="flex-1"
        >
          {PRESETS.map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </Select>
        <Badge tone="neutral" className="whitespace-nowrap">{rangeLabel}</Badge>
      </div>

      <div className="hidden sm:flex flex-wrap items-center gap-2">
        {PRESETS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              if (id !== "custom") onChange({ preset: id });
              else onChange({ preset: id, custom: { from: from || "", to: to || "" } });
            }}
            className={
              "h-8 px-3 rounded-lg text-sm font-medium transition-colors " +
              (preset === id
                ? "bg-ink text-white"
                : "bg-white text-ink-muted hover:text-ink hover:bg-paper border border-line")
            }
          >
            {label}
          </button>
        ))}
        <Badge tone="neutral" className="ml-auto">{rangeLabel}</Badge>
      </div>

      {preset === "custom" ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="block text-[11px] uppercase tracking-wider text-ink-muted">From</span>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-44"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] uppercase tracking-wider text-ink-muted">To</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-44"
            />
          </label>
          <Button
            onClick={() => {
              if (!from || !to) return;
              if (from > to) return;
              onChange({ preset: "custom", custom: { from, to } });
            }}
            disabled={!from || !to || from > to}
          >
            Apply
          </Button>
        </div>
      ) : null}
    </div>
  );
}
