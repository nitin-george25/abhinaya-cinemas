import { useEffect, useMemo, useRef, useState } from "react";

import { useSync } from "../lib/hooks/SyncContext";
import { todayIso, addDaysIso } from "../lib/dates";
import {
  addShow,
  blankEntry,
  deleteEntry,
  findEntry,
  removeShow,
  updateShow,
  updateShowRow,
  upsertEntry,
} from "../lib/entry";
import { computeEntry } from "../lib/engine";
import { sendShowMessage } from "../lib/whatsapp";
import { downloadDcrPdf } from "../lib/pdf";
import { LOGO_DATA_URL } from "../assets/logo";
import {
  dcrCsvFilename,
  dcrCsvRows,
  downloadCsv,
  tallyCsvFilename,
  tallyCsvRows,
} from "../lib/csv";
import type { AppState, DateISO, Entry, UUID } from "../lib/types";

import { Card, CardBody } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Input } from "../components/ui/Input";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { EntryHeader } from "../components/entry/EntryHeader";
import { ShowCard } from "../components/entry/ShowCard";
import { EntryPreview } from "../components/entry/EntryPreview";
import { MessageModal } from "../components/entry/MessageModal";
import { DcrModal } from "../components/dcr/DcrModal";

export default function EntryPage() {
  const { state, setAppState } = useSync();
  const appState = state.appState;

  // Selectors — what entry are we editing? Loaded from local state, not
  // from URL (route-state lands later in C6 when History deep-links here).
  const [date, setDate] = useState<DateISO>(todayIso());
  const [movieId, setMovieId] = useState<UUID | "">("");
  const [screenId, setScreenId] = useState<UUID | "">("");
  const [shareOverride, setShareOverride] = useState<number | null>(null);
  /** Owner-only delete confirmation dialog. Declared here (not next to
   *  onDelete) so the hook runs before the `!appState` early return. */
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Default movie / screen to the first available so the form isn't empty
  // on first load.
  useEffect(() => {
    if (!appState) return;
    const firstMovie = appState.movies[0];
    const firstScreen = appState.screens[0];
    if (!movieId && firstMovie) setMovieId(firstMovie.id);
    if (!screenId && firstScreen) setScreenId(firstScreen.id);
  }, [appState, movieId, screenId]);

  // Auto-send hook: any saved show with lastShow=true && !whatsappSentAt
  // fires the WhatsApp Cloud API send, then stamps whatsappSentAt so we
  // don't re-send. sendingRef dedupes against rapid re-renders.
  const sendingRef = useRef<Set<string>>(new Set());
  const existingForHook =
    appState && movieId && screenId
      ? findEntry(appState, date, movieId, screenId)
      : undefined;
  useEffect(() => {
    if (!appState || !existingForHook) return;
    const wa = appState.cinema?.whatsapp;
    if (!wa?.autoSendOnLastShow || !wa.recipient) return;

    (existingForHook.shows ?? []).forEach((sh, idx) => {
      if (!sh.lastShow || sh.whatsappSentAt) return;
      const key = `${existingForHook.id}__${idx}`;
      if (sendingRef.current.has(key)) return;
      sendingRef.current.add(key);

      const computed = computeEntry(appState, existingForHook);
      sendShowMessage({ state: appState, entry: existingForHook, showIdx: idx, computed })
        .then((res) => {
          sendingRef.current.delete(key);
          if (!res.ok) {
            console.error("WhatsApp auto-send failed:", res.error);
            return;
          }
          // Stamp whatsappSentAt on the saved show. Read the latest entry
          // from appState (in case it was edited mid-send) and patch by index.
          const fresh = findEntry(
            appState,
            existingForHook.date!,
            existingForHook.movieId,
            existingForHook.screenId,
          );
          if (!fresh) return;
          const patched: Entry = {
            ...fresh,
            shows: (fresh.shows ?? []).map((s, i) =>
              i === idx ? { ...s, whatsappSentAt: new Date().toISOString() } : s,
            ),
          };
          setAppState(upsertEntry(appState, patched));
        })
        .catch((err) => {
          sendingRef.current.delete(key);
          console.error("WhatsApp auto-send error:", err);
        });
    });
  }, [appState, existingForHook, setAppState]);

  if (!appState) {
    return (
      <Card>
        <CardBody className="text-sm text-ink-muted">Loading cloud data…</CardBody>
      </Card>
    );
  }

  const existing =
    movieId && screenId
      ? findEntry(appState, date, movieId, screenId)
      : undefined;

  const share = shareOverride ??
    existing?.share ??
    appState.movies.find((m) => m.id === movieId)?.share ?? 0;

  // DCR edit lock — an entry dated D is editable on D, D+1, D+2 (IST) and
  // locks from D+3 onward for everyone except the owner. RLS enforces the
  // same rule server-side (migration 20260613140000); this UI gate keeps
  // locked entries read-only and blocks back-dated creates.
  const editLocked = state.role !== "owner" && date < addDaysIso(todayIso(), -2);

  function startEntry() {
    if (!movieId || !screenId || editLocked) return;
    const fresh = blankEntry(appState!, date, movieId, screenId);
    if (shareOverride != null) fresh.share = shareOverride;
    setAppState(upsertEntry(appState!, fresh));
  }

  function persist(next: Entry) {
    if (editLocked) return;
    setAppState(upsertEntry(appState!, next));
  }

  function onHeaderChange(patch: {
    date?: DateISO; movieId?: UUID | ""; screenId?: UUID | ""; share?: number;
  }) {
    if (patch.date !== undefined) setDate(patch.date);
    if (patch.movieId !== undefined) {
      setMovieId(patch.movieId);
      setShareOverride(null);          // re-default share when movie switches
    }
    if (patch.screenId !== undefined) setScreenId(patch.screenId);

    // Share edits apply directly to the existing entry, or stage for the
    // next blankEntry().
    if (patch.share !== undefined) {
      if (existing) {
        persist({ ...existing, share: patch.share });
        setShareOverride(null);
      } else {
        setShareOverride(patch.share);
      }
    }
  }

  // Owner-only delete with an explicit confirmation dialog. RLS enforces
  // the same rule server-side (ent_delete policy, migration 20260606150000)
  // and an AFTER DELETE trigger writes the deletion_log row the Activity
  // page surfaces.
  const canDelete = state.role === "owner";

  function onDelete() {
    if (!existing || !canDelete) return;
    setConfirmingDelete(true);
  }

  function confirmDelete() {
    setConfirmingDelete(false);
    setAppState(deleteEntry(appState!, date, movieId as UUID, screenId as UUID));
  }

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-3xl font-bold tracking-tight">Today's entry</h2>
          <p className="text-sm text-ink-muted mt-1">
            Pick the date / movie / screen, then enter shows. The cloud saves
            automatically — watch the badge in the header.
          </p>
        </div>
        {existing ? (
          <EntryActions
            entry={existing}
            appState={appState}
            canDelete={canDelete}
            onDelete={onDelete}
          />
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this entry?"
        confirmLabel="Delete entry"
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={confirmDelete}
      >
        <p>
          {appState.movies.find((m) => m.id === movieId)?.name ?? "?"} on{" "}
          {appState.screens.find((s) => s.id === screenId)?.name ?? "?"} ·{" "}
          {date}
        </p>
        <p>
          This permanently removes the entry and all its shows from the
          cloud. The deletion is recorded in the Activity log, but the
          figures cannot be recovered.
        </p>
      </ConfirmDialog>

      <EntryHeader
        state={appState}
        date={date}
        movieId={movieId}
        screenId={screenId}
        share={share}
        shareLocked={!!existing || editLocked}
        onChange={onHeaderChange}
      />

      {editLocked ? (
        <LockedEntryView entry={existing} appState={appState} date={date} />
      ) : existing ? (
        <EntryBody entry={existing} persist={persist} />
      ) : (
        <EmptyState
          canStart={!!(movieId && screenId)}
          onStart={startEntry}
        />
      )}
    </div>
  );
}

function EmptyState({
  canStart,
  onStart,
}: {
  canStart: boolean;
  onStart: () => void;
}) {
  return (
    <Card>
      <CardBody className="py-10 text-center space-y-3">
        <Badge tone="neutral">No entry yet</Badge>
        <p className="text-sm text-ink-muted">
          {canStart
            ? "No entry exists for this date / movie / screen yet."
            : "Pick a movie and screen above to begin."}
        </p>
        <Button onClick={onStart} disabled={!canStart}>
          Start entry
        </Button>
      </CardBody>
    </Card>
  );
}

/**
 * Read-only view shown when an entry is locked (older than 2 days, non-owner).
 * Surfaces the computed DCR figures so staff can still read/print the day,
 * but offers no editable controls. The matching server-side guard is the
 * entries_edit_lock_* RLS policies (migration 20260613140000).
 */
function LockedEntryView({
  entry,
  appState,
  date,
}: {
  entry: Entry | undefined;
  appState: AppState;
  date: DateISO;
}) {
  const computed = useMemo(
    () => (entry ? computeEntry(appState, entry) : null),
    [appState, entry],
  );
  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="flex items-start gap-3">
          <Badge tone="amber">Locked</Badge>
          <div className="text-sm text-ink-muted">
            <p className="font-medium text-ink">
              This entry is more than 2 days old ({date}).
            </p>
            <p className="mt-1">
              Entries lock 2 days after their show date and can no longer be
              edited. Ask the owner if a correction is needed.
            </p>
          </div>
        </CardBody>
      </Card>
      {computed ? <EntryPreview computed={computed} /> : null}
    </div>
  );
}

