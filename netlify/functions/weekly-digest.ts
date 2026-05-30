// ============================================================================
// Abhinaya Cinemas — Weekly Digest (Mon morning, previous week's overview)
//
// Runs every Monday at 7:00 AM IST. Covers the previous Mon–Sun week with a
// week-over-week comparison against the week before that.
//
// Same lean philosophy as daily-digest: no engine duplication. Operational
// metrics only (tickets, shows, F&B summary). Money figures = F&B net only.
//
// Manual trigger / dry run:
//   GET <site>/.netlify/functions/weekly-digest?dry=1
//   GET <site>/.netlify/functions/weekly-digest?date=YYYY-MM-DD&dry=1
//     → date acts as "as-if today is this Monday" (digest will cover the 7
//        days ending the day before that date)
//   GET <site>/.netlify/functions/weekly-digest             → real send
// ============================================================================

import type { Config } from "@netlify/functions";
import {
  readEnv, makeClient,
  istNow, isoDate, addDays, fmtDate, fmtDateRange,
  fmtInt, fmtINR, fmtPctDelta, escapeHtml,
  aggregateBOEntry, aggregateFB,
  emailShell, warningBlock, sendEmail,
  type Entry, type FbEntry, type Cfg, type BoAgg, type FbAgg,
} from "./_lib/digest-core.js";

type WeekTotals = {
  daysWithBO: number;
  daysWithFB: number;
  totalShows: number;
  totalTickets: number;
  totalGross: number;
  totalSeats: number;
  totalFbNet: number;
  totalFbBills: number;
  atp: number;
  occPct: number;
  sph: number;
};

function totalsFor(bo: BoAgg[], fb: FbAgg[]): WeekTotals {
  const boDays = new Set(bo.map((r) => r.date));
  const fbDays = new Set(fb.map((r) => r.date));
  const totalTickets = bo.reduce((s, r) => s + r.tickets, 0);
  const totalGross = bo.reduce((s, r) => s + r.grossColl, 0);
  const totalSeats = bo.reduce((s, r) => s + r.seats, 0);
  const totalFbNet = fb.reduce((s, r) => s + r.net, 0);
  return {
    daysWithBO: boDays.size,
    daysWithFB: fbDays.size,
    totalShows: bo.reduce((s, r) => s + r.shows, 0),
    totalTickets,
    totalGross,
    totalSeats,
    totalFbNet,
    totalFbBills: fb.reduce((s, r) => s + r.bills, 0),
    atp:    totalTickets > 0 ? totalGross / totalTickets : 0,
    occPct: totalSeats   > 0 ? (totalTickets / totalSeats) * 100 : 0,
    sph:    totalTickets > 0 ? totalFbNet / totalTickets : 0,
  };
}

function topMovie(bo: BoAgg[]): { name: string; tickets: number } | null {
  const byMovie: Record<string, { name: string; tickets: number }> = {};
  bo.forEach((r) => {
    if (!byMovie[r.movieId]) byMovie[r.movieId] = { name: r.movieName, tickets: 0 };
    byMovie[r.movieId].tickets += r.tickets;
  });
  const list = Object.values(byMovie).sort((a, b) => b.tickets - a.tickets);
  return list.length ? list[0] : null;
}

function perScreen(bo: BoAgg[]): Array<{ screen: string; shows: number; tickets: number; seats: number; occPct: number }> {
  const m: Record<string, { screen: string; shows: number; tickets: number; seats: number }> = {};
  bo.forEach((r) => {
    if (!m[r.screenName]) m[r.screenName] = { screen: r.screenName, shows: 0, tickets: 0, seats: 0 };
    m[r.screenName].shows   += r.shows;
    m[r.screenName].tickets += r.tickets;
    m[r.screenName].seats   += r.seats;
  });
  return Object.values(m)
    .map((x) => ({ ...x, occPct: x.seats > 0 ? (x.tickets / x.seats) * 100 : 0 }))
    .sort((a, b) => b.tickets - a.tickets);
}

