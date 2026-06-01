import { useEffect, useMemo, useState } from "react";

import { useSync } from "../lib/hooks/SyncContext";
import { todayIso } from "../lib/dates";
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
import { EntryHeader } from "../components/entry/EntryHeader";
import { ShowCard } from "../components/entry/ShowCard";
import { EntryPreview } from "../components/entry/EntryPreview";
import { MessageModal } from "../components/entry/MessageModal";
import { DcrModal } from "../components/dcr/DcrModal";
import { buildShowMessage } from "../lib/whatsappMessage";

export default function EntryPage() {
  const { state, setAppState } = useSync();
  const appState = state.appState;

  // Selectors — what entry are we editing? Loaded from local state, not
  // from URL (route-state lands later in C6 when History deep-links here).
  const [date, setDate] = useState<DateISO>(todayIso());
  const [movieId, setMovieId] = useState<UUID | "">("");
  const [screenId, setScreenId] = useState<UUID | "">("");
  const [shareOverride, setShareOverride] = useState<number | null>(null);

  // Default movie / screen to the first available so the form isn't empty
  // on first load.
  useEffect(() => {
    if (!appState) return;
    const firstMovie = appState.movies[0];
    const firstScreen = appState.screens[0];
    if (!movieId && firstMovie) setMovieId(firstMovie.id);
    if (!screenId && firstScreen) setScreenId(firstScreen.id);
  }, [appState, movieId, screenId]);

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

  function startEntry() {
    if (!movieId || !screenId) return;
    const fresh = blankEntry(appState!, date, movieId, screenId);
    if (shareOverride != null) fresh.share = shareOverride;
    setAppState(upsertEntry(appState!, fresh));
  }

  function persist(next: Entry) {
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

  function onDelete() {
    if (!existing) return;
    if (!confirm("Delete this entry? This removes it from the cloud.")) return;
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
            onDelete={onDelete}
          />
        ) : null}
      </div>

      <EntryHeader
        state={appState}
        date={date}
        movieId={movieId}
        screenId={screenId}
        share={share}
        shareLocked={!!existing}
        onChange={onHeaderChange}
      />

      {existing ? (
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

  const [messageText, setMessageText] = useState<string | null>(null);

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
          onGenerateMessage={() =>
            setMessageText(buildShowMessage(appState, entry, i, computed))
          }
        />
      ))}

      <Button variant="secondary" onClick={() => persist(addShow(appState, entry))}>
        + Add show
      </Button>

      <EntryPreview computed={computed} />

      <MessageModal
        open={messageText !== null}
        text={messageText ?? ""}
        onClose={() => setMessageText(null)}
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
  onDelete,
}: {
  entry: Entry;
  appState: AppState;
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
        <Button variant="ghost" size="sm" onClick={onDelete}>Delete</Button>
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
