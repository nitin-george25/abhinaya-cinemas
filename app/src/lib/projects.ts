// ============================================================================
// Project Management — domain types + Supabase DAL.
//
// Backs the Renovations tracker (migration 20260613100000_projects_module).
// Normalized-only, no config-blob dual-write — same shape as lib/cash.ts.
//
// Assignment model:
//   • owner assigns ONE project manager (a member with role 'project_manager')
//   • project manager / owner assign further members (managers, daily managers)
//   • only owner + assigned members can tick tasks/subtasks (enforced by RLS)
// Ticks are stamped + audited by DB triggers; the client just flips `done`.
// ============================================================================

import { getSupabase } from "./supabase";
import type { DateISO } from "./types";

// ── enums ───────────────────────────────────────────────────────────────
export type ProjectStatus = "planning" | "active" | "on_hold" | "completed" | "archived";
export type ProjectRoleInProject = "project_manager" | "member";

export const PROJECT_STATUSES: ProjectStatus[] = [
  "planning", "active", "on_hold", "completed", "archived",
];

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: "Planning",
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
  archived: "Archived",
};

// ── domain types (camelCase) ──────────────────────────────────────────────
export interface Project {
  id: string;
  cinemaId: string;
  category: string;
  name: string;
  location: string | null;
  area: string | null;
  projectType: string | null;
  summary: string | null;
  status: ProjectStatus;
  startDate: DateISO | null;
  targetFinish: DateISO | null;
  projectManagerEmail: string | null;
  createdBy: string | null;
  createdAt: string;
  archivedAt: string | null;
}

export interface ProjectMember {
  id: string;
  projectId: string;
  userEmail: string;
  roleInProject: ProjectRoleInProject;
  assignedBy: string | null;
  assignedAt: string;
}

export interface ProjectPhase {
  id: string;
  projectId: string;
  seq: number;
  name: string;
  color: string | null;
}

export interface ProjectTask {
  id: string;
  projectId: string;
  phaseId: string;
  seq: number;
  code: string | null;
  name: string;
  note: string | null;
  startDate: DateISO | null;
  endDate: DateISO | null;
  isMilestone: boolean;
  done: boolean;
  doneAt: string | null;
  doneBy: string | null;
  doneNote: string | null;
}

export interface ProjectSubtask {
  id: string;
  projectId: string;
  taskId: string;
  seq: number;
  name: string;
  done: boolean;
  doneAt: string | null;
  doneBy: string | null;
  createdBy: string | null;
}

export interface ProjectTaskFile {
  id: string;
  projectId: string;
  taskId: string;
  fileUrl: string;
  fileName: string | null;
  fileSize: number | null;
  contentType: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
}

