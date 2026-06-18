// ============================================================================
// Abhinaya Cinemas — Project Management Digest (Supabase Edge Function)
//
// A per-recipient status email for the Project Management module. For every
// ACTIVE project it reports overall progress %, tasks done, delayed (overdue &
// not done), tasks due in the next 7 days, recent task activity, and the
// overdue / upcoming task lists. Recipients are routed: each project's TEAM
// (its project_members + project_manager_email) plus every global OWNER. Each
// person receives only the active projects relevant to them; owners get all.
//
// Two cadences share this one function (the cron passes ?mode=):
//   daily   — invoked 09:30 AM IST (04:00 UTC) every day   (activity = last 24h)
//   weekly  — invoked 09:45 AM IST (04:15 UTC) every Monday (activity = last 7d)
//
// Manual testing (preview HTML, no send — owner view of all active projects):
//   curl 'https://xkmjygegtpmmwwnyoufn.supabase.co/functions/v1/pm-digest?dry=1' \
//        -H 'Authorization: Bearer <SUPABASE_ANON_KEY>'
//   ...&mode=weekly        → weekly framing
//   ...&to=me@x.com        → send a real email only to me@x.com (test recipient)
//   ...&date=2026-06-18    → override "today" used for delayed / due-soon math
//
// Env vars (Supabase Dashboard → Edge Functions → Secrets):
//   RESEND_API_KEY  (required to send; ?dry=1 previews without it)
//   PM_DIGEST_FROM  (optional, default "Abhinaya PM <noreply@mail.abhinayacinemas.com>")
//   PM_DIGEST_TO    (optional override: comma-separated list. When set, ALL
//                    active projects are sent to exactly these addresses and the
//                    per-recipient routing is bypassed — handy for testing.)
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected — bypasses RLS, reads every project)
// ============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@4.0.0";

// ---------- types (mirror app/src/lib/db-types.ts row shapes) ----------
type ProjectRow = {
  id: string; name: string; category: string; location: string | null; area: string | null;
  project_type: string | null; summary: string | null; status: string;
  start_date: string | null; target_finish: string | null;
  project_manager_email: string | null;
};
type TaskRow = { id: string; project_id: string; name: string; code: string | null; end_date: string | null; done: boolean };
type SubtaskRow = { project_id: string; task_id: string; done: boolean };
type MemberRow = { project_id: string; user_email: string; role_in_project: string };
type AuditRow = { project_id: string; action: string; actor_email: string | null; detail: any; created_at: string };
type UserRow = { email: string; full_name: string | null; role: string };

// ---------- date helpers (IST = UTC+5:30) ----------
function istNow(): Date { return new Date(Date.now() + 5.5 * 60 * 60 * 1000); }
function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(s: string, n: number): string { const dt = new Date(s + "T00:00:00Z"); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10); }
function fmtDate(s: string): string {
  const dt = new Date(s + "T00:00:00Z");
  return dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
function fmtShort(s: string): string {
  const dt = new Date(s + "T00:00:00Z");
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}
// days between two yyyy-mm-dd dates (b - a)
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}
function relTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  const h = Math.floor(ms / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  return `${d}d ago`;
}

// ---------- format helpers ----------
function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function nameFor(email: string | null | undefined, names: Map<string, string>): string {
  if (!email) return "—";
  const n = names.get(email.toLowerCase());
  if (n) return n;
  return email.split("@")[0];
}

// ---------- per-project computed metrics ----------
type ProjectMetrics = {
  p: ProjectRow;
  pct: number;
  doneCount: number;
  taskCount: number;
  delayed: { name: string; code: string | null; end: string; daysOver: number }[];
  dueSoon: { name: string; code: string | null; end: string }[];
  activity: { who: string; what: string; when: string }[];
};

