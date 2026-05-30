// ============================================================================
// Abhinaya Cinemas — Daily Digest (previous day's report)
//
// Runs every morning at 7:00 AM IST. Pulls yesterday's BO + F&B from Supabase,
// composes a readable HTML email and sends it via Resend.
//
// Why this is intentionally lean:
//   The DCR engine math (POA/TMC/Cess/E-Tax/GST/Rep Batta) is locked and
//   lives in admin/dcr/js/01-box-office.js. We don't duplicate it here —
//   the digest only reports OPERATIONAL metrics that don't need the engine
//   (tickets, shows, F&B summary already pre-aggregated in fb_entries.summary).
//   For full financials the email links to the dashboard.
//
// Manual trigger / dry run:
//   GET <site>/.netlify/functions/daily-digest?dry=1
//   GET <site>/.netlify/functions/daily-digest?date=YYYY-MM-DD&dry=1
//   GET <site>/.netlify/functions/daily-digest             → real send
// ============================================================================

import type { Config } from "@netlify/functions";
import {
  readEnv, makeClient,
  istNow, isoDate, addDays, fmtDate,
  fmtInt, fmtINR, escapeHtml,
  aggregateBOEntry, aggregateFB,
  emailShell, warningBlock, sendEmail,
  type Entry, type FbEntry, type Cfg, type BoAgg, type FbAgg,
} from "./_lib/digest-core.js";

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

  // Yesterday's headline KPIs — ATP, Occ %, SPH
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

function plainText(opts: { targetDate: string; cinemaName: string; boByEntry: BoAgg[]; fbForDay: FbAgg | null; last7BoTicketsPerDay: number; last7FbNetPerDay: number; last7AtpAvg: number; last7OccAvg: number; last7SphAvg: number; missingScreens: string[]; noBoAtAll: boolean; }): string {
  const { targetDate, cinemaName, boByEntry, fbForDay, last7BoTicketsPerDay, last7FbNetPerDay, last7AtpAvg, last7OccAvg, last7SphAvg, missingScreens, noBoAtAll } = opts;
  const totalTickets = boByEntry.reduce((s, r) => s + r.tickets, 0);
  const totalShows = boByEntry.reduce((s, r) => s + r.shows, 0);
  const totalGross = boByEntry.reduce((s, r) => s + r.grossColl, 0);
  const totalSeats = boByEntry.reduce((s, r) => s + r.seats, 0);
  const atp = totalTickets > 0 ? totalGross / totalTickets : 0;
  const occ = totalSeats > 0 ? (totalTickets / totalSeats) * 100 : 0;
  const sph = totalTickets > 0 && fbForDay ? fbForDay.net / totalTickets : 0;
  return `Abhinaya — ${fmtDate(targetDate)}
${cinemaName}

Box Office:
${noBoAtAll ? "  (no entries)" : boByEntry.map(r => `  ${r.screenName} · ${r.movieName} · ${r.shows} shows · ${r.tickets} tickets · ${r.seats > 0 ? ((r.tickets / r.seats) * 100).toFixed(1) + "% occ" : "—"}`).join("\n")}
${noBoAtAll ? "" : `  Total: ${totalShows} shows, ${totalTickets} tickets, ATP ${fmtINR(atp)}, Occ ${totalSeats > 0 ? occ.toFixed(1) + "%" : "—"}`}

F&B:
${fbForDay ? `  Net: ${fmtINR(fbForDay.net)}\n  Bills: ${fmtInt(fbForDay.bills)}\n  SPH: ${fmtINR(sph)}` : "  (not entered)"}

7-day rolling avg:
  Tickets/day: ${fmtInt(last7BoTicketsPerDay)}
  F&B Net/day: ${fmtINR(last7FbNetPerDay)}
  ATP: ${fmtINR(last7AtpAvg)}
  Occupancy: ${last7OccAvg > 0 ? last7OccAvg.toFixed(1) + "%" : "—"}
  SPH: ${fmtINR(last7SphAvg)}

${missingScreens.length ? `Heads up: ${missingScreens.join(", ")} missing.\n` : ""}
Full financials: https://www.abhinayacinemas.com/admin/dcr/`;
}

// ---------- handler ----------
export default async (req: Request) => {
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const overrideDate = url.searchParams.get("date");

  const envOrErr = readEnv();
  if ("error" in envOrErr) return new Response(envOrErr.error, { status: 500 });
  const env = envOrErr;
  if (!env.resendKey && !dry) {
    return new Response("Missing RESEND_API_KEY env var (use ?dry=1 to preview without sending)", { status: 500 });
  }

  // Yesterday in IST (or override)
  let target: string;
  if (overrideDate && /^\d{4}-\d{2}-\d{2}$/.test(overrideDate)) {
    target = overrideDate;
  } else {
    const todayIst = istNow();
    const yesterday = new Date(todayIst.getTime() - 24 * 60 * 60 * 1000);
    target = isoDate(yesterday);
  }
  const from7 = addDays(target, -7);
  const to7 = addDays(target, -1);

  const sb = makeClient(env);

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

  const boEntries = (boRes.data || []) as Entry[];
  const boByEntry = boEntries.map((e) => aggregateBOEntry(e, cfg));
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
  const last7AtpAvg = bo7Tickets > 0 ? bo7Gross / bo7Tickets : 0;       // weighted avg
  const last7OccAvg = bo7Seats   > 0 ? (bo7Tickets / bo7Seats) * 100 : 0;
  const last7SphAvg = bo7Tickets > 0 ? fb7Net / bo7Tickets : 0;

  const allScreens: string[] = (cfg.screens || []).map((s) => s.name || s.id).filter(Boolean);
  const screensWithData = new Set(boByEntry.map((r) => r.screenName));
  const missingScreens = allScreens.filter((n) => !screensWithData.has(n));

  const totalTickets = boByEntry.reduce((s, r) => s + r.tickets, 0);
  const fbNet = fbForDay ? fbForDay.net : 0;
  const subject = `Abhinaya — ${fmtDate(target)} · ${fmtInt(totalTickets)} tickets · ${fmtINR(fbNet)} F&B`;
  const bodyHtml = renderBody({ targetDate: target, boByEntry, fbForDay, last7BoTicketsPerDay, last7FbNetPerDay, last7AtpAvg, last7OccAvg, last7SphAvg, missingScreens, noBoAtAll });
  const html = emailShell({ eyebrow: "Daily Digest", title: fmtDate(target), subtitle: cinemaName, bodyHtml });
  const text = plainText({ targetDate: target, cinemaName, boByEntry, fbForDay, last7BoTicketsPerDay, last7FbNetPerDay, last7AtpAvg, last7OccAvg, last7SphAvg, missingScreens, noBoAtAll });

  if (dry) {
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  const send = await sendEmail(env, subject, html, text);
  if (!send.ok) return new Response("Resend error: " + send.error, { status: 500 });

  return new Response(JSON.stringify({ ok: true, target, sentTo: env.toAddr, screens: boByEntry.length, fb: !!fbForDay, missingScreens }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};

// 7:00 AM IST every day = 01:30 UTC
export const config: Config = {
  schedule: "30 1 * * *",
};
