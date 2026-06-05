// ============================================================================
// Abhinaya Cinemas — Daily Digest (Supabase Edge Function port)
//
// Schedule: invoked by pg_cron every day at 7:00 AM IST (01:30 UTC).
// See supabase/migrations/digest-cron.sql for the cron job definition.
//
// Manual testing:
//   curl 'https://xkmjygegtpmmwwnyoufn.supabase.co/functions/v1/daily-digest?dry=1&date=2026-05-29' \
//        -H 'Authorization: Bearer <SUPABASE_ANON_KEY>'
//
// Env vars (set in Supabase Dashboard → Edge Functions → Secrets):
//   RESEND_API_KEY  (required)
//   DIGEST_TO       (optional, comma-separated list. Default:
//                    nitin.george@abhinayacinemas.com, ajim20@hotmail.com, shinu.thomas@abhinayacinemas.com)
//   DIGEST_FROM     (optional, default Abhinaya DCR <noreply@mail.abhinayacinemas.com>)
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
// ============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@4.0.0";

// ---------- types ----------
type Entry = { id: string; entry_date: string; movie_id: string; screen_id: string; share?: number; shows: any[]; updated_by?: string; updated_at?: string; };
type FbEntry = { id: string; entry_date: string; items: any[]; summary: any; notes?: string; updated_by?: string; updated_at?: string; };
type CfgScreen = { id: string; name?: string; classes?: Array<{ classId: string; seats?: number }>; priceCards?: Array<{ id: string; prices?: Record<string, number> }> };
type Cfg = { cinema?: { name?: string }; screens?: CfgScreen[]; movies?: Array<{ id: string; name?: string }>; classes?: Array<{ id: string; name?: string }>; [k: string]: any };
type BoAgg = { date: string; movieId: string; movieName: string; screenName: string; tickets: number; shows: number; grossColl: number; seats: number };
type FbAgg = { date: string; bills: number; gross: number; net: number; food: number; beverages: number };

// ---------- date helpers (IST = UTC+5:30) ----------
function istNow(): Date { return new Date(Date.now() + 5.5 * 60 * 60 * 1000); }
function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(s: string, n: number): string { const dt = new Date(s + "T00:00:00Z"); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10); }
function fmtDate(s: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric" }): string {
  const dt = new Date(s + "T00:00:00Z");
  return dt.toLocaleDateString("en-IN", { ...opts, timeZone: "UTC" });
}

// ---------- format helpers ----------
function fmtInt(n: number): string { if (!isFinite(n)) return "0"; return Math.round(n).toLocaleString("en-IN"); }
function fmtINR(n: number): string { if (!isFinite(n)) return "₹0"; return "₹" + Math.round(n).toLocaleString("en-IN"); }
function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]!));
}

// ---------- aggregation (no engine math; computes grossColl + seats from cfg) ----------
function aggregateBOEntry(e: Entry, cfg: Cfg): BoAgg {
  const shows = Array.isArray(e.shows) ? e.shows : [];
  const screen = (cfg.screens || []).find((s) => s.id === e.screen_id);
  const seatsByClass: Record<string, number> = {};
  (screen?.classes || []).forEach((c) => { seatsByClass[c.classId] = Number(c.seats) || 0; });
  const cardById: Record<string, Record<string, number>> = {};
  (screen?.priceCards || []).forEach((card) => { cardById[card.id] = card.prices || {}; });
  const seatsPerShow = Object.values(seatsByClass).reduce((s, n) => s + n, 0);
  const totalSeats = seatsPerShow * shows.length;
  let tickets = 0;
  let grossColl = 0;
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
    date: e.entry_date,
    movieId: e.movie_id,
    movieName: movie?.name || e.movie_id || "(unknown movie)",
    screenName: screen?.name || e.screen_id || "(unknown screen)",
    tickets, shows: shows.length, grossColl, seats: totalSeats,
  };
}

function aggregateFB(f: FbEntry): FbAgg {
  const sm = f.summary || {};
  return {
    date: f.entry_date,
    bills: Number(sm.bills) || 0,
    gross: Number(sm.grossSales) || 0,
    net: Number(sm.netSalesWithTax) || 0,
    food: Number(sm.foodSales) || 0,
    beverages: Number(sm.beveragesSales) || 0,
  };
}

