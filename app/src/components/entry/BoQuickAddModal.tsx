// ============================================================================
// BO Quick Add — pop-up shortcut to enter ticket counts for a show that has
// just closed (the daily/shift manager's mobile flow).
//
// Schedule-driven: pick a screen → tap one of today's OPEN scheduled shows
// (those whose tickets have closed, i.e. 30 min past start) → enter counts.
// Edits persist live (same as the Entry page); "Done" closes. Shows that are
// still upcoming can't be entered here — wait until they close, or use the
// full Entry page.
// ============================================================================

import { useEffect, useState } from "react";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Select } from "../ui/Input";
import { Badge } from "../ui/Badge";
import { ShowCard } from "./ShowCard";

import { useSync } from "../../lib/hooks/SyncContext";
import { useTickingClock } from "../../lib/hooks/useTickingClock";
import { todayIso, todayIstIso, daysBetweenIso } from "../../lib/dates";
import {
  ensureScheduledShow,
  findEntry,
  showIdxForSchedule,
  updateShow,
  updateShowRow,
  upsertEntry,
  blankShow,
} from "../../lib/entry";
import { schedulesForDay, showUnlockState } from "../../lib/schedule";
import { computeEntry } from "../../lib/engine";
import type { Show, ShowSchedule, UUID } from "../../lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function BoQuickAddModal({ open, onClose }: Props) {
  const { state, setAppState } = useSync();
  const appState = state.appState;
  const now = useTickingClock(60_000);

  const date = todayIso();
  const [screenId, setScreenId] = useState<UUID | "">("");
  const [pickedId, setPickedId] = useState<UUID | "">("");

  useEffect(() => {
    if (!open || !appState) return;
    setScreenId(appState.screens[0]?.id ?? "");
    setPickedId("");
  }, [open, appState]);

  if (!appState) return <Modal open={open} onClose={onClose}>{null}</Modal>;

  const role = state.role;
  const twoDayLockActive =
    role !== "owner" && daysBetweenIso(date, todayIstIso()) > 2; // ~never for today

  const daySchedules = screenId ? schedulesForDay(appState, date, screenId) : [];
  const gateOf = (s: ShowSchedule) =>
    showUnlockState({
      scheduleDate: date,
      showtime: s.showtime,
      now,
      role: (role ?? "cashier") as Parameters<typeof showUnlockState>[0]["role"],
      twoDayLockActive,
    });
  const openShows = daySchedules.filter((s) => {
    const g = gateOf(s);
    return g.state === "open" || g.state === "owner-open";
  });
  const nextUpcoming = daySchedules
    .map((s) => gateOf(s))
    .find((g) => g.state === "upcoming");

  const picked = daySchedules.find((s) => s.id === pickedId) ?? null;

  function patchShow(sched: ShowSchedule, patch: Partial<Show>) {
    const { state: s1, entry: e1, showIdx } = ensureScheduledShow(appState!, sched);
    setAppState(upsertEntry(s1, updateShow(e1, showIdx, patch)));
  }
  function patchRow(sched: ShowSchedule, classId: UUID, tickets: number) {
    const { state: s1, entry: e1, showIdx } = ensureScheduledShow(appState!, sched);
    setAppState(upsertEntry(s1, updateShowRow(e1, showIdx, classId, { tickets })));
  }

  // Build the show object + computed for the picked show.
  let cardEl: React.ReactNode = null;
  if (picked) {
    const movie = appState.movies.find((m) => m.id === picked.movieId);
    const entry = findEntry(appState, date, picked.movieId, screenId as UUID);
    const matIdx = showIdxForSchedule(entry, picked.id);
    const matShow = matIdx >= 0 ? entry!.shows![matIdx] : undefined;
    const show: Show =
      matShow ?? {
        ...blankShow(appState, screenId as UUID, picked.priceCardId),
        showtime: picked.showtime,
        scheduleId: picked.id,
      };
    const computedShow =
      matIdx >= 0 ? computeEntry(appState, entry!).shows[matIdx] : undefined;
    cardEl = (
      <div className="space-y-2">
        <div className="text-sm font-medium">{movie?.name ?? "Show"} · {picked.showtime}</div>
        <ShowCard
          state={appState}
          entry={entry ?? { id: "", date, movieId: picked.movieId, screenId: screenId as UUID, share: null, shows: [show] }}
          showIdx={0}
          show={show}
          computed={computedShow}
          metaLocked
          onChange={(patch) => patchShow(picked, patch)}
          onChangeRow={(classId, tickets) => patchRow(picked, classId, tickets)}
        />
      </div>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Enter BO — show" maxWidth="max-w-2xl">
      <div className="space-y-4">
        <label className="space-y-1 block max-w-xs">
          <span className="block text-[11px] uppercase tracking-wider text-ink-muted">Screen</span>
          <Select value={screenId} onChange={(e) => { setScreenId(e.target.value as UUID); setPickedId(""); }}>
            <option value="">— pick —</option>
            {appState.screens.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </label>

        {!screenId ? (
          <p className="text-sm text-ink-muted">Pick a screen to see its open shows.</p>
        ) : daySchedules.length === 0 ? (
          <p className="text-sm text-ink-muted">No shows scheduled today for this screen.</p>
        ) : openShows.length === 0 ? (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-ink-soft">
            Nothing open for entry yet — shows open 30 min after they start.
            {nextUpcoming && nextUpcoming.state === "upcoming"
              ? ` Next opens at ${nextUpcoming.opensAtHHMM}.`
              : ""}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {openShows.map((s) => {
              const m = appState.movies.find((mv) => mv.id === s.movieId);
              return (
                <button
                  key={s.id}
                  onClick={() => setPickedId(s.id)}
                  className={
                    "rounded-lg border px-3 py-2 text-sm text-left " +
                    (pickedId === s.id
                      ? "border-amber-400 bg-amber-50"
                      : "border-line bg-white hover:border-ink-muted")
                  }
                >
                  <div className="font-medium tabular-nums">{s.showtime}</div>
                  <div className="text-xs text-ink-muted truncate max-w-[10rem]">{m?.name ?? "—"}</div>
                </button>
              );
            })}
          </div>
        )}

        {cardEl}

        <div className="flex items-center justify-between gap-2 pt-2">
          <span className="text-xs text-ink-muted">
            {picked ? <Badge tone="green">Saving live</Badge> : null}
          </span>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}
