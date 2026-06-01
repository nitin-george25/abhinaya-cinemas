import { Card, CardBody } from "../ui/Card";
import { fmtINR, fmtInt, fmtPct, pctDelta } from "../../lib/dashboard";

type FormatKind = "inr" | "int" | "pct" | "inr2";

interface Props {
  label: string;
  value: number | null;
  prevValue: number | null;
  format: FormatKind;
  sublabel?: string;
}

const formatters: Record<FormatKind, (v: number | null) => string> = {
  inr:  (v) => fmtINR(v, 0),
  inr2: (v) => fmtINR(v, 2),
  int:  (v) => fmtInt(v),
  pct:  (v) => fmtPct(v, 1),
};

/**
 * One KPI tile: tiny label, big number (tabular), small delta line.
 * Delta colour is intentionally desaturated — this is a numbers-heavy ops
 * screen, not a stock ticker; we want it legible, not loud.
 */
export function KpiCard({ label, value, prevValue, format, sublabel }: Props) {
  const fmt = formatters[format];
  const delta = pctDelta(value, prevValue);
  const positive = delta != null && delta >= 0;

  return (
    <Card>
      <CardBody className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <h3 className="text-[11px] font-semibold tracking-wider uppercase text-ink-muted">
            {label}
          </h3>
          {sublabel ? (
            <span className="text-[11px] text-ink-muted">{sublabel}</span>
          ) : null}
        </div>
        <div className="text-2xl font-semibold tracking-tight tabular-nums">
          {fmt(value)}
        </div>
        <div className="text-xs text-ink-muted leading-snug min-h-[16px]">
          {delta == null ? (
            <span>no prior period</span>
          ) : (
            <>
              <span className={positive ? "text-green-700" : "text-red-700"}>
                {positive ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
              </span>
              <span className="ml-1.5">vs {fmt(prevValue)}</span>
            </>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
