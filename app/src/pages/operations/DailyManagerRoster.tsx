// ============================================================================
// /operations/rosters/daily-managers — weekly Daily Manager roster.
//
// Roster weeks run Thursday → Wednesday; one daily manager is on duty per day
// for a 3:00 PM → 3:00 PM (next-day) shift.
//
//   • owner / manager — create + publish the week, assign the on-duty DM per
//     day, and approve/reject swap + emergency-leave requests.
//   • daily_manager   — view the published roster, request a day swap (with a
//     reason), and flag an emergency leave (manager records cover).
//
// First instance of a reusable roster surface — the DAL keys everything on a
// staff_type so other staff rosters can be added as further tabs later.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { Field, Select } from "../../components/ui/Input";
import { useSync } from "../../lib/hooks/SyncContext";
import { todayIso } from "../../lib/dates";
import {
  loadRoster,
  createRoster,
  setAssignee,
  setRosterStatus,
  requestSwap,
  decideSwap,
  markEmergencyLeave,
  decideEmergencyLeave,
  listRosterStaff,
  weekStartOf,
  weekDates,
  weekRangeLabel,
  WEEKDAY_LABELS,
  type RosterBundle,
  type RosterStaffOption,
  type RosterAssignment,
} from "../../lib/roster";
import type { DateISO } from "../../lib/types";

