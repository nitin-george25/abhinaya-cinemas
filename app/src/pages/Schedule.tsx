// ============================================================================
// Schedule — stage 1 of the box-office workflow.
//
// Owner / manager / daily_manager programme each day per screen: an ordered
// list of shows (showtime + movie + price card). The Entry page then derives
// ticket entry from this programme, unlocking each show 30 min after its start.
//
// Writes flow through useSync().setAppState (schedule mutation helpers) → the
// delta-sync hook persists. Incomplete rows (movie not yet picked) stay local
// until complete; they are never pushed (see isCompleteSchedule).
// ============================================================================

import { useState } from "react";

import { useSync } from "../lib/hooks/SyncContext";
import {
  todayIso,
  todayIstIso,
  daysBetweenIso,
  addDaysIso,
  minutesToHHMM,
  hhmmToMinutes,
} from "../lib/dates";
import {
  blankSchedule,
  copyScheduleForward,
  enteredShowForSchedule,
  removeSchedule,
  scheduleEditGate,
  scheduleMovieChangeWarning,
  schedulesForDay,
  updateSchedule,
  updateScheduleAndEntry,
  upsertSchedule,
} from "../lib/schedule";
import type { Role } from "../lib/hooks/useSupabaseSync";
import type { AppState, DateISO, ShowSchedule, UUID } from "../lib/types";

import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input, Select, SearchSelect, Field } from "../components/ui/Input";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Badge } from "../components/ui/Badge";
import { ScheduleImportModal } from "../components/schedule/ScheduleImportModal";

export default function SchedulePage() {
  const { state, setAppState } = useSync();
  const appState = state.appState;
  const cinemaId = (state.cinemaId ?? "") as UUID;
  // Price card is owner-only: managers / daily managers programme times, films
  // and 3D, but the card is auto-assigned (Vista import / default) and only the
  // owner can change it here.
  const isOwner = state.role === "owner";
  const role = state.role;

  const [date, setDate] = useState<DateISO>(todayIso());
  const [copyFrom, setCopyFrom] = useState<{ src: DateISO; label: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  if (!appState) {
    return (
      <Card>
        <CardBody className="text-sm text-ink-muted">Loading cloud data…</CardBody>
      </Card>
    );
  }

  const movieOptions = appState.movies.map((m) => ({ value: m.id, label: m.name }));

  // Same DCR edit lock the Entry page and the entries trigger use: from D+3
  // onward, a row that already has ticket entry is owner-only.
  const twoDayLockActive = role !== "owner" && daysBetweenIso(date, todayIstIso()) > 2;

  function patch(next: AppState) {
    setAppState(next);
  }

  // ── copy-forward ───────────────────────────────────────────────────────
  function requestCopy(daysBack: number, label: string) {
    setCopyFrom({ src: addDaysIso(date, -daysBack), label });
  }
  function doCopy() {
    if (!appState || !copyFrom) return;
    const src = copyFrom.src;
    // All screens' non-cancelled programme from the source day.
    const source = appState.showSchedules.filter(
      (s) => s.date === src && !s.cancelled,
    );
    const clones = copyScheduleForward(source, date).map((s) => ({
      ...s,
      cinemaId: cinemaId || s.cinemaId,
    }));
    // Replace the current day entirely (the confirm warned about overwrite).
    const kept = appState.showSchedules.filter((s) => s.date !== date);
    patch({ ...appState, showSchedules: [...kept, ...clones] });
    setCopyFrom(null);
  }

  // Import — replace each (date, screen) present in the file with its rows,
  // leaving other screens that day untouched. Idempotent on re-upload.
  function applyImport(rows: ShowSchedule[], importDate: DateISO) {
    if (!appState) return;
    const screens = new Set(rows.map((r) => r.screenId));
    const kept = appState.showSchedules.filter(
      (s) => !(s.date === importDate && screens.has(s.screenId)),
    );
    patch({ ...appState, showSchedules: [...kept, ...rows] });
    setDate(importDate);
  }

  const dayHasAny = appState.showSchedules.some((s) => s.date === date);

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-3xl font-bold tracking-tight">Schedule</h2>
          <p className="text-sm text-ink-muted mt-1">
            Programme each screen for the day — showtime, movie and price card.
            Box-office entry opens for a show 30 minutes after it starts.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2 print:hidden">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Button variant="secondary" size="sm" onClick={() => requestCopy(1, "yesterday")}>
            Copy yesterday
          </Button>
          <Button variant="secondary" size="sm" onClick={() => requestCopy(7, "last week")}>
            Copy last week
          </Button>
          <Button variant="primary" size="sm" onClick={() => setImportOpen(true)}>
            Upload (Vista)
          </Button>
        </div>
      </div>

      {appState.screens.length === 0 ? (
        <Card>
          <CardBody className="text-sm text-ink-muted">
            No screens configured yet. Add screens in Settings → Screens first.
          </CardBody>
        </Card>
      ) : (
        appState.screens.map((screen) => (
          <ScreenSchedule
            key={screen.id}
            appState={appState}
            cinemaId={cinemaId}
            date={date}
            screenId={screen.id}
            screenName={screen.name}
            movieOptions={movieOptions}
            isOwner={isOwner}
            role={role}
            twoDayLockActive={twoDayLockActive}
            onPatch={patch}
          />
        ))
      )}

      <ConfirmDialog
        open={copyFrom !== null}
        title={`Copy ${copyFrom?.label ?? ""}'s schedule?`}
        confirmLabel="Copy"
        onCancel={() => setCopyFrom(null)}
        onConfirm={doCopy}
      >
        <p>
          This copies every screen's programme from {copyFrom?.label} ({copyFrom?.src})
          onto {date}.
        </p>
        {dayHasAny ? (
          <p>
            <strong>{date} already has a schedule</strong> — it will be replaced.
            Shows that already have box-office entries keep their entries. Any
            entered show whose showtime is not in the copied programme is
            flagged "Not on the programme" on the Entry page so you can delete
            it or restore its show.
          </p>
        ) : null}
      </ConfirmDialog>

      <ScheduleImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={applyImport}
      />
    </div>
  );
}

