import { Input, Select } from "../ui/Input";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Card, CardBody } from "../ui/Card";
import { screenById, entryClasses, cardById, N } from "../../lib/engine";
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
  onRemove?: () => void;
  /** Click → open the after-show WhatsApp message modal for this show. */
  onGenerateMessage?: () => void;
  /** Schedule-owned: showtime + price card are set on the Schedule page and
   *  shown read-only here (entry stage only records ticket counts / free pass /
   *  last-show). Hides the Remove button (remove a show on the Schedule page). */
  metaLocked?: boolean;
  /** Auto-detected last show of the movie's day (latest scheduled showtime).
   *  Replaces the old manual "Last show of day" checkbox — drives the WhatsApp
   *  day-totals append. */
  isLast?: boolean;
}

/**
 * One show inside the entry. Compact card with:
 *   • showtime + price card + free-pass fields at the top
 *   • per-class ticket inputs as a list on mobile, table on sm+
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
  metaLocked = false,
  isLast = false,
}: Props) {
  const screen = screenById(state, entry.screenId);
  // Active classes + any historical-era class with tickets in this entry.
  const cls = entryClasses(state, screen, entry);
  const cards = screen?.priceCards ?? [];
  const selectedCard = cardById(state, entry.screenId, show.priceCardId);

  return (
    <Card>
      <CardBody className="space-y-4">
        {/* Header row — meta + remove */}
        <div className="grid grid-cols-2 sm:flex sm:items-end gap-3 sm:flex-wrap">
          <div className="space-y-1">
            <span className="block text-[11px] uppercase tracking-wider text-ink-muted">
              Show {showIdx + 1}
            </span>
            {metaLocked ? (
              <div className="h-11 sm:h-10 flex items-center font-medium tabular-nums">
                {show.showtime || "—"}
              </div>
            ) : (
              <Input
                type="time"
                value={show.showtime ?? ""}
                onChange={(e) => onChange({ showtime: e.target.value })}
                className="w-full sm:w-32"
              />
            )}
          </div>

          <div className="space-y-1 col-span-2 sm:flex-1 sm:min-w-[180px]">
            <span className="block text-[11px] uppercase tracking-wider text-ink-muted">
              Price card
            </span>
            {metaLocked ? (
              <div className="h-11 sm:h-10 flex items-center truncate">
                {selectedCard?.name ?? "—"}
              </div>
            ) : (
              <Select
                value={show.priceCardId ?? ""}
                onChange={(e) => onChange({ priceCardId: e.target.value as UUID })}
                className="w-full"
              >
                <option value="">— pick —</option>
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
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
              className="w-full sm:w-24 tabular-nums"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {isLast ? (
            <Badge tone="blue" className="whitespace-nowrap">Last show of day</Badge>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {onGenerateMessage ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={onGenerateMessage}
                title="Generate WhatsApp message for this show"
              >
                Message
              </Button>
            ) : null}
            {onRemove && !metaLocked ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onRemove}
                title="Remove this show"
              >
                Remove
              </Button>
            ) : null}
          </div>
        </div>

        {/* Class rows — table on sm+, card list on mobile */}
        <div className="hidden sm:block overflow-x-auto">
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

        {/* Mobile card list */}
        <div className="sm:hidden space-y-2">
          {cls.map((cl) => {
            const price = N(selectedCard?.prices?.[cl.classId]);
            const tickets = N(show.rows?.[cl.classId]?.tickets);
            const cRow = computed?.rows.find((r) => r.cls === cl.name);
            const gross = cRow?.grossColl ?? price * tickets;
            return (
              <div key={cl.classId} className="rounded-xl border border-line p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">{cl.name}</div>
                  <div className="text-[11px] text-ink-muted tabular-nums">
                    {fmtInt(cl.seats)} seats · {price > 0 ? fmtINR(price) : "—"}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={cl.seats || undefined}
                    value={tickets}
                    onChange={(e) =>
                      onChangeRow(cl.classId, Math.max(0, Number(e.target.value) || 0))
                    }
                    className="w-28 tabular-nums text-base"
                    aria-label={`Tickets for ${cl.name}`}
                  />
                  <div className="flex-1 text-right tabular-nums">
                    <div className="text-sm font-medium">{fmtINR(gross)}</div>
                    <div className="text-[11px] text-ink-muted">
                      {formatSerials(cRow?.from, cRow?.to)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {computed ? (
            <div className="flex items-center justify-between rounded-xl bg-paper border border-line px-3 py-2.5">
              <span className="text-[11px] uppercase tracking-wider text-ink-muted font-semibold">
                Show total
              </span>
              <div className="text-right tabular-nums">
                <div className="font-semibold">{fmtINR(computed.totals.grossColl)}</div>
                <div className="text-[11px] text-ink-muted">
                  {fmtInt(computed.totals.tickets)} tickets
                </div>
              </div>
            </div>
          ) : null}
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
