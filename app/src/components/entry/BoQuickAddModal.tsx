// ============================================================================
// BO Quick Add — pop-up shortcut to enter ONE show's data for today.
//
// Designed for the daily/shift manager flow on mobile: tap FAB → "Enter BO",
// pick movie + screen, enter a single show, Save. Date is prefilled to today.
// If a day already exists for that (date, movie, screen), the show is appended
// to it; otherwise a fresh entry is created.
//
// For multi-show editing or share/PDF actions, the user still goes to
// /box-office/entry — this is purely the quick path.
// ============================================================================

import { useEffect, useMemo, useState } from "react";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input, Select } from "../ui/Input";
import { ShowCard } from "./ShowCard";

import { useSync } from "../../lib/hooks/SyncContext";
import { todayIso, addDaysIso } from "../../lib/dates";
import {
  blankEntry, blankShow, findEntry, upsertEntry,
} from "../../lib/entry";
import { computeEntry } from "../../lib/engine";
import type { AppState, Entry, Show, UUID } from "../../lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
}

function freshShow(appState: AppState, screenId: UUID | ""): Show {
  if (!screenId) return { rows: {} };
  return blankShow(appState, screenId);
}

export function BoQuickAddModal({ open, onClose }: Props) {
  const { state, setAppState } = useSync();
  const appState = state.appState;

  const [date, setDate] = useState(todayIso());
  const [movieId, setMovieId] = useState<UUID | "">("");
  const [screenId, setScreenId] = useState<UUID | "">("");
  const [show, setShow] = useState<Show>({ rows: {} });

  // Reset on each open. Default movie/screen to first available.
  useEffect(() => {
    if (!open || !appState) return;
    setDate(todayIso());
    const firstMovieId = appState.movies[0]?.id ?? "";
    const firstScreenId = appState.screens[0]?.id ?? "";
    setMovieId(firstMovieId);
    setScreenId(firstScreenId);
    setShow(freshShow(appState, firstScreenId));
  }, [open, appState]);

  // Re-default the price card + class rows when the screen changes.
  function pickScreen(id: UUID) {
    if (!appState) return;
    setScreenId(id);
    setShow(freshShow(appState, id));
  }

  // Build a synthetic "draft" entry for ShowCard + computeEntry preview.
  // Reuse the existing one for (date, movie, screen), appending the new show
  // at the end; otherwise fabricate a fresh one-show entry.
  const existing =
    appState && movieId && screenId
      ? findEntry(appState, date, movieId, screenId)
      : undefined;

  const preview: Entry | null = useMemo(() => {
    if (!appState || !movieId || !screenId) return null;
    if (existing) {
      return { ...existing, shows: [...(existing.shows ?? []), show] };
    }
    const fresh = blankEntry(appState, date, movieId as UUID, screenId as UUID);
    return { ...fresh, shows: [show] };
  }, [appState, date, movieId, screenId, existing, show]);

  const computed = useMemo(
    () => (preview && appState ? computeEntry(appState, preview) : null),
    [appState, preview],
  );
  const computedShow = computed?.shows[computed.shows.length - 1];

  // DCR edit lock — non-owners cannot add/edit a show for a date older than
  // 2 days (editable on D, D+1, D+2 IST). RLS enforces it server-side too
  // (migration 20260613140000); this keeps the UI honest.
  const editLocked = state.role !== "owner" && date < addDaysIso(todayIso(), -2);

  function save() {
    if (!preview || !appState || editLocked) return;
    setAppState(upsertEntry(appState, preview));
    onClose();
  }

  if (!appState) return <Modal open={open} onClose={onClose}>{null}</Modal>;

  // The new show is always the LAST in preview.shows.
  const showIdx = preview ? (preview.shows ?? []).length - 1 : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Quick add — BO show"
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <label className="space-y-1">
            <span className="block text-[11px] uppercase tracking-wider text-ink-muted">Date</span>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] uppercase tracking-wider text-ink-muted">Movie</span>
            <Select value={movieId} onChange={(e) => setMovieId(e.target.value as UUID)}>
              <option value="">— pick —</option>
              {appState.movies.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 col-span-2 sm:col-span-1">
            <span className="block text-[11px] uppercase tracking-wider text-ink-muted">Screen</span>
            <Select
              value={screenId}
              onChange={(e) => pickScreen(e.target.value as UUID)}
            >
              <option value="">— pick —</option>
              {appState.screens.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </label>
        </div>

        {editLocked ? (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-ink-soft">
            {date} is more than 2 days old. Entries lock after 2 days — ask the
            owner if a correction is needed.
          </div>
        ) : existing ? (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-ink-soft">
            A day already exists for {date}. This show will be appended as
            Show #{(existing.shows ?? []).length + 1}.
          </div>
        ) : null}

        {preview && movieId && screenId ? (
          <ShowCard
            state={appState}
            entry={preview}
            showIdx={showIdx}
            show={show}
            computed={computedShow}
            onChange={(patch) => setShow((s) => ({ ...s, ...patch }))}
            onChangeRow={(classId, tickets) =>
              setShow((s) => ({
                ...s,
                rows: { ...(s.rows ?? {}), [classId]: { tickets } },
              }))
            }
            onRemove={onClose}
          />
        ) : (
          <p className="text-sm text-ink-muted">
            Pick a movie and screen above to start.
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!preview || !movieId || !screenId || editLocked}>
            Save show
          </Button>
        </div>
      </div>
    </Modal>
  );
}
