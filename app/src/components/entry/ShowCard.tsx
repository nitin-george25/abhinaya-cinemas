import { Input, Select } from "../ui/Input";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Card, CardBody } from "../ui/Card";
import {
  screenById,
  entryClasses,
  cardById,
  glasses3dConfig,
  N,
} from "../../lib/engine";
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
  /** Label for the remove button — "Remove" by default. Scheduled shows use
   *  "Delete show" since the schedule row survives, only the entry goes. */
  removeLabel?: string;
  /** Click → open the after-show WhatsApp message modal for this show. */
  onGenerateMessage?: () => void;
  /** Schedule-owned: showtime + price card are set on the Schedule page and
   *  shown read-only here (entry stage only records ticket counts / free pass /
   *  last-show). The Remove button is driven by `onRemove` alone — the caller
   *  decides whether a locked-meta show may be deleted. */
  metaLocked?: boolean;
  /** Does the PROGRAMME say this show is 3D? Only meaningful under
   *  `metaLocked`, where it decides whether the glasses field shows at all —
   *  the snapshot on the show is not trusted for that, because it can drift
   *  (copy-forward carrying is3d onto a day whose film later changed, a
   *  backfill run with wide date bounds, rows stamped before the Schedule
   *  started mirroring). The programme is the truth; a disagreeing snapshot is
   *  reported by `staleGlasses` rather than silently rendered as a charge. */
  is3d?: boolean;
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
  removeLabel = "Remove",
  onGenerateMessage,
  metaLocked = false,
  is3d = false,
  isLast = false,
}: Props) {
  const screen = screenById(state, entry.screenId);
  // Schedule-backed shows take 3D from the programme. Unscheduled ones have no
  // programme, so their own snapshot is the truth.
  const showsGlasses = metaLocked ? is3d : show.glasses3d != null;
  // Snapshot says 3D but the programme does not: the charge is live in the
  // engine (which never reads schedules) while the field is hidden. Surface it
  // rather than leaving money on a show that looks 2D.
  const staleGlasses = metaLocked && !is3d && show.glasses3d != null;
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
            {/* Schedule-backed shows never edit the card here: the programme
                owns it and mirrors changes down (updateScheduleAndEntry), so
                a second editor would just be a way to disagree with it.
                Unscheduled shows have no programme row — the Entry page is
                their only home, not a duplicate. */}
            {metaLocked ? (
              <div
                className="h-11 sm:h-10 flex items-center truncate"
                title="Set on the Schedule page, which owns this show's programme"
              >
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

          {/* 3D glasses rental — cinema-only income, never in the distributor
              split. Present = 3D show. Blank qty means auto (= paid tickets),
              so it tracks live as ticket counts are keyed in.
              WHETHER a show is 3D belongs to the programme when there is one
              (metaLocked): the Schedule page owns it and mirrors changes down
              here, so this is not a second place to set it. Pairs issued is
              entry data either way, and stays editable. */}
          {!showsGlasses ? null : (
          <div className="space-y-1 col-span-2 sm:col-auto">
            <span className="block text-[11px] uppercase tracking-wider text-ink-muted">
              3D glasses
            </span>
            {show.glasses3d ? (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={show.glasses3d.qty ?? ""}
                  placeholder={String(computed?.totals.tickets ?? 0)}
                  title="Pairs issued. Blank = same as tickets sold."
                  onChange={(e) =>
                    onChange({
                      glasses3d: {
                        ...show.glasses3d!,
                        qty: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0),
                      },
                    })
                  }
                  className="w-20 tabular-nums"
                  aria-label="3D glasses pairs issued"
                />
                <span className="text-[11px] text-ink-muted whitespace-nowrap tabular-nums">
                  × {fmtINR(show.glasses3d.rate)}
                  {computed?.glasses ? ` = ${fmtINR(computed.glasses.amount)}` : ""}
                </span>
                {metaLocked ? (
                  <span
                    className="text-[11px] text-ink-muted"
                    title="Set on the Schedule page, which owns this show's programme"
                  >
                    3D · from Schedule
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onChange({ glasses3d: undefined })}
                    title="Not a 3D show — remove the glasses charge"
                  >
                    Clear
                  </Button>
                )}
              </div>
            ) : metaLocked ? (
              // Programme says 3D but nothing is stamped yet — the charge
              // lands when the show materializes. No add button here: the
              // Schedule page owns whether a show is 3D.
              <div className="h-11 sm:h-10 flex items-center text-[11px] text-ink-muted">
                Charged on entry
              </div>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onChange({ glasses3d: { ...glasses3dConfig(state) } })}
                title="Charge the 3D glasses rental on this show"
              >
                + 3D glasses
              </Button>
            )}
          </div>
          )}
        </div>

        {/* Snapshot disagrees with the programme. The engine reads the
            snapshot, so this show is still being charged even though it reads
            as 2D — offer the one-click repair. */}
        {staleGlasses ? (
          <div className="rounded-xl border border-amber-400 bg-amber-50 px-3 py-2 text-xs flex flex-wrap items-center gap-2">
            <span className="text-amber-900">
              This show is marked 2D on the Schedule but still carries a 3D
              glasses charge from an earlier edit, so it is still being billed.
            </span>
            <Button
              variant="secondary"
              size="sm"
              className="ml-auto"
              onClick={() => onChange({ glasses3d: undefined })}
              title="Drop the stale glasses charge from this show"
            >
              Remove charge
            </Button>
          </div>
        ) : null}

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
            {onRemove ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onRemove}
                title={`${removeLabel} — this show only`}
              >
                {removeLabel}
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