function EntryBody({
  entry,
  persist,
}: {
  entry: Entry;
  persist: (next: Entry) => void;
}) {
  const { state } = useSync();
  const appState = state.appState!;

  // computeEntry is fast (microseconds on real data) — recompute on every
  // change. If we ever need to trim this, useMemo + JSON.stringify(entry)
  // is the lazy hatch.
  const computed = useMemo(
    () => computeEntry(appState, entry),
    [appState, entry],
  );

  const [msgIdx, setMsgIdx] = useState<number | null>(null);

  return (
    <div className="space-y-5">
      {(entry.shows ?? []).map((sh, i) => (
        <ShowCard
          key={i}
          state={appState}
          entry={entry}
          showIdx={i}
          show={sh}
          computed={computed.shows[i]}
          onChange={(patch) => persist(updateShow(entry, i, patch))}
          onChangeRow={(classId, tickets) =>
            persist(updateShowRow(entry, i, classId, { tickets }))
          }
          onRemove={() => persist(removeShow(entry, i))}
          onGenerateMessage={() => setMsgIdx(i)}
        />
      ))}

      <Button variant="secondary" onClick={() => persist(addShow(appState, entry))}>
        + Add show
      </Button>

      {/* cash_20 — cancelled shows. Recorded OUTSIDE the shows array so the
          locked DCR engine (isRealShow, batta, fund) never sees them; only
          the server-side movie-status engine reads the count. */}
      <Card>
        <CardBody className="flex flex-wrap items-center gap-4">
          <div className="grow min-w-60">
            <div className="text-sm font-medium">Cancelled shows</div>
            <p className="text-xs text-ink-muted mt-1">
              Shows scheduled today but not run (strike, power cut, no
              audience…). Recording them keeps the movie listed as Now
              Showing on the website — a day with no tickets and no
              cancelled shows does not count as played.
            </p>
          </div>
          <Input
            type="number"
            min={0}
            max={12}
            className="w-24 shrink-0"
            aria-label="Cancelled shows"
            value={entry.cancelledShows ?? 0}
            onChange={(e) =>
              persist({
                ...entry,
                cancelledShows: Math.max(0, Math.min(12, Number(e.target.value) || 0)),
              })
            }
          />
        </CardBody>
      </Card>

      <EntryPreview computed={computed} />

      <MessageModal
        open={msgIdx !== null}
        state={appState}
        entry={entry}
        showIdx={msgIdx}
        computed={computed}
        onPatchShow={(i, patch) => persist(updateShow(entry, i, patch))}
        onClose={() => setMsgIdx(null)}
      />
    </div>
  );
}

