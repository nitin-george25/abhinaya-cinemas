import { Link } from "react-router-dom";

import { orphanShowIdxs } from "../../lib/schedule";
import type { AppState, Entry } from "../../lib/types";

/**
 * Screen-only warning above a DCR: this entry contains shows that are no longer
 * on the programme (their schedule row was deleted, or the day was replaced by
 * a copy-forward / import after entry). Their tickets still count in every
 * total below, which is exactly the kind of silent mismatch that used to go
 * unnoticed — the fix is on the Entry page, one click away.
 *
 * Hidden on print/PDF: the DCR itself must stay a faithful render of the math.
 */
export function OrphanNotice({
  state,
  entry,
}: {
  state: AppState;
  entry: Entry;
}) {
  const orphans = orphanShowIdxs(state, entry);
  if (orphans.length === 0) return null;

  const times = orphans
    .map((i) => entry.shows?.[i]?.showtime || "—")
    .join(", ");

  return (
    <div className="print:hidden rounded-xl border border-amber-400 bg-amber-50 px-3 py-2 text-xs">
      <strong>
        {orphans.length} {orphans.length === 1 ? "show" : "shows"} in this DCR
        {orphans.length === 1 ? " is" : " are"} not on the programme
      </strong>{" "}
      ({times}). Their tickets are still counted in the totals below. Fix it on
      the{" "}
      <Link className="underline" to="/box-office/entry">
        Entry page
      </Link>{" "}
      — either delete the show or put it back on the Schedule.
    </div>
  );
}
