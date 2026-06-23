// ============================================================================
// Route page: /reports/picture-ending — Picture Ending Statement builder.
//
// Pick a finished film → its run is rolled into per-week NET / SHARE using the
// same math as the DCR → fill the settlement inputs (publicity %, TDS, flex
// charge, advances) → preview the credit/debit cascade → export a branded PDF
// + CSV, and persist the statement with a running number.
//
// Advances are stored in distributor_payments (reusable); each generated
// statement is frozen into picture_ending_statements.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";

import { useSync } from "../../lib/hooks/SyncContext";
import { money } from "../../lib/format";
import { downloadCsv } from "../../lib/csv";
import {
  buildPictureEnding,
  defaultPictureEndingInputs,
  type PictureEndingInputs,
} from "../../lib/pictureEnding";
import { downloadPictureEndingPdf } from "../../lib/pictureEndingPdf";
import { pictureEndingCsvRows, pictureEndingCsvFilename } from "../../lib/pictureEndingCsv";
import { getCinemaProfile, type CinemaProfile } from "../../lib/cinemaProfile";
import {
  listDistributorPayments,
  addDistributorPayment,
  deleteDistributorPayment,
} from "../../lib/distributorPayments";
import {
  savePictureEndingStatement,
  listPictureEndingStatements,
  type SavedPictureEndingStatement,
} from "../../lib/pictureEndingStatements";
import { LOGO_DATA_URL } from "../../assets/logo";
import type { Movie } from "../../lib/types";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Field, Input, Select } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";

const inr = (x: number) => "₹" + (money(x) || "0.00");

const MODES = ["rtgs", "neft", "imps", "upi", "cheque", "cash", "adjustment"];

