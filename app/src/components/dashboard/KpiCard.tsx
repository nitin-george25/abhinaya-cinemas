import { Card, CardBody } from "../ui/Card";
import {
  fmtINR, fmtInt, fmtPct, pctDelta,
  fmtINRCompact, fmtIntCompact,
} from "../../lib/dashboard";

type FormatKind = "inr" | "int" | "pct" | "inr2";

interface Props {
  label: string;
  value: number | null;
  prevValue: number | null;
  format: FormatKind;
  sublabel?: string;
  /** Prior-period year — appears in the footer as "vs YYYY" so the user
   *  knows the delta is year-over-year, not a rolling window. */
  prevYear?: number;
}

const fullFormatters: Record<FormatKind, (v: number | null) => string> = {
  inr:  (v) => fmtINR(v, 0),
  inr2: (v) => fmtINR(v, 2),
  int:  (v) => fmtInt(v),
  pct:  (v) => fmtPct(v, 1),
};

// Compact variants for narrow tiles. Pct + inr2 (ATP, SPH — small 3-digit
// money) stay full so the precision is visible.
const compactFormatters: Record<FormatKind, (v: number | null) => string> = {
  inr:  (v) => fmtINRCompact(v),
  inr2: (v) => fmtINR(v, 2),
  int:  (v) => fmtIntCompact(v),
  pct:  (v) => fmtPct(v, 1),
};

/**
 * KPI tile, value-led with the delta tucked into the bottom-right:
 *
 *   COMBINED REVENUE
 *   ₹ 5.4L
 *   BO + F&B · vs 2025         ▲ 12.3%   ← context bottom-left, delta bottom-right
 *
 * Compact number formatting on phones so 2-up tiles never overflow.
 */
export function KpiCard({ label, value, prevValue, format, sublabel, prevYear }: Props) {
  const full = fullFormatters[format];
  const compact = compactFormatters[format];
  const delta = pctDelta(value, prevValue);
  const positive = delta != null && delta >= 0;

  // Footer-left text composes sublabel + "vs YYYY" context. Footer-right
  // is reserved for the delta chip. When there's no prior data, we use
  // the right slot to say so.
  const yearSuffix = prevYear != null
    ? `vs ${prevYear}`
    : "";
  const footerLeft = [sublabel, yearSuffix].filter(Boolean).join(" · ");

  return (
    <Card>
      <CardBody className="p-3 sm:p-5">
        <h3 className="text-[10px] sm:text-[11px] font-semibold tracking-wider uppercase text-ink-muted truncate">
          {label}
        </h3>

        <div className="mt-1.5 text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums leading-none truncate">
          <span className="sm:hidden">{compact(value)}</span>
          <span className="hidden sm:inline">{full(value)}</span>
        </div>

        <div className="mt-2 flex items-baseline justify-between gap-2 text-[10px] sm:text-[11px] text-ink-muted min-h-[14px]">
          <span className="truncate min-w-0">{footerLeft}</span>
          {delta != null ? (
            <span
              className={
                "text-xs sm:text-sm font-medium tabular-nums shrink-0 " +
                (positive ? "text-green-700" : "text-red-700")
              }
            >
              {positive ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
            </span>
          ) : (
            <span className="shrink-0">no prior yr</span>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