// taskCompletion: subtasks done / total, else 1|0 from task.done (mirrors lib/projects.ts)
function computeMetrics(
  p: ProjectRow, tasks: TaskRow[], subs: SubtaskRow[], audit: AuditRow[],
  today: string, names: Map<string, string>,
): ProjectMetrics {
  const subsByTask = new Map<string, { done: number; total: number }>();
  for (const s of subs) {
    const g = subsByTask.get(s.task_id) || { done: 0, total: 0 };
    g.total += 1; if (s.done) g.done += 1;
    subsByTask.set(s.task_id, g);
  }
  let sum = 0;
  for (const t of tasks) {
    const g = subsByTask.get(t.id);
    sum += g && g.total > 0 ? g.done / g.total : (t.done ? 1 : 0);
  }
  const pct = tasks.length ? Math.round((sum / tasks.length) * 100) : 0;
  const doneCount = tasks.filter((t) => t.done).length;

  const in7 = addDays(today, 7);
  const delayed = tasks
    .filter((t) => !t.done && t.end_date && t.end_date < today)
    .map((t) => ({ name: t.name, code: t.code, end: t.end_date!, daysOver: dayDiff(t.end_date!, today) }))
    .sort((a, b) => b.daysOver - a.daysOver);
  const dueSoon = tasks
    .filter((t) => !t.done && t.end_date && t.end_date >= today && t.end_date <= in7)
    .map((t) => ({ name: t.name, code: t.code, end: t.end_date! }))
    .sort((a, b) => a.end.localeCompare(b.end));

  const activity = audit
    .filter((a) => a.project_id === p.id)
    .slice(0, 8)
    .map((a) => {
      const label = ({
        task_checked: "completed", task_unchecked: "reopened",
        subtask_checked: "ticked subtask on", subtask_unchecked: "un-ticked subtask on",
      } as Record<string, string>)[a.action] || a.action;
      const taskName = a.detail?.name ? `“${a.detail.name}”` : "a task";
      return { who: nameFor(a.actor_email, names), what: `${label} ${taskName}`, when: relTime(a.created_at) };
    });

  return { p, pct, doneCount, taskCount: tasks.length, delayed, dueSoon, activity };
}

// ---------- HTML ----------
function bar(pct: number): string {
  const c = pct >= 80 ? "#16a34a" : pct >= 40 ? "#0ea5e9" : "#f59e0b";
  return `<div style="background:#eee;border-radius:999px;height:8px;overflow:hidden;margin:6px 0 2px">
    <div style="width:${Math.max(2, pct)}%;height:8px;background:${c}"></div></div>`;
}
function stat(label: string, value: string, tone?: "red" | "amber"): string {
  const color = tone === "red" ? "#b91c1c" : tone === "amber" ? "#92400e" : "#111";
  const bg = tone === "red" ? "#fef2f2" : tone === "amber" ? "#fff8e1" : "#fafafa";
  return `<div style="flex:1;background:${bg};border-radius:6px;padding:10px;text-align:center">
    <div style="font-size:18px;font-weight:700;color:${color}">${escapeHtml(value)}</div>
    <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em;margin-top:2px">${escapeHtml(label)}</div>
  </div>`;
}
function projectCard(m: ProjectMetrics, names: Map<string, string>): string {
  const { p } = m;
  const meta = [p.location, p.area, p.project_type ? `Type: ${p.project_type}` : null].filter(Boolean).join(" · ");
  const pm = nameFor(p.project_manager_email, names);
  const finishLine = p.target_finish
    ? (() => {
        const todayIso = isoDate(istNow());
        const d = dayDiff(todayIso, p.target_finish!);
        const tail = d < 0 ? `<span style="color:#b91c1c">${-d}d overdue</span>`
          : d === 0 ? `<span style="color:#92400e">due today</span>`
          : `<span style="color:#666">${d}d left</span>`;
        return `Target finish: <b>${fmtDate(p.target_finish!)}</b> · ${tail}`;
      })()
    : "No target finish set";

  const delayedHtml = m.delayed.length
    ? `<div style="margin-top:12px"><div style="font-size:12px;font-weight:600;color:#b91c1c;margin-bottom:4px">Overdue (${m.delayed.length})</div>${
        m.delayed.slice(0, 5).map((t) =>
          `<div style="font-size:13px;color:#444;padding:2px 0">• ${escapeHtml(t.code ? t.code + " " : "")}${escapeHtml(t.name)} <span style="color:#b91c1c">— ${t.daysOver}d over (due ${fmtShort(t.end)})</span></div>`
        ).join("")}${m.delayed.length > 5 ? `<div style="font-size:12px;color:#888;padding:2px 0">…and ${m.delayed.length - 5} more</div>` : ""}</div>`
    : "";

  const dueHtml = m.dueSoon.length
    ? `<div style="margin-top:12px"><div style="font-size:12px;font-weight:600;color:#92400e;margin-bottom:4px">Due in 7 days (${m.dueSoon.length})</div>${
        m.dueSoon.slice(0, 5).map((t) =>
          `<div style="font-size:13px;color:#444;padding:2px 0">• ${escapeHtml(t.code ? t.code + " " : "")}${escapeHtml(t.name)} <span style="color:#92400e">— due ${fmtShort(t.end)}</span></div>`
        ).join("")}${m.dueSoon.length > 5 ? `<div style="font-size:12px;color:#888;padding:2px 0">…and ${m.dueSoon.length - 5} more</div>` : ""}</div>`
    : "";

  const actHtml = m.activity.length
    ? `<div style="margin-top:12px"><div style="font-size:12px;font-weight:600;color:#333;margin-bottom:4px">Recent activity</div>${
        m.activity.map((a) =>
          `<div style="font-size:13px;color:#555;padding:2px 0">${escapeHtml(a.who)} ${escapeHtml(a.what)} <span style="color:#aaa">· ${escapeHtml(a.when)}</span></div>`
        ).join("")}</div>`
    : `<div style="margin-top:12px;font-size:13px;color:#aaa">No task activity in this period.</div>`;

  return `
  <div style="background:#fff;border:1px solid #ececec;border-radius:10px;padding:18px;margin:14px 0">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
      <div>
        <div style="font-size:16px;font-weight:700;color:#111">${escapeHtml(p.name)}</div>
        ${meta ? `<div style="font-size:12px;color:#888;margin-top:2px">${escapeHtml(meta)}</div>` : ""}
      </div>
      <span style="background:#dcfce7;color:#166534;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:4px 8px;border-radius:999px;white-space:nowrap">Active</span>
    </div>
    <div style="font-size:12px;color:#666;margin-top:8px">PM: <b>${escapeHtml(pm)}</b> · ${finishLine}</div>
    ${bar(m.pct)}
    <div style="display:flex;gap:8px;margin-top:10px">
      ${stat("Progress", m.pct + "%")}
      ${stat("Tasks done", `${m.doneCount}/${m.taskCount}`)}
      ${stat("Delayed", String(m.delayed.length), m.delayed.length ? "red" : undefined)}
      ${stat("Due in 7d", String(m.dueSoon.length), m.dueSoon.length ? "amber" : undefined)}
    </div>
    ${delayedHtml}
    ${dueHtml}
    ${actHtml}
  </div>`;
}