export interface ProjectAuditEntry {
  id: number;
  projectId: string;
  taskId: string | null;
  subtaskId: string | null;
  action: string;
  actorEmail: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

/** Everything needed to render one project's detail view in a single load. */
export interface ProjectBundle {
  project: Project;
  members: ProjectMember[];
  phases: ProjectPhase[];
  tasks: ProjectTask[];
  subtasks: ProjectSubtask[];
  files: ProjectTaskFile[];
  budgetItems: ProjectBudgetItem[];
  invoices: ProjectInvoice[];
}

// ── row mappers (snake → camel) ───────────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
const toProject = (r: any): Project => ({
  id: r.id,
  cinemaId: r.cinema_id,
  category: r.category,
  name: r.name,
  location: r.location ?? null,
  area: r.area ?? null,
  projectType: r.project_type ?? null,
  summary: r.summary ?? null,
  status: r.status,
  startDate: r.start_date ?? null,
  targetFinish: r.target_finish ?? null,
  projectManagerEmail: r.project_manager_email ?? null,
  createdBy: r.created_by ?? null,
  createdAt: r.created_at,
  archivedAt: r.archived_at ?? null,
});

const toMember = (r: any): ProjectMember => ({
  id: r.id,
  projectId: r.project_id,
  userEmail: r.user_email,
  roleInProject: r.role_in_project,
  assignedBy: r.assigned_by ?? null,
  assignedAt: r.assigned_at,
});

const toPhase = (r: any): ProjectPhase => ({
  id: r.id, projectId: r.project_id, seq: r.seq, name: r.name, color: r.color ?? null,
});

const toTask = (r: any): ProjectTask => ({
  id: r.id,
  projectId: r.project_id,
  phaseId: r.phase_id,
  seq: r.seq,
  code: r.code ?? null,
  name: r.name,
  note: r.note ?? null,
  startDate: r.start_date ?? null,
  endDate: r.end_date ?? null,
  isMilestone: !!r.is_milestone,
  done: !!r.done,
  doneAt: r.done_at ?? null,
  doneBy: r.done_by ?? null,
  doneNote: r.done_note ?? null,
});

const toSubtask = (r: any): ProjectSubtask => ({
  id: r.id,
  projectId: r.project_id,
  taskId: r.task_id,
  seq: r.seq,
  name: r.name,
  done: !!r.done,
  doneAt: r.done_at ?? null,
  doneBy: r.done_by ?? null,
  createdBy: r.created_by ?? null,
});

const toFile = (r: any): ProjectTaskFile => ({
  id: r.id,
  projectId: r.project_id,
  taskId: r.task_id,
  fileUrl: r.file_url,
  fileName: r.file_name ?? null,
  fileSize: r.file_size ?? null,
  contentType: r.content_type ?? null,
  uploadedBy: r.uploaded_by ?? null,
  uploadedAt: r.uploaded_at,
});

const toAudit = (r: any): ProjectAuditEntry => ({
  id: r.id,
  projectId: r.project_id,
  taskId: r.task_id ?? null,
  subtaskId: r.subtask_id ?? null,
  action: r.action,
  actorEmail: r.actor_email ?? null,
  detail: r.detail ?? null,
  createdAt: r.created_at,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── projects ──────────────────────────────────────────────────────────────
export async function listProjects(category = "renovation"): Promise<Project[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("projects")
    .select("*")
    .eq("category", category)
    .order("created_at", { ascending: false });
  if (error) { console.warn("[projects] listProjects", error.message); return []; }
  return ((data as unknown[]) ?? []).map(toProject);
}

export async function getProject(id: string): Promise<Project | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.from("projects").select("*").eq("id", id).maybeSingle();
  if (error) { console.warn("[projects] getProject", error.message); return null; }
  return data ? toProject(data) : null;
}

export interface CreateProjectInput {
  cinemaId: string;
  category?: string;
  name: string;
  location?: string | null;
  area?: string | null;
  projectType?: string | null;
  summary?: string | null;
  status?: ProjectStatus;
  startDate?: DateISO | null;
  targetFinish?: DateISO | null;
  createdBy: string;
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { data, error } = await sb
    .from("projects")
    .insert({
      cinema_id: input.cinemaId,
      category: input.category ?? "renovation",
      name: input.name,
      location: input.location ?? null,
      area: input.area ?? null,
      project_type: input.projectType ?? null,
      summary: input.summary ?? null,
      status: input.status ?? "active",
      start_date: input.startDate ?? null,
      target_finish: input.targetFinish ?? null,
      created_by: input.createdBy,
      updated_by: input.createdBy,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return toProject(data);
}

export interface UpdateProjectInput {
  name?: string;
  location?: string | null;
  area?: string | null;
  projectType?: string | null;
  summary?: string | null;
  status?: ProjectStatus;
  startDate?: DateISO | null;
  targetFinish?: DateISO | null;
  projectManagerEmail?: string | null;
  updatedBy: string;
}

export async function updateProject(id: string, patch: UpdateProjectInput): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const row: Record<string, unknown> = { updated_by: patch.updatedBy };
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.location !== undefined) row.location = patch.location;
  if (patch.area !== undefined) row.area = patch.area;
  if (patch.projectType !== undefined) row.project_type = patch.projectType;
  if (patch.summary !== undefined) row.summary = patch.summary;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.startDate !== undefined) row.start_date = patch.startDate;
  if (patch.targetFinish !== undefined) row.target_finish = patch.targetFinish;
  if (patch.projectManagerEmail !== undefined) row.project_manager_email = patch.projectManagerEmail;
  const { error } = await sb.from("projects").update(row).eq("id", id);
  if (error) throw new Error(error.message);
}

// ── members ─────────────────────────────────────────────────────────────
export async function listMembers(projectId: string): Promise<ProjectMember[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("project_members").select("*").eq("project_id", projectId)
    .order("role_in_project", { ascending: true }).order("user_email", { ascending: true });
  if (error) { console.warn("[projects] listMembers", error.message); return []; }
  return ((data as unknown[]) ?? []).map(toMember);
}

/** Add or update a member (upsert on the project+email unique key). */
export async function assignMember(
  projectId: string,
  userEmail: string,
  roleInProject: ProjectRoleInProject,
  assignedBy: string,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.from("project_members").upsert(
    {
      project_id: projectId,
      user_email: userEmail.toLowerCase(),
      role_in_project: roleInProject,
      assigned_by: assignedBy,
    },
    { onConflict: "project_id,user_email" },
  );
  if (error) throw new Error(error.message);
}

export async function removeMember(projectId: string, userEmail: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb
    .from("project_members").delete()
    .eq("project_id", projectId).eq("user_email", userEmail.toLowerCase());
  if (error) throw new Error(error.message);
}

/**
 * Owner assigns the project manager: set projects.project_manager_email AND
 * upsert the member row with the 'project_manager' role. Demotes any prior PM
 * member to a plain member so there is only ever one.
 */
export async function setProjectManager(
  projectId: string,
  userEmail: string,
  assignedBy: string,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  // Demote existing PMs (other than the new one) to member.
  await sb.from("project_members")
    .update({ role_in_project: "member" })
    .eq("project_id", projectId).eq("role_in_project", "project_manager")
    .neq("user_email", userEmail.toLowerCase());
  await assignMember(projectId, userEmail, "project_manager", assignedBy);
  await updateProject(projectId, { projectManagerEmail: userEmail.toLowerCase(), updatedBy: assignedBy });
}

// ── phases / tasks / subtasks ─────────────────────────────────────────────
export async function listPhases(projectId: string): Promise<ProjectPhase[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("project_phases").select("*").eq("project_id", projectId)
    .order("seq", { ascending: true });
  if (error) { console.warn("[projects] listPhases", error.message); return []; }
  return ((data as unknown[]) ?? []).map(toPhase);
}

export async function listTasks(projectId: string): Promise<ProjectTask[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("project_tasks").select("*").eq("project_id", projectId)
    .order("seq", { ascending: true });
  if (error) { console.warn("[projects] listTasks", error.message); return []; }
  return ((data as unknown[]) ?? []).map(toTask);
}

export async function listSubtasks(projectId: string): Promise<ProjectSubtask[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("project_subtasks").select("*").eq("project_id", projectId)
    .order("seq", { ascending: true });
  if (error) { console.warn("[projects] listSubtasks", error.message); return []; }
  return ((data as unknown[]) ?? []).map(toSubtask);
}

/** Flip a task's done flag. done_at/done_by + audit are set by a DB trigger. */
export async function setTaskDone(
  taskId: string, done: boolean, note?: string | null,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  // done_note is set only when completing; the DB trigger clears it on reopen.
  const row: Record<string, unknown> = { done };
  if (done && note !== undefined) row.done_note = note;
  const { error } = await sb.from("project_tasks").update(row).eq("id", taskId);
  if (error) throw new Error(error.message);
}

export async function setSubtaskDone(subtaskId: string, done: boolean): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.from("project_subtasks").update({ done }).eq("id", subtaskId);
  if (error) throw new Error(error.message);
}

