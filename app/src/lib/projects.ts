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
  expenses: ProjectExpense[];
  quotations: ProjectQuotation[];
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
  const [members, phases, tasks, subtasks, files, budgetItems, invoices, expenses, quotations] =
    await Promise.all([
      listMembers(projectId),
      listPhases(projectId),
      listTasks(projectId),
      listSubtasks(projectId),
      listTaskFiles(projectId),
      listBudgetItems(projectId),
      listInvoices(projectId),
      listExpenses(projectId),
      listQuotations(projectId),
    ]);
  return {
    project, members, phases, tasks, subtasks, files, budgetItems, invoices, expenses, quotations,
  };
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
  expenseId: string | null;
  subtotal: number | null;
  gst: number | null;
  freight: number | null;
  total: number | null;
  deviationReason: string | null;
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
  expenseId: r.expense_id ?? null,
  subtotal: r.subtotal != null ? Number(r.subtotal) : null,
  gst: r.gst != null ? Number(r.gst) : null,
  freight: r.freight != null ? Number(r.freight) : null,
  total: r.total != null ? Number(r.total) : null,
  deviationReason: r.deviation_reason ?? null,
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

// ════════════════════════════════════════════════════════════════════════════
// Expense approval & payment flow (migration 20260617120000_project_expense_flow)
//
// Lifecycle per expense: quoting → quote_approved → invoiced →
//   payment_requested → paid  (+ rejected / cancelled). State changes run
// through SECURITY DEFINER RPCs that enforce the machine + per-role gating.
// ════════════════════════════════════════════════════════════════════════════

export type ExpenseStatus =
  | "quoting" | "quote_approved" | "invoiced" | "payment_requested"
  | "paid" | "rejected" | "cancelled";

