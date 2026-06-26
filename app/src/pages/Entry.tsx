import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { useSync } from "../lib/hooks/SyncContext";
import { useTickingClock } from "../lib/hooks/useTickingClock";
import { todayIso, todayIstIso, daysBetweenIso } from "../lib/dates";
import { uid } from "../lib/mappers";
import {
  blankShow,
  deleteEntry,
  ensureScheduledShow,
  findEntry,
  showIdxForSchedule,
  updateShow,
  updateShowRow,
  upsertEntry,
} from "../lib/entry";
import {
  schedulesForDay,
  showUnlockState,
  isLastShowOfDay,
  isLastScheduledShow,
} from "../lib/schedule";
import {
  computeEntry,
  hasShareOverride,
  resolveShare,
  runWeekOf,
} from "../lib/engine";
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
import type {
  AppState,
  DateISO,
  Entry,
  Show,
  ShowSchedule,
  UUID,
} from "../lib/types";

import { Card, CardBody } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Input, Select, Field } from "../components/ui/Input";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { ShowCard } from "../components/entry/ShowCard";
import { EntryPreview } from "../components/entry/EntryPreview";
import { MessageModal } from "../components/entry/MessageModal";
import { DcrModal } from "../components/dcr/DcrModal";

export default function EntryPage() {
  const { state, setAppState } = useSync();
  const appState = state.appState;

  const [date, setDate] = useState<DateISO>(todayIso());
  const [screenId, setScreenId] = useState<UUID | "">("");

  // Default the screen to the first available so the page isn't empty on load.
  useEffect(() => {
    if (!appState) return;
    if (!screenId && appState.screens[0]) setScreenId(appState.screens[0].id);
  }, [appState, screenId]);

  // Auto-send hook: the day's last show (auto-detected from the schedule) with
  // no whatsappSentAt fires the WhatsApp send, across every entry on (date, screen).
  const sendingRef = useRef<Set<string>>(new Set());
  const dayEntries = useMemo(
    () =>
      appState && screenId
        ? appState.entries.filter((e) => e.date === date && e.screenId === screenId)
        : [],
    [appState, date, screenId],
  );
  useEffect(() => {
    if (!appState) return;
    const wa = appState.cinema?.whatsapp;
    if (!wa?.autoSendOnLastShow || !wa.recipient) return;
    dayEntries.forEach((entry) => {
      (entry.shows ?? []).forEach((sh, idx) => {
        // "Last show of day" is auto-detected from the schedule now.
        if (sh.whatsappSentAt || !isLastShowOfDay(appState, entry, idx)) return;
        const key = `${entry.id}__${idx}`;
        if (sendingRef.current.has(key)) return;
        sendingRef.current.add(key);
        const computed = computeEntry(appState, entry);
        sendShowMessage({ state: appState, entry, showIdx: idx, computed })
          .then((res) => {
            sendingRef.current.delete(key);
            if (!res.ok) { console.error("WhatsApp auto-send failed:", res.error); return; }
            const fresh = findEntry(appState, entry.date!, entry.movieId, entry.screenId);
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
    });
  }, [appState, dayEntries, setAppState]);

  if (!appState) {
    return (
      <Card>
        <CardBody className="text-sm text-ink-muted">Loading cloud data…</CardBody>
      </Card>
    );
  }

  const role = state.role;
  // DCR edit lock — the day is locked from D+3 onward for everyone except the
  // owner. Evaluated in IST so it matches the server-side RLS. The per-show
  // +30-min unlock (showUnlockState) ANDs with this.
  const twoDayLockActive =
    role !== "owner" && daysBetweenIso(date, todayIstIso()) > 2;

  const daySchedules = screenId ? schedulesForDay(appState, date, screenId) : [];
  // Distinct movies in first-showtime order.
  const movieOrder: UUID[] = [];
  for (const s of daySchedules) if (!movieOrder.includes(s.movieId)) movieOrder.push(s.movieId);

  // Historical / pre-schedule days: no programme but existing entries to read.
  const historicalEntries =
    daySchedules.length === 0 ? dayEntries : [];

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight">Box-office entry</h2>
        <p className="text-sm text-ink-muted mt-1">
          Enter ticket counts for each scheduled show. A show opens for entry 30
          minutes after it starts, when its tickets close. Programme the day on
          the{" "}
          <Link to="/box-office/schedule" className="text-amber-600 underline">
            Schedule
          </Link>{" "}
          page.
        </p>
      </div>

      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-2 max-w-xl">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Screen">
            <Select value={screenId} onChange={(e) => setScreenId(e.target.value as UUID | "")}>
              <option value="">— pick —</option>
              {appState.screens.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      {!screenId ? (
        <EmptyHint>Pick a screen to see its schedule.</EmptyHint>
      ) : daySchedules.length === 0 ? (
        historicalEntries.length > 0 ? (
          <HistoricalView entries={historicalEntries} appState={appState} canDelete={role === "owner"} />
        ) : (
          <EmptyHint>
            No schedule for this day.{" "}
            <Link to="/box-office/schedule" className="text-amber-600 underline">
              Programme it on the Schedule page
            </Link>{" "}
            first, then enter numbers here.
          </EmptyHint>
        )
      ) : (
        movieOrder.map((movieId) => (
          <MovieSection
            key={movieId}
            appState={appState}
            date={date}
            screenId={screenId}
            movieId={movieId}
            shows={daySchedules.filter((s) => s.movieId === movieId)}
            role={role}
            twoDayLockActive={twoDayLockActive}
            setAppState={setAppState}
          />
        ))
      )}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardBody className="py-10 text-center text-sm text-ink-muted">{children}</CardBody>
    </Card>
  );
}

/** One movie's shows on (date, screen) → its DCR entry. */
function MovieSection({
  appState,
  date,
  screenId,
  movieId,
  shows,
  role,
  twoDayLockActive,
  setAppState,
}: {
  appState: AppState;
  date: DateISO;
  screenId: UUID;
  movieId: UUID;
  shows: ShowSchedule[];
  role: string | null;
  twoDayLockActive: boolean;
  setAppState: (s: AppState) => void;
}) {
  const now = useTickingClock(60_000);
  const movie = appState.movies.find((m) => m.id === movieId);
  const entry = findEntry(appState, date, movieId, screenId);
  const computed = useMemo(
    () => (entry ? computeEntry(appState, entry) : null),
    [appState, entry],
  );
  const [msg, setMsg] = useState<{ entry: Entry; idx: number } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // ── materialize-on-edit handlers ────────────────────────────────────────
  function patchShow(sched: ShowSchedule, patch: Partial<Show>) {
    const { state: s1, entry: e1, showIdx } = ensureScheduledShow(appState, sched);
    setAppState(upsertEntry(s1, updateShow(e1, showIdx, patch)));
  }
  function patchRow(sched: ShowSchedule, classId: UUID, tickets: number) {
    const { state: s1, entry: e1, showIdx } = ensureScheduledShow(appState, sched);
    setAppState(upsertEntry(s1, updateShowRow(e1, showIdx, classId, { tickets })));
  }

  // Share resolution for this movie's day (per-day → week → base).
  const shareEntry: Entry = entry ?? { id: "", date, movieId, screenId, share: null, shows: [] };
  const share = resolveShare(appState, shareEntry);
  const wk = runWeekOf(appState, shareEntry);
  const weekRateSet =
    !!movie && wk != null && !!movie.weekShares &&
    movie.weekShares[wk] !== undefined && movie.weekShares[wk] !== null &&
    (movie.weekShares[wk] as unknown) !== "";
  const shareSource: "override" | "week" | "base" =
    entry != null && hasShareOverride(entry) ? "override" : weekRateSet ? "week" : "base";
  // Share stays editable past the 2-day lock for owner + manager only.
  const shareEditable =
    !!entry && (!twoDayLockActive || role === "owner" || role === "manager");

  // cancelledShows can create a bare entry (a cancelled day with no tickets is
  // exactly the movie-status engine's "scheduled but not run" record).
  const cancelledEditable = !twoDayLockActive || role === "owner";

  function setShare(val: number | null) {
    if (!entry) return;
    setAppState(upsertEntry(appState, { ...entry, share: val }));
  }
  function setCancelled(n: number) {
    const base: Entry = entry ?? { id: uid(), date, movieId, screenId, share: null, shows: [] };
    setAppState(upsertEntry(appState, { ...base, cancelledShows: Math.max(0, Math.min(12, n)) }));
  }

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-xl font-bold tracking-tight">
              {movie?.name ?? "Unknown movie"}
            </h3>
            <p className="text-xs text-ink-muted mt-0.5">
              {shows.length} {shows.length === 1 ? "show" : "shows"} scheduled
            </p>
          </div>
          {entry ? (
            <EntryActions
              entry={entry}
              appState={appState}
              canDelete={role === "owner"}
              onDelete={() => setConfirmingDelete(true)}
            />
          ) : null}
        </div>

        {/* Distributor share */}
        <div className="max-w-xs">
          <Field
            label="Distributor share"
            hint={
              !entry
                ? "Set after the first show is entered"
                : !shareEditable
                  ? "Locked after 2 days"
                  : shareSource === "override"
                    ? "Per-day override · clear to use the week rate"
                    : shareSource === "week"
                      ? "From this run week's rate · type to override"
                      : "From the movie's base rate · type to override"
            }
          >
            <Input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={Number.isFinite(share) ? share : 0}
              disabled={!shareEditable}
              onChange={(e) => {
                const n = e.target.value.trim() === "" ? NaN : Number(e.target.value);
                setShare(Number.isFinite(n) && n > 0 ? n : null);
              }}
              className="tabular-nums"
            />
          </Field>
        </div>

        {/* Per-show gated entry */}
        {shows.map((sched, i) => (
          <ScheduledShow
            key={sched.id}
            appState={appState}
            entry={entry}
            sched={sched}
            index={i}
            date={date}
            screenId={screenId}
            now={now}
            role={role}
            twoDayLockActive={twoDayLockActive}
            computed={computed}
            onPatchShow={(patch) => patchShow(sched, patch)}
            onPatchRow={(classId, tickets) => patchRow(sched, classId, tickets)}
            onMessage={(e2, idx) => setMsg({ entry: e2, idx })}
          />
        ))}

        {/* Cancelled shows (movie-status input) */}
        <Card>
          <CardBody className="flex flex-wrap items-center gap-4">
            <div className="grow min-w-60">
              <div className="text-sm font-medium">Cancelled shows</div>
              <p className="text-xs text-ink-muted mt-1">
                Scheduled shows that did not run (strike, power cut, no audience…).
                Recording them keeps the movie listed as Now Showing.
              </p>
            </div>
            <Input
              type="number"
              min={0}
              max={12}
              className="w-24 shrink-0"
              aria-label="Cancelled shows"
              disabled={!cancelledEditable}
              value={entry?.cancelledShows ?? 0}
              onChange={(e) => setCancelled(Number(e.target.value) || 0)}
            />
          </CardBody>
        </Card>

        {computed ? <EntryPreview computed={computed} /> : null}

        {msg ? (
          <MessageModal
            open={msg !== null}
            state={appState}
            entry={msg.entry}
            showIdx={msg.idx}
            computed={computeEntry(appState, msg.entry)}
            onPatchShow={(i, patch) => setAppState(upsertEntry(appState, updateShow(msg.entry, i, patch)))}
            onClose={() => setMsg(null)}
          />
        ) : null}

        <ConfirmDialog
          open={confirmingDelete}
          title="Delete this entry?"
          confirmLabel="Delete entry"
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            setConfirmingDelete(false);
            setAppState(deleteEntry(appState, date, movieId, screenId));
          }}
        >
          <p>{movie?.name ?? "?"} · {date}</p>
          <p>
            This permanently removes the entry and all its ticket counts from the
            cloud. The scheduled shows stay on the Schedule page.
          </p>
        </ConfirmDialog>
      </CardBody>
    </Card>
  );
}

/** A single scheduled show, rendered per its unlock gate. */
function ScheduledShow({
  appState,
  entry,
  sched,
  index,
  date,
  screenId,
  now,
  role,
  twoDayLockActive,
  computed,
  onPatchShow,
  onPatchRow,
  onMessage,
}: {
  appState: AppState;
  entry: Entry | undefined;
  sched: ShowSchedule;
  index: number;
  date: DateISO;
  screenId: UUID;
  now: Date;
  role: string | null;
  twoDayLockActive: boolean;
  computed: ReturnType<typeof computeEntry> | null;
  onPatchShow: (patch: Partial<Show>) => void;
  onPatchRow: (classId: UUID, tickets: number) => void;
  onMessage: (entry: Entry, idx: number) => void;
}) {
  const gate = showUnlockState({
    scheduleDate: date,
    showtime: sched.showtime,
    now,
    role: (role ?? "cashier") as Parameters<typeof showUnlockState>[0]["role"],
    twoDayLockActive,
  });

  const matIdx = showIdxForSchedule(entry, sched.id);
  const matShow = matIdx >= 0 ? entry!.shows![matIdx] : undefined;

  // Upcoming — tickets haven't closed yet.
  if (gate.state === "upcoming") {
    return (
      <div className="rounded-xl border border-line bg-paper px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <span className="text-sm font-medium">Show {index + 1} · {sched.showtime}</span>
          <p className="text-xs text-ink-muted mt-0.5">
            Opens for entry at {gate.opensAtHHMM}
            {Number.isFinite(gate.opensInMin) ? ` · in ${gate.opensInMin} min` : ""}
          </p>
        </div>
        <Badge tone="neutral">Upcoming</Badge>
      </div>
    );
  }

  // Past the 2-day lock for a non-owner — read-only.
  if (gate.state === "past-locked") {
    const totals = matIdx >= 0 ? computed?.shows[matIdx]?.totals : undefined;
    return (
      <div className="rounded-xl border border-line bg-paper px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <span className="text-sm font-medium">Show {index + 1} · {sched.showtime}</span>
          <p className="text-xs text-ink-muted mt-0.5">
            {totals ? `${totals.tickets} tickets` : "Not entered"}
          </p>
        </div>
        <Badge tone="amber">Locked</Badge>
      </div>
    );
  }

  // Editable (open / owner-open). Render the full ShowCard, materializing the
  // entered show lazily on first edit.
  const show: Show =
    matShow ?? {
      ...blankShow(appState, screenId, sched.priceCardId),
      showtime: sched.showtime,
      scheduleId: sched.id,
    };
  const computedShow = matIdx >= 0 ? computed?.shows[matIdx] : undefined;

  return (
    <ShowCard
      state={appState}
      entry={entry ?? { id: "", date, movieId: sched.movieId, screenId, share: null, shows: [show] }}
      showIdx={index}
      show={show}
      computed={computedShow}
      metaLocked
      isLast={isLastScheduledShow(appState, sched)}
      onChange={onPatchShow}
      onChangeRow={onPatchRow}
      onGenerateMessage={
        entry && matIdx >= 0 ? () => onMessage(entry, matIdx) : undefined
      }
    />
  );
}

/**
 * Read-only view for days that predate the schedule feature (no programme but
 * existing entries). Surfaces the computed DCRs so staff can still read/print.
 */
function HistoricalView({
  entries,
  appState,
  canDelete,
}: {
  entries: Entry[];
  appState: AppState;
  canDelete: boolean;
}) {
  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="flex items-start gap-3">
          <Badge tone="neutral">No schedule</Badge>
          <p className="text-sm text-ink-muted">
            This day has no programme (it predates the Schedule feature). The
            entries below are read from existing box-office data.
          </p>
        </CardBody>
      </Card>
      {entries.map((entry) => (
        <HistoricalEntry key={entry.id} entry={entry} appState={appState} canDelete={canDelete} />
      ))}
    </div>
  );
}

