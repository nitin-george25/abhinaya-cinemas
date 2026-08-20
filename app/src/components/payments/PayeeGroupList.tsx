// ============================================================================
// PayeeGroupList — the inbox's "By payee" view.
//
// The list view is ordered by date, which is right for "what needs doing next"
// and wrong for "who do I owe". Four invoices for one vendor sit scattered among
// everything else, so batching only happens if the accountant happens to notice
// — which for sundry creditors accumulating over a fortnight is exactly when
// they won't.
//
// This collapses the same rows into one card per payee: how many, how much, and
// a Pay-together button that is live the moment two or more of them can actually
// be batched. The opportunity becomes visible instead of something to discover.
// ============================================================================

import { useState } from "react";

import { Card, CardBody } from "../ui/Card";
import { Button } from "../ui/Button";
import { PaymentStatusBadge } from "./PaymentStatusBadge";
import { fmtINR } from "../../lib/dashboard";
import type { PaymentInboxRow } from "../../lib/payments";

export interface PayeeGroup {
  key:       string;
  payee:     string;
  rows:      PaymentInboxRow[];
  batchable: PaymentInboxRow[];
  total:     number;
}

/**
 * Group rows by payee, biggest owing first. Only payees with something still
 * outstanding lead — a payee whose invoices are all paid is still listed (the
 * accountant may be looking one up) but sorts below.
 */
export function groupByPayee(
  rows: PaymentInboxRow[],
  canBatch: (r: PaymentInboxRow) => boolean,
): PayeeGroup[] {
  const byKey = new Map<string, PayeeGroup>();
  for (const r of rows) {
    const key = r.payee.trim().toLowerCase();
    let g = byKey.get(key);
    if (!g) {
      g = { key, payee: r.payee, rows: [], batchable: [], total: 0 };
      byKey.set(key, g);
    }
    g.rows.push(r);
    if (canBatch(r)) { g.batchable.push(r); g.total += r.amount; }
  }
  return [...byKey.values()].sort((a, b) =>
    b.batchable.length - a.batchable.length || b.total - a.total || a.payee.localeCompare(b.payee));
}

export function PayeeGroupList({
  groups,
  busy,
  onOpen,
  onPayTogether,
}: {
  groups: PayeeGroup[];
  busy: boolean;
  onOpen: (row: PaymentInboxRow) => void;
  onPayTogether: (rows: PaymentInboxRow[]) => void;
}) {
  // Anything with a batching opportunity opens expanded, so the invoices behind
  // the number are visible before the accountant commits to paying them.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const isOpen = (g: PayeeGroup) => !(collapsed[g.key] ?? g.batchable.length < 2);

  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const open = isOpen(g);
        const canPay = g.batchable.length >= 2;
        return (
          <Card key={g.key}>
            <CardBody className="p-0">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-2 text-left"
                  onClick={() => setCollapsed((c) => ({ ...c, [g.key]: open }))}
                >
                  <span className="text-ink-muted">{open ? "▾" : "▸"}</span>
                  <span className="truncate font-medium text-ink">{g.payee}</span>
                  <span className="shrink-0 text-xs text-ink-muted">
                    {g.batchable.length > 0
                      ? `${g.batchable.length} outstanding`
                      : `${g.rows.length} settled`}
                  </span>
                </button>
                <div className="flex items-center gap-3">
                  {g.total > 0 ? (
                    <span className="font-mono text-sm tabular-nums">{fmtINR(g.total)}</span>
                  ) : null}
                  <Button
                    size="sm"
                    disabled={busy || !canPay}
                    title={canPay
                      ? `Pay all ${g.batchable.length} in one transfer`
                      : "Needs two or more invoices that can still be batched"}
                    onClick={() => onPayTogether(g.batchable)}
                  >
                    Pay together
                  </Button>
                </div>
              </div>

              {open ? (
                <ul className="divide-y divide-line border-t border-line">
                  {g.rows.map((r) => (
                    <li key={`${r.kind}-${r.id}`}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-paper"
                        onClick={() => onOpen(r)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-ink">{r.typeLabel}</span>
                          <span className="text-xs text-ink-muted">
                            {r.source}{r.neededBy ? ` · needed by ${r.neededBy}` : ""}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-3">
                          <span className="font-mono text-sm tabular-nums">{fmtINR(r.amount)}</span>
                          <PaymentStatusBadge status={r.status} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
