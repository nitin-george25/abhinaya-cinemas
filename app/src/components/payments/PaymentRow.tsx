// ============================================================================
// PaymentRow — one worklist row (desktop table). State-aware CTA hint; the
// whole row opens the detail drawer. Petty/project rows read muted (read-only).
// ============================================================================

import { PaymentStatusBadge } from "./PaymentStatusBadge";
import { fmtINR } from "../../lib/dashboard";
import type { PaymentInboxRow } from "../../lib/payments";

/** The verb the row offers, by lane — purely a hint; the drawer does the work. */
function ctaFor(row: PaymentInboxRow): string | null {
  if (row.readonly) return null;
  switch (row.lane) {
    case "draft":    return "Submit";
    case "approved": return "Mark paid";
    case "awaiting": return "View";
    default:         return null;
  }
}

export function PaymentRow({
  row,
  onOpen,
}: {
  row: PaymentInboxRow;
  onOpen: () => void;
}) {
  const cta = ctaFor(row);
  return (
    <tr
      className={`cursor-pointer border-t border-line hover:bg-paper ${row.readonly ? "text-ink-muted" : ""}`}
      onClick={onOpen}
    >
      <td className="px-4 py-2">
        <div className="font-medium text-ink">{row.payee}</div>
        <div className="font-mono text-xs text-ink-muted">{row.id.slice(0, 8)}</div>
      </td>
      <td className="px-4 py-2">
        <div>{row.typeLabel}</div>
        {row.accountingHead ? <div className="text-xs text-ink-muted">{row.accountingHead}</div> : null}
      </td>
      <td className="px-4 py-2">{row.source}</td>
      <td className="px-4 py-2 text-right font-mono tabular-nums">{fmtINR(row.amount)}</td>
      <td className="px-4 py-2"><PaymentStatusBadge status={row.status} /></td>
      <td className="px-4 py-2">{row.neededBy ?? "—"}</td>
      <td className="px-4 py-2 text-right">
        {cta ? <span className="text-xs font-medium text-amber-700">{cta} →</span> : null}
      </td>
    </tr>
  );
}
