// ============================================================================
// Abhinaya Cinemas — Weekly Digest (Supabase Edge Function port)
//
// Schedule: invoked by pg_cron every Monday at 7:00 AM IST (01:30 UTC).
//
// Manual testing:
//   curl 'https://xkmjygegtpmmwwnyoufn.supabase.co/functions/v1/weekly-digest?dry=1&date=2026-05-25' \
//        -H 'Authorization: Bearer <SUPABASE_ANON_KEY>'
// ============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@4.0.0";

// ---------- types ----------
type Entry = { id: string; entry_date: string; movie_id: string; screen_id: string; share?: number; shows: any[]; updated_by?: string; updated_at?: string; };
type FbEntry = { id: string; entry_date: string; items: any[]; summary: any; notes?: string; updated_by?: string; updated_at?: string; };
type CfgScreen = { id: string; name?: string; classes?: Array<{ classId: string; seats?: number }>; priceCards?: Array<{ id: string; prices?: Record<string, number> }> };
type Cfg = { cinema?: { name?: string }; screens?: CfgScreen[]; movies?: Array<{ id: string; name?: string }>; [k: string]: any };
type BoAgg = { date: string; movieId: string; movieName: string; screenName: string; tickets: number; shows: number; grossColl: number; seats: number };
type FbAgg = { date: string; bills: number; gross: number; net: number; food: number; beverages: number };

// ---------- date helpers ----------
function istNow(): Date { return new Date(Date.now() + 5.5 * 60 * 60 * 1000); }
function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(s: string, n: number): string { const dt = new Date(s + "T00:00:00Z"); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10); }
function fmtDate(s: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric" }): string {
  const dt = new Date(s + "T00:00:00Z");
  return dt.toLocaleDateString("en-IN", { ...opts, timeZone: "UTC" });
}
function fmtDateRange(from: string, to: string): string {
  const f = new Date(from + "T00:00:00Z"), t = new Date(to + "T00:00:00Z");
  const sameMonth = f.getUTCMonth() === t.getUTCMonth() && f.getUTCFullYear() === t.getUTCFullYear();
  if (sameMonth) {
    return f.toLocaleDateString("en-IN", { day: "numeric", timeZone: "UTC" }) + "–" + t.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }
  return f.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) + " – " + t.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// ---------- format helpers ----------
function fmtInt(n: number): string { if (!isFinite(n)) return "0"; return Math.round(n).toLocaleString("en-IN"); }
function fmtINR(n: number): string { if (!isFinite(n)) return "₹0"; return "₹" + Math.round(n).toLocaleString("en-IN"); }
function fmtPctDelta(curr: number, prev: number): { text: string; color: string; arrow: string } {
  if (prev === 0) return { text: curr === 0 ? "no change" : "new", color: "#666", arrow: "" };
  const pct = ((curr - prev) / prev) * 100;
  if (Math.abs(pct) < 0.5) return { text: "≈ flat", color: "#666", arrow: "→" };
  const up = pct > 0;
  return { text: `${up ? "+" : ""}${pct.toFixed(1)}%`, color: up ? "#16a34a" : "#dc2626", arrow: up ? "▲" : "▼" };
}
function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// ---------- aggregation ----------
function aggregateBOEntry(e: Entry, cfg: Cfg): BoAgg {
  const shows = Array.isArray(e.shows) ? e.shows : [];
  const screen = (cfg.screens || []).find((s) => s.id === e.screen_id);
  const seatsByClass: Record<string, number> = {};
  (screen?.classes || []).forEach((c) => { seatsByClass[c.classId] = Number(c.seats) || 0; });
  const cardById: Record<string, Record<string, number>> = {};
  (screen?.priceCards || []).forEach((card) => { cardById[card.id] = card.prices || {}; });
  const seatsPerShow = Object.values(seatsByClass).reduce((s, n) => s + n, 0);
  const totalSeats = seatsPerShow * shows.length;
  let tickets = 0, grossColl = 0;
  shows.forEach((sh: any) => {
    const cardPrices = cardById[sh?.priceCardId] || {};
    const rows = (sh && sh.rows) || {};
    Object.keys(rows).forEach((classId) => {
      const qty = Number(rows[classId]?.tickets) || 0;
      tickets += qty;
      grossColl += qty * (Number(cardPrices[classId]) || 0);
    });
  });
  const movie = (cfg.movies || []).find((m) => m.id === e.movie_id);
  return {
    date: e.entry_date, movieId: e.movie_id,
    movieName: movie?.name || e.movie_id || "(unknown movie)",
    screenName: screen?.name || e.screen_id || "(unknown screen)",
    tickets, shows: shows.length, grossColl, seats: totalSeats,
  };
}
function aggregateFB(f: FbEntry): FbAgg {
  const sm = f.summary || {};
  return { date: f.entry_date, bills: Number(sm.bills) || 0, gross: Number(sm.grossSales) || 0, net: Number(sm.netSalesWithTax) || 0, food: Number(sm.foodSales) || 0, beverages: Number(sm.beveragesSales) || 0 };
}

