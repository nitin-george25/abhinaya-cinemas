// ============================================================================
// QuoteCompareCard — one quotation in the asset compare view (S4). The owner
// approves one to lock the vendor + price (approval #1 of 2).
// ============================================================================

import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { fmtINR } from "../../lib/dashboard";
import type { PaymentQuotation } from "../../lib/payments";

export function QuoteCompareCard({
  quote,
  lowest,
  canApprove,
  busy,
  onApprove,
}: {
  quote: PaymentQuotation;
  lowest: boolean;
  canApprove: boolean;
  busy: boolean;
  onApprove: () => void;
}) {
  const approved = quote.status === "approved";
  const rejected = quote.status === "rejected";
  return (
    <div className={cn(
      "flex flex-col gap-2 rounded-xl border bg-paper-card p-4",
      approved ? "border-green-200 ring-1 ring-green-200" : "border-line",
      rejected && "opacity-50",
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-ink">{quote.vendor}</div>
        <div className="flex gap-1">
          {lowest ? <Badge tone="blue">Lowest</Badge> : null}
          {approved ? <Badge tone="green">Approved</Badge> : null}
          {rejected ? <Badge tone="neutral">Rejected</Badge> : null}
        </div>
      </div>
      <div className="font-mono text-xl tabular-nums">{fmtINR(quote.amount, 2)}</div>
      <dl className="space-y-0.5 text-xs text-ink-muted">
        {quote.leadTime ? <div>Lead time: {quote.leadTime}</div> : null}
        {quote.warranty ? <div>Warranty: {quote.warranty}</div> : null}
        {quote.notes ? <div>{quote.notes}</div> : null}
      </dl>
      <div className="flex items-center justify-between">
        <a href={quote.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-amber-700 hover:underline">
          View quote
        </a>
        {canApprove && quote.status === "submitted" ? (
          <Button size="sm" disabled={busy} onClick={onApprove}>Approve &amp; lock</Button>
        ) : null}
      </div>
    </div>
  );
}