/**
 * Right-aligned action row for the entry header. Only shown when an entry
 * exists. Delete is a ghost button so it's clearly destructive but not
 * visually loud.
 */
function EntryActions({
  entry,
  appState,
  canDelete,
  onDelete,
}: {
  entry: Entry;
  appState: AppState;
  /** Owner only — delete is a legal-record action (see migration
   *  20260606150000). Others don't even see the button. */
  canDelete: boolean;
  onDelete: () => void;
}) {
  const computed = useMemo(
    () => computeEntry(appState, entry),
    [appState, entry],
  );
  const [dcrOpen, setDcrOpen] = useState(false);

  function dlPdf() {
    downloadDcrPdf(computed, {
      cinema: appState.cinema,
      tax: appState.tax,
      logoDataUrl: LOGO_DATA_URL,
    });
  }
  function dlCsv() {
    downloadCsv(dcrCsvFilename(computed), dcrCsvRows(computed, appState.cinema));
  }
  function dlTally() {
    const rows = tallyCsvRows(computed);
    if (rows.length < 2) {
      alert(
        "No sold tickets with serials to export yet. Enter tickets and make " +
          "sure a serial starting point exists.",
      );
      return;
    }
    downloadCsv(tallyCsvFilename(computed), rows);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Button variant="secondary" size="sm" onClick={() => setDcrOpen(true)}>
          View DCR
        </Button>
        <Button variant="secondary" size="sm" onClick={dlCsv}>CSV</Button>
        <Button variant="secondary" size="sm" onClick={dlTally}>Tally CSV</Button>
        <Button size="sm" onClick={dlPdf}>Download PDF</Button>
        {canDelete ? (
          <Button variant="ghost" size="sm" onClick={onDelete}>Delete</Button>
        ) : null}
      </div>

      <DcrModal
        open={dcrOpen}
        onClose={() => setDcrOpen(false)}
        computed={computed}
        appState={appState}
      />
    </>
  );
}