function emailShell(opts: { eyebrow: string; title: string; subtitle: string; bodyHtml: string }): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#222">
  <div style="max-width:640px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:12px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
      <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.08em;font-weight:600">${escapeHtml(opts.eyebrow)}</div>
      <h1 style="margin:6px 0 4px;font-size:24px;color:#111">${escapeHtml(opts.title)}</h1>
      <div style="color:#666;font-size:14px">${escapeHtml(opts.subtitle)}</div>
      ${opts.bodyHtml}
      <div style="margin-top:28px;padding-top:18px;border-top:1px solid #eee;font-size:12px;color:#888;line-height:1.6">
        Open the <a href="https://admin.abhinayacinemas.com/projects/renovations" style="color:#4f46e5;text-decoration:none;font-weight:500">Project Management dashboard</a> for the full timeline, checklist and finances.
      </div>
    </div>
    <div style="text-align:center;color:#aaa;font-size:11px;margin-top:14px">Automated project status — Abhinaya Cinemas.</div>
  </div>
</body></html>`;
}

// ---------- handler ----------
Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const mode = url.searchParams.get("mode") === "weekly" ? "weekly" : "daily";
  const overrideDate = url.searchParams.get("date");
  const toOverrideQS = url.searchParams.get("to"); // single test recipient via query string

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY") || "";
  const fromAddr = Deno.env.get("PM_DIGEST_FROM") || "Abhinaya PM <noreply@mail.abhinayacinemas.com>";
  const toOverrideEnv = (Deno.env.get("PM_DIGEST_TO") || "").split(",").map((s) => s.trim()).filter(Boolean);

  if (!supabaseUrl || !supabaseKey) {
    return new Response("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var", { status: 500 });
  }
  if (!resendKey && !dry) {
    return new Response("Missing RESEND_API_KEY env var (use ?dry=1 to preview without sending)", { status: 500 });
  }

  const today = (overrideDate && /^\d{4}-\d{2}-\d{2}$/.test(overrideDate)) ? overrideDate : isoDate(istNow());
  const windowStart = mode === "weekly" ? addDays(today, -7) : addDays(today, -1);

  const sb: SupabaseClient = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  // 1) active projects
  const projRes = await sb
    .from("projects")
    .select("id,name,category,location,area,project_type,summary,status,start_date,target_finish,project_manager_email")
    .eq("status", "active");
  if (projRes.error) return new Response("projects query: " + projRes.error.message, { status: 500 });
  const projects = (projRes.data || []) as ProjectRow[];

  if (projects.length === 0) {
    return new Response(JSON.stringify({ ok: true, mode, note: "No active projects — nothing sent.", target: today }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
  const ids = projects.map((p) => p.id);

  // 2) supporting data
  const [taskRes, subRes, memRes, auditRes, userRes] = await Promise.all([
    sb.from("project_tasks").select("id,project_id,name,code,end_date,done").in("project_id", ids),
    sb.from("project_subtasks").select("project_id,task_id,done").in("project_id", ids),
    sb.from("project_members").select("project_id,user_email,role_in_project").in("project_id", ids),
    sb.from("project_audit").select("project_id,action,actor_email,detail,created_at")
      .in("project_id", ids).gte("created_at", windowStart + "T00:00:00Z").order("created_at", { ascending: false }),
    sb.from("authorized_users").select("email,full_name,role"),
  ]);
  if (taskRes.error)  return new Response("tasks query: " + taskRes.error.message, { status: 500 });
  if (memRes.error)   return new Response("members query: " + memRes.error.message, { status: 500 });
  if (userRes.error)  return new Response("users query: " + userRes.error.message, { status: 500 });

  const tasks  = (taskRes.data  || []) as TaskRow[];
  const subs   = (subRes.data   || []) as SubtaskRow[];
  const members = (memRes.data  || []) as MemberRow[];
  const audit  = (auditRes.data || []) as AuditRow[];
  const users  = (userRes.data  || []) as UserRow[];

  const names = new Map<string, string>();
  for (const u of users) if (u.full_name) names.set(u.email.toLowerCase(), u.full_name);
  const ownerEmails = users.filter((u) => u.role === "owner").map((u) => u.email.toLowerCase());

  // 3) metrics per project
  const tasksByProj = new Map<string, TaskRow[]>();
  for (const t of tasks) { const a = tasksByProj.get(t.project_id) || []; a.push(t); tasksByProj.set(t.project_id, a); }
  const metricsById = new Map<string, ProjectMetrics>();
  for (const p of projects) {
    metricsById.set(p.id, computeMetrics(p, tasksByProj.get(p.id) || [], subs, audit, today, names));
  }

  // 4) recipient → project ids. Team = project_members ∪ project_manager_email; plus all owners get everything.
  const recipients = new Map<string, Set<string>>();
  const add = (email: string, pid: string) => {
    const e = email.toLowerCase().trim();
    if (!e) return;
    const set = recipients.get(e) || new Set<string>();
    set.add(pid); recipients.set(e, set);
  };
  for (const p of projects) {
    if (p.project_manager_email) add(p.project_manager_email, p.id);
    for (const o of ownerEmails) add(o, p.id);
  }
  for (const mrow of members) add(mrow.user_email, mrow.project_id);

  const eyebrow = mode === "weekly" ? "Weekly Project Digest" : "Daily Project Digest";
  const titleDate = fmtDate(today);

  // ----- dry preview: owner view (all active projects) -----
  if (dry) {
    const cards = projects
      .map((p) => metricsById.get(p.id)!)
      .sort((a, b) => b.delayed.length - a.delayed.length || a.pct - b.pct)
      .map((m) => projectCard(m, names)).join("");
    const html = emailShell({
      eyebrow, title: titleDate,
      subtitle: `${projects.length} active project${projects.length === 1 ? "" : "s"} · Project Management`,
      bodyHtml: cards,
    });
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  // ----- build the send list -----
  type Send = { to: string[]; projectIds: string[] };
  const sends: Send[] = [];
  if (toOverrideQS) {
    sends.push({ to: [toOverrideQS], projectIds: ids });        // test: one address, all projects
  } else if (toOverrideEnv.length) {
    sends.push({ to: toOverrideEnv, projectIds: ids });          // forced recipient list, all projects
  } else {
    for (const [email, set] of recipients) sends.push({ to: [email], projectIds: [...set] });
  }

  const resend = new Resend(resendKey);
  const results: { to: string[]; projects: number; ok: boolean; error?: string }[] = [];
  for (const s of sends) {
    const mine = s.projectIds
      .map((pid) => metricsById.get(pid)!)
      .filter(Boolean)
      .sort((a, b) => b.delayed.length - a.delayed.length || a.pct - b.pct);
    if (mine.length === 0) continue;

    const totalDelayed = mine.reduce((n, m) => n + m.delayed.length, 0);
    const subject = `Abhinaya PM — ${mode === "weekly" ? "Weekly" : "Daily"} status · ${mine.length} active project${mine.length === 1 ? "" : "s"}${totalDelayed ? ` · ${totalDelayed} delayed` : ""}`;
    const html = emailShell({
      eyebrow, title: titleDate,
      subtitle: `${mine.length} active project${mine.length === 1 ? "" : "s"} · Project Management`,
      bodyHtml: mine.map((m) => projectCard(m, names)).join(""),
    });
    const { error } = await resend.emails.send({ from: fromAddr, to: s.to, subject, html });
    results.push({ to: s.to, projects: mine.length, ok: !error, error: error ? JSON.stringify(error) : undefined });
  }

  const anyErr = results.some((r) => !r.ok);
  return new Response(JSON.stringify({ ok: !anyErr, mode, target: today, activeProjects: projects.length, emails: results }), {
    status: anyErr ? 502 : 200, headers: { "Content-Type": "application/json" },
  });
});
