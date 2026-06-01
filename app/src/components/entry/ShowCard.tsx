import { Input, Select } from "../ui/Input";
import { Button } from "../ui/Button";
import { Card, CardBody } from "../ui/Card";
import { screenById, screenClasses, cardById, N } from "../../lib/engine";
import { fmtINR, fmtInt } from "../../lib/dashboard";
import type {
  AppState,
  ComputedShow,
  Entry,
  Show,
  UUID,
} from "../../lib/types";

interface Props {
  state: AppState;
  entry: Entry;
  showIdx: number;
  show: Show;
  /** Computed result for this show (passes-through serials + per-class totals). */
  computed: ComputedShow | undefined;
  onChange: (patch: Partial<Show>) => void;
  onChangeRow: (classId: UUID, tickets: number) => void;
  onRemove: () => void;
  /** Click → open the after-show WhatsApp message modal for this show. */
  onGenerateMessage?: () => void;
}

/**
 * One show inside the entry. Compact card with:
 *   • showtime + price card + free-pass row at the top
 *   • per-class ticket inputs in a grid
 *   • per-row computed serial range + per-row gross from computeEntry
 */
export function ShowCard({
  state,
  entry,
  showIdx,
  show,
  computed,
  onChange,
  onChangeRow,
  onRemove,
  onGenerateMessage,
}: Props) {
  const screen = screenById(state, entry.screenId);
  const cls = screenClasses(state, screen);
  const cards = screen?.priceCards ?? [];
  const selectedCard = cardById(state, entry.screenId, show.priceCardId);

  return (
    <Card>
      <CardBody className="space-y-4">
        {/* Header row — meta + remove */}
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1">
            <span className="block text-[11px] uppercase tracking-wider text-ink-muted">
              Show {showIdx + 1}
            </span>
            <Input
              type="time"
              value={show.showtime ?? ""}
              onChange={(e) => onChange({ showtime: e.target.value })}
              className="w-32"
            />
          </div>

          <div className="space-y-1 flex-1 min-w-[180px]">
            <span className="block text-[11px] uppercase tracking-wider text-ink-muted">
              Price card
            </span>
            <Select
              value={show.priceCardId ?? ""}
              onChange={(e) => onChange({ priceCardId: e.target.value as UUID })}
            >
              <option value="">— pick —</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <span className="block text-[11px] uppercase tracking-wider text-ink-muted">
              Free pass
            </span>
            <Input
              type="number"
              min={0}
              value={show.freePass ?? 0}
              onChange={(e) => onChange({ freePass: Number(e.target.value) || 0 })}
              className="w-24 tabular-nums"
            />
          </div>

          <label className="flex items-center gap-1.5 text-xs text-ink-muted whitespace-nowrap pb-2">
            <input
              type="checkbox"
              checked={!!show.lastShow}
              onChange={(e) => onChange({ lastShow: e.target.checked })}
            />
            Last show of day
          </label>

          <div className="ml-auto flex items-center gap-2">
            {onGenerateMessage ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={onGenerateMessage}
                title="Generate WhatsApp message for this show"
              >
                Generate message
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              title="Remove this show"
            >
              Remove
            </Button>
          </div>
        </div>

        {/* Class rows */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-ink-muted border-b border-line">
                <th className="text-left py-2 pr-3 font-semibold">Class</th>
                <th className="text-right py-2 px-2 font-semibold">Seats</th>
                <th className="text-right py-2 px-2 font-semibold">Price</th>
                <th className="text-left py-2 px-2 font-semibold">Tickets</th>
                <th className="text-right py-2 px-2 font-semibold whitespace-nowrap">Serials</th>
                <th className="text-right py-2 pl-2 font-semibold whitespace-nowrap">Gross</th>
              </tr>
            </thead>
            <tbody>
              {cls.map((cl) => {
                const price = N(selectedCard?.prices?.[cl.classId]);
                const tickets = N(show.rows?.[cl.classId]?.tickets);
                const cRow = computed?.rows.find((r) => r.cls === cl.name);
                return (
                  <tr key={cl.classId} className="border-b border-line last:border-b-0">
                    <td className="py-2 pr-3 font-medium">{cl.name}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-ink-muted">{fmtInt(cl.seats)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {price > 0 ? fmtINR(price) : <span className="text-ink-muted">—</span>}
                    </td>
                    <td className="py-2 px-2">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={cl.seats || undefined}
                        value={tickets}
                        onChange={(e) =>
                          onChangeRow(cl.classId, Math.max(0, Number(e.target.value) || 0))
                        }
                        className="w-24 tabular-nums"
                      />
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums text-ink-muted whitespace-nowrap">
                      {formatSerials(cRow?.from, cRow?.to)}
                    </td>
                    <td className="py-2 pl-2 text-right tabular-nums whitespace-nowrap">
                      {fmtINR(cRow?.grossColl ?? price * tickets)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* Show total */}
            {computed ? (
              <tfoot>
                <tr className="border-t-2 border-line">
                  <td className="py-2 pr-3 font-semibold text-ink-muted text-[11px] uppercase tracking-wider">
                    Total
                  </td>
                  <td />
                  <td />
                  <td className="py-2 px-2 tabular-nums font-semibold">
                    {fmtInt(computed.totals.tickets)}
                  </td>
                  <td />
                  <td className="py-2 pl-2 text-right tabular-nums font-semibold whitespace-nowrap">
                    {fmtINR(computed.totals.grossColl)}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

function formatSerials(from: number | string | undefined, to: number | string | undefined): string {
  if (from === "" || from == null) return "—";
  if (to === "NA" || to === "" || to == null) return String(from);
  return `${from}–${to}`;
}