// Daily breakdown: for each of 7 days, tickets + F&B net
function daily7(bo: BoAgg[], fb: FbAgg[], fromDate: string): Array<{ date: string; tickets: number; fbNet: number; hasBO: boolean; hasFB: boolean }> {
  const out: Array<{ date: string; tickets: number; fbNet: number; hasBO: boolean; hasFB: boolean }> = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(fromDate, i);
    const dayBo = bo.filter((r) => r.date === d);
    const dayFb = fb.find((r) => r.date === d);
    out.push({
      date: d,
      tickets: dayBo.reduce((s, r) => s + r.tickets, 0),
      fbNet: dayFb ? dayFb.net : 0,
      hasBO: dayBo.length > 0,
      hasFB: !!dayFb,
    });
  }
  return out;
}

// ---------- body renderer ----------
function renderBody(opts: {
  weekFrom: string;
  weekTo: string;
  curr: WeekTotals;
  prev: WeekTotals;
  byScreen: Array<{ screen: string; shows: number; tickets: number; seats: number; occPct: number }>;
  topMov: { name: string; tickets: number } | null;
  byDay: Array<{ date: string; tickets: number; fbNet: number; hasBO: boolean; hasFB: boolean }>;
  daysMissingBO: number;
  daysMissingFB: number;
}): string {
  const { weekFrom, weekTo, curr, prev, byScreen, topMov, byDay, daysMissingBO, daysMissingFB } = opts;

  const ticketDelta = fmtPctDelta(curr.totalTickets, prev.totalTickets);
  const fbDelta     = fmtPctDelta(curr.totalFbNet,   prev.totalFbNet);
  const atpDelta    = fmtPctDelta(curr.atp,          prev.atp);
  const occDelta    = fmtPctDelta(curr.occPct,       prev.occPct);
  const sphDelta    = fmtPctDelta(curr.sph,          prev.sph);

  const missingNotes: string[] = [];
  if (daysMissingBO > 0) missingNotes.push(`${daysMissingBO} day${daysMissingBO === 1 ? "" : "s"} without a BO entry`);
  if (daysMissingFB > 0) missingNotes.push(`${daysMissingFB} day${daysMissingFB === 1 ? "" : "s"} without F&B`);
  const missingHtml = missingNotes.length
    ? warningBlock(`<b>Coverage gaps:</b> ${escapeHtml(missingNotes.join(" · "))}. Totals reflect only what was entered.`)
    : "";

  // Big KPI cards (top two)
  const kpiBlock = `
    <div style="display:flex;gap:10px;margin:18px 0 10px">
      <div style="flex:1;background:#fafafa;border-radius:6px;padding:14px">
        <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em">Tickets</div>
        <div style="font-size:22px;font-weight:700;margin-top:4px;color:#111">${fmtInt(curr.totalTickets)}</div>
        <div style="font-size:12px;margin-top:4px;color:${ticketDelta.color}">${ticketDelta.arrow} ${ticketDelta.text} vs prior week</div>
      </div>
      <div style="flex:1;background:#fafafa;border-radius:6px;padding:14px">
        <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em">F&B Net</div>
        <div style="font-size:22px;font-weight:700;margin-top:4px;color:#111">${fmtINR(curr.totalFbNet)}</div>
        <div style="font-size:12px;margin-top:4px;color:${fbDelta.color}">${fbDelta.arrow} ${fbDelta.text} vs prior week</div>
      </div>
    </div>
    <div style="display:flex;gap:10px;margin:0 0 18px">
      <div style="flex:1;background:#fafafa;border-radius:6px;padding:12px">
        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em">ATP</div>
        <div style="font-size:18px;font-weight:700;margin-top:2px;color:#111">${fmtINR(curr.atp)}</div>
        <div style="font-size:11px;color:${atpDelta.color};margin-top:2px">${atpDelta.arrow} ${atpDelta.text}</div>
      </div>
      <div style="flex:1;background:#fafafa;border-radius:6px;padding:12px">
        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em">Occ %</div>
        <div style="font-size:18px;font-weight:700;margin-top:2px;color:#111">${curr.totalSeats > 0 ? curr.occPct.toFixed(1) + "%" : "—"}</div>
        <div style="font-size:11px;color:${occDelta.color};margin-top:2px">${occDelta.arrow} ${occDelta.text}</div>
      </div>
      <div style="flex:1;background:#fafafa;border-radius:6px;padding:12px">
        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em">SPH</div>
        <div style="font-size:18px;font-weight:700;margin-top:2px;color:#111">${curr.totalTickets > 0 ? fmtINR(curr.sph) : "—"}</div>
        <div style="font-size:11px;color:${sphDelta.color};margin-top:2px">${sphDelta.arrow} ${sphDelta.text}</div>
      </div>
    </div>`;

  const summaryTbl = `<table style="width:100%;border-collapse:collapse;background:#fafafa;border-radius:6px;overflow:hidden">
    <tr><td style="padding:10px 12px;color:#666">Shows</td><td style="padding:10px 12px;text-align:right;font-weight:600">${fmtInt(curr.totalShows)}</td></tr>
    <tr><td style="padding:10px 12px;color:#666;border-top:1px solid #eee">F&B Bills</td><td style="padding:10px 12px;text-align:right;font-weight:600;border-top:1px solid #eee">${fmtInt(curr.totalFbBills)}</td></tr>
    <tr><td style="padding:10px 12px;color:#666;border-top:1px solid #eee">Days with BO entries</td><td style="padding:10px 12px;text-align:right;border-top:1px solid #eee">${curr.daysWithBO} / 7</td></tr>
    <tr><td style="padding:10px 12px;color:#666;border-top:1px solid #eee">Days with F&B entries</td><td style="padding:10px 12px;text-align:right;border-top:1px solid #eee">${curr.daysWithFB} / 7</td></tr>
  </table>`;

  const topMovHtml = topMov
    ? `<div style="padding:14px;background:#f0f7ff;border-radius:6px;margin-top:18px">
        <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em">Top movie</div>
        <div style="font-size:16px;font-weight:600;margin-top:4px;color:#111">${escapeHtml(topMov.name)}</div>
        <div style="font-size:12px;color:#666;margin-top:2px">${fmtInt(topMov.tickets)} tickets over the week</div>
      </div>`
    : "";

  const screenRowsHtml = byScreen.length ? byScreen.map((r) => `
    <tr>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;font-weight:500">${escapeHtml(r.screen)}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right">${fmtInt(r.shows)}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right">${fmtInt(r.tickets)}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right">${r.seats > 0 ? r.occPct.toFixed(1) + "%" : "—"}</td>
    </tr>`).join("") : `<tr><td colspan="4" style="padding:14px;color:#999;text-align:center">No screens reported</td></tr>`;

  const screenTbl = `<table style="width:100%;border-collapse:collapse;background:#fafafa;border-radius:6px;overflow:hidden">
    <thead><tr style="background:#f0f0f0;font-size:11px;text-transform:uppercase;color:#666;letter-spacing:.05em">
      <th style="padding:10px 8px;text-align:left">Screen</th>
      <th style="padding:10px 8px;text-align:right">Shows</th>
      <th style="padding:10px 8px;text-align:right">Tickets</th>
      <th style="padding:10px 8px;text-align:right">Occ %</th>
    </tr></thead>
    <tbody>${screenRowsHtml}</tbody>
  </table>`;

  const dayRowsHtml = byDay.map((d) => {
    const dayLabel = fmtDate(d.date, { weekday: "short", day: "numeric", month: "short" });
    return `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee;font-weight:500">${dayLabel}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;color:${d.hasBO ? "#222" : "#bbb"}">${d.hasBO ? fmtInt(d.tickets) : "—"}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;color:${d.hasFB ? "#222" : "#bbb"}">${d.hasFB ? fmtINR(d.fbNet) : "—"}</td>
    </tr>`;
  }).join("");

  const dayTbl = `<table style="width:100%;border-collapse:collapse;background:#fafafa;border-radius:6px;overflow:hidden">
    <thead><tr style="background:#f0f0f0;font-size:11px;text-transform:uppercase;color:#666;letter-spacing:.05em">
      <th style="padding:8px;text-align:left">Day</th>
      <th style="padding:8px;text-align:right">Tickets</th>
      <th style="padding:8px;text-align:right">F&B Net</th>
    </tr></thead>
    <tbody>${dayRowsHtml}</tbody>
  </table>`;

  return `
    ${missingHtml}
    ${kpiBlock}

    <h2 style="font-size:15px;margin:28px 0 10px;color:#333;font-weight:600">Week summary</h2>
    ${summaryTbl}
    ${topMovHtml}

    <h2 style="font-size:15px;margin:28px 0 10px;color:#333;font-weight:600">By screen</h2>
    ${screenTbl}

    <h2 style="font-size:15px;margin:28px 0 10px;color:#333;font-weight:600">Day by day</h2>
    ${dayTbl}`;
}

