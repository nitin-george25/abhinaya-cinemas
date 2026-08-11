import type { ReactNode } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { fmtINR, fmtInt } from "../../lib/dashboard";
import type { ComputedEntry } from "../../lib/types";

interface Props {
  computed: ComputedEntry;
}

/**
 * Live computed totals for the current entry. Mirrors the bottom panel of
 * the legacy entry tab — operator sees grand totals + today's roll + the
 * running cumulative for this movie+screen.
 */
export function EntryPreview({ computed }: Props) {
  const t = computed.today;
  const cum = computed.total;
  const g = computed.glasses;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Live preview</CardTitle>
        {computed.runningDay ? (
          <span className="text-xs text-ink-muted">
            Day {computed.runningDay} of release
          </span>
        ) : null}
      </CardHeader>
      <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <PreviewBlock title="Today">
          <Row label="Audience"   value={fmtInt(t.audience)} />
          <Row label="BO Gross"   value={fmtINR(t.grossColl)} />
          <Row label="GST"        value={fmtINR(t.gst)} />
          <Row label="eTax"       value={fmtINR(t.etax)} />
          <Row label="TMC + Cess" value={fmtINR(t.tmc + t.cess)} />
          <Row label="Rep Batta"  value={fmtINR(t.repBatta)} />
          <Row label="Fund"       value={fmtINR(t.fund)} />
          <Row label="Net Share"  value={fmtINR(t.netShare)} highlight />
          <Row label={`Distributor (${computed.share}%)`} value={fmtINR(t.distShare)} muted />
          <Row label="Exhibitor"  value={fmtINR(t.exShare)} muted />
        </PreviewBlock>

        <PreviewBlock title="Previous (this movie · this screen)">
          <Row label="Audience"   value={fmtInt(computed.previous.audience)} />
          <Row label="BO Gross"   value={fmtINR(computed.previous.grossColl)} />
          <Row label="Net Share"  value={fmtINR(computed.previous.netShare)} />
          <Row label="Distributor" value={fmtINR(computed.previous.distShare)} muted />
          <Row label="Exhibitor"  value={fmtINR(computed.previous.exShare)} muted />
        </PreviewBlock>

        <PreviewBlock title="Cumulative">
          <Row label="Audience"   value={fmtInt(cum.audience)} />
          <Row label="BO Gross"   value={fmtINR(cum.grossColl)} />
          <Row label="Net Share"  value={fmtINR(cum.netShare)} highlight />
          <Row label="Distributor" value={fmtINR(cum.distShare)} muted />
          <Row label="Exhibitor"  value={fmtINR(cum.exShare)} muted />
        </PreviewBlock>
      </CardBody>

      {/* Its own strip below the box-office blocks, not a row inside them:
          the rental is cinema-only income and never entered any figure above.
          Hidden entirely on a 2D day. */}
      {g.qty > 0 ? (
        <div className="border-t border-line px-4 py-3 sm:px-6 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <div className="text-[11px] uppercase tracking-wider font-semibold text-ink-muted">
              3D glasses · cinema only
            </div>
            <div className="text-xs text-ink-muted mt-0.5">
              {fmtInt(g.qty)} {g.qty === 1 ? "pair" : "pairs"} × {fmtINR(g.rate)}
              {" · "}not in Gross or Net Share, no distributor share
            </div>
          </div>
          <div className="ml-auto flex items-baseline gap-5 tabular-nums">
            <div className="text-right">
              <div className="text-[11px] text-ink-muted">GST ({g.gstPct}%, incl.)</div>
              <div className="text-sm">{fmtINR(g.gst)}</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-ink-muted">Collected</div>
              <div className="text-lg font-semibold">{fmtINR(g.amount)}</div>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function PreviewBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-[11px] uppercase tracking-wider font-semibold text-ink-muted">
        {title}
      </h3>
      <div className="divide-y divide-line">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  highlight,
  muted,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <span className={muted ? "text-ink-muted text-sm" : "text-sm"}>{label}</span>
      <span
        className={
          "tabular-nums whitespace-nowrap " +
          (highlight ? "font-semibold" : muted ? "text-ink-muted" : "")
        }
      >
        {value}
      </span>
    </div>
  );
}