export async function addSubtask(
  projectId: string,
  taskId: string,
  name: string,
  createdBy: string,
  seq = 0,
): Promise<ProjectSubtask> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { data, error } = await sb
    .from("project_subtasks")
    .insert({ project_id: projectId, task_id: taskId, name, created_by: createdBy, seq })
    .select("*").single();
  if (error) throw new Error(error.message);
  return toSubtask(data);
}

export async function deleteSubtask(subtaskId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.from("project_subtasks").delete().eq("id", subtaskId);
  if (error) throw new Error(error.message);
}

// ── task files ────────────────────────────────────────────────────────────
export async function listTaskFiles(projectId: string): Promise<ProjectTaskFile[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("project_task_files").select("*").eq("project_id", projectId)
    .order("uploaded_at", { ascending: false });
  if (error) { console.warn("[projects] listTaskFiles", error.message); return []; }
  return ((data as unknown[]) ?? []).map(toFile);
}

/** Upload to the project-files bucket then record the row. Returns the row. */
export async function uploadTaskFile(
  projectId: string,
  taskId: string,
  file: File,
  uploadedBy: string,
): Promise<ProjectTaskFile> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const ext = file.name.split(".").pop() ?? "bin";
  const path = `${projectId}/${taskId}/${Date.now()}.${ext}`;
  const up = await sb.storage.from("project-files").upload(path, file, { upsert: false });
  if (up.error) throw new Error(up.error.message);
  const { data: pub } = sb.storage.from("project-files").getPublicUrl(path);
  const { data, error } = await sb
    .from("project_task_files")
    .insert({
      project_id: projectId,
      task_id: taskId,
      file_url: pub.publicUrl,
      file_name: file.name,
      file_size: file.size,
      content_type: file.type || null,
      uploaded_by: uploadedBy,
    })
    .select("*").single();
  if (error) throw new Error(error.message);
  return toFile(data);
}

