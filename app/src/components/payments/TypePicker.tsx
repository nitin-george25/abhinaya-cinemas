// ============================================================================
// TypePicker — grouped picker over the payment-type taxonomy (§5). Each type
// shows its accounting head and the flags that change the flow downstream:
//   • asset  → "Needs quotes"   (forces the quotation stage, phase 4)
//   • exempt → "No invoice"     (invoice upload is hidden)
//   • F&B    → "Zoho"           (posts to Zoho Books on mark-paid, phase 6)
// ============================================================================

import { Badge } from "../ui/Badge";
import { cn } from "../ui/cn";
import type { PaymentType } from "../../lib/payments";

/** Coarse grouping for the picker — data-driven from each type's flags. */
function groupOf(t: PaymentType): string {
  if (t.payeeCategory === "distributor") return "Distributor";
  if (t.isAsset) return "Assets & capex";
  if (t.payeeCategory === "internal") return "Internal";
  if (["employee", "landlord", "government", "bank"].includes(t.payeeCategory)) {
    return "People, rent & statutory";
  }
  return "Operating expenses";
}

const GROUP_ORDER = [
  "Distributor",
  "Operating expenses",
  "Assets & capex",
  "People, rent & statutory",
  "Internal",
];

export function TypePicker({
  types,
  value,
  onChange,
}: {
  types: PaymentType[];
  value: string | null;
  onChange: (typeId: string) => void;
}) {
  const groups = new Map<string, PaymentType[]>();
  for (const t of types) {
    const g = groupOf(t);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(t);
  }
  const orderedGroups = GROUP_ORDER.filter((g) => groups.has(g));

  return (
    <div className="space-y-6">
      {orderedGroups.map((g) => (
        <div key={g} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {g}
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {groups.get(g)!.map((t) => {
              const selected = t.id === value;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onChange(t.id)}
                  aria-pressed={selected}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-xl border bg-paper-card p-3 text-left transition-colors",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60",
                    selected
                      ? "border-amber-300 ring-1 ring-amber-300"
                      : "border-line hover:border-ink-muted",
                  )}
                >
                  <span className="font-medium text-ink">{t.name}</span>
                  <span className="text-xs text-ink-muted">{t.accountingHead}</span>
                  <span className="flex flex-wrap gap-1">
                    {t.isAsset ? <Badge tone="blue">Needs quotes</Badge> : null}
                    {t.invoiceRule === "exempt" ? (
                      <Badge tone="neutral">No invoice</Badge>
                    ) : null}
                    {t.zohoPush ? <Badge tone="amber">Zoho</Badge> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
