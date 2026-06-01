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

// Compact variants for narrow tiles (mobile 2-up). Pct and the small inr2
// (ATP, SPH — typically 3-digit) stay full so precision shows.
const compactFormatters: Record<FormatKind, (v: number | null) => string> = {
  inr:  (v) => fmtINRCompact(v),
  inr2: (v) => fmtINR(v, 2),
  int:  (v) => fmtIntCompact(v),
  pct:  (v) => fmtPct(v, 1),
};

/**
 * One KPI tile: tiny label, big number, small delta line. The value renders
 * compact on phones (1.2L, 23K) and full on sm+ where the card is wider.
 * Sublabel sits below the value on mobile so the label row never wraps.
 */
export function KpiCard({ label, value, prevValue, format, sublabel }: Props) {
  const full = fullFormatters[format];
  const compact = compactFormatters[format];
  const delta = pctDelta(value, prevValue);
  const positive = delta != null && delta >= 0;

  return (
    <Card>
      <CardBody className="p-3 sm:p-5 space-y-1">
        <h3 className="text-[10px] sm:text-[11px] font-semibold tracking-wider uppercase text-ink-muted truncate">
          {label}
        </h3>

        {/* Compact on phones, full on sm+. Two spans, one visible per breakpoint —
            avoids JS detection and keeps the number tabular in both. */}
        <div className="tracking-tight tabular-nums font-semibold">
          <span className="sm:hidden text-xl">{compact(value)}</span>
          <span className="hidden sm:inline text-2xl">{full(value)}</span>
        </div>

        {sublabel ? (
          <div className="text-[10px] sm:text-[11px] text-ink-muted truncate">
            {sublabel}
          </div>
        ) : null}

        <div className="text-[11px] sm:text-xs text-ink-muted leading-snug min-h-[16px] truncate">
          {delta == null ? (
            <span>no prior period</span>
          ) : (
            <>
              <span className={positive ? "text-green-700" : "text-red-700"}>
                {positive ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
              </span>
              {/* Hide the "vs ₹ X" tail on mobile — it eats the row. */}
              <span className="ml-1.5 hidden sm:inline">vs {full(prevValue)}</span>
            </>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
