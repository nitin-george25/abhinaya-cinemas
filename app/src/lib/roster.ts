// ============================================================================
// Operations rosters — domain types + Supabase DAL.
//
// Backs Operations → Rosters → Daily Manager Roster (migration
// operations-rosters). Weekly rosters run Thursday → Wednesday; one daily
// manager is on duty per day for a 3:00 PM → 3:00 PM (next-day) shift.
//
// Normalized-only, no config-blob dual-write — same shape as lib/cash.ts and
// lib/projects.ts. Reads warn + return a safe default; writes throw.
//
// Roles (enforced by RLS, mirrored in the UI):
//   • owner / manager  — build + publish rosters, decide swaps + leave.
//   • daily_manager    — read the roster, request swaps, flag emergency leave.
// ============================================================================

import { getSupabase } from "./supabase";
import { addDaysIso, localIso } from "./dates";
import { listUsers } from "./users";
import type { DateISO } from "./types";
import type {
  StaffRosterRow,
  RosterAssignmentRow,
  RosterSwapRow,
  RosterEmergencyLeaveRow,
  RosterStatus,
  RosterRequestStatus,
} from "./db-types";

export const DAILY_MANAGER_STAFF_TYPE = "daily_manager";

// ── domain types (camelCase) ────────────────────────────────────────────────
export interface StaffRoster {
  id: string;
  cinemaId: string;
  staffType: string;
  weekStart: DateISO;
  status: RosterStatus;
  notes: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface RosterAssignment {
  id: string;
  rosterId: string;
  workDate: DateISO;
  dayOffset: number;
  assigneeEmail: string | null;
  shiftStart: string;
  shiftLabel: string;
}

export interface RosterSwap {
  id: string;
  rosterId: string;
  requestedBy: string;
  fromDate: DateISO;
  toDate: DateISO;
  counterpartyEmail: string | null;
  reason: string;
  status: RosterRequestStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string | null;
}

export interface RosterEmergencyLeave {
  id: string;
  rosterId: string;
  workDate: DateISO;
  staffEmail: string;
  reason: string;
  status: RosterRequestStatus;
  coverEmail: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string | null;
}

export interface RosterBundle {
  roster: StaffRoster;
  assignments: RosterAssignment[];
  swaps: RosterSwap[];
  leaves: RosterEmergencyLeave[];
}

export interface RosterStaffOption {
  email: string;
  label: string; // full name or username, falling back to the email
}

// ── week helpers ────────────────────────────────────────────────────────────

export const WEEKDAY_LABELS = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"] as const;

/**
 * The Thursday that opens the roster week containing `iso`. Roster weeks run
 * Thursday → Wednesday, so we step back to the most recent Thursday (Postgres
 * + JS agree: Thu = 4 when Sun = 0). Parsed local, never UTC (IST safety).
 */
export function weekStartOf(iso: DateISO): DateISO {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  const dow = date.getDay();           // Sun=0 … Sat=6
  const back = (dow - 4 + 7) % 7;      // days since the opening Thursday
  return localIso(new Date(y, m - 1, d - back));
}

/** The seven local dates of a roster week, Thu → Wed. */
export function weekDates(weekStart: DateISO): DateISO[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i));
}

/** Human label for a week, e.g. "12 Jun → 18 Jun 2026". */
export function weekRangeLabel(weekStart: DateISO): string {
  const end = addDaysIso(weekStart, 6);
  const fmt = (iso: DateISO, withYear: boolean) => {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y!, m! - 1, d!);
    const opts: Intl.DateTimeFormatOptions = withYear
      ? { day: "numeric", month: "short", year: "numeric" }
      : { day: "numeric", month: "short" };
    return dt.toLocaleDateString("en-GB", opts);
  };
  return `${fmt(weekStart, false)} → ${fmt(end, true)}`;
}

// ── mappers ─────────────────────────────────────────────────────────────────