function ScreenSchedule({
  appState,
  cinemaId,
  date,
  screenId,
  screenName,
  movieOptions,
  isOwner,
  role,
  twoDayLockActive,
  onPatch,
}: {
  appState: AppState;
  cinemaId: UUID;
  date: DateISO;
  screenId: UUID;
  screenName: string;
  movieOptions: Array<{ value: string; label: string }>;
  isOwner: boolean;
  role: Role | null;
  twoDayLockActive: boolean;
  onPatch: (next: AppState) => void;
}) {
  const rows = schedulesForDay(appState, date, screenId);
  const screen = appState.screens.find((s) => s.id === screenId);
  const priceCards = screen?.priceCards ?? [];

  // Duplicate showtimes on the same screen — the DB unique constraint would
  // reject them, so flag before the push fails.
  const times = rows.map((r) => r.showtime).filter(Boolean);
  const dupTimes = new Set(times.filter((t, i) => times.indexOf(t) !== i));

  function addShow() {
    // Default to a non-clashing time: 3h after the last show, else 10:00.
    const last = rows[rows.length - 1];
    const base = last ? (hhmmToMinutes(last.showtime) ?? 600) + 180 : 600;
    let showtime = minutesToHHMM(base);
    while (times.includes(showtime)) {
      showtime = minutesToHHMM((hhmmToMinutes(showtime) ?? 600) + 15);
    }
    const row = blankSchedule(appState, date, screenId, cinemaId, {
      showtime,
      priceCardId: priceCards[0]?.id,
    });
    onPatch(upsertSchedule(appState, row));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{screenName}</CardTitle>
        <Badge tone="neutral">{rows.length} {rows.length === 1 ? "show" : "shows"}</Badge>
      </CardHeader>
      <CardBody className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-ink-muted">No shows scheduled. Add one below.</p>
        ) : (
          rows.map((row) => (
            <ScheduleRow
              key={row.id}
              appState={appState}
              row={row}
              movieOptions={movieOptions}
              priceCards={priceCards}
              isOwner={isOwner}
              role={role}
              twoDayLockActive={twoDayLockActive}
              clash={!!row.showtime && dupTimes.has(row.showtime)}
              onPatch={onPatch}
            />
          ))
        )}
        <Button variant="secondary" size="sm" onClick={addShow}>
          + Add show
        </Button>
      </CardBody>
    </Card>
  );
}

