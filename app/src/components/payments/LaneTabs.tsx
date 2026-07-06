// ============================================================================
// LaneTabs — the inbox status filter (All · Draft · Awaiting · Approved · Paid ·
// Petty) rendered as pill chips with per-lane counts.
// ============================================================================

import { cn } from "../ui/cn";
import type { PaymentLane } from "../../lib/payments";

export type Lane = "all" | PaymentLane;

const LANES: { key: Lane; label: string }[] = [
  { key: "all",      label: "All" },
  { key: "draft",    label: "Draft" },
  { key: "awaiting", label: "Awaiting" },
  { key: "approved", label: "Approved" },
  { key: "paid",     label: "Paid" },
  { key: "petty",    label: "Petty" },
];

export function LaneTabs({
  value,
  onChange,
  counts,
}: {
  value: Lane;
  onChange: (lane: Lane) => void;
  counts: Record<Lane, number>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {LANES.map((l) => {
        const active = l.key === value;
        return (
          <button
            key={l.key}
            type="button"
            onClick={() => onChange(l.key)}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60",
              active
                ? "border-ink bg-ink text-white"
                : "border-line bg-paper-card text-ink-muted hover:text-ink",
            )}
          >
            {l.label}
            <span
              className={cn(
                "rounded-full px-1.5 text-xs tabular-nums",
                active ? "bg-white/20" : "bg-paper text-ink-muted",
              )}
            >
              {counts[l.key] ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}