// ---------- HTML chrome ----------
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
        For full financials (GST, TMC, Cess, Net Share, Distributor/Exhibitor splits), open the
        <a href="https://www.abhinayacinemas.com/admin/dcr/" style="color:#4f46e5;text-decoration:none;font-weight:500">DCR dashboard</a>.
      </div>
    </div>
    <div style="text-align:center;color:#aaa;font-size:11px;margin-top:14px">
      Automated report — sent at 7:00 AM IST.
    </div>
  </div>
</body></html>`;
}

function warningBlock(msg: string): string {
  return `<div style="background:#fff8e1;border-left:4px solid #f59e0b;padding:12px 14px;border-radius:6px;margin:14px 0;color:#92400e;font-size:14px">${msg}</div>`;
}

// ---------- body renderer ----------
function renderBody(opts: {
  targetDate: string;
  boByEntry: BoAgg[];
  fbForDay: FbAgg | null;
  last7BoTicketsPerDay: number;
  last7FbNetPerDay: number;
  last7AtpAvg: number;
  last7OccAvg: number;
  last7SphAvg: number;
  missingScreens: string[];
  noBoAtAll: boolean;
}): string {
  const { targetDate, boByEntry, fbForDay, last7BoTicketsPerDay, last7FbNetPerDay, last7AtpAvg, last7OccAvg, last7SphAvg, missingScreens, noBoAtAll } = opts;
  const totalTickets = boByEntry.reduce((s, r) => s + r.tickets, 0);
  const totalShows = boByEntry.reduce((s, r) => s + r.shows, 0);
  const totalGross = boByEntry.reduce((s, r) => s + r.grossColl, 0);
  const totalSeats = boByEntry.reduce((s, r) => s + r.seats, 0);
  const fbNet = fbForDay ? fbForDay.net : 0;
  const fbBills = fbForDay ? fbForDay.bills : 0;
  const atp = totalTickets > 0 ? totalGross / totalTickets : 0;
  const occ = totalSeats > 0 ? (totalTickets / totalSeats) * 100 : 0;
  const sph = totalTickets > 0 ? fbNet / totalTickets : 0;

  const screenRowsHtml = boByEntry.map((r) => {
    const rowOcc = r.seats > 0 ? (r.tickets / r.seats) * 100 : 0;
    return `
    <tr>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;font-weight:500">${escapeHtml(r.screenName)}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;color:#555">${escapeHtml(r.movieName)}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right">${fmtInt(r.shows)}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right">${fmtInt(r.tickets)}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right">${r.seats > 0 ? rowOcc.toFixed(1) + "%" : "—"}</td>
    </tr>`;
  }).join("");

  const missingHtml = missingScreens.length
    ? warningBlock(`<b>Heads up:</b> ${escapeHtml(missingScreens.join(", "))} ${missingScreens.length === 1 ? "has" : "have"} no DCR entry for ${fmtDate(targetDate)}.`)
    : "";

  const boTable = noBoAtAll
    ? warningBlock(`No Box Office entries at all for ${fmtDate(targetDate)}.`)
    : `<table style="width:100%;border-collapse:collapse;background:#fafafa;border-radius:6px;overflow:hidden">
        <thead><tr style="background:#f0f0f0;font-size:11px;text-transform:uppercase;color:#666;letter-spacing:.05em">
          <th style="padding:10px 8px;text-align:left">Screen</th>
          <th style="padding:10px 8px;text-align:left">Movie</th>
          <th style="padding:10px 8px;text-align:right">Shows</th>
          <th style="padding:10px 8px;text-align:right">Tickets</th>
          <th style="padding:10px 8px;text-align:right">Occ %</th>
        </tr></thead>
        <tbody>${screenRowsHtml}</tbody>
        <tfoot><tr style="background:#f0f0f0;font-weight:600">
          <td colspan="2" style="padding:10px 8px">Total</td>
          <td style="padding:10px 8px;text-align:right">${fmtInt(totalShows)}</td>
          <td style="padding:10px 8px;text-align:right">${fmtInt(totalTickets)}</td>
          <td style="padding:10px 8px;text-align:right">${totalSeats > 0 ? occ.toFixed(1) + "%" : "—"}</td>
        </tr></tfoot>
      </table>`;

  const kpiBlock = noBoAtAll ? "" : `
    <div style="display:flex;gap:10px;margin-top:14px">
      <div style="flex:1;background:#fafafa;border-radius:6px;padding:12px">
        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em">ATP</div>
        <div style="font-size:18px;font-weight:700;margin-top:2px;color:#111">${fmtINR(atp)}</div>
        <div style="font-size:11px;color:#888;margin-top:1px">Avg ticket price</div>
      </div>
      <div style="flex:1;background:#fafafa;border-radius:6px;padding:12px">
        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em">Occ %</div>
        <div style="font-size:18px;font-weight:700;margin-top:2px;color:#111">${totalSeats > 0 ? occ.toFixed(1) + "%" : "—"}</div>
        <div style="font-size:11px;color:#888;margin-top:1px">Tickets / capacity</div>
      </div>
      <div style="flex:1;background:#fafafa;border-radius:6px;padding:12px">
        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em">SPH</div>
        <div style="font-size:18px;font-weight:700;margin-top:2px;color:#111">${fbForDay ? fmtINR(sph) : "—"}</div>
        <div style="font-size:11px;color:#888;margin-top:1px">F&B per head</div>
      </div>
    </div>`;

  const fbBlockHtml = fbForDay
    ? `<table style="width:100%;border-collapse:collapse;background:#fafafa;border-radius:6px;overflow:hidden">
        <tr><td style="padding:10px 12px;color:#666">F&B Net Sales</td><td style="padding:10px 12px;text-align:right;font-weight:600">${fmtINR(fbNet)}</td></tr>
        <tr><td style="padding:10px 12px;color:#666;border-top:1px solid #eee">Bills</td><td style="padding:10px 12px;text-align:right;border-top:1px solid #eee">${fmtInt(fbBills)}</td></tr>
      </table>`
    : warningBlock(`F&B not entered for ${fmtDate(targetDate)}.`);

  return `
    ${missingHtml}
    <h2 style="font-size:15px;margin:28px 0 10px;color:#333;font-weight:600">Box Office</h2>
    ${boTable}
    ${kpiBlock}
    <h2 style="font-size:15px;margin:28px 0 10px;color:#333;font-weight:600">F&B</h2>
    ${fbBlockHtml}
    <h2 style="font-size:15px;margin:28px 0 10px;color:#333;font-weight:600">7-day rolling average</h2>
    <table style="width:100%;border-collapse:collapse;background:#fafafa;border-radius:6px;overflow:hidden">
      <tr><td style="padding:10px 12px;color:#666">Tickets per day</td><td style="padding:10px 12px;text-align:right;font-weight:600">${fmtInt(last7BoTicketsPerDay)}</td></tr>
      <tr><td style="padding:10px 12px;color:#666;border-top:1px solid #eee">F&B Net per day</td><td style="padding:10px 12px;text-align:right;font-weight:600;border-top:1px solid #eee">${fmtINR(last7FbNetPerDay)}</td></tr>
      <tr><td style="padding:10px 12px;color:#666;border-top:1px solid #eee">ATP (avg ticket price)</td><td style="padding:10px 12px;text-align:right;font-weight:600;border-top:1px solid #eee">${fmtINR(last7AtpAvg)}</td></tr>
      <tr><td style="padding:10px 12px;color:#666;border-top:1px solid #eee">Occupancy %</td><td style="padding:10px 12px;text-align:right;font-weight:600;border-top:1px solid #eee">${last7OccAvg > 0 ? last7OccAvg.toFixed(1) + "%" : "—"}</td></tr>
      <tr><td style="padding:10px 12px;color:#666;border-top:1px solid #eee">SPH (F&B per head)</td><td style="padding:10px 12px;text-align:right;font-weight:600;border-top:1px solid #eee">${fmtINR(last7SphAvg)}</td></tr>
    </table>`;
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
  const toAddr = Deno.env.get("DIGEST_TO") || "nitin.george@abhinayacinemas.com,ajim20@hotmail.com,shinu.thomas@abhinayacinemas.com";
  const toAddrs = toAddr.split(",").map((s) => s.trim()).filter(Boolean);

  if (!supabaseUrl || !supabaseKey) {
    return new Response("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var", { status: 500 });
  }
  if (!resendKey && !dry) {
    return new Response("Missing RESEND_API_KEY env var (use ?dry=1 to preview without sending)", { status: 500 });
  }

  let target: string;
  if (overrideDate && /^\d{4}-\d{2}-\d{2}$/.test(overrideDate)) {
    target = overrideDate;
  } else {
    const yesterday = new Date(istNow().getTime() - 24 * 60 * 60 * 1000);
    target = isoDate(yesterday);
  }
  const from7 = addDays(target, -7);
  const to7 = addDays(target, -1);

  const sb: SupabaseClient = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  const [cfgRes, boRes, fbRes, bo7Res, fb7Res] = await Promise.all([
    sb.from("config").select("data").eq("id", 1).maybeSingle(),
    sb.from("entries").select("*").eq("entry_date", target),
    sb.from("fb_entries").select("*").eq("entry_date", target).maybeSingle(),
    sb.from("entries").select("entry_date, movie_id, screen_id, shows").gte("entry_date", from7).lte("entry_date", to7),
    sb.from("fb_entries").select("entry_date, summary").gte("entry_date", from7).lte("entry_date", to7),
  ]);

  if (cfgRes.error) return new Response("config query: " + cfgRes.error.message, { status: 500 });
  if (boRes.error)  return new Response("entries query: " + boRes.error.message, { status: 500 });
  if (fbRes.error)  return new Response("fb_entries query: " + fbRes.error.message, { status: 500 });

  const cfg: Cfg = (cfgRes.data?.data) || {};
  const cinemaName = cfg.cinema?.name || "Abhinaya Cinemas, Changanacherry";

  const boByEntry = ((boRes.data || []) as Entry[]).map((e) => aggregateBOEntry(e, cfg));
  const noBoAtAll = boByEntry.length === 0;
  const fbForDay = fbRes.data ? aggregateFB(fbRes.data as FbEntry) : null;

  const bo7 = ((bo7Res.data || []) as Entry[]).map((e) => aggregateBOEntry(e, cfg));
  const fb7 = ((fb7Res.data || []) as FbEntry[]).map((f) => aggregateFB(f));
  const bo7Tickets = bo7.reduce((s, r) => s + r.tickets, 0);
  const bo7Gross   = bo7.reduce((s, r) => s + r.grossColl, 0);
  const bo7Seats   = bo7.reduce((s, r) => s + r.seats, 0);
  const fb7Net     = fb7.reduce((s, r) => s + r.net, 0);
  const last7BoTicketsPerDay = Math.round(bo7Tickets / 7);
  const last7FbNetPerDay     = Math.round(fb7Net / 7);
  const last7AtpAvg = bo7Tickets > 0 ? bo7Gross / bo7Tickets : 0;
  const last7OccAvg = bo7Seats   > 0 ? (bo7Tickets / bo7Seats) * 100 : 0;
  const last7SphAvg = bo7Tickets > 0 ? fb7Net / bo7Tickets : 0;

  const allScreens: string[] = (cfg.screens || []).map((s) => s.name || s.id).filter(Boolean) as string[];
  const screensWithData = new Set(boByEntry.map((r) => r.screenName));
  const missingScreens = allScreens.filter((n) => !screensWithData.has(n));

  const totalTickets = boByEntry.reduce((s, r) => s + r.tickets, 0);
  const fbNet = fbForDay ? fbForDay.net : 0;
  const subject = `Abhinaya — ${fmtDate(target)} · ${fmtInt(totalTickets)} tickets · ${fmtINR(fbNet)} F&B`;
  const bodyHtml = renderBody({ targetDate: target, boByEntry, fbForDay, last7BoTicketsPerDay, last7FbNetPerDay, last7AtpAvg, last7OccAvg, last7SphAvg, missingScreens, noBoAtAll });
  const html = emailShell({ eyebrow: "Daily Digest", title: fmtDate(target), subtitle: cinemaName, bodyHtml });

  if (dry) {
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  const resend = new Resend(resendKey);
  const { error } = await resend.emails.send({
    from: fromAddr, to: toAddrs, subject, html,
  });
  if (error) return new Response("Resend error: " + JSON.stringify(error), { status: 500 });

  return new Response(JSON.stringify({ ok: true, target, sentTo: toAddrs, screens: boByEntry.length, fb: !!fbForDay, missingScreens }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
