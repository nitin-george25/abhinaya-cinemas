// ============================================================================
// Stepper — the 3-step header for the "Make a Payment" flow (Type → Details →
// Review). Purely presentational; the page owns the active step.
// ============================================================================

import { cn } from "../ui/cn";

export function Stepper({
  step,
  labels,
}: {
  step: number;            // 1-based
  labels: string[];
}) {
  return (
    <ol className="flex items-center gap-2">
      {labels.map((label, i) => {
        const n = i + 1;
        const active = n === step;
        const done = n < step;
        return (
          <li key={label} className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border text-sm font-semibold tabular-nums",
                  active && "border-ink bg-ink text-white",
                  done && "border-amber-300 bg-amber-50 text-ink-soft",
                  !active && !done && "border-line bg-paper text-ink-muted",
                )}
              >
                {n}
              </span>
              <span
                className={cn(
                  "text-sm font-medium",
                  active ? "text-ink" : "text-ink-muted",
                )}
              >
                {label}
              </span>
            </div>
            {n < labels.length ? (
              <span className="mx-1 h-px w-8 bg-line" aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
