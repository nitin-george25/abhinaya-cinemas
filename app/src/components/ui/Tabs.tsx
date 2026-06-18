import type { ReactNode } from "react";
import { cn } from "./cn";

// ============================================================================
// Tabs — a compact segmented pill control (iOS-style). A neutral track holds
// the options; the active one lifts to a white pill with a subtle ring/shadow.
// Reusable across the app wherever you switch between a small set of views.
//
//   <Tabs options={[{value:"a",label:"A"},{value:"b",label:"B"}]} value={v} onChange={setV} />
// ============================================================================

export interface TabOption<T extends string> {
  value: T;
  label: ReactNode;
}

export function Tabs<T extends string>({
  options, value, onChange, className, size = "md",
}: {
  options: TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "px-3 py-1 text-xs" : "px-3.5 py-1.5 text-sm";
  return (
    <div
      role="tablist"
      className={cn("inline-flex items-center gap-1 rounded-full border border-line bg-paper p-1", className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-full font-medium transition-colors",
              pad,
              active
                ? "bg-white text-ink shadow-sm ring-1 ring-line"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
