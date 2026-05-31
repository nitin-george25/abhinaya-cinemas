// ============================================================================
// On-screen DCR view.
//
// Mirrors the legacy renderDCR() HTML structure: brand header, key/value
// meta block, one card per show with the class-level table, GRAND TOTAL
// strip, Settlement (today) panel, and the cumulative Previous/Today/Total
// table.
//
// Print stylesheet (in app/src/index.css) hides the app shell and shrinks
// padding so "Cmd-P → Save as PDF" produces a reasonable fallback PDF —
// the PRIMARY PDF path is generateDcrPdf() in lib/pdf.ts.
// ============================================================================

import { int, money, fmtTime, weekday } from "../../lib/format";
import type {
  Cinema,
  ComputedEntry,
  CumulativeRow,
  TaxConfig,
} from "../../lib/types";

interface Props {
  computed: ComputedEntry;
  cinema: Cinema;
  tax: TaxConfig;
}

export function DcrView({ computed, cinema, tax }: Props) {
  if (!computed.movie || !computed.screen) {
    return (
      <div className="dcr-page p-8 text-center text-ink-muted">
        Pick a movie and screen first.
      </div>
    );
  }

  const C = computed;
  const g = C.grand;

  return (
    <div className="dcr-page bg-white text-ink mx-auto max-w-[1100px] border border-line rounded-2xl shadow-card overflow-hidden">
      <BrandHeader cinema={cinema} />

      <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <MetaTable
          rows={[
            ["Name of the Picture", C.movie.name],
            ["Name of the Distributor", C.movie.distributor ?? ""],
            ["Screen", C.screen.name],
          ]}
        />
        <MetaTable
          rows={[
            ["Date", C.entry.date ?? ""],
            ["Running Day", String(C.runningDay ?? "")],
            ["Week Day", weekday(C.entry.date)],
          ]}
        />
      </div>

      <div className="px-6 pb-2 space-y-4">
        {C.shows.map((sh, idx) => (
          <ShowBlock key={idx} idx={idx} show={sh} tax={tax} />
        ))}
      </div>

      <div className="px-6 pb-4">
        <GrandRow g={g} />
      </div>

      <div className="px-6 pb-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SettlementPanel C={C} tax={tax} />
        <CumulativePanel previous={C.previous} today={C.today} total={C.total} />
      </div>

      <Foot />
    </div>
  );
}

// ── header ─────────────────────────────────────────────────────────────

function BrandHeader({ cinema }: { cinema: Cinema }) {
  return (
    <header className="border-b border-line">
      <div className="flex h-1.5">
        <div className="flex-1 bg-red-500" />
        <div className="flex-1 bg-amber-400" />
        <div className="flex-1 bg-blue-500" />
      </div>
      <div className="px-6 py-4 flex items-center justify-between gap-6">
        <div>
          <h1 className="text-lg font-bold tracking-wide">{cinema.name}</h1>
          <p className="text-xs text-ink-muted">GSTIN : {cinema.gstin}</p>
        </div>
        <h2 className="text-sm font-bold tracking-wider">DAILY COLLECTION REPORT</h2>
      </div>
    </header>
  );
}

// ── meta key/value tables ──────────────────────────────────────────────

