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
import { todayIso, addDaysIso, minutesToHHMM, hhmmToMinutes } from "../lib/dates";
import {
  blankSchedule,
  copyScheduleForward,
  removeSchedule,
  schedulesForDay,
  updateSchedule,
  upsertSchedule,
} from "../lib/schedule";
import type { AppState, DateISO, ShowSchedule, UUID } from "../lib/types";

import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input, Select, SearchSelect, Field } from "../components/ui/Input";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Badge } from "../components/ui/Badge";

export default function SchedulePage() {
  const { state, setAppState } = useSync();
  const appState = state.appState;
  const cinemaId = (state.cinemaId ?? "") as UUID;

  const [date, setDate] = useState<DateISO>(todayIso());
  const [copyFrom, setCopyFrom] = useState<{ src: DateISO; label: string } | null>(null);

  if (!appState) {
    return (
      <Card>
        <CardBody className="text-sm text-ink-muted">Loading cloud data…</CardBody>
      </Card>
    );
  }

  const movieOptions = appState.movies.map((m) => ({ value: m.id, label: m.name }));

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
            Shows that already have box-office entries keep their entries, but
            the programme rows are overwritten.
          </p>
        ) : null}
      </ConfirmDialog>
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
  onPatch,
}: {
  appState: AppState;
  cinemaId: UUID;
  date: DateISO;
  screenId: UUID;
  screenName: string;
  movieOptions: Array<{ value: string; label: string }>;
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
  clash,
  onPatch,
}: {
  appState: AppState;
  row: ShowSchedule;
  movieOptions: Array<{ value: string; label: string }>;
  priceCards: Array<{ id: string; name: string }>;
  clash: boolean;
  onPatch: (next: AppState) => void;
}) {
  return (
    <div className="rounded-xl border border-line p-3 space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-[8rem_1fr_12rem_auto] gap-3 sm:items-end">
        <Field label="Time">
          <Input
            type="time"
            value={row.showtime}
            onChange={(e) => onPatch(updateSchedule(appState, row.id, { showtime: e.target.value }))}
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
          <Select
            value={row.priceCardId ?? ""}
            onChange={(e) =>
              onPatch(updateSchedule(appState, row.id, { priceCardId: (e.target.value || undefined) as UUID | undefined }))
            }
          >
            <option value="">— pick —</option>
            {priceCards.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onPatch(removeSchedule(appState, row.id))}
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
    </div>
  );
}
