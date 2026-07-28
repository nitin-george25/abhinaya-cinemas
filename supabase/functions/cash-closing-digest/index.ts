// ============================================================================
// Abhinaya Cinemas — Cash Closing Digest (Supabase Edge Function)
//
// The morning cash counterpart to daily-digest. Where the DCR digest answers
// "what did we sell?", this one answers "where is the money?" for the previous
// business day:
//   • Daily manager view  — total sale, cash to bank, non-cash, net discrepancy
//   • By unit             — Box Office vs F&B (operating_units.kind)
//   • By cashier          — sale, cash, discrepancy, signoff status
//   • Petty expenses      — approved spend for the day + anything still pending
//
// Schedule: invoked by pg_cron every day at 7:00 AM IST (01:30 UTC).
// See supabase/migrations/20260727000000_cash_closing_digest_cron.sql.
//
// NO math is duplicated from the console. actual_total and discrepancy are
// generated columns in daily_cash_closings (cash_19); petty_expenses_paid is
// maintained by a trigger (cash_03). We only sum what Postgres already
// computed. The one derived figure is "cash to deposit", which mirrors
// app/src/pages/reports/CashClosing.tsx exactly: cash counted minus one
// default_float_amount per unit that closed today.
//
// LAYOUT: this email is read on phones first (managers open it before they
// reach the office), so no table exceeds 4 columns and secondary figures live
// in sublines under the primary value rather than in their own columns. That
// layout is legible at 320px with CSS entirely disabled — the @media block in
// emailShell() only softens padding and stacks the tiles, so Outlook desktop
// and other clients that drop <style> still render something readable.
// ============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@4.0.0";

// ---------- types ----------
type Closing = {
  id: string;
  operating_unit_id: string;
  pos_counter_id: string;
  business_date: string;
  shift: string;
  cashier_email: string | null;
  closed_by_email: string | null;
  pos_total_sales: number | string | null;
  pos_non_cash_total: number | string | null;
  cash_counted: number | string | null;
  petty_expenses_paid: number | string | null;
  non_cash_actual_total: number | string | null;
  actual_total: number | string | null;
  discrepancy: number | string | null;
  status: string;
  notes: string | null;
};
type Unit = {
  id: string;
  name: string | null;
  kind: string | null;
  display_order: number | null;
  default_float_amount: number | string | null;
  archived_at: string | null;
};
type Counter = { id: string; name: string | null; operating_unit_id: string; archived_at: string | null };
type Petty = {
  id: string;
  operating_unit_id: string;
  pos_counter_id: string | null;
  expense_date: string;
  amount: number | string | null;
  category: string | null;
  description: string | null;
  paid_to: string | null;
  requested_by_email: string | null;
  status: string;
};
type UserRow = { email: string; full_name: string | null };

// ---------- date helpers (IST = UTC+5:30) ----------
function istNow(): Date { return new Date(Date.now() + 5.5 * 60 * 60 * 1000); }
function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function fmtDate(s: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric" }): string {
  const dt = new Date(s + "T00:00:00Z");
  return dt.toLocaleDateString("en-IN", { ...opts, timeZone: "UTC" });
}

// ---------- format helpers ----------
function num(v: unknown): number { const n = Number(v ?? 0); return isFinite(n) ? n : 0; }
function fmtInt(n: number): string { if (!isFinite(n)) return "0"; return Math.round(n).toLocaleString("en-IN"); }
function fmtINR(n: number): string {
  if (!isFinite(n)) return "₹0";
  const r = Math.round(n);
  return (r < 0 ? "−₹" : "₹") + Math.abs(r).toLocaleString("en-IN");
}
/** Discrepancy is signed: positive = excess, negative = short (cash_19). */
function fmtDisc(n: number): string {
  const r = Math.round(n);
  if (r === 0) return "₹0";
  return (r > 0 ? "+₹" : "−₹") + Math.abs(r).toLocaleString("en-IN");
}
function discColor(n: number): string {
  const r = Math.round(n);
  return r === 0 ? "#111" : r > 0 ? "#047857" : "#b91c1c";
}
function titleCase(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]!));
}

// ---------- cell chrome ----------
// Class + style live together so every cell picks up the mobile overrides.
const HL = `class="hdr" style="padding:10px 8px;text-align:left"`;
const HR = `class="hdr" style="padding:10px 8px;text-align:right"`;
const CL = `class="cell" style="padding:11px 8px;border-bottom:1px solid #eee;vertical-align:top"`;
const CR = `class="cell" style="padding:11px 8px;border-bottom:1px solid #eee;text-align:right;vertical-align:top"`;
const FL = `class="cell" style="padding:10px 8px;vertical-align:top"`;
const FR = `class="cell" style="padding:10px 8px;text-align:right;vertical-align:top"`;