export async function deleteTaskFile(fileId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.from("project_task_files").delete().eq("id", fileId);
  if (error) throw new Error(error.message);
}

// ── audit ─────────────────────────────────────────────────────────────────
export async function listAudit(projectId: string, limit = 100): Promise<ProjectAuditEntry[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("project_audit").select("*").eq("project_id", projectId)
    .order("created_at", { ascending: false }).limit(limit);
  if (error) { console.warn("[projects] listAudit", error.message); return []; }
  return ((data as unknown[]) ?? []).map(toAudit);
}

// ── one-shot bundle load for the detail page ───────────────────────────────
export async function loadProjectBundle(projectId: string): Promise<ProjectBundle | null> {
  const project = await getProject(projectId);
  if (!project) return null;
  const [members, phases, tasks, subtasks, files, budgetItems, invoices] = await Promise.all([
    listMembers(projectId),
    listPhases(projectId),
    listTasks(projectId),
    listSubtasks(projectId),
    listTaskFiles(projectId),
    listBudgetItems(projectId),
    listInvoices(projectId),
  ]);
  return { project, members, phases, tasks, subtasks, files, budgetItems, invoices };
}

// ── progress helpers ───────────────────────────────────────────────────────
/**
 * A task's completion fraction (0..1). With subtasks it's the share of
 * subtasks done; without, it's 1 when the task itself is ticked.
 */
export function taskCompletion(task: ProjectTask, subtasks: ProjectSubtask[]): number {
  const subs = subtasks.filter((s) => s.taskId === task.id);
  if (subs.length === 0) return task.done ? 1 : 0;
  return subs.filter((s) => s.done).length / subs.length;
}

/** Whole-project completion as a 0..100 percentage, averaged over tasks. */
export function projectProgressPct(tasks: ProjectTask[], subtasks: ProjectSubtask[]): number {
  if (tasks.length === 0) return 0;
  const sum = tasks.reduce((acc, t) => acc + taskCompletion(t, subtasks), 0);
  return Math.round((sum / tasks.length) * 100);
}

// ── finances: budget items + invoices ──────────────────────────────────────
export interface ProjectBudgetItem {
  id: string;
  projectId: string;
  seq: number;
  name: string;
  category: string | null;
  estimate: number;
  notes: string | null;
}