function addWeeks(weekStart: DateISO, n: number): DateISO {
  const [y, m, d] = weekStart.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d! + n * 7);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}` as DateISO;
}

function dayLabel(iso: DateISO): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function DailyManagerRosterPage() {
  const { state } = useSync();
  const isManager = state.role === "owner" || state.role === "manager";
  const email = state.email ?? "";

  const [weekStart, setWeekStart] = useState<DateISO>(() => weekStartOf(todayIso()));
  const [bundle, setBundle] = useState<RosterBundle | null>(null);
  const [staff, setStaff] = useState<RosterStaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [swapOpen, setSwapOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const reload = useCallback(async () => {
    if (!state.cinemaId) return;
    setLoading(true);
    setErr(null);
    try {
      const b = await loadRoster(state.cinemaId, weekStart);
      setBundle(b);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [state.cinemaId, weekStart]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    listRosterStaff().then(setStaff).catch(() => setStaff([]));
  }, []);

  const staffLabel = useCallback(
    (e: string | null): string => {
      if (!e) return "—";
      return staff.find((s) => s.email === e)?.label ?? e;
    },
    [staff],
  );

  const dates = useMemo(() => weekDates(weekStart), [weekStart]);
  const pendingSwaps = bundle?.swaps.filter((s) => s.status === "pending") ?? [];
  const pendingLeaves = bundle?.leaves.filter((l) => l.status === "pending") ?? [];

  async function handleCreate() {
    if (!state.cinemaId) { setErr("No cinema context — try reloading."); return; }
    setBusy(true); setErr(null);
    try {
      const b = await createRoster(state.cinemaId, weekStart, email);
      setBundle(b);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleAssign(a: RosterAssignment, value: string) {
    setBusy(true); setErr(null);
    try {
      await setAssignee(a.id, value || null, email);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handlePublishToggle() {
    if (!bundle) return;
    setBusy(true); setErr(null);
    try {
      await setRosterStatus(bundle.roster.id, bundle.roster.status === "published" ? "draft" : "published", email);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold">Daily Manager Roster</h1>
          <p className="text-sm text-ink-muted">
            Weekly roster · Thursday → Wednesday · 3:00 PM → 3:00 PM (next-day) shift.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setWeekStart((w) => addWeeks(w, -1))}>←</Button>
          <Button variant="secondary" size="sm" onClick={() => setWeekStart(weekStartOf(todayIso()))}>This week</Button>
          <Button variant="secondary" size="sm" onClick={() => setWeekStart((w) => addWeeks(w, 1))}>→</Button>
        </div>
      </div>

      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="font-display font-semibold">{weekRangeLabel(weekStart)}</span>
            {bundle ? (
              <Badge tone={bundle.roster.status === "published" ? "green" : "amber"}>
                {bundle.roster.status === "published" ? "Published" : "Draft"}
              </Badge>
            ) : (
              <Badge tone="neutral">No roster</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {bundle ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => setSwapOpen(true)} disabled={busy}>
                  Request swap
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setLeaveOpen(true)} disabled={busy}>
                  Mark emergency leave
                </Button>
                {isManager ? (
                  <Button size="sm" onClick={() => void handlePublishToggle()} disabled={busy}>
                    {bundle.roster.status === "published" ? "Unpublish" : "Publish"}
                  </Button>
                ) : null}
              </>
            ) : isManager ? (
              <Button size="sm" onClick={() => void handleCreate()} disabled={busy}>
                {busy ? "Creating…" : "Create roster"}
              </Button>
            ) : null}
          </div>
        </CardBody>
      </Card>

      {err ? (
        <Card><CardBody><p className="text-sm text-red-600">{err}</p></CardBody></Card>
      ) : null}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : !bundle ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-muted">
              {isManager
                ? "No roster for this week yet. Click “Create roster” to start one."
                : "No roster published for this week yet."}
            </p>
          </CardBody>
        </Card>
      ) : (
        <>
          {/* 7-day grid */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {bundle.assignments.map((a) => {
              const dayLeaves = bundle.leaves.filter((l) => l.workDate === a.workDate);
              const approvedLeave = dayLeaves.find((l) => l.status === "approved");
              const pendingLeave = dayLeaves.find((l) => l.status === "pending");
              const dayPendingSwap = bundle.swaps.some(
                (s) => s.status === "pending" && (s.fromDate === a.workDate || s.toDate === a.workDate),
              );
              return (
                <Card key={a.id} className="h-full">
                  <CardBody className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-display font-semibold">{WEEKDAY_LABELS[a.dayOffset]}</span>
                      <span className="text-xs text-ink-muted">{dayLabel(a.workDate)}</span>
                    </div>
                    <p className="text-[11px] text-ink-muted">{a.shiftLabel}</p>
                    {isManager ? (
                      <Select
                        value={a.assigneeEmail ?? ""}
                        onChange={(e) => void handleAssign(a, e.target.value)}
                        disabled={busy}
                      >
                        <option value="">— Unassigned —</option>
                        {staff.map((s) => (
                          <option key={s.email} value={s.email}>{s.label}</option>
                        ))}
                      </Select>
                    ) : (
                      <p className="text-sm font-medium text-ink">{staffLabel(a.assigneeEmail)}</p>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {approvedLeave ? (
                        <Badge tone="red">Leave · cover {staffLabel(approvedLeave.coverEmail)}</Badge>
                      ) : null}
                      {pendingLeave ? <Badge tone="amber">Leave pending</Badge> : null}
                      {dayPendingSwap ? <Badge tone="blue">Swap pending</Badge> : null}
                    </div>
                  </CardBody>
                </Card>
              );
            })}
          </div>

          {/* Manager: pending approvals */}
          {isManager && (pendingSwaps.length > 0 || pendingLeaves.length > 0) ? (
            <Card>
              <CardHeader><CardTitle>Pending approvals</CardTitle></CardHeader>
              <CardBody className="space-y-4">
                {pendingSwaps.map((s) => (
                  <SwapDecisionRow
                    key={s.id}
                    fromLabel={`${dayLabel(s.fromDate)} (${staffLabel(s.requestedBy)})`}
                    toLabel={`${dayLabel(s.toDate)} (${staffLabel(s.counterpartyEmail)})`}
                    reason={s.reason}
                    disabled={busy}
                    onDecide={async (approve, note) => {
                      setBusy(true); setErr(null);
                      try { await decideSwap(s, approve, email, note); await reload(); }
                      catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
                      finally { setBusy(false); }
                    }}
                  />
                ))}
                {pendingLeaves.map((l) => (
                  <LeaveDecisionRow
                    key={l.id}
                    dayLabel={`${dayLabel(l.workDate)} — ${staffLabel(l.staffEmail)}`}
                    reason={l.reason}
                    staff={staff}
                    disabled={busy}
                    onDecide={async (approve, coverEmail) => {
                      setBusy(true); setErr(null);
                      try { await decideEmergencyLeave(l, approve, coverEmail, email); await reload(); }
                      catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
                      finally { setBusy(false); }
                    }}
                  />
                ))}
              </CardBody>
            </Card>
          ) : null}

          {/* Everyone: request log */}
          {bundle.swaps.length > 0 || bundle.leaves.length > 0 ? (
            <Card>
              <CardHeader><CardTitle>Requests this week</CardTitle></CardHeader>
              <CardBody className="space-y-2 text-sm">
                {bundle.swaps.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 last:border-0 last:pb-0">
                    <span>
                      <span className="font-medium">Swap</span> · {dayLabel(s.fromDate)} ⇄ {dayLabel(s.toDate)} · {staffLabel(s.requestedBy)}
                      <span className="text-ink-muted"> — {s.reason}</span>
                    </span>
                    <RequestStatusBadge status={s.status} />
                  </div>
                ))}
                {bundle.leaves.map((l) => (
                  <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 last:border-0 last:pb-0">
                    <span>
                      <span className="font-medium">Leave</span> · {dayLabel(l.workDate)} · {staffLabel(l.staffEmail)}
                      <span className="text-ink-muted"> — {l.reason}</span>
                      {l.coverEmail ? <span className="text-ink-muted"> · cover {staffLabel(l.coverEmail)}</span> : null}
                    </span>
                    <RequestStatusBadge status={l.status} />
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : null}
        </>
      )}

      {bundle && swapOpen ? (
        <SwapModal
          assignments={bundle.assignments}
          requestedBy={email}
          staffLabel={staffLabel}
          onClose={() => setSwapOpen(false)}
          onSubmit={async (fromDate, toDate, reason) => {
            const counterparty = bundle.assignments.find((a) => a.workDate === toDate)?.assigneeEmail ?? null;
            await requestSwap({ rosterId: bundle.roster.id, requestedBy: email, fromDate, toDate, counterpartyEmail: counterparty, reason });
            setSwapOpen(false);
            await reload();
          }}
        />
      ) : null}

      {bundle && leaveOpen ? (
        <LeaveModal
          assignments={bundle.assignments}
          fallbackEmail={email}
          staffLabel={staffLabel}
          onClose={() => setLeaveOpen(false)}
          onSubmit={async (workDate, staffEmail, reason) => {
            await markEmergencyLeave({ rosterId: bundle.roster.id, workDate, staffEmail, reason });
            setLeaveOpen(false);
            await reload();
          }}
        />
      ) : null}
    </div>
  );
}

function RequestStatusBadge({ status }: { status: "pending" | "approved" | "rejected" }) {
  const tone = status === "approved" ? "green" : status === "rejected" ? "red" : "amber";
  const label = status[0]!.toUpperCase() + status.slice(1);
  return <Badge tone={tone}>{label}</Badge>;
}

function TextArea({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={3}
      className="block w-full rounded-lg border border-line bg-white px-3 py-2 text-base sm:text-sm placeholder:text-ink-muted text-ink focus:outline-none focus:ring-2 focus:ring-amber-400/60 focus:border-amber-400"
    />
  );
}

function SwapDecisionRow({
  fromLabel, toLabel, reason, disabled, onDecide,
}: {
  fromLabel: string; toLabel: string; reason: string; disabled: boolean;
  onDecide: (approve: boolean, note: string) => void | Promise<void>;
}) {
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2 rounded-lg border border-line p-3">
      <p className="text-sm"><span className="font-medium">Swap</span> · {fromLabel} ⇄ {toLabel}</p>
      <p className="text-sm text-ink-muted">{reason}</p>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        className="block w-full h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-amber-400/60 focus:border-amber-400"
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void onDecide(true, note)} disabled={disabled}>Approve</Button>
        <Button variant="secondary" size="sm" onClick={() => void onDecide(false, note)} disabled={disabled}>Reject</Button>
      </div>
    </div>
  );
}

function LeaveDecisionRow({
  dayLabel, reason, staff, disabled, onDecide,
}: {
  dayLabel: string; reason: string; staff: RosterStaffOption[]; disabled: boolean;
  onDecide: (approve: boolean, coverEmail: string | null) => void | Promise<void>;
}) {
  const [cover, setCover] = useState("");
  return (
    <div className="space-y-2 rounded-lg border border-line p-3">
      <p className="text-sm"><span className="font-medium">Emergency leave</span> · {dayLabel}</p>
      <p className="text-sm text-ink-muted">{reason}</p>
      <Field label="Assign cover">
        <Select value={cover} onChange={(e) => setCover(e.target.value)}>
          <option value="">— Choose cover —</option>
          {staff.map((s) => <option key={s.email} value={s.email}>{s.label}</option>)}
        </Select>
      </Field>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void onDecide(true, cover || null)} disabled={disabled}>Approve</Button>
        <Button variant="secondary" size="sm" onClick={() => void onDecide(false, null)} disabled={disabled}>Reject</Button>
      </div>
    </div>
  );
}

function SwapModal({
  assignments, requestedBy, staffLabel, onClose, onSubmit,
}: {
  assignments: RosterAssignment[];
  requestedBy: string;
  staffLabel: (e: string | null) => string;
  onClose: () => void;
  onSubmit: (fromDate: DateISO, toDate: DateISO, reason: string) => Promise<void>;
}) {
  // Default "from" to a day the requester is on, if any.
  const mine = assignments.find((a) => a.assigneeEmail === requestedBy);
  const [fromDate, setFromDate] = useState<DateISO>(mine?.workDate ?? assignments[0]!.workDate);
  const [toDate, setToDate] = useState<DateISO>(
    (assignments.find((a) => a.workDate !== (mine?.workDate ?? assignments[0]!.workDate))?.workDate) ?? assignments[0]!.workDate,
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function optLabel(a: RosterAssignment): string {
    return `${WEEKDAY_LABELS[a.dayOffset]} ${dayLabel(a.workDate)} — ${staffLabel(a.assigneeEmail)}`;
  }

  async function submit() {
    if (fromDate === toDate) { setErr("Pick two different days to swap."); return; }
    if (!reason.trim()) { setErr("A reason is required."); return; }
    setBusy(true); setErr(null);
    try { await onSubmit(fromDate, toDate, reason.trim()); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  return (
    <Modal
      open onClose={onClose} maxWidth="max-w-lg" title="Request day swap"
      actions={
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={() => void submit()} disabled={busy}>{busy ? "Sending…" : "Send request"}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        {err ? <p className="text-sm text-red-600">{err}</p> : null}
        <Field label="My day">
          <Select value={fromDate} onChange={(e) => setFromDate(e.target.value as DateISO)}>
            {assignments.map((a) => <option key={a.id} value={a.workDate}>{optLabel(a)}</option>)}
          </Select>
        </Field>
        <Field label="Swap with">
          <Select value={toDate} onChange={(e) => setToDate(e.target.value as DateISO)}>
            {assignments.map((a) => <option key={a.id} value={a.workDate}>{optLabel(a)}</option>)}
          </Select>
        </Field>
        <Field label="Reason">
          <TextArea value={reason} onChange={setReason} placeholder="Why the swap is needed" />
        </Field>
        <p className="text-xs text-ink-muted">A manager must approve before the swap takes effect.</p>
      </div>
    </Modal>
  );
}

function LeaveModal({
  assignments, fallbackEmail, staffLabel, onClose, onSubmit,
}: {
  assignments: RosterAssignment[];
  fallbackEmail: string;
  staffLabel: (e: string | null) => string;
  onClose: () => void;
  onSubmit: (workDate: DateISO, staffEmail: string, reason: string) => Promise<void>;
}) {
  const [workDate, setWorkDate] = useState<DateISO>(assignments[0]!.workDate);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const staffEmail = assignments.find((a) => a.workDate === workDate)?.assigneeEmail ?? fallbackEmail;

  async function submit() {
    if (!reason.trim()) { setErr("A reason is required."); return; }
    setBusy(true); setErr(null);
    try { await onSubmit(workDate, staffEmail, reason.trim()); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  return (
    <Modal
      open onClose={onClose} maxWidth="max-w-lg" title="Mark emergency leave"
      actions={
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={() => void submit()} disabled={busy}>{busy ? "Saving…" : "Submit"}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        {err ? <p className="text-sm text-red-600">{err}</p> : null}
        <Field label="Day">
          <Select value={workDate} onChange={(e) => setWorkDate(e.target.value as DateISO)}>
            {assignments.map((a) => (
              <option key={a.id} value={a.workDate}>
                {WEEKDAY_LABELS[a.dayOffset]} {dayLabel(a.workDate)} — {staffLabel(a.assigneeEmail)}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-xs text-ink-muted">On leave: {staffLabel(staffEmail)}</p>
        <Field label="Reason">
          <TextArea value={reason} onChange={setReason} placeholder="Reason for the emergency leave" />
        </Field>
        <p className="text-xs text-ink-muted">A manager will record the cover and approve.</p>
      </div>
    </Modal>
  );
}