function plainText(opts: { weekFrom: string; weekTo: string; cinemaName: string; curr: WeekTotals; prev: WeekTotals; byScreen: Array<{ screen: string; shows: number; tickets: number; seats: number; occPct: number }>; topMov: { name: string; tickets: number } | null; byDay: Array<{ date: string; tickets: number; fbNet: number; hasBO: boolean; hasFB: boolean }>; }): string {
  const { weekFrom, weekTo, cinemaName, curr, prev, byScreen, topMov, byDay } = opts;
  const ticketDelta = fmtPctDelta(curr.totalTickets, prev.totalTickets);
  const fbDelta     = fmtPctDelta(curr.totalFbNet,   prev.totalFbNet);
  const atpDelta    = fmtPctDelta(curr.atp,          prev.atp);
  const occDelta    = fmtPctDelta(curr.occPct,       prev.occPct);
  const sphDelta    = fmtPctDelta(curr.sph,          prev.sph);
  return `Abhinaya — Week of ${fmtDateRange(weekFrom, weekTo)}
${cinemaName}

KPIs:
  Tickets: ${fmtInt(curr.totalTickets)}   (${ticketDelta.arrow} ${ticketDelta.text} WoW)
  F&B Net: ${fmtINR(curr.totalFbNet)}   (${fbDelta.arrow} ${fbDelta.text} WoW)
  ATP:     ${fmtINR(curr.atp)}   (${atpDelta.arrow} ${atpDelta.text} WoW)
  Occ %:   ${curr.totalSeats > 0 ? curr.occPct.toFixed(1) + "%" : "—"}   (${occDelta.arrow} ${occDelta.text} WoW)
  SPH:     ${curr.totalTickets > 0 ? fmtINR(curr.sph) : "—"}   (${sphDelta.arrow} ${sphDelta.text} WoW)
  Shows:   ${fmtInt(curr.totalShows)}
  Bills:   ${fmtInt(curr.totalFbBills)}
  Days w/ BO:  ${curr.daysWithBO}/7
  Days w/ F&B: ${curr.daysWithFB}/7

${topMov ? `Top movie: ${topMov.name} (${fmtInt(topMov.tickets)} tickets)\n` : ""}
By screen:
${byScreen.map((r) => `  ${r.screen}: ${r.shows} shows, ${r.tickets} tickets, ${r.seats > 0 ? r.occPct.toFixed(1) + "% occ" : "—"}`).join("\n")}

Day by day:
${byDay.map((d) => `  ${fmtDate(d.date, { weekday: "short", day: "numeric", month: "short" })}: ${d.hasBO ? d.tickets + " tickets" : "—"}, ${d.hasFB ? fmtINR(d.fbNet) : "—"}`).join("\n")}

Full financials: https://www.abhinayacinemas.com/admin/dcr/`;
}

