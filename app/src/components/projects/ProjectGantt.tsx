// ============================================================================
// ProjectGantt — read-only timeline ported from the original renovation HTML.
//
// Renders one column per project day with colored phase bars, a "today"
// marker and diamond milestones. Day indices are derived from the project's
// start date so the chart stays correct as dates shift.
// ============================================================================

import type { ReactNode } from "react";

import type { ProjectPhase, ProjectTask } from "../../lib/projects";

const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const parseDate = (iso: string) => new Date(`${iso}T00:00:00`);
const dayDiff = (a: Date, b: Date) =>
  Math.round((a.getTime() - b.getTime()) / 86_400_000);
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function ProjectGantt({
  phases, tasks, startDate, targetFinish,
}: {
  phases: ProjectPhase[];
  tasks: ProjectTask[];
  startDate: string | null;
  targetFinish: string | null;
}) {
  if (!startDate) {
    return <p className="text-sm text-ink-muted">Set a start date to see the timeline.</p>;
  }
  const start = parseDate(startDate);

  // Total days = span to the latest of target finish / any task end.
  let maxDay = targetFinish ? dayDiff(parseDate(targetFinish), start) + 1 : 1;
  for (const t of tasks) {
    if (t.endDate) maxDay = Math.max(maxDay, dayDiff(parseDate(t.endDate), start) + 1);
    if (t.startDate) maxDay = Math.max(maxDay, dayDiff(parseDate(t.startDate), start) + 1);
  }
  const totalDays = Math.max(maxDay, 1);

  const todayDay = dayDiff(parseDate(todayISO()), start) + 1;
  const dateOf = (day: number) => {
    const d = new Date(start);
    d.setDate(d.getDate() + (day - 1));
    return d;
  };

  // Month header spans.
  const months: { label: string; span: number }[] = [];
  for (let d = 1; d <= totalDays; d++) {
    const m = dateOf(d).getMonth();
    const last = months[months.length - 1];
    if (last && dateOf(d - 1).getMonth() === m) last.span++;
    else months.push({ label: MON[m]!, span: 1 });
  }

  const tasksByPhase = (phaseId: string) =>
    tasks.filter((t) => t.phaseId === phaseId).sort((a, b) => a.seq - b.seq);

  const dayCol = "w-8 min-w-8";

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-white">
      <table className="border-collapse text-[11px]" style={{ minWidth: 760 }}>
        <thead>
          <tr>
            <th
              className="sticky left-0 z-20 bg-paper text-left px-2 py-1 font-semibold border border-line"
              style={{ width: 260, minWidth: 260 }}
              rowSpan={2}
            >
              Task
            </th>
            {months.map((m, i) => (
              <th key={i} colSpan={m.span} className="bg-paper text-center font-bold border border-line py-0.5">
                {m.label}
              </th>
            ))}
          </tr>
          <tr>
            {Array.from({ length: totalDays }, (_, i) => {
              const day = i + 1;
              const dt = dateOf(day);
              const isToday = day === todayDay;
              return (
                <th
                  key={day}
                  className={`${dayCol} text-center border border-line py-0.5 font-semibold ${
                    isToday ? "bg-red-500 text-white" : "bg-paper text-ink-muted"
                  }`}
                >
                  {dt.getDate()}
                  <span className="block text-[8px] font-normal">{DOW[dt.getDay()]}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {phases.map((ph) => {
            const phaseTasks = tasksByPhase(ph.id);
            if (phaseTasks.length === 0) return null;
            return (
              <PhaseRows
                key={ph.id}
                phase={ph}
                tasks={phaseTasks}
                totalDays={totalDays}
                todayDay={todayDay}
                start={start}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PhaseRows({
  phase, tasks, totalDays, todayDay, start,
}: {
  phase: ProjectPhase;
  tasks: ProjectTask[];
  totalDays: number;
  todayDay: number;
  start: Date;
}) {
  const color = phase.color ?? "#999";
  const dayCol = "w-8 min-w-8";
  return (
    <>
      <tr>
        <td
          className="sticky left-0 z-10 bg-white px-2 py-1 font-bold uppercase tracking-wide border border-line text-[10px]"
          style={{ color }}
        >
          {phase.name}
        </td>
        {Array.from({ length: totalDays }, (_, i) => (
          <td
            key={i}
            className={`${dayCol} h-6 border border-line ${i + 1 === todayDay ? "bg-red-500/5" : ""}`}
          />
        ))}
      </tr>
      {tasks.map((t) => {
        const s = t.startDate ? dayDiff(parseDate(t.startDate), start) + 1 : null;
        const e = t.endDate ? dayDiff(parseDate(t.endDate), start) + 1 : s;
        return (
          <tr key={t.id}>
            <td
              className="sticky left-0 z-10 bg-white px-2 py-1 font-medium border border-line truncate"
              title={t.name}
              style={{ maxWidth: 260 }}
            >
              {t.code ? `${t.code} · ` : ""}{t.name}
            </td>
            {Array.from({ length: totalDays }, (_, i) => {
              const day = i + 1;
              let inner: ReactNode = null;
              if (s !== null && day === s) {
                const widthDays = (e ?? s) - s + 1;
                if (t.isMilestone && s === e) {
                  inner = (
                    <span
                      className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-white"
                      style={{ background: "#1C1C1C", boxShadow: "0 0 0 1px #1C1C1C" }}
                    />
                  );
                } else {
                  inner = (
                    <div
                      className="absolute top-1 bottom-1 left-px flex items-center overflow-hidden rounded px-1 text-[9px] font-semibold text-white"
                      style={{
                        background: color,
                        width: `calc(${widthDays * 100}% + ${widthDays - 1}px)`,
                        opacity: t.done ? 0.55 : 1,
                      }}
                      title={`${t.name} (${t.startDate} – ${t.endDate})`}
                    >
                      {widthDays >= 2 ? t.code : ""}{t.isMilestone ? " ◆" : ""}
                    </div>
                  );
                }
              }
              return (
                <td
                  key={day}
                  className={`${dayCol} relative h-6 border border-line ${day === todayDay ? "bg-red-500/5" : ""}`}
                >
                  {inner}
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}