function ScheduleRow({
  appState,
  row,
  movieOptions,
  priceCards,
  isOwner,
  role,
  twoDayLockActive,
  clash,
  onPatch,
}: {
  appState: AppState;
  row: ShowSchedule;
  movieOptions: Array<{ value: string; label: string }>;
  priceCards: Array<{ id: string; name: string }>;
  isOwner: boolean;
  role: Role | null;
  twoDayLockActive: boolean;
  clash: boolean;
  onPatch: (next: AppState) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  // A pending programme-owned edit awaiting confirmation, because applying it
  // would rewrite a DCR that already has tickets.
  const [pending, setPending] = useState<{
    patch: Partial<ShowSchedule>;
    what: string;
  } | null>(null);
  // Tickets already entered against this programme row. Removing the row also
  // removes them (otherwise they'd linger, unseen, in the DCR) — so say so.
  const entered = enteredShowForSchedule(appState, row);
  const movieName =
    movieOptions.find((o) => o.value === row.movieId)?.label ?? "No movie";

  // The programme owns time / price card / 3D and mirrors them onto the entered
  // show. Once a show is materialized that rewrites DCR money, so past the
  // 2-day window it is owner-only — same rule the entries trigger enforces.
  const gate = scheduleEditGate(appState, row, role, twoDayLockActive);
  const movieWarning = scheduleMovieChangeWarning(appState, row);

  /** Apply a programme-owned edit, confirming first when it rewrites tickets. */
  function edit(patch: Partial<ShowSchedule>, what: string) {
    if (!gate.editable) return;
    if (gate.tickets > 0) {
      setPending({ patch, what });
      return;
    }
    onPatch(updateScheduleAndEntry(appState, row.id, patch));
  }

  return (
    <div className="rounded-xl border border-line p-3 space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-[8rem_1fr_12rem_auto_auto] gap-3 sm:items-end">
        <Field label="Time">
          <Input
            type="time"
            value={row.showtime}
            disabled={!gate.editable}
            title={gate.reason}
            onChange={(e) => edit({ showtime: e.target.value }, "show time")}
          />
        </Field>
        <Field label="Movie">
          <SearchSelect
            value={row.movieId}
            onChange={(v) => onPatch(updateSchedule(appState, row.id, { movieId: v as UUID }))}
            options={movieOptions}
            placeholder="Search movie…"
          />
        </Field>
        <Field label="Price card">
          {isOwner ? (
            <Select
              value={row.priceCardId ?? ""}
              disabled={!gate.editable}
              title={gate.reason}
              onChange={(e) =>
                edit(
                  { priceCardId: (e.target.value || undefined) as UUID | undefined },
                  "price card",
                )
              }
            >
              <option value="">— pick —</option>
              {priceCards.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          ) : (
            // Owner-only: auto-assigned from the Vista import / screen default.
            // Non-owners see it read-only.
            <div
              className="h-11 sm:h-10 flex items-center truncate text-sm"
              title="Price card is set by the owner"
            >
              {priceCards.find((c) => c.id === row.priceCardId)?.name ?? "—"}
            </div>
          )}
        </Field>
        {/* 3D marks the show for the glasses-rental line at ticket entry. It
            is cinema-only income and never touches the distributor split. */}
        <label
          className={
            "flex items-end gap-2 pb-2 text-sm whitespace-nowrap " +
            (gate.editable ? "cursor-pointer" : "cursor-not-allowed text-ink-muted")
          }
          title={gate.reason ?? "3D show — adds the glasses rental line to this show"}
        >
          <input
            type="checkbox"
            checked={row.is3d ?? false}
            disabled={!gate.editable}
            onChange={(e) => edit({ is3d: e.target.checked }, "3D flag")}
          />
          3D
        </label>

        <div className="flex items-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(true)}
            title="Remove this show"
          >
            Remove
          </Button>
        </div>
      </div>
      {clash ? (
        <p className="text-xs text-red-600">
          Another show on this screen is already at {row.showtime}. Two shows
          can't start at the same time — change one.
        </p>
      ) : null}
      {entered && entered.tickets > 0 ? (
        <p className="text-xs text-ink-muted">
          {entered.tickets} tickets entered for this show
          {gate.editable
            ? " — time, price card and 3D changes here update the DCR too."
            : "."}
        </p>
      ) : null}
      {!gate.editable ? (
        <p className="text-xs text-amber-700">{gate.reason}</p>
      ) : null}
      {movieWarning ? (
        <p className="text-xs text-amber-700">{movieWarning}</p>
      ) : null}

      {/* Programme-owned edit that rewrites an entered show. The price card
          drives gross, taxes and the distributor split, so the operator sees
          what moves before it moves. */}
      <ConfirmDialog
        open={pending !== null}
        title={`Change the ${pending?.what ?? "show"} on an entered show?`}
        confirmLabel="Change it"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (p) onPatch(updateScheduleAndEntry(appState, row.id, p.patch));
        }}
      >
        <p>
          <strong>{row.showtime || "—"}</strong> · {movieName} · {row.date}
        </p>
        <p>
          This show already has <strong>{gate.tickets} tickets</strong> entered.
          The change is applied to the programme <em>and</em> to the entered
          show, so the DCR follows.
        </p>
        {pending?.what === "price card" ? (
          <p>
            <strong>This re-prices the DCR.</strong> Gross collection, GST,
            e-tax, net share and the distributor split are all recalculated at
            the new card. If this DCR was already filed or settled, re-issue it.
          </p>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirming}
        title="Remove this show from the programme?"
        confirmLabel={entered ? "Remove show + entry" : "Remove show"}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onPatch(removeSchedule(appState, row.id));
        }}
      >
        <p>
          <strong>{row.showtime || "—"}</strong> · {movieName} · {row.date}
        </p>
        {entered ? (
          <p>
            <strong>
              This show has box-office entry ({entered.tickets} tickets).
            </strong>{" "}
            Removing it deletes those ticket counts too, so the DCR and every
            report drop this show. This cannot be undone.
          </p>
        ) : (
          <p>Nothing has been entered against this show yet.</p>
        )}
      </ConfirmDialog>
    </div>
  );
}