function MetaTable({ rows }: { rows: Array<[string, string]> }) {
  return (
    <table className="w-full text-sm border border-line">
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={i} className="border-b border-line last:border-b-0">
            <td className="bg-paper px-3 py-1.5 font-semibold w-2/5 align-top">{k}</td>
            <td className="px-3 py-1.5">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── one show block ─────────────────────────────────────────────────────

function ShowBlock({
  idx,
  show,
  tax,
}: {
  idx: number;
  show: ComputedEntry["shows"][number];
  tax: TaxConfig;
}) {
  return (
    <section className="border border-line rounded-md overflow-hidden">
      <div className="bg-ink text-white px-3 py-1.5 text-xs font-semibold tracking-wider flex justify-between">
        <span>
          SHOW {idx + 1} · SHOW TIME {fmtTime(show.showtime) || "—"}
          {show.card ? "  ·  " + show.card.name : ""}
        </span>
        <span>No. of Free Pass: {show.freePass ?? 0}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="bg-paper text-ink">
              <th className="text-left px-2 py-1.5 font-semibold">Class</th>
              <th className="text-right px-2 py-1.5 font-semibold">Total Seats</th>
              <th className="text-right px-2 py-1.5 font-semibold">POA</th>
              <th className="text-right px-2 py-1.5 font-semibold" colSpan={2}>
                Sl.no of Tickets Sold
              </th>
              <th className="text-right px-2 py-1.5 font-semibold">Tkts</th>
              <th className="text-right px-2 py-1.5 font-semibold">Gross</th>
              <th className="text-right px-2 py-1.5 font-semibold">Total POA</th>
              <th className="text-right px-2 py-1.5 font-semibold">TMC ₹{tax.tmc}</th>
              <th className="text-right px-2 py-1.5 font-semibold">Cess ₹{tax.cess}</th>
              <th className="text-right px-2 py-1.5 font-semibold">E-Tax</th>
              <th className="text-right px-2 py-1.5 font-semibold">Total</th>
              <th className="text-right px-2 py-1.5 font-semibold">GST</th>
            </tr>
            <tr className="bg-paper text-ink-muted text-[10px]">
              <th /> <th /> <th />
              <th className="text-right px-2 pb-1">From</th>
              <th className="text-right px-2 pb-1">To</th>
              <th /> <th /> <th /> <th /> <th /> <th /> <th /> <th />
            </tr>
          </thead>
          <tbody>
            {show.rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                <td className="px-2 py-1 font-medium">{r.cls}</td>
                <td className="px-2 py-1 text-right">{int(r.seats)}</td>
                <td className="px-2 py-1 text-right">{money(r.poa)}</td>
                <td className="px-2 py-1 text-right">{r.from === "" || r.from == null ? "" : int(r.from)}</td>
                <td className="px-2 py-1 text-right">{r.to === "NA" ? "NA" : r.to === "" || r.to == null ? "" : int(r.to)}</td>
                <td className="px-2 py-1 text-right">{int(r.tickets)}</td>
                <td className="px-2 py-1 text-right">{money(r.grossColl)}</td>
                <td className="px-2 py-1 text-right">{money(r.totalPOA)}</td>
                <td className="px-2 py-1 text-right">{money(r.tmc)}</td>
                <td className="px-2 py-1 text-right">{money(r.cess)}</td>
                <td className="px-2 py-1 text-right">{money(r.etax)}</td>
                <td className="px-2 py-1 text-right">{money(r.total)}</td>
                <td className="px-2 py-1 text-right">{money(r.gst)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-line bg-paper font-semibold">
              <td className="px-2 py-1.5" colSpan={5}>Total</td>
              <td className="px-2 py-1.5 text-right">{int(show.totals.tickets)}</td>
              <td className="px-2 py-1.5 text-right">{money(show.totals.grossColl)}</td>
              <td className="px-2 py-1.5 text-right">{money(show.totals.totalPOA)}</td>
              <td className="px-2 py-1.5 text-right">{money(show.totals.tmc)}</td>
              <td className="px-2 py-1.5 text-right">{money(show.totals.cess)}</td>
              <td className="px-2 py-1.5 text-right">{money(show.totals.etax)}</td>
              <td className="px-2 py-1.5 text-right">{money(show.totals.total)}</td>
              <td className="px-2 py-1.5 text-right">{money(show.totals.gst)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── grand total strip ──────────────────────────────────────────────────

function GrandRow({ g }: { g: ComputedEntry["grand"] }) {
  return (
    <table className="w-full text-xs tabular-nums border border-line">
      <tbody>
        <tr className="bg-amber-400 font-bold">
          <td className="px-2 py-2 text-right" colSpan={5}>GRAND TOTAL</td>
          <td className="px-2 py-2 text-right">{int(g.tickets)}</td>
          <td className="px-2 py-2 text-right">{money(g.grossColl)}</td>
          <td className="px-2 py-2 text-right">{money(g.totalPOA)}</td>
          <td className="px-2 py-2 text-right">{money(g.tmc)}</td>
          <td className="px-2 py-2 text-right">{money(g.cess)}</td>
          <td className="px-2 py-2 text-right">{money(g.etax)}</td>
          <td className="px-2 py-2 text-right">{money(g.total)}</td>
          <td className="px-2 py-2 text-right">{money(g.gst)}</td>
        </tr>
      </tbody>
    </table>
  );
}

// ── settlement panel ───────────────────────────────────────────────────

function SettlementPanel({ C, tax }: { C: ComputedEntry; tax: TaxConfig }) {
  const sp = C.share;
  return (
    <div>
      <table className="w-full text-sm border border-line tabular-nums">
        <thead>
          <tr className="bg-ink text-white">
            <th className="px-3 py-2 text-center font-semibold" colSpan={2}>
              Settlement (today)
            </th>
          </tr>
        </thead>
        <tbody>
          <SettleRow label="Total GST"    value={money(C.grand.gst)} />
          <SettleRow label="Rep. Batta"   value={money(C.today.repBatta)} />
          <SettleRow label="Fund"         value={money(C.fund)} />
          <SettleRow label="Net Share"    value={money(C.today.netShare)} highlight />
          <SettleRow label={`DS - Distributor (${sp}%)`} value={money(C.today.distShare)} />
          <SettleRow label={`ES - Exhibitor (${100 - sp}%)`} value={money(C.today.exShare)} />
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-ink-muted leading-snug border border-dashed border-line rounded-md p-3">
        <strong className="text-ink">TERMS:</strong> Net Share = Gross − GST − TMC − Cess − E-Tax − Fund − Rep.Batta.
        DS/ES split on Net Share. E-Tax/GST by ticket price:
        {" "}&gt; ₹{tax.threshold}: {tax.above.etaxPct}% E-Tax / {tax.above.gstPct}% GST;
        {" "}≤ ₹{tax.threshold}: {tax.below.etaxPct}% / {tax.below.gstPct}%.
      </p>
    </div>
  );
}

function SettleRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <tr className="border-t border-line">
      <td className="bg-paper px-3 py-1.5 font-semibold w-3/5">{label}</td>
      <td className={"px-3 py-1.5 text-right " + (highlight ? "font-semibold" : "")}>
        {value}
      </td>
    </tr>
  );
}

// ── cumulative panel ───────────────────────────────────────────────────

function CumulativePanel({
  previous,
  today,
  total,
}: {
  previous: CumulativeRow;
  today: CumulativeRow;
  total: CumulativeRow;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] tabular-nums border border-line">
        <thead>
          <tr className="bg-ink text-white">
            <th className="px-2 py-1.5 text-left font-semibold">Period</th>
            <th className="px-2 py-1.5 text-right font-semibold">Gross Coll</th>
            <th className="px-2 py-1.5 text-right font-semibold">TMC</th>
            <th className="px-2 py-1.5 text-right font-semibold">Cess</th>
            <th className="px-2 py-1.5 text-right font-semibold">Fund</th>
            <th className="px-2 py-1.5 text-right font-semibold">Rep.Batta</th>
            <th className="px-2 py-1.5 text-right font-semibold">Net Share</th>
            <th className="px-2 py-1.5 text-right font-semibold">Dist.Share</th>
            <th className="px-2 py-1.5 text-right font-semibold">Ex.Share</th>
            <th className="px-2 py-1.5 text-right font-semibold">E-Tax</th>
            <th className="px-2 py-1.5 text-right font-semibold">Total GST</th>
            <th className="px-2 py-1.5 text-right font-semibold">Audience</th>
          </tr>
        </thead>
        <tbody>
          <CumRow label="Previous" o={previous} />
          <CumRow label="Today's"  o={today} />
          <CumRow label="Total"    o={total} shade />
        </tbody>
      </table>
    </div>
  );
}

function CumRow({ label, o, shade }: { label: string; o: CumulativeRow; shade?: boolean }) {
  return (
    <tr className={"border-t border-line " + (shade ? "bg-paper font-semibold" : "")}>
      <td className="px-2 py-1.5">{label}</td>
      <td className="px-2 py-1.5 text-right">{money(o.grossColl)}</td>
      <td className="px-2 py-1.5 text-right">{money(o.tmc)}</td>
      <td className="px-2 py-1.5 text-right">{money(o.cess)}</td>
      <td className="px-2 py-1.5 text-right">{money(o.fund)}</td>
      <td className="px-2 py-1.5 text-right">{money(o.repBatta)}</td>
      <td className="px-2 py-1.5 text-right">{money(o.netShare)}</td>
      <td className="px-2 py-1.5 text-right">{money(o.distShare)}</td>
      <td className="px-2 py-1.5 text-right">{money(o.exShare)}</td>
      <td className="px-2 py-1.5 text-right">{money(o.etax)}</td>
      <td className="px-2 py-1.5 text-right">{money(o.gst)}</td>
      <td className="px-2 py-1.5 text-right">{int(o.audience)}</td>
    </tr>
  );
}

// ── footer ─────────────────────────────────────────────────────────────

function Foot() {
  return (
    <footer className="border-t border-line px-6 py-3 flex items-center gap-3">
      <div className="flex gap-0.5">
        <i className="w-1.5 h-3 inline-block bg-red-500" />
        <i className="w-1.5 h-3 inline-block bg-amber-400" />
        <i className="w-1.5 h-3 inline-block bg-blue-500" />
      </div>
      <span className="text-[11px] text-ink-muted">
        Abhinaya Cinemas — Daily Collection Report
      </span>
    </footer>
  );
}