export const EXPENSE_STATUS_LABEL: Record<ExpenseStatus, string> = {
  quoting: "Quoting",
  quote_approved: "Quote approved",
  invoiced: "Invoiced",
  payment_requested: "Payment requested",
  paid: "Paid",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export type QuotationStatus = "submitted" | "approved" | "rejected";

export interface ProjectExpense {
  id: string;
  projectId: string;
  budgetItemId: string | null;
  title: string;
  description: string | null;
  status: ExpenseStatus;
  approvedQuotationId: string | null;
  approvedVendor: string | null;
  approvedAmount: number | null;
  quoteSkipReason: string | null;
  paidAmount: number | null;
  paidAt: string | null;
  paidBy: string | null;
  otpReference: string | null;
  paymentNote: string | null;
  paymentReceiptUrl: string | null;
  paymentReceiptName: string | null;
  slackChannel: string | null;
  slackTs: string | null;
  paymentRequestedBy: string | null;
  paymentRequestedAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface ProjectQuotation {
  id: string;
  projectId: string;
  expenseId: string;
  vendor: string;
  amount: number;
  notes: string | null;
  fileUrl: string;
  fileName: string | null;
  fileSize: number | null;
  contentType: string | null;
  status: QuotationStatus;
  submittedBy: string | null;
  submittedAt: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const toExpense = (r: any): ProjectExpense => ({
  id: r.id,
  projectId: r.project_id,
  budgetItemId: r.budget_item_id ?? null,
  title: r.title,
  description: r.description ?? null,
  status: r.status,
  approvedQuotationId: r.approved_quotation_id ?? null,
  approvedVendor: r.approved_vendor ?? null,
  approvedAmount: r.approved_amount != null ? Number(r.approved_amount) : null,
  quoteSkipReason: r.quote_skip_reason ?? null,
  paidAmount: r.paid_amount != null ? Number(r.paid_amount) : null,
  paidAt: r.paid_at ?? null,
  paidBy: r.paid_by ?? null,
  otpReference: r.otp_reference ?? null,
  paymentNote: r.payment_note ?? null,
  paymentReceiptUrl: r.payment_receipt_url ?? null,
  paymentReceiptName: r.payment_receipt_name ?? null,
  slackChannel: r.slack_channel ?? null,
  slackTs: r.slack_ts ?? null,
  paymentRequestedBy: r.payment_requested_by ?? null,
  paymentRequestedAt: r.payment_requested_at ?? null,
  createdBy: r.created_by ?? null,
  createdAt: r.created_at,
});

const toQuotation = (r: any): ProjectQuotation => ({
  id: r.id,
  projectId: r.project_id,
  expenseId: r.expense_id,
  vendor: r.vendor,
  amount: Number(r.amount ?? 0),
  notes: r.notes ?? null,
  fileUrl: r.file_url,
  fileName: r.file_name ?? null,
  fileSize: r.file_size ?? null,
  contentType: r.content_type ?? null,
  status: r.status,
  submittedBy: r.submitted_by ?? null,
  submittedAt: r.submitted_at,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listExpenses(projectId: string): Promise<ProjectExpense[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("project_expenses").select("*").eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) { console.warn("[projects] listExpenses", error.message); return []; }
  return ((data as unknown[]) ?? []).map(toExpense);
}

export async function listQuotations(projectId: string): Promise<ProjectQuotation[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("project_quotations").select("*").eq("project_id", projectId)
    .order("submitted_at", { ascending: true });
  if (error) { console.warn("[projects] listQuotations", error.message); return []; }
  return ((data as unknown[]) ?? []).map(toQuotation);
}

// ── raise / edit / cancel an expense ────────────────────────────────────────
export interface CreateExpenseInput {
  budgetItemId?: string | null;
  title: string;
  description?: string | null;
}

export async function createExpense(
  projectId: string, input: CreateExpenseInput, createdBy: string,
): Promise<ProjectExpense> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { data, error } = await sb
    .from("project_expenses")
    .insert({
      project_id: projectId,
      budget_item_id: input.budgetItemId ?? null,
      title: input.title,
      description: input.description ?? null,
      created_by: createdBy,
      updated_by: createdBy,
    })
    .select("*").single();
  if (error) throw new Error(error.message);
  return toExpense(data);
}

/** Cancel an expense before it is paid (RPC: member or owner). */
export async function cancelExpense(expenseId: string, reason: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.rpc("fn_project_expense_cancel", {
    p_expense_id: expenseId, p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

// ── quotations (quote FILE is required) ─────────────────────────────────────
export interface QuotationInput {
  vendor: string;
  amount: number;
  notes?: string | null;
}

export async function addQuotation(
  projectId: string, expenseId: string, input: QuotationInput, file: File, submittedBy: string,
): Promise<ProjectQuotation> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  if (!file) throw new Error("A quotation file is required");
  const ext = file.name.split(".").pop() ?? "bin";
  const path = `${projectId}/quotes/${Date.now()}.${ext}`;
  const up = await sb.storage.from("project-files").upload(path, file, { upsert: false });
  if (up.error) throw new Error(up.error.message);
  const { data: pub } = sb.storage.from("project-files").getPublicUrl(path);
  const { data, error } = await sb
    .from("project_quotations")
    .insert({
      project_id: projectId,
      expense_id: expenseId,
      vendor: input.vendor,
      amount: input.amount,
      notes: input.notes ?? null,
      file_url: pub.publicUrl,
      file_name: file.name,
      file_size: file.size,
      content_type: file.type || null,
      submitted_by: submittedBy,
    })
    .select("*").single();
  if (error) throw new Error(error.message);
  return toQuotation(data);
}

export async function deleteQuotation(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.from("project_quotations").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Owner approves one quotation (RPC: siblings auto-rejected, expense advances). */
export async function approveQuotation(quotationId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.rpc("fn_project_quote_approve", { p_quotation_id: quotationId });
  if (error) throw new Error(error.message);
}

/** Owner rejects all submitted quotes; expense stays in quoting for re-quoting. */
export async function rejectQuotations(expenseId: string, reason: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.rpc("fn_project_quotes_reject", {
    p_expense_id: expenseId, p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

/**
 * PM/owner skip the quotation stage with a reason (e.g. "known vendor"):
 * quoting → quote_approved with the given vendor + amount (RPC).
 */
export async function skipQuotation(
  expenseId: string, vendor: string, amount: number, reason: string,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.rpc("fn_project_expense_skip_quotation", {
    p_expense_id: expenseId, p_vendor: vendor, p_amount: amount, p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

// ── invoice the approved expense (subtotal must match approved + GST + freight)
export interface ExpenseInvoiceInput {
  invoiceNo?: string | null;
  invoiceDate?: DateISO | null;
  subtotal: number;
  gst: number;
  freight: number;
  deviationReason?: string | null;
}

export interface InvoiceNotifyContext {
  projectName: string;
  lineItem: string | null;
  expenseTitle: string;
  vendor: string | null;
  deepLink?: string | null;
}

export async function recordExpenseInvoice(
  projectId: string, expenseId: string, input: ExpenseInvoiceInput, file: File,
  notify?: InvoiceNotifyContext,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  if (!file) throw new Error("An invoice file is required");
  const ext = file.name.split(".").pop() ?? "bin";
  const path = `${projectId}/invoices/${Date.now()}.${ext}`;
  const up = await sb.storage.from("project-files").upload(path, file, { upsert: false });
  if (up.error) throw new Error(up.error.message);
  const { data: pub } = sb.storage.from("project-files").getPublicUrl(path);
  const total = (input.subtotal || 0) + (input.gst || 0) + (input.freight || 0);
  const { error } = await sb.rpc("fn_project_expense_record_invoice", {
    p_expense_id: expenseId,
    p_invoice_no: input.invoiceNo ?? null,
    p_invoice_date: input.invoiceDate ?? null,
    p_subtotal: input.subtotal,
    p_gst: input.gst,
    p_freight: input.freight,
    p_file_url: pub.publicUrl,
    p_file_name: file.name,
    p_file_size: file.size,
    p_content_type: file.type || null,
    p_deviation_reason: input.deviationReason ?? null,
  });
  if (error) throw new Error(error.message);

  // Best-effort post to Slack #invoices — must not fail the upload.
  if (notify) {
    try {
      await sb.functions.invoke("notify-slack", {
        body: {
          kind: "invoice_uploaded",
          projectName: notify.projectName,
          lineItem: notify.lineItem,
          expenseTitle: notify.expenseTitle,
          vendor: notify.vendor,
          amount: total,
          invoiceNo: input.invoiceNo ?? null,
          invoiceUrl: pub.publicUrl,
          invoiceFileName: file.name,
          deepLink: notify.deepLink ?? null,
        },
      });
    } catch (e) {
      console.warn("[projects] invoice Slack notify failed (non-blocking)", e);
    }
  }
}

// ── payment: request (Slack #payments) + mark paid (receipt) ────────────────
export interface RequestPaymentInput {
  projectName: string;
  lineItem: string | null;
  expenseTitle: string;
  vendor: string | null;
  amount: number;
  invoiceUrl: string | null;
  invoiceFileName: string | null;
  deepLink?: string | null;
}

/**
 * Accountant requests payment: posts the bill to Slack #payments for the owner
 * to approve via the notify-slack Edge Function, then records the transition.
 */
export async function requestExpensePayment(
  expenseId: string, input: RequestPaymentInput,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { data, error } = await sb.functions.invoke("notify-slack", {
    body: {
      kind: "payment_request",
      projectName: input.projectName,
      lineItem: input.lineItem,
      expenseTitle: input.expenseTitle,
      vendor: input.vendor,
      amount: input.amount,
      invoiceUrl: input.invoiceUrl,
      invoiceFileName: input.invoiceFileName,
      deepLink: input.deepLink ?? null,
    },
  });
  if (error) throw new Error(`Slack notification failed: ${error.message}`);
  const res = (data ?? {}) as { channel?: string | null; ts?: string | null };
  const { error: rpcErr } = await sb.rpc("fn_project_expense_request_payment", {
    p_expense_id: expenseId,
    p_slack_channel: res.channel ?? null,
    p_slack_ts: res.ts ?? null,
  });
  if (rpcErr) throw new Error(rpcErr.message);
}

export interface MarkPaidNotify {
  projectName: string;
  lineItem: string | null;
  expenseTitle: string;
  vendor: string | null;
  deepLink?: string | null;
}

/**
 * Accountant marks paid by attaching the payment RECEIPT (bank/UPI proof) —
 * the OTP step is gone. The receipt is uploaded to the project-files bucket,
 * recorded on the expense, and then posted to Slack #payments (best-effort).
 */
export async function markExpensePaid(
  projectId: string,
  expenseId: string,
  receipt: File,
  paidAmount: number | null,
  note: string | null,
  notify?: MarkPaidNotify,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");

  const ext = receipt.name.split(".").pop() ?? "bin";
  const path = `${projectId}/receipts/${Date.now()}.${ext}`;
  const up = await sb.storage.from("project-files").upload(path, receipt, { upsert: false });
  if (up.error) throw new Error(up.error.message);
  const { data: pub } = sb.storage.from("project-files").getPublicUrl(path);

  const { error } = await sb.rpc("fn_project_expense_mark_paid", {
    p_expense_id: expenseId,
    p_paid_amount: paidAmount,
    p_note: note,
    p_receipt_url: pub.publicUrl,
    p_receipt_name: receipt.name,
    p_receipt_size: receipt.size,
    p_content_type: receipt.type || null,
  });
  if (error) throw new Error(error.message);

  // Best-effort second post to #payments with the receipt — must not fail the
  // mark-paid that already committed above.
  if (notify) {
    try {
      await sb.functions.invoke("notify-slack", {
        body: {
          kind: "payment_paid",
          projectName: notify.projectName,
          lineItem: notify.lineItem,
          expenseTitle: notify.expenseTitle,
          vendor: notify.vendor,
          amount: paidAmount,
          receiptUrl: pub.publicUrl,
          receiptFileName: receipt.name,
          deepLink: notify.deepLink ?? null,
        },
      });
    } catch (e) {
      console.warn("[projects] payment-paid Slack notify failed (non-blocking)", e);
    }
  }
}

// ── expense-based finance summary (Estimate / Paid / Remaining) ─────────────
export interface ExpenseLineRollup extends ProjectBudgetItem {
  paid: number;          // sum of paid expense amounts on this line
  remaining: number;     // estimate − paid
  expenseCount: number;  // expenses on this line (excl. cancelled/rejected)
}

export interface ExpenseFinanceSummary {
  items: ExpenseLineRollup[];
  unallocatedPaid: number;     // paid expenses with no budget line
  unallocatedCount: number;
  totalEstimate: number;
  totalPaid: number;
  remaining: number;           // totalEstimate − totalPaid
  spentPct: number;            // totalPaid / totalEstimate × 100
}

const PAID = (e: ProjectExpense) => (e.status === "paid" ? (e.paidAmount ?? 0) : 0);
const LIVE = (e: ProjectExpense) => e.status !== "cancelled" && e.status !== "rejected";

export function expenseFinanceSummary(
  items: ProjectBudgetItem[], expenses: ProjectExpense[],
): ExpenseFinanceSummary {
  const byItem = new Map<string, { paid: number; count: number }>();
  let unallocatedPaid = 0;
  let unallocatedCount = 0;
  for (const e of expenses) {
    if (!LIVE(e)) continue;
    if (e.budgetItemId) {
      const cur = byItem.get(e.budgetItemId) ?? { paid: 0, count: 0 };
      cur.paid += PAID(e); cur.count += 1;
      byItem.set(e.budgetItemId, cur);
    } else {
      unallocatedPaid += PAID(e); unallocatedCount += 1;
    }
  }
  const rolled: ExpenseLineRollup[] = items.map((it) => {
    const agg = byItem.get(it.id) ?? { paid: 0, count: 0 };
    return { ...it, paid: agg.paid, remaining: it.estimate - agg.paid, expenseCount: agg.count };
  });
  const totalEstimate = items.reduce((a, b) => a + b.estimate, 0);
  const totalPaid = expenses.reduce((a, e) => a + PAID(e), 0);
  return {
    items: rolled,
    unallocatedPaid,
    unallocatedCount,
    totalEstimate,
    totalPaid,
    remaining: totalEstimate - totalPaid,
    spentPct: totalEstimate > 0 ? Math.round((totalPaid / totalEstimate) * 100) : 0,
  };
}