/** Secondary figures ride under the primary value instead of taking a column. */
function sub(html: string): string {
  return `<div class="sub" style="font-size:11px;color:#888;margin-top:3px;line-height:1.45">${html}</div>`;
}
function strong(html: string, color = "#111"): string {
  return `<span style="font-weight:600;color:${color}">${html}</span>`;
}

// ---------- HTML chrome ----------
function emailShell(opts: { eyebrow: string; title: string; subtitle: string; bodyHtml: string }): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<style>
  /* Progressive enhancement only. Everything below is a nicety — the layout
     is already legible at 320px with this block stripped out entirely. */
  @media only screen and (max-width:600px) {
    .wrap  { padding:10px !important; }
    .card  { padding:18px 14px !important; border-radius:10px !important; }
    .title { font-size:20px !important; }
    .tile  { display:block !important; width:100% !important; padding:4px 0 !important; }
    .cell  { padding:10px 6px !important; font-size:13px !important; }
    .hdr   { padding:8px 6px !important; font-size:10px !important; }
    .sub   { font-size:11px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#222;-webkit-text-size-adjust:100%">
  <div class="wrap" style="max-width:640px;margin:0 auto;padding:24px">
    <div class="card" style="background:#fff;border-radius:12px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
      <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.08em;font-weight:600">${escapeHtml(opts.eyebrow)}</div>
      <h1 class="title" style="margin:6px 0 4px;font-size:24px;line-height:1.2;color:#111">${escapeHtml(opts.title)}</h1>
      <div style="color:#666;font-size:14px">${escapeHtml(opts.subtitle)}</div>
      ${opts.bodyHtml}
      <div style="margin-top:28px;padding-top:18px;border-top:1px solid #eee;font-size:12px;color:#888;line-height:1.6">
        Denominations, EDC slips, deposit slips and per-method actuals are on the
        <a href="https://admin.abhinayacinemas.com/cash/closings" style="color:#4f46e5;text-decoration:none;font-weight:500">Cash Closing console</a>.
      </div>
    </div>
    <div style="text-align:center;color:#aaa;font-size:11px;margin-top:14px">
      Automated report — sent at 7:00 AM IST.
    </div>
  </div>
</body></html>`;
}

function warningBlock(msg: string): string {
  return `<div style="background:#fff8e1;border-left:4px solid #f59e0b;padding:12px 14px;border-radius:6px;margin:14px 0;color:#92400e;font-size:14px;line-height:1.5">${msg}</div>`;
}

function h2(s: string): string {
  return `<h2 style="font-size:15px;margin:28px 0 10px;color:#333;font-weight:600">${escapeHtml(s)}</h2>`;
}

function tableOpen(): string {
  return `<table role="presentation" width="100%" style="width:100%;border-collapse:collapse;background:#fafafa;border-radius:6px;overflow:hidden">`;
}
function headRow(cells: string): string {
  return `<thead><tr style="background:#f0f0f0;font-size:11px;text-transform:uppercase;color:#666;letter-spacing:.05em">${cells}</tr></thead>`;
}

// ---------- aggregation shapes ----------
type Agg = {
  sale: number; cash: number; nonCash: number; petty: number; discrepancy: number;
  count: number; pending: number; disputed: number;
};
function newAgg(): Agg {
  return { sale: 0, cash: 0, nonCash: 0, petty: 0, discrepancy: 0, count: 0, pending: 0, disputed: 0 };
}
function addTo(a: Agg, c: Closing): void {
  a.sale        += num(c.pos_total_sales);
  a.cash        += num(c.cash_counted);
  a.nonCash     += num(c.pos_non_cash_total);
  a.petty       += num(c.petty_expenses_paid);
  a.discrepancy += num(c.discrepancy);
  a.count       += 1;
  if (c.status === "disputed") a.disputed += 1;
  else if (c.status !== "signed" && c.status !== "resolved") a.pending += 1;
}
function statusText(a: Agg): string {
  if (a.disputed > 0) return `<span style="color:#b91c1c">${a.disputed} disputed</span>`;
  if (a.pending > 0)  return `<span style="color:#b45309">${a.pending} pending</span>`;
  return `<span style="color:#047857">signed</span>`;
}

// ---------- body renderer ----------
function renderBody(opts: {
  targetDate: string;
  closings: Closing[];
  units: Unit[];
  unitName: (id: string) => string;
  counterName: (id: string) => string;
  nameOf: (email?: string | null) => string;
  petty: Petty[];
  floatRetained: number;
  unitsWithoutClosing: string[];
}): string {
  const { targetDate, closings, units, unitName, counterName, nameOf, petty, floatRetained, unitsWithoutClosing } = opts;

  const totals = newAgg();
  for (const c of closings) addTo(totals, c);
  const cashToDeposit = totals.cash - floatRetained;

  if (closings.length === 0) {
    return `${warningBlock(`<b>No cash closings were recorded for ${escapeHtml(fmtDate(targetDate))}.</b> Every till is unaccounted for — check with the daily manager before the day's cash moves.`)}
      ${pettySection(petty, nameOf, unitName, targetDate)}`;
  }

  // ── headline tiles ────────────────────────────────────────────────────
  // 2×2 on desktop; the .tile class stacks them to one column on phones.
  // If the client drops <style>, 2×2 at 160px per tile still reads fine.
  const tile = (label: string, value: string, hint: string, color: string) => `
    <td class="tile" width="50%" style="padding:6px" valign="top">
      <div style="background:#fafafa;border-radius:6px;padding:12px">
        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em">${escapeHtml(label)}</div>
        <div style="font-size:19px;font-weight:700;margin-top:3px;color:${color}">${value}</div>
        <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.4">${hint}</div>
      </div>
    </td>`;

  const tiles = `
    <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;margin-top:6px">
      <tr>
        ${tile("Total sale", fmtINR(totals.sale), `${fmtInt(totals.count)} closing${totals.count === 1 ? "" : "s"}`, "#111")}
        ${tile("Cash to deposit", fmtINR(cashToDeposit),
               floatRetained > 0
                 ? `Counted ${escapeHtml(fmtINR(totals.cash))}<br>less float ${escapeHtml(fmtINR(floatRetained))}`
                 : `Cash counted ${escapeHtml(fmtINR(totals.cash))}`,
               "#047857")}
      </tr>
      <tr>
        ${tile("Non-cash", fmtINR(totals.nonCash), "Card / UPI / online", "#111")}
        ${tile("Discrepancy", fmtDisc(totals.discrepancy),
               totals.discrepancy === 0 ? "Tallied" : totals.discrepancy > 0 ? "Excess" : "Short",
               discColor(totals.discrepancy))}
      </tr>
    </table>`;

  // ── by unit (Box Office / F&B) ────────────────────────────────────────
  // 4 columns. Non-cash and petty ride as a subline under the unit name.
  const byUnit = new Map<string, Agg>();
  for (const c of closings) {
    let a = byUnit.get(c.operating_unit_id);
    if (!a) { a = newAgg(); byUnit.set(c.operating_unit_id, a); }
    addTo(a, c);
  }
  const unitOrder = new Map(units.map((u, i) => [u.id, u.display_order ?? i]));
  const unitRows = Array.from(byUnit.entries())
    .sort((x, y) => (unitOrder.get(x[0]) ?? 999) - (unitOrder.get(y[0]) ?? 999))
    .map(([id, a]) => `
      <tr>
        <td ${CL}>${strong(escapeHtml(unitName(id)))}
          ${sub(`Non-cash ${fmtINR(a.nonCash)} · Petty ${fmtINR(a.petty)}`)}
        </td>
        <td ${CR}>${fmtINR(a.sale)}</td>
        <td ${CR}>${fmtINR(a.cash)}</td>
        <td ${CR}><span style="color:${discColor(a.discrepancy)}">${fmtDisc(a.discrepancy)}</span></td>
      </tr>`).join("");

  const unitTable = `
    ${tableOpen()}
      ${headRow(`
        <th ${HL}>Unit</th>
        <th ${HR}>Sale</th>
        <th ${HR}>Cash</th>
        <th ${HR}>Disc.</th>`)}
      <tbody>${unitRows}</tbody>
      <tfoot><tr style="background:#f0f0f0;font-weight:600">
        <td ${FL}>Total${sub(`Non-cash ${fmtINR(totals.nonCash)} · Petty ${fmtINR(totals.petty)}`)}</td>
        <td ${FR}>${fmtINR(totals.sale)}</td>
        <td ${FR}>${fmtINR(totals.cash)}</td>
        <td ${FR}><span style="color:${discColor(totals.discrepancy)}">${fmtDisc(totals.discrepancy)}</span></td>
      </tr></tfoot>
    </table>`;

  // ── by cashier ────────────────────────────────────────────────────────
  // 3 columns: who (+ counters), sale (+ cash/non-cash split), disc (+ status).
  type CashierAgg = Agg & { email: string | null; counters: Set<string> };
  const byCashier = new Map<string, CashierAgg>();
  for (const c of closings) {
    const email = c.cashier_email ?? c.closed_by_email ?? null;
    const key = (email ?? "—").toLowerCase();
    let a = byCashier.get(key);
    if (!a) { a = { ...newAgg(), email, counters: new Set<string>() }; byCashier.set(key, a); }
    addTo(a, c);
    a.counters.add(counterName(c.pos_counter_id));
  }
  const cashierRows = Array.from(byCashier.values())
    .sort((x, y) => y.sale - x.sale)
    .map((a) => `
      <tr>
        <td ${CL}>${strong(escapeHtml(nameOf(a.email)))}
          ${sub(escapeHtml(Array.from(a.counters).join(", ")))}
        </td>
        <td ${CR}>${fmtINR(a.sale)}
          ${sub(`Cash ${fmtINR(a.cash)} · Non-cash ${fmtINR(a.nonCash)}`)}
        </td>
        <td ${CR}><span style="color:${discColor(a.discrepancy)}">${fmtDisc(a.discrepancy)}</span>
          ${sub(statusText(a))}
        </td>
      </tr>`).join("");

  const cashierTable = `
    ${tableOpen()}
      ${headRow(`
        <th ${HL}>Cashier</th>
        <th ${HR}>Sale</th>
        <th ${HR}>Disc.</th>`)}
      <tbody>${cashierRows}</tbody>
    </table>`;

  // ── warnings ──────────────────────────────────────────────────────────
  const warnings: string[] = [];
  if (unitsWithoutClosing.length) {
    warnings.push(warningBlock(
      `<b>Heads up:</b> ${escapeHtml(unitsWithoutClosing.join(", "))} ${unitsWithoutClosing.length === 1 ? "has" : "have"} no cash closing for ${escapeHtml(fmtDate(targetDate))}.`,
    ));
  }
  if (totals.disputed > 0) {
    warnings.push(warningBlock(
      `<b>${totals.disputed} closing${totals.disputed === 1 ? " is" : "s are"} disputed.</b> Resolve before the cash is banked.`,
    ));
  }
  if (totals.pending > 0) {
    warnings.push(warningBlock(
      `<b>${totals.pending} closing${totals.pending === 1 ? "" : "s"} still awaiting signoff.</b> Cashier confirmation is pending.`,
    ));
  }

  return `
    ${warnings.join("")}
    ${tiles}
    ${h2("By unit")}
    ${unitTable}
    ${h2("By cashier")}
    ${cashierTable}
    ${pettySection(petty, nameOf, unitName, targetDate)}`;
}

// ---------- petty expenses ----------
// 2 columns: what (+ unit / payee / category subline) and amount.
function pettySection(
  petty: Petty[],
  nameOf: (email?: string | null) => string,
  unitName: (id: string) => string,
  targetDate: string,
): string {
  const approved = petty.filter((p) => p.status === "approved");
  const pending  = petty.filter((p) => p.status === "pending");
  const approvedTotal = approved.reduce((s, p) => s + num(p.amount), 0);
  const pendingTotal  = pending.reduce((s, p) => s + num(p.amount), 0);

  const pendingWarn = pending.length
    ? warningBlock(`<b>${pending.length} petty expense${pending.length === 1 ? "" : "s"} awaiting approval</b> (${escapeHtml(fmtINR(pendingTotal))}). These are not in the closing figures above.`)
    : "";

  if (approved.length === 0) {
    return `${h2("Petty expenses")}
      ${pendingWarn}
      ${tableOpen()}
        <tr><td class="cell" style="padding:12px;color:#666">No approved petty expenses for ${escapeHtml(fmtDate(targetDate))}.</td></tr>
      </table>`;
  }

  const rows = approved
    .sort((a, b) => num(b.amount) - num(a.amount))
    .map((p) => {
      const what = p.description || p.category || "—";
      const who  = p.paid_to ? `Paid to ${p.paid_to}` : `By ${nameOf(p.requested_by_email)}`;
      const meta = [unitName(p.operating_unit_id), p.category ? titleCase(p.category) : null, who]
        .filter(Boolean).map((s) => escapeHtml(String(s))).join(" · ");
      return `
      <tr>
        <td ${CL}>${strong(escapeHtml(what))}${sub(meta)}</td>
        <td ${CR}>${strong(fmtINR(num(p.amount)))}</td>
      </tr>`;
    }).join("");

  return `${h2("Petty expenses")}
    ${pendingWarn}
    ${tableOpen()}
      ${headRow(`
        <th ${HL}>Expense</th>
        <th ${HR}>Amount</th>`)}
      <tbody>${rows}</tbody>
      <tfoot><tr style="background:#f0f0f0;font-weight:600">
        <td ${FL}>Total approved</td>
        <td ${FR}>${fmtINR(approvedTotal)}</td>
      </tr></tfoot>
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
  const toAddr = Deno.env.get("CASH_DIGEST_TO")
    || Deno.env.get("DIGEST_TO")
    || "nitin.george@abhinayacinemas.com,ajim20@hotmail.com,shinu.thomas@abhinayacinemas.com";
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

  const sb: SupabaseClient = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  const [closeRes, unitRes, counterRes, pettyRes, userRes, cfgRes] = await Promise.all([
    sb.from("daily_cash_closings").select("*").eq("business_date", target),
    sb.from("operating_units").select("id, name, kind, display_order, default_float_amount, archived_at").order("display_order"),
    sb.from("pos_counters").select("id, name, operating_unit_id, archived_at"),
    sb.from("petty_expenses").select("*").eq("expense_date", target),
    sb.from("authorized_users").select("email, full_name"),
    sb.from("config").select("data").eq("id", 1).maybeSingle(),
  ]);

  if (closeRes.error)   return new Response("daily_cash_closings query: " + closeRes.error.message, { status: 500 });
  if (unitRes.error)    return new Response("operating_units query: " + unitRes.error.message, { status: 500 });
  if (counterRes.error) return new Response("pos_counters query: " + counterRes.error.message, { status: 500 });
  if (pettyRes.error)   return new Response("petty_expenses query: " + pettyRes.error.message, { status: 500 });

  const closings = (closeRes.data || []) as Closing[];
  const units    = (unitRes.data || []) as Unit[];
  const counters = (counterRes.data || []) as Counter[];
  const petty    = (pettyRes.data || []) as Petty[];
  const users    = (userRes.data || []) as UserRow[];
  const cinemaName = (cfgRes.data?.data as { cinema?: { name?: string } } | null)?.cinema?.name
    || "Abhinaya Cinemas, Changanacherry";

  // Lookups. Archived units/counters still appear on old rows, so name from the
  // full list and only use the active list for the "who didn't close?" check.
  const unitById = new Map(units.map((u) => [u.id, u]));
  const unitName = (id: string) => unitById.get(id)?.name || "(unknown unit)";
  const counterById = new Map(counters.map((c) => [c.id, c]));
  const counterName = (id: string) => counterById.get(id)?.name || "—";
  const nameByEmail = new Map(users.filter((u) => u.email).map((u) => [u.email.toLowerCase(), u.full_name || u.email]));
  const nameOf = (email?: string | null) => (email ? nameByEmail.get(email.toLowerCase()) ?? email : "—");

  // Cash to deposit: each till retains its float once at deposit time, so net
  // cash to bank = counted − one default_float_amount per unit that closed.
  const unitIdsWithClosing = new Set(closings.map((c) => c.operating_unit_id));
  let floatRetained = 0;
  for (const id of unitIdsWithClosing) floatRetained += num(unitById.get(id)?.default_float_amount);

  const unitsWithoutClosing = units
    .filter((u) => !u.archived_at && !unitIdsWithClosing.has(u.id))
    .map((u) => u.name || u.id);

  const totalSale = closings.reduce((s, c) => s + num(c.pos_total_sales), 0);
  const totalCash = closings.reduce((s, c) => s + num(c.cash_counted), 0);
  const totalDisc = closings.reduce((s, c) => s + num(c.discrepancy), 0);
  const cashToDeposit = totalCash - floatRetained;

  const discPart = Math.round(totalDisc) === 0 ? "tallied" : `${fmtDisc(totalDisc)} disc.`;
  const subject = closings.length === 0
    ? `Cash closing — ${fmtDate(target)} · no closings recorded`
    : `Cash closing — ${fmtDate(target)} · ${fmtINR(totalSale)} sale · ${fmtINR(cashToDeposit)} to bank · ${discPart}`;

  const bodyHtml = renderBody({
    targetDate: target, closings, units, unitName, counterName, nameOf,
    petty, floatRetained, unitsWithoutClosing,
  });
  const html = emailShell({
    eyebrow: "Cash Closing",
    title: fmtDate(target),
    subtitle: cinemaName,
    bodyHtml,
  });

  if (dry) {
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  const resend = new Resend(resendKey);
  const { error } = await resend.emails.send({ from: fromAddr, to: toAddrs, subject, html });
  if (error) return new Response("Resend error: " + JSON.stringify(error), { status: 500 });

  return new Response(JSON.stringify({
    ok: true, target, sentTo: toAddrs,
    closings: closings.length, petty: petty.length, unitsWithoutClosing,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
});