export interface ProjectInvoice {
  id: string;
  projectId: string;
  budgetItemId: string | null;
  vendor: string | null;
  invoiceNo: string | null;
  invoiceDate: DateISO | null;
  amount: number;
  notes: string | null;
  fileUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  contentType: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const toBudgetItem = (r: any): ProjectBudgetItem => ({
  id: r.id,
  projectId: r.project_id,
  seq: r.seq,
  name: r.name,
  category: r.category ?? null,
  estimate: Number(r.estimate ?? 0),
  notes: r.notes ?? null,
});

const toInvoice = (r: any): ProjectInvoice => ({
  id: r.id,
  projectId: r.project_id,
  budgetItemId: r.budget_item_id ?? null,
  vendor: r.vendor ?? null,
  invoiceNo: r.invoice_no ?? null,
  invoiceDate: r.invoice_date ?? null,
  amount: Number(r.amount ?? 0),
  notes: r.notes ?? null,
  fileUrl: r.file_url ?? null,
  fileName: r.file_name ?? null,
  fileSize: r.file_size ?? null,
  contentType: r.content_type ?? null,
  uploadedBy: r.uploaded_by ?? null,
  uploadedAt: r.uploaded_at,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listBudgetItems(projectId: string): Promise<ProjectBudgetItem[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("project_budget_items").select("*").eq("project_id", projectId)
    .order("seq", { ascending: true });
  if (error) { console.warn("[projects] listBudgetItems", error.message); return []; }
  return ((data as unknown[]) ?? []).map(toBudgetItem);
}

export interface BudgetItemInput {
  name: string;
  category?: string | null;
  estimate?: number;
  notes?: string | null;
}

export async function createBudgetItem(
  projectId: string, input: BudgetItemInput, createdBy: string, seq = 0,
): Promise<ProjectBudgetItem> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { data, error } = await sb
    .from("project_budget_items")
    .insert({
      project_id: projectId,
      name: input.name,
      category: input.category ?? null,
      estimate: input.estimate ?? 0,
      notes: input.notes ?? null,
      seq,
      created_by: createdBy,
      updated_by: createdBy,
    })
    .select("*").single();
  if (error) throw new Error(error.message);
  return toBudgetItem(data);
}

export async function updateBudgetItem(
  id: string, patch: BudgetItemInput, updatedBy: string,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const row: Record<string, unknown> = { updated_by: updatedBy };
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.estimate !== undefined) row.estimate = patch.estimate;
  if (patch.notes !== undefined) row.notes = patch.notes;
  const { error } = await sb.from("project_budget_items").update(row).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteBudgetItem(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.from("project_budget_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listInvoices(projectId: string): Promise<ProjectInvoice[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("project_invoices").select("*").eq("project_id", projectId)
    .order("invoice_date", { ascending: false });
  if (error) { console.warn("[projects] listInvoices", error.message); return []; }
  return ((data as unknown[]) ?? []).map(toInvoice);
}

export interface InvoiceInput {
  budgetItemId?: string | null;
  vendor?: string | null;
  invoiceNo?: string | null;
  invoiceDate?: DateISO | null;
  amount: number;
  notes?: string | null;
}

/** Create an invoice row, optionally uploading a bill file to project-files. */
export async function createInvoice(
  projectId: string, input: InvoiceInput, uploadedBy: string, file?: File | null,
): Promise<ProjectInvoice> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  let fileMeta: { url: string; name: string; size: number; type: string } | null = null;
  if (file) {
    const ext = file.name.split(".").pop() ?? "bin";
    const path = `${projectId}/invoices/${Date.now()}.${ext}`;
    const up = await sb.storage.from("project-files").upload(path, file, { upsert: false });
    if (up.error) throw new Error(up.error.message);
    const { data: pub } = sb.storage.from("project-files").getPublicUrl(path);
    fileMeta = { url: pub.publicUrl, name: file.name, size: file.size, type: file.type || "" };
  }
  const { data, error } = await sb
    .from("project_invoices")
    .insert({
      project_id: projectId,
      budget_item_id: input.budgetItemId ?? null,
      vendor: input.vendor ?? null,
      invoice_no: input.invoiceNo ?? null,
      invoice_date: input.invoiceDate ?? null,
      amount: input.amount,
      notes: input.notes ?? null,
      file_url: fileMeta?.url ?? null,
      file_name: fileMeta?.name ?? null,
      file_size: fileMeta?.size ?? null,
      content_type: fileMeta?.type ?? null,
      uploaded_by: uploadedBy,
    })
    .select("*").single();
  if (error) throw new Error(error.message);
  return toInvoice(data);
}

export async function deleteInvoice(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.from("project_invoices").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── finance summary ─────────────────────────────────────────────────────────
export interface BudgetItemRollup extends ProjectBudgetItem {
  actual: number;       // sum of allocated invoices
  variance: number;     // estimate − actual (positive = under budget)
  invoiceCount: number;
}

export interface FinanceSummary {
  items: BudgetItemRollup[];
  unallocatedActual: number;   // invoices not tied to a budget line
  unallocatedCount: number;
  totalEstimate: number;
  totalActual: number;
  variance: number;            // totalEstimate − totalActual
  spentPct: number;            // totalActual / totalEstimate × 100
}

export function financeSummary(
  items: ProjectBudgetItem[], invoices: ProjectInvoice[],
): FinanceSummary {
  const byItem = new Map<string, { sum: number; count: number }>();
  let unallocatedActual = 0;
  let unallocatedCount = 0;
  for (const inv of invoices) {
    if (inv.budgetItemId) {
      const cur = byItem.get(inv.budgetItemId) ?? { sum: 0, count: 0 };
      cur.sum += inv.amount; cur.count += 1;
      byItem.set(inv.budgetItemId, cur);
    } else {
      unallocatedActual += inv.amount; unallocatedCount += 1;
    }
  }
  const rolled: BudgetItemRollup[] = items.map((it) => {
    const agg = byItem.get(it.id) ?? { sum: 0, count: 0 };
    return { ...it, actual: agg.sum, variance: it.estimate - agg.sum, invoiceCount: agg.count };
  });
  const totalEstimate = items.reduce((a, b) => a + b.estimate, 0);
  const totalActual = invoices.reduce((a, b) => a + b.amount, 0);
  return {
    items: rolled,
    unallocatedActual,
    unallocatedCount,
    totalEstimate,
    totalActual,
    variance: totalEstimate - totalActual,
    spentPct: totalEstimate > 0 ? Math.round((totalActual / totalEstimate) * 100) : 0,
  };
}

// ── task structure: add / edit timeline / delete (owner/manager) ────────────
export interface CreateTaskInput {
  phaseId: string;
  name: string;
  code?: string | null;
  note?: string | null;
  startDate?: DateISO | null;
  endDate?: DateISO | null;
  isMilestone?: boolean;
}

export async function createTask(
  projectId: string, input: CreateTaskInput, createdBy: string, seq = 0,
): Promise<ProjectTask> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { data, error } = await sb
    .from("project_tasks")
    .insert({
      project_id: projectId,
      phase_id: input.phaseId,
      name: input.name,
      code: input.code ?? null,
      note: input.note ?? null,
      start_date: input.startDate ?? null,
      end_date: input.endDate ?? null,
      is_milestone: input.isMilestone ?? false,
      seq,
      updated_by: createdBy,
    })
    .select("*").single();
  if (error) throw new Error(error.message);
  return toTask(data);
}

export interface TaskPatch {
  name?: string;
  code?: string | null;
  note?: string | null;
  startDate?: DateISO | null;
  endDate?: DateISO | null;
  isMilestone?: boolean;
}

export async function updateTask(
  taskId: string, patch: TaskPatch, updatedBy: string,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const row: Record<string, unknown> = { updated_by: updatedBy };
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.code !== undefined) row.code = patch.code;
  if (patch.note !== undefined) row.note = patch.note;
  if (patch.startDate !== undefined) row.start_date = patch.startDate;
  if (patch.endDate !== undefined) row.end_date = patch.endDate;
  if (patch.isMilestone !== undefined) row.is_milestone = patch.isMilestone;
  const { error } = await sb.from("project_tasks").update(row).eq("id", taskId);
  if (error) throw new Error(error.message);
}

export async function deleteTask(taskId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.from("project_tasks").delete().eq("id", taskId);
  if (error) throw new Error(error.message);
}

// ── budget: bulk insert (CSV import) ────────────────────────────────────────
export async function createBudgetItemsBulk(
  projectId: string, rows: BudgetItemInput[], createdBy: string, startSeq = 0,
): Promise<number> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  if (rows.length === 0) return 0;
  const payload = rows.map((r, i) => ({
    project_id: projectId,
    name: r.name,
    category: r.category ?? null,
    estimate: r.estimate ?? 0,
    notes: r.notes ?? null,
    seq: startSeq + i,
    created_by: createdBy,
    updated_by: createdBy,
  }));
  const { data, error } = await sb.from("project_budget_items").insert(payload).select("id");
  if (error) throw new Error(error.message);
  return ((data as unknown[]) ?? []).length;
}