export default function ReportsPictureEndingPage() {
  const { state } = useSync();
  const appState = state.appState;
  const cinemaId = state.cinemaId;
  const email = state.email ?? "system";

  const [profile, setProfile] = useState<CinemaProfile | null>(null);
  const [movieId, setMovieId] = useState<string>("");
  const [inputs, setInputs] = useState<PictureEndingInputs | null>(null);
  const [saved, setSaved] = useState<SavedPictureEndingStatement[]>([]);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  // Movies that actually ran (have entries), newest first.
  const movies = useMemo<Movie[]>(() => {
    if (!appState) return [];
    const withRuns = new Set(appState.entries.map((e) => e.movieId));
    return appState.movies
      .filter((m) => withRuns.has(m.id))
      .sort((a, b) => (b.release ?? "").localeCompare(a.release ?? ""));
  }, [appState]);

  const movie = movies.find((m) => m.id === movieId);
  const distributor = appState?.distributors.find((d) => d.id === movie?.distributorId);

  // Load the cinema profile once (statement header needs the full identity).
  useEffect(() => {
    if (!cinemaId) return;
    void getCinemaProfile(cinemaId).then(setProfile);
  }, [cinemaId]);

  const reloadSaved = useCallback(async () => {
    if (!cinemaId) return;
    setSaved(await listPictureEndingStatements(cinemaId));
  }, [cinemaId]);
  useEffect(() => { void reloadSaved(); }, [reloadSaved]);

  // On movie change, seed inputs from defaults + pull its advances.
  useEffect(() => {
    if (!movie || !cinemaId) { setInputs(null); return; }
    const base = defaultPictureEndingInputs(profile?.gstin ?? appState?.cinema.gstin, distributor, {
      theatreName: profile?.name ?? appState?.cinema.name,
    });
    setInputs(base);
    void listDistributorPayments(cinemaId, { movieId: movie.id }).then((pays) => {
      setInputs((cur) =>
        cur
          ? {
              ...cur,
              advances: pays.map((p) => ({
                id: p.id,
                paidOn: p.paidOn,
                amount: p.amount,
                mode: p.mode,
                ref: p.instrumentRef,
                bank: p.bank,
                note: p.note,
              })),
            }
          : cur,
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movieId]);

  const computed = useMemo(() => {
    if (!appState || !movie || !inputs) return null;
    return buildPictureEnding(appState, movie.id, inputs);
  }, [appState, movie, inputs]);

  function patch(p: Partial<PictureEndingInputs>) {
    setInputs((cur) => (cur ? { ...cur, ...p } : cur));
  }
  function num(v: string): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  // ── advances (persisted to distributor_payments) ──
  const [adv, setAdv] = useState({ paidOn: "", amount: "", mode: "rtgs", ref: "", bank: "" });
  async function addAdvance() {
    if (!cinemaId || !movie || !adv.paidOn || !num(adv.amount)) return;
    setBusy(true);
    try {
      await addDistributorPayment(
        cinemaId,
        {
          distributorId: movie.distributorId ?? null,
          movieId: movie.id,
          paidOn: adv.paidOn,
          amount: num(adv.amount),
          mode: adv.mode,
          instrumentRef: adv.ref || null,
          bank: adv.bank || null,
          kind: "advance",
        },
        email,
      );
      const pays = await listDistributorPayments(cinemaId, { movieId: movie.id });
      patch({
        advances: pays.map((p) => ({
          id: p.id, paidOn: p.paidOn, amount: p.amount,
          mode: p.mode, ref: p.instrumentRef, bank: p.bank, note: p.note,
        })),
      });
      setAdv({ paidOn: "", amount: "", mode: "rtgs", ref: "", bank: "" });
    } finally {
      setBusy(false);
    }
  }
  async function removeAdvance(id?: string) {
    if (!id || !cinemaId || !movie) return;
    setBusy(true);
    try {
      await deleteDistributorPayment(id);
      const pays = await listDistributorPayments(cinemaId, { movieId: movie.id });
      patch({
        advances: pays.map((p) => ({
          id: p.id, paidOn: p.paidOn, amount: p.amount,
          mode: p.mode, ref: p.instrumentRef, bank: p.bank, note: p.note,
        })),
      });
    } finally {
      setBusy(false);
    }
  }

  // ── exports + save ──
  function exportPdf(statementNo?: number) {
    if (!computed || !profile) return;
    downloadPictureEndingPdf(computed, { cinema: profile, logoDataUrl: LOGO_DATA_URL, statementNo });
  }
  function exportCsv(statementNo?: number) {
    if (!computed || !profile) return;
    downloadCsv(pictureEndingCsvFilename(computed, statementNo), pictureEndingCsvRows(computed, profile, statementNo));
  }
  async function saveStatement() {
    if (!computed || !cinemaId) return;
    setBusy(true);
    try {
      const rec = await savePictureEndingStatement(cinemaId, computed, email, { status: "final" });
      await reloadSaved();
      setFlash(`Saved as statement #${rec.statementNo}.`);
      exportPdf(rec.statementNo);
    } catch (e) {
      setFlash("Save failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  if (!appState) {
    return <Card><CardBody className="text-sm text-ink-muted">Loading cloud data…</CardBody></Card>;
  }

  const t = computed?.totals;
  const savedForMovie = saved.filter((s) => s.movieId === movieId);

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight">Picture Ending</h2>
        <p className="text-sm text-ink-muted mt-1">
          End-of-run settlement statement for a distributor — weekly share rolled from the DCR,
          plus GST, publicity, TDS, expenses and advances. Exports a branded PDF and CSV.
        </p>
      </div>

      {/* movie picker */}
      <Card>
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 items-end">
          <Field label="Picture">
            <Select value={movieId} onChange={(e) => setMovieId(e.target.value)}>
              <option value="">Select a finished movie…</option>
              {movies.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}{m.release ? ` · ${m.release}` : ""}{m.distributor ? ` · ${m.distributor}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          {movie ? (
            <div className="text-sm text-ink-muted lg:col-span-2">
              <span className="font-medium text-ink">{distributor?.name ?? movie.distributor ?? "No distributor"}</span>
              {distributor?.gstin ? <> · GST {distributor.gstin}</> : null}
              {computed?.runFrom ? <> · ran {computed.runFrom} → {computed.runTo} ({computed.totalDays} days)</> : null}
              {!distributor?.gstin && (distributor || movie.distributorId) ? (
                <span className="text-amber-600"> · add the distributor's GST ID in Settings → Distributors</span>
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {computed && inputs && t ? (
        <>
          {/* inputs */}
          <Card>
            <CardHeader><CardTitle>Statement inputs</CardTitle></CardHeader>
            <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Statement date">
                <Input type="date" value={inputs.statementDate}
                  onChange={(e) => patch({ statementDate: e.target.value })} />
              </Field>
              <Field label="Format (e.g. M-2D)">
                <Input value={inputs.movieFormat ?? ""} placeholder="M-2D"
                  onChange={(e) => patch({ movieFormat: e.target.value })} />
              </Field>
              <Field label="Name of theatre">
                <Input value={inputs.theatreName ?? ""}
                  onChange={(e) => patch({ theatreName: e.target.value })} />
              </Field>
              <Field label="Representative">
                <Input value={inputs.representative ?? ""}
                  onChange={(e) => patch({ representative: e.target.value })} />
              </Field>
              <Field label="GST type" hint="auto from GST state codes">
                <Select value={inputs.taxKind}
                  onChange={(e) => patch({ taxKind: e.target.value as "intra" | "inter" })}>
                  <option value="intra">SGST + CGST (in-state)</option>
                  <option value="inter">IGST (inter-state)</option>
                </Select>
              </Field>
              <Field label="GST % on share">
                <Input type="number" step="0.001" value={inputs.gstPct}
                  onChange={(e) => patch({ gstPct: num(e.target.value) })} />
              </Field>
              <Field label="Publicity % of ex-share">
                <Input type="number" step="0.001" value={inputs.publicityPct}
                  onChange={(e) => patch({ publicityPct: num(e.target.value) })} />
              </Field>
              <Field label="TDS %">
                <Input type="number" step="0.001" value={inputs.tdsPct}
                  onChange={(e) => patch({ tdsPct: num(e.target.value) })} />
              </Field>
              <Field label="Flex display charge (₹)">
                <Input type="number" step="0.01" value={inputs.flexCharge}
                  onChange={(e) => patch({ flexCharge: num(e.target.value) })} />
              </Field>
              <Field label="Round-off">
                <Select value={inputs.roundOffMode}
                  onChange={(e) => patch({ roundOffMode: e.target.value as "auto" | "manual" })}>
                  <option value="auto">Auto (nearest ₹)</option>
                  <option value="manual">Manual</option>
                </Select>
              </Field>
              {inputs.roundOffMode === "manual" ? (
                <Field label="Round-off amount (₹)">
                  <Input type="number" step="0.01" value={inputs.roundOff}
                    onChange={(e) => patch({ roundOff: num(e.target.value) })} />
                </Field>
              ) : null}
              <Field label="Hold-over date" hint="auto-detected">
                <Input value={computed.holdOverDate ?? "—"} readOnly className="bg-paper/60" />
              </Field>
            </CardBody>
          </Card>

          {/* advances */}
          <Card>
            <CardHeader><CardTitle>Advances paid</CardTitle></CardHeader>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-ink-muted border-b border-line">
                      <th className="text-left px-5 py-3 font-semibold w-32">Date</th>
                      <th className="text-left px-5 py-3 font-semibold w-24">Mode</th>
                      <th className="text-left px-5 py-3 font-semibold">Bank / Instrument</th>
                      <th className="text-right px-5 py-3 font-semibold w-32">Amount</th>
                      <th className="px-5 py-3 w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {inputs.advances.length === 0 ? (
                      <tr><td colSpan={5} className="px-5 py-4 text-ink-muted">No advances recorded for this picture.</td></tr>
                    ) : inputs.advances.map((a) => (
                      <tr key={a.id ?? a.paidOn + a.amount} className="border-b border-line">
                        <td className="px-5 py-2 tabular-nums">{a.paidOn}</td>
                        <td className="px-5 py-2 uppercase">{a.mode ?? "—"}</td>
                        <td className="px-5 py-2 text-ink-muted">
                          {[a.bank, a.ref ? "Ch# " + a.ref : ""].filter(Boolean).join(" · ") || "—"}
                        </td>
                        <td className="px-5 py-2 text-right tabular-nums">{inr(a.amount)}</td>
                        <td className="px-5 py-2 text-right">
                          <Button size="sm" variant="ghost" className="text-red-700"
                            disabled={busy} onClick={() => removeAdvance(a.id)}>×</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end p-5 border-t border-line bg-paper/40">
                <Field label="Date"><Input type="date" value={adv.paidOn} onChange={(e) => setAdv({ ...adv, paidOn: e.target.value })} /></Field>
                <Field label="Mode">
                  <Select value={adv.mode} onChange={(e) => setAdv({ ...adv, mode: e.target.value })}>
                    {MODES.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
                  </Select>
                </Field>
                <Field label="Bank"><Input value={adv.bank} placeholder="ICICI Bank" onChange={(e) => setAdv({ ...adv, bank: e.target.value })} /></Field>
                <Field label="Cheque / UTR"><Input value={adv.ref} onChange={(e) => setAdv({ ...adv, ref: e.target.value })} /></Field>
                <div className="flex gap-2">
                  <Field label="Amount (₹)"><Input type="number" step="0.01" value={adv.amount} onChange={(e) => setAdv({ ...adv, amount: e.target.value })} /></Field>
                  <Button className="mb-0.5" disabled={busy || !adv.paidOn || !num(adv.amount)} onClick={addAdvance}>Add</Button>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* preview: weekly + cascade */}
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Weekly run</CardTitle></CardHeader>
              <CardBody className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-ink-muted border-b border-line">
                      <th className="text-left px-4 py-2.5 font-semibold">From</th>
                      <th className="text-left px-4 py-2.5 font-semibold">To</th>
                      <th className="text-right px-4 py-2.5 font-semibold">Days</th>
                      <th className="text-right px-4 py-2.5 font-semibold">Net</th>
                      <th className="text-right px-4 py-2.5 font-semibold">Share %</th>
                      <th className="text-right px-4 py-2.5 font-semibold">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {computed.weeks.map((w) => (
                      <tr key={w.week} className="border-b border-line">
                        <td className="px-4 py-2 tabular-nums">{w.from}</td>
                        <td className="px-4 py-2 tabular-nums">{w.to}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{w.days}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{inr(w.net)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{w.sharePct}%</td>
                        <td className="px-4 py-2 text-right tabular-nums">{inr(w.share)}</td>
                      </tr>
                    ))}
                    <tr className="bg-paper/60 font-semibold">
                      <td className="px-4 py-2">Total</td><td></td>
                      <td className="px-4 py-2 text-right tabular-nums">{computed.totalDays}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{inr(t.net)}</td>
                      <td></td>
                      <td className="px-4 py-2 text-right tabular-nums">{inr(t.share)}</td>
                    </tr>
                  </tbody>
                </table>
              </CardBody>
            </Card>

            <Card>
              <CardHeader><CardTitle>Settlement</CardTitle></CardHeader>
              <CardBody className="p-0">
                <table className="w-full text-sm">
                  <tbody>
                    <LedgerRow label="Total share — taxable value" credit={t.share} />
                    {inputs.taxKind === "inter" ? (
                      <LedgerRow label={`Share IGST @ ${inputs.gstPct}%`} credit={t.shareIgst} />
                    ) : (
                      <>
                        <LedgerRow label={`Share SGST @ ${inputs.gstPct / 2}%`} credit={t.shareSgst} />
                        <LedgerRow label={`Share CGST @ ${inputs.gstPct / 2}%`} credit={t.shareCgst} />
                      </>
                    )}
                    <LedgerRow label={`Publicity — ${inputs.publicityPct}% of ex-share`} debit={t.publicityBase} />
                    {inputs.taxKind === "inter" ? (
                      <LedgerRow label={`Publicity IGST @ ${inputs.gstPct}%`} debit={t.publicityIgst} />
                    ) : (
                      <>
                        <LedgerRow label={`Publicity SGST @ ${inputs.gstPct / 2}%`} debit={t.publicitySgst} />
                        <LedgerRow label={`Publicity CGST @ ${inputs.gstPct / 2}%`} debit={t.publicityCgst} />
                      </>
                    )}
                    <LedgerRow label={`TDS @ ${inputs.tdsPct}% on share + publicity`} debit={t.tds} />
                    {t.flexCharge ? <LedgerRow label="Flex display charge" debit={t.flexCharge} /> : null}
                    {t.advances ? <LedgerRow label="Advances paid" debit={t.advances} muted /> : null}
                    <tr className="border-y border-line bg-paper/60 font-semibold">
                      <td className="px-4 py-2">Total</td>
                      <td className="px-4 py-2 text-right tabular-nums">{inr(t.credit)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{inr(t.debit)}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="flex items-center justify-between px-4 py-3 bg-amber-100/70">
                  <span className="font-semibold">Balance payable to distributor</span>
                  <span className="font-bold tabular-nums text-lg">{inr(t.balance)}</span>
                </div>
                {t.roundOff ? (
                  <p className="px-4 py-1.5 text-[11px] text-ink-muted text-right">
                    includes round-off {inr(t.roundOff)} · gross {inr(t.balanceBeforeRound)}
                  </p>
                ) : null}
              </CardBody>
            </Card>
          </div>

          {/* actions */}
          <Card>
            <CardBody className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" disabled={!profile} onClick={() => exportPdf()}>Export PDF</Button>
              <Button variant="secondary" disabled={!profile} onClick={() => exportCsv()}>Export CSV</Button>
              <Button disabled={busy || !profile} onClick={saveStatement}>Save &amp; number statement</Button>
              {!profile ? <span className="text-sm text-amber-600">Loading cinema profile…</span> : null}
              {flash ? <span className="text-sm text-ink-muted">{flash}</span> : null}
            </CardBody>
          </Card>

          {/* saved statements for this movie */}
          {savedForMovie.length ? (
            <Card>
              <CardHeader><CardTitle>Saved statements</CardTitle></CardHeader>
              <CardBody className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-ink-muted border-b border-line">
                      <th className="text-left px-5 py-2.5 font-semibold w-20">No.</th>
                      <th className="text-left px-5 py-2.5 font-semibold w-32">Date</th>
                      <th className="text-left px-5 py-2.5 font-semibold">Status</th>
                      <th className="text-right px-5 py-2.5 font-semibold">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {savedForMovie.map((s) => (
                      <tr key={s.id} className="border-b border-line">
                        <td className="px-5 py-2 tabular-nums">#{s.statementNo}</td>
                        <td className="px-5 py-2 tabular-nums">{s.statementDate}</td>
                        <td className="px-5 py-2"><Badge tone="neutral">{s.status}</Badge></td>
                        <td className="px-5 py-2 text-right tabular-nums">{inr(s.totals?.balance ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          ) : null}
        </>
      ) : movie ? (
        <Card><CardBody className="text-sm text-ink-muted">No collecting days found for this picture.</CardBody></Card>
      ) : null}
    </div>
  );
}

function LedgerRow({
  label, credit, debit, muted,
}: { label: string; credit?: number; debit?: number; muted?: boolean }) {
  return (
    <tr className="border-b border-line">
      <td className={"px-4 py-2 " + (muted ? "text-ink-muted" : "")}>{label}</td>
      <td className="px-4 py-2 text-right tabular-nums">{credit != null ? "₹" + (money(credit) || "0.00") : ""}</td>
      <td className="px-4 py-2 text-right tabular-nums">{debit != null ? "₹" + (money(debit) || "0.00") : ""}</td>
    </tr>
  );
}
