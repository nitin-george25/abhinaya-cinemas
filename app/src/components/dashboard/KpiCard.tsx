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
 * KPI tile, value-led:
 *
 *   COMBINED REVENUE              ← small uppercase label
 *   ₹ 5.4L              ▲ 12.3%   ← big value with delta chip on same baseline
 *   BO + F&B · vs ₹ 4.8L           ← sublabel + prior on a muted footer row
 *
 * Compact number formatting kicks in below sm so 2-up tiles never overflow.
 * The delta sits beside the value (instead of below) so the card has only
 * three text rows instead of four, and the eye lands on the number first.
 */
export function KpiCard({ label, value, prevValue, format, sublabel }: Props) {
  const full = fullFormatters[format];
  const compact = compactFormatters[format];
  const delta = pctDelta(value, prevValue);
  const positive = delta != null && delta >= 0;

  // Compose the muted footer row: sublabel, optional "vs <prev>" (desktop
  // only — it eats the row on mobile), or "no prior period" when there's
  // nothing to compare against.
  const footerLeft = sublabel ?? "";
  const footerRight =
    delta == null
      ? "no prior period"
      : prevValue != null
        ? `vs ${full(prevValue)}`
        : "";
  const showFooter = !!(footerLeft || footerRight);

  return (
    <Card>
      <CardBody className="p-3 sm:p-5">
        <h3 className="text-[10px] sm:text-[11px] font-semibold tracking-wider uppercase text-ink-muted truncate">
          {label}
        </h3>

        <div className="mt-1.5 flex items-baseline justify-between gap-2">
          <div className="text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums leading-none truncate min-w-0">
            <span className="sm:hidden">{compact(value)}</span>
            <span className="hidden sm:inline">{full(value)}</span>
          </div>
          {delta != null ? (
            <span
              className={
                "text-xs sm:text-sm font-medium tabular-nums shrink-0 " +
                (positive ? "text-green-700" : "text-red-700")
              }
            >
              {positive ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
            </span>
          ) : null}
        </div>

        {showFooter ? (
          <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[10px] sm:text-[11px] text-ink-muted">
            <span className="truncate min-w-0">{footerLeft}</span>
            {/* Hide the "vs ₹ X" tail on phones where it competes with
                sublabel for space. "no prior period" still shows. */}
            <span
              className={
                "shrink-0 " +
                (footerRight === "no prior period" ? "" : "hidden sm:inline")
              }
            >
              {footerRight}
            </span>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
