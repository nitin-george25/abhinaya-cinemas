// ============================================================================
// PaymentStatusBadge — maps a payment lifecycle status to a Badge tone + label.
//
// Extends the shared <Badge> (does NOT fork it) with the 10-state → tone map
// from the design handoff (README "Status → display map"). Kept in one place so
// the inbox, drawer, rows and reports all render status identically.
// ============================================================================

import { Badge } from "../ui/Badge";

type Tone = "neutral" | "amber" | "green" | "red" | "blue";

const MAP: Record<string, { label: string; tone: Tone }> = {
  draft:                     { label: "Draft",          tone: "neutral" },
  quoting:                   { label: "Quoting",        tone: "blue"    },
  quote_approved:            { label: "Quote approved", tone: "blue"    },
  invoiced:                  { label: "Invoiced",       tone: "blue"    },
  // legacy + new "awaiting owner" states all read the same to the operator
  pending:                   { label: "Awaiting owner", tone: "amber"   },
  awaiting:                  { label: "Awaiting owner", tone: "amber"   },
  awaiting_approval:         { label: "Awaiting owner", tone: "amber"   },
  awaiting_payment_approval: { label: "Awaiting owner", tone: "amber"   },
  approved:                  { label: "Approved — pay", tone: "green"   },
  rejected:                  { label: "Rejected",       tone: "red"     },
  paid:                      { label: "Paid",           tone: "green"   },
  posted:                    { label: "Posted",         tone: "green"   },
  petty:                     { label: "Petty",          tone: "neutral" },
};

export function PaymentStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const m = MAP[status] ?? { label: status, tone: "neutral" as Tone };
  return <Badge tone={m.tone} className={className}>{m.label}</Badge>;
}
