// ============================================================================
// Shared helpers for the daily + weekly digest functions.
// Underscore-prefixed folder = not exposed as an endpoint by Netlify.
// ============================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";

// ---------- environment ----------
export type DigestEnv = {
  supabaseUrl: string;
  supabaseKey: string;
  resendKey: string;
  fromAddr: string;
  toAddr: string;
};

export function readEnv(): DigestEnv | { error: string } {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const resendKey = process.env.RESEND_API_KEY || "";
  const fromAddr = process.env.DIGEST_FROM || "Abhinaya DCR <noreply@mail.abhinayacinemas.com>";
  const toAddr = process.env.DIGEST_TO || "nitin.george@abhinayacinemas.com";
  if (!supabaseUrl || !supabaseKey) {
    return { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env var" };
  }
  return { supabaseUrl, supabaseKey, resendKey, fromAddr, toAddr };
}

export function makeClient(env: DigestEnv): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabaseKey, { auth: { persistSession: false } });
}

// ---------- date helpers (IST = UTC+5:30) ----------
export function istNow(): Date {
  const now = new Date();
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
}
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(dateStr: string, n: number): string {
  const dt = new Date(dateStr + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
export function fmtDate(dateStr: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric" }): string {
  const dt = new Date(dateStr + "T00:00:00Z");
  return dt.toLocaleDateString("en-IN", { ...opts, timeZone: "UTC" });
}
export function fmtDateRange(fromDate: string, toDate: string): string {
  // "25 May – 31 May 2026" (compact range)
  const fromDt = new Date(fromDate + "T00:00:00Z");
  const toDt = new Date(toDate + "T00:00:00Z");
  const sameMonth = fromDt.getUTCMonth() === toDt.getUTCMonth() && fromDt.getUTCFullYear() === toDt.getUTCFullYear();
  if (sameMonth) {
    const left = fromDt.toLocaleDateString("en-IN", { day: "numeric", timeZone: "UTC" });
    const right = toDt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    return `${left}–${right}`;
  }
  const left = fromDt.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  const right = toDt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${left} – ${right}`;
}

// ---------- format helpers ----------
export function fmtInt(n: number): string {
  if (!isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-IN");
}
export function fmtINR(n: number): string {
  if (!isFinite(n)) return "₹0";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}
export function fmtPctDelta(curr: number, prev: number): { text: string; color: string; arrow: string } {
  if (prev === 0) return { text: curr === 0 ? "no change" : "new", color: "#666", arrow: "" };
  const pct = ((curr - prev) / prev) * 100;
  if (Math.abs(pct) < 0.5) return { text: "≈ flat", color: "#666", arrow: "→" };
  const up = pct > 0;
  return {
    text: `${up ? "+" : ""}${pct.toFixed(1)}%`,
    color: up ? "#16a34a" : "#dc2626",
    arrow: up ? "▲" : "▼",
  };
}
export function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]!));
}

// ---------- domain types ----------
export type Entry = {
  id: string;
  entry_date: string;
  movie_id: string;
  screen_id: string;
  share?: number;
  shows: any[];
  updated_by?: string;
  updated_at?: string;
};
export type FbEntry = {
  id: string;
  entry_date: string;
  items: any[];
  summary: any;
  notes?: string;
  updated_by?: string;
  updated_at?: string;
};
export type Cfg = {
  cinema?: { name?: string };
  screens?: Array<{ id: string; name?: string }>;
  movies?: Array<{ id: string; name?: string }>;
  [k: string]: any;
};

// ---------- aggregation (no engine math — see comment in daily-digest.ts) ----------
export type BoAgg = {
  date: string;
  movieId: string;
  movieName: string;
  screenName: string;
  tickets: number;
  shows: number;
};
export type FbAgg = {
  date: string;
  bills: number;
  gross: number;
  net: number;
  food: number;
  beverages: number;
};

export function aggregateBOEntry(e: Entry, cfg: Cfg): BoAgg {
  const shows = Array.isArray(e.shows) ? e.shows : [];
  let tickets = 0;
  shows.forEach((sh: any) => {
    const rows = (sh && sh.rows) || {};
    Object.values(rows).forEach((r: any) => {
      tickets += Number(r?.tickets) || 0;
    });
  });
  const movie = (cfg.movies || []).find((m) => m.id === e.movie_id);
  const screen = (cfg.screens || []).find((s) => s.id === e.screen_id);
  return {
    date: e.entry_date,
    movieId: e.movie_id,
    movieName: movie?.name || e.movie_id || "(unknown movie)",
    screenName: screen?.name || e.screen_id || "(unknown screen)",
    tickets,
    shows: shows.length,
  };
}

export function aggregateFB(f: FbEntry): FbAgg {
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
export function emailShell(opts: { eyebrow: string; title: string; subtitle: string; bodyHtml: string }): string {
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

export function warningBlock(msg: string): string {
  return `<div style="background:#fff8e1;border-left:4px solid #f59e0b;padding:12px 14px;border-radius:6px;margin:14px 0;color:#92400e;font-size:14px">${msg}</div>`;
}

// ---------- send wrapper ----------
export async function sendEmail(env: DigestEnv, subject: string, html: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!env.resendKey) return { ok: false, error: "Missing RESEND_API_KEY" };
  const resend = new Resend(env.resendKey);
  const { error } = await resend.emails.send({
    from: env.fromAddr,
    to: [env.toAddr],
    subject,
    html,
    text,
  });
  if (error) return { ok: false, error: JSON.stringify(error) };
  return { ok: true };
}
