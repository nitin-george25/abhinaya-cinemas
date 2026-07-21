import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { useSync } from "../lib/hooks/SyncContext";
import { useTickingClock } from "../lib/hooks/useTickingClock";
import { todayIso, todayIstIso, daysBetweenIso } from "../lib/dates";
import { uid } from "../lib/mappers";
import {
  addShow,
  blankShow,
  deleteEntry,
  ensureScheduledShow,
  findEntry,
  removeShow,
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
  orphanShowIdxs,
} from "../lib/schedule";
import {
  computeEntry,
  hasShareOverride,
  resolveShare,
  runWeekOf,
} from "../lib/engine";
import { fmtINR } from "../lib/dashboard";
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

  // Historical / pre-schedule days: no programme but existing entries. Edited
  // through the unscheduled editor, which owns showtime + price card itself
  // (there is no schedule row to own them).
  const historicalEntries =
    daySchedules.length === 0 ? dayEntries : [];

  // Entries whose movie is NOT on the day's programme (schedule rows removed
  // or replaced after entry — e.g. one-off screenings dropped by a copy-
  // forward). Without this they'd be invisible here while still counting in
  // every report. Rendered below the scheduled sections, same editor.
  const offProgramme =
    daySchedules.length > 0
      ? dayEntries.filter((e) => !movieOrder.includes(e.movieId))
      : [];

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
          <UnscheduledView
            variant="no-schedule"
            entries={historicalEntries}
            appState={appState}
            role={role}
            twoDayLockActive={twoDayLockActive}
            setAppState={setAppState}
          />
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
        <>
          {movieOrder.map((movieId) => (
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
          ))}
          {offProgramme.length > 0 ? (
            <UnscheduledView
              variant="off-programme"
              entries={offProgramme}
              appState={appState}
              role={role}
              twoDayLockActive={twoDayLockActive}
              setAppState={setAppState}
            />
          ) : null}
        </>
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
  // The after-show message modal. Store only the entry.shows index — the modal
  // reads the LIVE entry from this scope so edits (e.g. the online ₹ field)
  // reflect immediately. (Storing a snapshot here froze the field's value and
  // made it look un-editable.)
  const [msgIdx, setMsgIdx] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Per-show delete — holds the entry.shows index awaiting confirmation.
  const [deletingShowIdx, setDeletingShowIdx] = useState<number | null>(null);
  const deletingShow = deletingShowIdx !== null ? entry?.shows?.[deletingShowIdx] : undefined;

  // Entered shows with no programme row left (schedule row deleted, or the day
  // replaced by a copy-forward / Vista import after entry). They render from
  // the schedule below, so without this they'd be invisible here while still
  // counting in the DCR — the exact bug this section exists to make impossible.
  const orphans = useMemo(
    () => (entry ? orphanShowIdxs(appState, entry) : []),
    [appState, entry],
  );
  const deletingTotals =
    deletingShowIdx !== null ? computed?.shows[deletingShowIdx]?.totals : undefined;
  const deletingIsOrphan =
    deletingShowIdx !== null && orphans.includes(deletingShowIdx);

  // ── materialize-on-edit handlers ────────────────────────────────────────
  function patchShow(sched: ShowSchedule, patch: Partial<Show>) {
    const { state: s1, entry: e1, showIdx } = ensureScheduledShow(appState, sched);
    setAppState(upsertEntry(s1, updateShow(e1, showIdx, patch)));
  }
  function patchRow(sched: ShowSchedule, classId: UUID, tickets: number) {
    const { state: s1, entry: e1, showIdx } = ensureScheduledShow(appState, sched);
    setAppState(upsertEntry(s1, updateShowRow(e1, showIdx, classId, { tickets })));
  }

  const fieldProps: EntryFieldProps = {
    appState,
    date,
    movieId,
    screenId,
    entry,
    role,
    twoDayLockActive,
    setAppState,
  };

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

        <EntryMetaFields {...fieldProps} />

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
            onMessage={(idx) => setMsgIdx(idx)}
            canDelete={role === "owner"}
            onDeleteShow={(idx) => setDeletingShowIdx(idx)}
          />
        ))}

        {orphans.length > 0 && entry ? (
          <div className="rounded-xl border border-amber-400 bg-amber-50 p-3 space-y-3">
            <div>
              <Badge tone="amber">Not on the programme</Badge>
              <p className="text-xs text-ink-muted mt-1.5">
                {orphans.length === 1 ? "This show was" : "These shows were"}{" "}
                entered earlier but {orphans.length === 1 ? "is" : "are"} no
                longer on the Schedule for {date}.{" "}
                {orphans.length === 1 ? "It is" : "They are"} still counted in
                the DCR and every report — delete{" "}
                {orphans.length === 1 ? "it" : "them"} here, or put the show back
                on the Schedule page.
              </p>
            </div>
            {orphans.map((idx) => {
              const sh = entry.shows?.[idx];
              const t = computed?.shows[idx]?.totals;
              return (
                <div
                  key={sh?.scheduleId ?? `orphan-${idx}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-paper px-3 py-2"
                >
                  <div>
                    <span className="text-sm font-medium">
                      {sh?.showtime || "No showtime"}
                    </span>
                    <p className="text-xs text-ink-muted mt-0.5">
                      {t ? `${t.tickets} tickets · ${fmtINR(t.grossColl)}` : "Not entered"}
                    </p>
                  </div>
                  {role === "owner" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeletingShowIdx(idx)}
                    >
                      Delete show
                    </Button>
                  ) : (
                    <span className="text-xs text-ink-muted">
                      Owner can delete this
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}

        <CancelledShowsField {...fieldProps} />

        {computed ? <EntryPreview computed={computed} /> : null}

        {msgIdx !== null && entry && computed ? (
          <MessageModal
            open
            state={appState}
            entry={entry}
            showIdx={msgIdx}
            computed={computed}
            onPatchShow={(i, patch) => setAppState(upsertEntry(appState, updateShow(entry, i, patch)))}
            onClose={() => setMsgIdx(null)}
          />
        ) : null}

        <ConfirmDialog
          open={confirmingDelete}
          title="Delete the whole DCR?"
          confirmLabel="Delete DCR"
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            setConfirmingDelete(false);
            setAppState(deleteEntry(appState, date, movieId, screenId));
          }}
        >
          <p>
            <strong>{movie?.name ?? "?"}</strong> · {date}
            {computed
              ? ` · ${entry?.shows?.length ?? 0} ${(entry?.shows?.length ?? 0) === 1 ? "show" : "shows"} entered · ${computed.grand.tickets} tickets`
              : ""}
          </p>
          <p>
            This permanently removes the entry and every show's ticket counts
            from the cloud. It cannot be undone. The scheduled shows stay on the
            Schedule page.
          </p>
          <p>To remove just one show, use "Delete show" on that show's card.</p>
        </ConfirmDialog>

        <ConfirmDialog
          open={deletingShowIdx !== null}
          title="Delete this show's entry?"
          confirmLabel="Delete show"
          onCancel={() => setDeletingShowIdx(null)}
          onConfirm={() => {
            const idx = deletingShowIdx;
            setDeletingShowIdx(null);
            if (idx !== null && entry) {
              setAppState(upsertEntry(appState, removeShow(entry, idx)));
            }
          }}
        >
          <p>
            <strong>{movie?.name ?? "?"}</strong> ·{" "}
            {deletingShow?.showtime || "—"}
            {deletingTotals ? ` · ${deletingTotals.tickets} tickets` : ""}
          </p>
          <p>
            This clears the ticket counts entered for this show only — the rest
            of the DCR is untouched.
          </p>
          <p>
            {deletingIsOrphan
              ? "This show is no longer on the programme, so it will disappear from the DCR entirely."
              : "The show stays on the Schedule page, so you can enter it again."}
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
  canDelete,
  onDeleteShow,
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
  onMessage: (idx: number) => void;
  /** Owner-only, mirrors the DCR delete gate. */
  canDelete: boolean;
  /** Asks the parent to confirm deleting the entry.shows[idx] for this show. */
  onDeleteShow: (matIdx: number) => void;
}) {
  const gate = showUnlockState({
    scheduleDate: date,
    showtime: sched.showtime,
    now,
    role: (role ?? "cashier") as Parameters<typeof showUnlockState>[0]["role"],
    twoDayLockActive,
  });

  const matIdx = showIdxForSchedule(entry, sched);
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
        entry && matIdx >= 0 ? () => onMessage(matIdx) : undefined
      }
      // Only a materialized show has anything to delete; owner-gated like the
      // DCR delete. The schedule row itself is removed on the Schedule page.
      onRemove={
        canDelete && entry && matIdx >= 0 ? () => onDeleteShow(matIdx) : undefined
      }
      removeLabel="Delete show"
    />
  );
}

// ── shared entry-level fields ────────────────────────────────────────────
//
// Used by both editors: MovieSection (schedule-driven) and UnscheduledEntry
// (no programme). `entry` is optional because a scheduled movie with nothing
// entered yet has no row — touching either field materializes a bare one.

interface EntryFieldProps {
  appState: AppState;
  date: DateISO;
  movieId: UUID;
  screenId: UUID;
  entry: Entry | undefined;
  role: string | null;
  twoDayLockActive: boolean;
  setAppState: (s: AppState) => void;
}

/** Distributor share % (per-day → week → base) + rep-batta waiver. */
function EntryMetaFields({
  appState,
  date,
  movieId,
  screenId,
  entry,
  role,
  twoDayLockActive,
  setAppState,
}: EntryFieldProps) {
  const [confirmingWaiver, setConfirmingWaiver] = useState(false);
  const movie = appState.movies.find((m) => m.id === movieId);

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

  // Rep-batta waiver (non-film screenings, e.g. FIFA matches). Checking asks
  // for confirmation; unchecking restores the normal step lookup directly.
  const repBattaWaived = entry?.repBattaWaived ?? false;
  const waiverEditable = !twoDayLockActive || role === "owner";

  function setShare(val: number | null) {
    if (!entry) return;
    setAppState(upsertEntry(appState, { ...entry, share: val }));
  }
  function setWaived(on: boolean) {
    const base: Entry = entry ?? { id: uid(), date, movieId, screenId, share: null, shows: [] };
    setAppState(upsertEntry(appState, { ...base, repBattaWaived: on }));
  }

  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
      <div className="max-w-xs grow">
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

      <label
        className={`inline-flex items-center gap-2 pb-2 text-sm ${
          waiverEditable ? "cursor-pointer" : "cursor-not-allowed text-ink-muted"
        }`}
        title={
          waiverEditable
            ? "No rep batta for this DCR (non-film screening, e.g. FIFA match)"
            : "Locked after 2 days"
        }
      >
        <input
          type="checkbox"
          checked={repBattaWaived}
          disabled={!waiverEditable}
          onChange={(e) => {
            if (e.target.checked) setConfirmingWaiver(true);
            else setWaived(false);
          }}
        />
        No rep batta
        {repBattaWaived ? <Badge tone="amber">₹0</Badge> : null}
      </label>

      <ConfirmDialog
        open={confirmingWaiver}
        title="Waive rep batta for this DCR?"
        confirmLabel="Waive rep batta"
        onCancel={() => setConfirmingWaiver(false)}
        onConfirm={() => {
          setConfirmingWaiver(false);
          setWaived(true);
        }}
      >
        <p>{movie?.name ?? "?"} · {date}</p>
        <p>
          Rep batta becomes ₹0 on this DCR — for screenings without a film rep
          (FIFA matches, events). Net &amp; distributor shares recompute
          accordingly. Untick the box to restore the normal batta.
        </p>
      </ConfirmDialog>
    </div>
  );
}

/** Cancelled-show count — the movie-status engine's "scheduled but not run". */
function CancelledShowsField({
  appState,
  date,
  movieId,
  screenId,
  entry,
  role,
  twoDayLockActive,
  setAppState,
}: EntryFieldProps) {
  const editable = !twoDayLockActive || role === "owner";
  function setCancelled(n: number) {
    const base: Entry = entry ?? { id: uid(), date, movieId, screenId, share: null, shows: [] };
    setAppState(upsertEntry(appState, { ...base, cancelledShows: Math.max(0, Math.min(12, n)) }));
  }
  return (
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
          disabled={!editable}
          value={entry?.cancelledShows ?? 0}
          onChange={(e) => setCancelled(Number(e.target.value) || 0)}
        />
      </CardBody>
    </Card>
  );
}

// ── unscheduled entries ──────────────────────────────────────────────────

/**
 * Editor for entries with no programme behind them. Two cases:
 *
 *  • "no-schedule" — the whole day has no show_schedules rows: days that
 *    predate the Schedule feature, and days older than the sync window.
 *  • "off-programme" — the day IS programmed but this movie is not on it
 *    (schedule rows removed or replaced by a copy-forward after entry).
 *
 * Both are edited the same way: with no schedule row to own showtime and price
 * card, the show itself owns them (metaLocked off) — the pre-schedule flow. No
 * per-show 30-min unlock gate applies either, since there's no showtime to gate
 * against; the 2-day DCR lock still does, so past it this is owner-only, which
 * matches enforce_entry_edit_lock server-side.
 */
function UnscheduledView({
  variant,
  entries,
  appState,
  role,
  twoDayLockActive,
  setAppState,
}: {
  variant: "no-schedule" | "off-programme";
  entries: Entry[];
  appState: AppState;
  role: string | null;
  twoDayLockActive: boolean;
  setAppState: (s: AppState) => void;
}) {
  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="flex items-start gap-3">
          {variant === "off-programme" ? (
            <Badge tone="amber">Off programme</Badge>
          ) : (
            <Badge tone="neutral">No schedule</Badge>
          )}
          <p className="text-sm text-ink-muted">
            {variant === "off-programme" ? (
              <>
                These entries exist for this day but their shows are no longer
                on the programme (schedule edited or copied over). They still
                count in all reports, and are edited directly below — showtime
                and price card included, since no{" "}
                <Link to="/box-office/schedule" className="text-amber-600 underline">
                  Schedule
                </Link>{" "}
                row owns them.
              </>
            ) : (
              <>
                This day has no programme (it predates the Schedule feature, or
                it is outside the schedule sync window). Edit the entries below
                directly — showtime and price card are set here rather than on
                the{" "}
                <Link to="/box-office/schedule" className="text-amber-600 underline">
                  Schedule
                </Link>{" "}
                page.
              </>
            )}
          </p>
        </CardBody>
      </Card>
      {entries.map((entry) => (
        <UnscheduledEntry
          key={entry.id}
          entry={entry}
          appState={appState}
          role={role}
          twoDayLockActive={twoDayLockActive}
          setAppState={setAppState}
        />
      ))}
    </div>
  );
}

function UnscheduledEntry({
  entry,
  appState,
  role,
  twoDayLockActive,
  setAppState,
}: {
  entry: Entry;
  appState: AppState;
  role: string | null;
  twoDayLockActive: boolean;
  setAppState: (s: AppState) => void;
}) {
  const computed = useMemo(() => computeEntry(appState, entry), [appState, entry]);
  const movie = appState.movies.find((m) => m.id === entry.movieId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [removingShow, setRemovingShow] = useState<number | null>(null);

  // Ticket counts are frozen past the 2-day lock for everyone but the owner
  // (twoDayLockActive already excludes them). Share + waiver keep their own,
  // looser gates inside EntryMetaFields.
  const editable = !twoDayLockActive;
  const shows = entry.shows ?? [];

  const fieldProps: EntryFieldProps = {
    appState,
    date: entry.date!,
    movieId: entry.movieId,
    screenId: entry.screenId,
    entry,
    role,
    twoDayLockActive,
    setAppState,
  };

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-xl font-bold tracking-tight">
              {movie?.name ?? "Unknown movie"}
            </h3>
            <p className="text-xs text-ink-muted mt-0.5">
              {shows.length} {shows.length === 1 ? "show" : "shows"} entered
            </p>
          </div>
          <EntryActions
            entry={entry}
            appState={appState}
            canDelete={role === "owner"}
            onDelete={() => setConfirmingDelete(true)}
          />
        </div>

        <EntryMetaFields {...fieldProps} />

        {editable ? (
          <>
            {shows.map((show, i) => (
              <ShowCard
                key={show.scheduleId ?? `show-${i}`}
                state={appState}
                entry={entry}
                showIdx={i}
                show={show}
                computed={computed.shows[i]}
                onChange={(patch) =>
                  setAppState(upsertEntry(appState, updateShow(entry, i, patch)))
                }
                onChangeRow={(classId, tickets) =>
                  setAppState(
                    upsertEntry(appState, updateShowRow(entry, i, classId, { tickets })),
                  )
                }
                onRemove={() => setRemovingShow(i)}
              />
            ))}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAppState(upsertEntry(appState, addShow(appState, entry)))}
            >
              Add show
            </Button>
          </>
        ) : (
          <p className="text-sm text-ink-muted">
            Locked after 2 days — ticket counts are read-only for your role.
          </p>
        )}

        <CancelledShowsField {...fieldProps} />

        <EntryPreview computed={computed} />

        <ConfirmDialog
          open={removingShow !== null}
          title="Remove this show?"
          confirmLabel="Remove show"
          onCancel={() => setRemovingShow(null)}
          onConfirm={() => {
            const idx = removingShow;
            setRemovingShow(null);
            if (idx !== null) setAppState(upsertEntry(appState, removeShow(entry, idx)));
          }}
        >
          <p>
            {movie?.name ?? "?"} · {entry.date} · show{" "}
            {removingShow !== null ? removingShow + 1 : ""}
            {removingShow !== null && shows[removingShow]?.showtime
              ? ` (${shows[removingShow]!.showtime})`
              : ""}
          </p>
          <p>
            Its ticket counts are removed from this DCR and every report. The
            other shows keep their serial ranges recomputed in order.
          </p>
        </ConfirmDialog>

        <ConfirmDialog
          open={confirmingDelete}
          title="Delete the whole DCR?"
          confirmLabel="Delete DCR"
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            setConfirmingDelete(false);
            setAppState(deleteEntry(appState, entry.date!, entry.movieId, entry.screenId));
          }}
        >
          <p>
            <strong>{movie?.name ?? "?"}</strong> · {entry.date} ·{" "}
            {shows.length} {shows.length === 1 ? "show" : "shows"} ·{" "}
            {computed.grand.tickets} tickets
          </p>
          <p>
            This permanently removes the entry and all its shows from the cloud.
            It cannot be undone.
          </p>
          <p>To remove just one show, use "Remove" on that show's card.</p>
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