function toRoster(r: StaffRosterRow): StaffRoster {
  return {
    id: r.id,
    cinemaId: r.cinema_id,
    staffType: r.staff_type,
    weekStart: r.week_start as DateISO,
    status: r.status,
    notes: r.notes,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toAssignment(r: RosterAssignmentRow): RosterAssignment {
  return {
    id: r.id,
    rosterId: r.roster_id,
    workDate: r.work_date as DateISO,
    dayOffset: r.day_offset,
    assigneeEmail: r.assignee_email,
    shiftStart: r.shift_start,
    shiftLabel: r.shift_label,
  };
}

function toSwap(r: RosterSwapRow): RosterSwap {
  return {
    id: r.id,
    rosterId: r.roster_id,
    requestedBy: r.requested_by,
    fromDate: r.from_date as DateISO,
    toDate: r.to_date as DateISO,
    counterpartyEmail: r.counterparty_email,
    reason: r.reason,
    status: r.status,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    decisionNote: r.decision_note,
    createdAt: r.created_at,
  };
}

function toLeave(r: RosterEmergencyLeaveRow): RosterEmergencyLeave {
  return {
    id: r.id,
    rosterId: r.roster_id,
    workDate: r.work_date as DateISO,
    staffEmail: r.staff_email,
    reason: r.reason,
    status: r.status,
    coverEmail: r.cover_email,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
  };
}

// ── reads (warn + safe default, never throw) ────────────────────────────────

/**
 * Load the full roster bundle for a week, or null if no roster exists yet.
 * staffType defaults to daily managers.
 */
export async function loadRoster(
  cinemaId: string,
  weekStart: DateISO,
  staffType: string = DAILY_MANAGER_STAFF_TYPE,
): Promise<RosterBundle | null> {
  const sb = getSupabase();
  const { data: rosterRow, error } = await sb
    .from("staff_rosters")
    .select("*")
    .eq("cinema_id", cinemaId)
    .eq("staff_type", staffType)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (error) {
    console.warn("[roster] loadRoster", error.message);
    return null;
  }
  if (!rosterRow) return null;
  const roster = toRoster(rosterRow as StaffRosterRow);

  const [aRes, sRes, lRes] = await Promise.all([
    sb.from("roster_assignments").select("*").eq("roster_id", roster.id).order("day_offset"),
    sb.from("roster_swaps").select("*").eq("roster_id", roster.id).order("created_at", { ascending: false }),
    sb.from("roster_emergency_leaves").select("*").eq("roster_id", roster.id).order("created_at", { ascending: false }),
  ]);
  if (aRes.error) console.warn("[roster] assignments", aRes.error.message);
  if (sRes.error) console.warn("[roster] swaps", sRes.error.message);
  if (lRes.error) console.warn("[roster] leaves", lRes.error.message);

  return {
    roster,
    assignments: ((aRes.data as RosterAssignmentRow[] | null) ?? []).map(toAssignment),
    swaps: ((sRes.data as RosterSwapRow[] | null) ?? []).map(toSwap),
    leaves: ((lRes.data as RosterEmergencyLeaveRow[] | null) ?? []).map(toLeave),
  };
}

/** The staff who can be put on duty — daily managers + managers. */
export async function listRosterStaff(): Promise<RosterStaffOption[]> {
  const users = await listUsers();
  return users
    .filter((u) => u.role === "daily_manager" || u.role === "manager")
    .map((u) => ({
      email: u.email,
      label: u.fullName || u.username || u.email,
    }));
}

// ── writes (throw on error) ─────────────────────────────────────────────────

/**
 * Create a roster for a week + its seven (empty) day assignments. Idempotent
 * on the (cinema, staff_type, week_start) unique key — if one already exists it
 * is returned untouched.
 */
export async function createRoster(
  cinemaId: string,
  weekStart: DateISO,
  createdBy: string,
  staffType: string = DAILY_MANAGER_STAFF_TYPE,
): Promise<RosterBundle> {
  const existing = await loadRoster(cinemaId, weekStart, staffType);
  if (existing) return existing;

  const sb = getSupabase();
  const { data, error } = await sb
    .from("staff_rosters")
    .insert({
      cinema_id: cinemaId,
      staff_type: staffType,
      week_start: weekStart,
      status: "draft",
      created_by: createdBy,
      updated_by: createdBy,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  const roster = toRoster(data as StaffRosterRow);

  const rows = weekDates(weekStart).map((d, i) => ({
    roster_id: roster.id,
    work_date: d,
    day_offset: i,
    assignee_email: null,
    updated_by: createdBy,
  }));
  const { error: insErr } = await sb.from("roster_assignments").insert(rows);
  if (insErr) throw new Error(insErr.message);

  const bundle = await loadRoster(cinemaId, weekStart, staffType);
  if (!bundle) throw new Error("Roster created but could not be reloaded.");
  return bundle;
}

/** Assign (or clear) the on-duty staff for one day. Owner/manager only. */
export async function setAssignee(
  assignmentId: string,
  assigneeEmail: string | null,
  updatedBy: string,
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("roster_assignments")
    .update({
      assignee_email: assigneeEmail,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    })
    .eq("id", assignmentId);
  if (error) throw new Error(error.message);
}

/** Flip a roster between draft and published. Owner/manager only. */
export async function setRosterStatus(
  rosterId: string,
  status: RosterStatus,
  updatedBy: string,
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("staff_rosters")
    .update({ status, updated_by: updatedBy, updated_at: new Date().toISOString() })
    .eq("id", rosterId);
  if (error) throw new Error(error.message);
}

/** Save the roster note. Owner/manager only. */
export async function setRosterNotes(
  rosterId: string,
  notes: string,
  updatedBy: string,
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("staff_rosters")
    .update({ notes: notes || null, updated_by: updatedBy, updated_at: new Date().toISOString() })
    .eq("id", rosterId);
  if (error) throw new Error(error.message);
}

/** Raise a day-swap request (pending until a manager decides). */
export async function requestSwap(input: {
  rosterId: string;
  requestedBy: string;
  fromDate: DateISO;
  toDate: DateISO;
  counterpartyEmail: string | null;
  reason: string;
}): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("roster_swaps").insert({
    roster_id: input.rosterId,
    requested_by: input.requestedBy,
    from_date: input.fromDate,
    to_date: input.toDate,
    counterparty_email: input.counterpartyEmail,
    reason: input.reason,
    status: "pending",
  });
  if (error) throw new Error(error.message);
}

/**
 * Approve or reject a swap. On approval the two days' assignees are exchanged
 * (manager has write on roster_assignments). The decision is stamped either way.
 */
export async function decideSwap(
  swap: RosterSwap,
  approve: boolean,
  decidedBy: string,
  note: string,
): Promise<void> {
  const sb = getSupabase();

  if (approve) {
    // Look up the two assignments by (roster, date) and exchange assignees.
    const { data, error } = await sb
      .from("roster_assignments")
      .select("id, work_date, assignee_email")
      .eq("roster_id", swap.rosterId)
      .in("work_date", [swap.fromDate, swap.toDate]);
    if (error) throw new Error(error.message);
    const rows = (data as Pick<RosterAssignmentRow, "id" | "work_date" | "assignee_email">[] | null) ?? [];
    const from = rows.find((r) => r.work_date === swap.fromDate);
    const to = rows.find((r) => r.work_date === swap.toDate);
    if (from && to) {
      const stamp = new Date().toISOString();
      const u1 = await sb
        .from("roster_assignments")
        .update({ assignee_email: to.assignee_email, updated_by: decidedBy, updated_at: stamp })
        .eq("id", from.id);
      if (u1.error) throw new Error(u1.error.message);
      const u2 = await sb
        .from("roster_assignments")
        .update({ assignee_email: from.assignee_email, updated_by: decidedBy, updated_at: stamp })
        .eq("id", to.id);
      if (u2.error) throw new Error(u2.error.message);
    }
  }

  const { error: decErr } = await sb
    .from("roster_swaps")
    .update({
      status: approve ? "approved" : "rejected",
      decided_by: decidedBy,
      decided_at: new Date().toISOString(),
      decision_note: note || null,
    })
    .eq("id", swap.id);
  if (decErr) throw new Error(decErr.message);
}

/** Flag a day as emergency leave (pending until a manager records cover). */
export async function markEmergencyLeave(input: {
  rosterId: string;
  workDate: DateISO;
  staffEmail: string;
  reason: string;
}): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("roster_emergency_leaves").insert({
    roster_id: input.rosterId,
    work_date: input.workDate,
    staff_email: input.staffEmail,
    reason: input.reason,
    status: "pending",
  });
  if (error) throw new Error(error.message);
}

/**
 * Approve or reject an emergency leave. On approval, if a cover is named, that
 * cover becomes the day's assignee. The decision is stamped either way.
 */
export async function decideEmergencyLeave(
  leave: RosterEmergencyLeave,
  approve: boolean,
  coverEmail: string | null,
  decidedBy: string,
): Promise<void> {
  const sb = getSupabase();

  if (approve && coverEmail) {
    const { data, error } = await sb
      .from("roster_assignments")
      .select("id")
      .eq("roster_id", leave.rosterId)
      .eq("work_date", leave.workDate)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as { id: string } | null;
    if (row) {
      const u = await sb
        .from("roster_assignments")
        .update({ assignee_email: coverEmail, updated_by: decidedBy, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (u.error) throw new Error(u.error.message);
    }
  }

  const { error: decErr } = await sb
    .from("roster_emergency_leaves")
    .update({
      status: approve ? "approved" : "rejected",
      cover_email: coverEmail,
      decided_by: decidedBy,
      decided_at: new Date().toISOString(),
    })
    .eq("id", leave.id);
  if (decErr) throw new Error(decErr.message);
}