// ---------- handler ----------
export default async (req: Request) => {
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const overrideDate = url.searchParams.get("date"); // "as-if today is this Monday"

  const envOrErr = readEnv();
  if ("error" in envOrErr) return new Response(envOrErr.error, { status: 500 });
  const env = envOrErr;
  if (!env.resendKey && !dry) {
    return new Response("Missing RESEND_API_KEY env var (use ?dry=1 to preview without sending)", { status: 500 });
  }

  // Compute "previous Mon-Sun" range
  let asIfMonday: string;
  if (overrideDate && /^\d{4}-\d{2}-\d{2}$/.test(overrideDate)) {
    asIfMonday = overrideDate;
  } else {
    asIfMonday = isoDate(istNow());
  }
  // weekTo = day before "today" (Sunday); weekFrom = 6 days before that (Monday)
  const weekTo = addDays(asIfMonday, -1);
  const weekFrom = addDays(asIfMonday, -7);
  // prev week for WoW
  const prevWeekTo = addDays(weekFrom, -1);
  const prevWeekFrom = addDays(weekFrom, -7);

  const sb = makeClient(env);

  const [cfgRes, boRes, fbRes, boPrevRes, fbPrevRes] = await Promise.all([
    sb.from("config").select("data").eq("id", 1).maybeSingle(),
    sb.from("entries").select("*").gte("entry_date", weekFrom).lte("entry_date", weekTo),
    sb.from("fb_entries").select("*").gte("entry_date", weekFrom).lte("entry_date", weekTo),
    sb.from("entries").select("entry_date, movie_id, screen_id, shows").gte("entry_date", prevWeekFrom).lte("entry_date", prevWeekTo),
    sb.from("fb_entries").select("entry_date, summary").gte("entry_date", prevWeekFrom).lte("entry_date", prevWeekTo),
  ]);

  if (cfgRes.error) return new Response("config query: " + cfgRes.error.message, { status: 500 });
  if (boRes.error)  return new Response("entries query: " + boRes.error.message, { status: 500 });
  if (fbRes.error)  return new Response("fb_entries query: " + fbRes.error.message, { status: 500 });

  const cfg: Cfg = (cfgRes.data?.data) || {};
  const cinemaName = cfg.cinema?.name || "Abhinaya Cinemas, Changanacherry";

  const boCurr = ((boRes.data || []) as Entry[]).map((e) => aggregateBOEntry(e, cfg));
  const fbCurr = ((fbRes.data || []) as FbEntry[]).map((f) => aggregateFB(f));
  const boPrev = ((boPrevRes.data || []) as Entry[]).map((e) => aggregateBOEntry(e, cfg));
  const fbPrev = ((fbPrevRes.data || []) as FbEntry[]).map((f) => aggregateFB(f));

  const curr = totalsFor(boCurr, fbCurr);
  const prev = totalsFor(boPrev, fbPrev);
  const byScreen = perScreen(boCurr);
  const topMov = topMovie(boCurr);
  const byDay = daily7(boCurr, fbCurr, weekFrom);
  const daysMissingBO = 7 - curr.daysWithBO;
  const daysMissingFB = 7 - curr.daysWithFB;

  const ticketDelta = fmtPctDelta(curr.totalTickets, prev.totalTickets);
  const subject = `Abhinaya — Week of ${fmtDateRange(weekFrom, weekTo)} · ${fmtInt(curr.totalTickets)} tickets (${ticketDelta.arrow} ${ticketDelta.text}) · ${fmtINR(curr.totalFbNet)} F&B`;
  const bodyHtml = renderBody({ weekFrom, weekTo, curr, prev, byScreen, topMov, byDay, daysMissingBO, daysMissingFB });
  const html = emailShell({ eyebrow: "Weekly Digest", title: `Week of ${fmtDateRange(weekFrom, weekTo)}`, subtitle: cinemaName, bodyHtml });
  const text = plainText({ weekFrom, weekTo, cinemaName, curr, prev, byScreen, topMov, byDay });

  if (dry) {
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  const send = await sendEmail(env, subject, html, text);
  if (!send.ok) return new Response("Resend error: " + send.error, { status: 500 });

  return new Response(JSON.stringify({
    ok: true, weekFrom, weekTo, sentTo: env.toAddr,
    daysWithBO: curr.daysWithBO, daysWithFB: curr.daysWithFB,
    tickets: curr.totalTickets, fbNet: curr.totalFbNet,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};

// Mondays at 7:00 AM IST = Mondays at 01:30 UTC
export const config: Config = {
  schedule: "30 1 * * 1",
};