// ---------- week roll-up ----------
type WeekTotals = { daysWithBO: number; daysWithFB: number; totalShows: number; totalTickets: number; totalGross: number; totalSeats: number; totalFbNet: number; totalFbBills: number; atp: number; occPct: number; sph: number };

function totalsFor(bo: BoAgg[], fb: FbAgg[]): WeekTotals {
  const boDays = new Set(bo.map((r) => r.date));
  const fbDays = new Set(fb.map((r) => r.date));
  const totalTickets = bo.reduce((s, r) => s + r.tickets, 0);
  const totalGross = bo.reduce((s, r) => s + r.grossColl, 0);
  const totalSeats = bo.reduce((s, r) => s + r.seats, 0);
  const totalFbNet = fb.reduce((s, r) => s + r.net, 0);
  return {
    daysWithBO: boDays.size, daysWithFB: fbDays.size,
    totalShows: bo.reduce((s, r) => s + r.shows, 0),
    totalTickets, totalGross, totalSeats, totalFbNet,
    totalFbBills: fb.reduce((s, r) => s + r.bills, 0),
    atp:    totalTickets > 0 ? totalGross / totalTickets : 0,
    occPct: totalSeats   > 0 ? (totalTickets / totalSeats) * 100 : 0,
    sph:    totalTickets > 0 ? totalFbNet / totalTickets : 0,
  };
}
function topMovie(bo: BoAgg[]): { name: string; tickets: number } | null {
  const byMovie: Record<string, { name: string; tickets: number }> = {};
  bo.forEach((r) => { if (!byMovie[r.movieId]) byMovie[r.movieId] = { name: r.movieName, tickets: 0 }; byMovie[r.movieId].tickets += r.tickets; });
  const list = Object.values(byMovie).sort((a, b) => b.tickets - a.tickets);
  return list.length ? list[0] : null;
}
function perScreen(bo: BoAgg[]) {
  const m: Record<string, { screen: string; shows: number; tickets: number; seats: number }> = {};
  bo.forEach((r) => { if (!m[r.screenName]) m[r.screenName] = { screen: r.screenName, shows: 0, tickets: 0, seats: 0 }; m[r.screenName].shows += r.shows; m[r.screenName].tickets += r.tickets; m[r.screenName].seats += r.seats; });
  return Object.values(m).map((x) => ({ ...x, occPct: x.seats > 0 ? (x.tickets / x.seats) * 100 : 0 })).sort((a, b) => b.tickets - a.tickets);
}
function daily7(bo: BoAgg[], fb: FbAgg[], fromDate: string) {
  const out = [];
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

// ---------- HTML chrome ----------
function emailShell(opts: { eyebrow: string; title: string; subtitle: string; bodyHtml: string }): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#222">
  <div style="max-width:640px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:12px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
      <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.08em;font-weight:600">${escapeHtml(opts.eyebrow)}</div>
      <h1 style="margin:6px 0 4px;font-size:24px;color:#111">${escapeHtml(opts.title)}</h1>
      <div style="color:#666;font-size:14px">${escapeHtml(opts.subtitle)}</div>
      ${opts.bodyHtml}
      <div style="margin-top:28px;padding-top:18px;border-top:1px solid #eee;font-size:12px;color:#888;line-height:1.6">
        For full financials (GST, TMC, Cess, Net Share, Distributor/Exhibitor splits), open the
        <a href="https://www.abhinayacinemas.com/admin/dcr/" style="color:#4f46e5;text-decoration:none;font-weight:500">DCR dashboard</a>.
      </div>
    </div>
    <div style="text-align:center;color:#aaa;font-size:11px;margin-top:14px">Automated report — sent at 7:00 AM IST.</div>
  </div></body></html>`;
}
function warningBlock(msg: string): string {
  return `<div style="background:#fff8e1;border-left:4px solid #f59e0b;padding:12px 14px;border-radius:6px;margin:14px 0;color:#92400e;font-size:14px">${msg}</div>`;
}

// ---------- body renderer ----------
function renderBody(opts: { weekFrom: string; weekTo: string; curr: WeekTotals; prev: WeekTotals; byScreen: ReturnType<typeof perScreen>; topMov: { name: string; tickets: number } | null; byDay: ReturnType<typeof daily7>; daysMissingBO: number; daysMissingFB: number; }): string {
  const { curr, prev, byScreen, topMov, byDay, daysMissingBO, daysMissingFB } = opts;
  const ticketDelta = fmtPctDelta(curr.totalTickets, prev.totalTickets);
  const fbDelta = fmtPctDelta(curr.totalFbNet, prev.totalFbNet);
  const atpDelta = fmtPctDelta(curr.atp, prev.atp);
  const occDelta = fmtPctDelta(curr.occPct, prev.occPct);
  const sphDelta = fmtPctDelta(curr.sph, prev.sph);

  const missingNotes: string[] = [];
  if (daysMissingBO > 0) missingNotes.push(`${daysMissingBO} day${daysMissingBO === 1 ? "" : "s"} without a BO entry`);
  if (daysMissingFB > 0) missingNotes.push(`${daysMissingFB} day${daysMissingFB === 1 ? "" : "s"} without F&B`);
  const missingHtml = missingNotes.length
    ? warningBlock(`<b>Coverage gaps:</b> ${escapeHtml(missingNotes.join(" · "))}. Totals reflect only what was entered.`)
    : "";

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
    <tbody>${screenRowsHtml}</tbody></table>`;

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
    <tbody>${dayRowsHtml}</tbody></table>`;

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

// ---------- handler ----------
Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const overrideDate = url.searchParams.get("date");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY") || "";
  const fromAddr = Deno.env.get("DIGEST_FROM") || "Abhinaya DCR <noreply@mail.abhinayacinemas.com>";
  const toAddr = Deno.env.get("DIGEST_TO") || "nitin.george@abhinayacinemas.com";

  if (!supabaseUrl || !supabaseKey) return new Response("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var", { status: 500 });
  if (!resendKey && !dry) return new Response("Missing RESEND_API_KEY env var (use ?dry=1)", { status: 500 });

  // Compute previous Mon-Sun range
  let asIfMonday: string;
  if (overrideDate && /^\d{4}-\d{2}-\d{2}$/.test(overrideDate)) {
    asIfMonday = overrideDate;
  } else {
    asIfMonday = isoDate(istNow());
  }
  const weekTo       = addDays(asIfMonday, -1);
  const weekFrom     = addDays(asIfMonday, -7);
  const prevWeekTo   = addDays(weekFrom, -1);
  const prevWeekFrom = addDays(weekFrom, -7);

  const sb: SupabaseClient = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

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

  if (dry) return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });

  const resend = new Resend(resendKey);
  const { error } = await resend.emails.send({ from: fromAddr, to: [toAddr], subject, html });
  if (error) return new Response("Resend error: " + JSON.stringify(error), { status: 500 });

  return new Response(JSON.stringify({
    ok: true, weekFrom, weekTo, sentTo: toAddr,
    daysWithBO: curr.daysWithBO, daysWithFB: curr.daysWithFB,
    tickets: curr.totalTickets, fbNet: curr.totalFbNet,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
});