function HistoricalEntry({
  entry,
  appState,
  canDelete,
}: {
  entry: Entry;
  appState: AppState;
  canDelete: boolean;
}) {
  const { setAppState } = useSync();
  const computed = useMemo(() => computeEntry(appState, entry), [appState, entry]);
  const movie = appState.movies.find((m) => m.id === entry.movieId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-xl font-bold tracking-tight">
            {movie?.name ?? "Unknown movie"}
          </h3>
          <EntryActions
            entry={entry}
            appState={appState}
            canDelete={canDelete}
            onDelete={() => setConfirmingDelete(true)}
          />
        </div>
        <EntryPreview computed={computed} />
        <ConfirmDialog
          open={confirmingDelete}
          title="Delete this entry?"
          confirmLabel="Delete entry"
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            setConfirmingDelete(false);
            setAppState(deleteEntry(appState, entry.date!, entry.movieId, entry.screenId));
          }}
        >
          <p>{movie?.name ?? "?"} · {entry.date}</p>
          <p>This permanently removes the entry and all its shows from the cloud.</p>
        </ConfirmDialog>
      </CardBody>
    </Card>
  );
}

/**
 * Right-aligned action row for a movie entry — DCR view + exports + delete.
 */
function EntryActions({
  entry,
  appState,
  canDelete,
  onDelete,
}: {
  entry: Entry;
  appState: AppState;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const computed = useMemo(() => computeEntry(appState, entry), [appState, entry]);
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
        <Button variant="secondary" size="sm" onClick={() => setDcrOpen(true)}>View DCR</Button>
        <Button variant="secondary" size="sm" onClick={dlCsv}>CSV</Button>
        <Button variant="secondary" size="sm" onClick={dlTally}>Tally CSV</Button>
        <Button size="sm" onClick={dlPdf}>Download PDF</Button>
        {canDelete ? (
          <Button variant="ghost" size="sm" onClick={onDelete}>Delete</Button>
        ) : null}
      </div>
      <DcrModal open={dcrOpen} onClose={() => setDcrOpen(false)} computed={computed} appState={appState} />
    </>
  );
}
