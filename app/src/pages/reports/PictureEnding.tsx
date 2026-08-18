// ============================================================================
// Route page: /reports/picture-ending — Picture Ending Statement builder.
//
// Pick a finished film AND the screen it played → that screen's run is rolled
// into per-week NET / SHARE using the same math as the DCR → fill the
// settlement inputs (publicity %, TDS, flex charge, advances) → preview the
// credit/debit cascade → export a branded PDF + CSV, and persist the statement
// with a running number.
//
// One statement settles one SCREEN × MOVIE: a film that played two screens is
// settled twice, each on its own run span and hold-over date.
//
// Advances are stored per FILM in distributor_payments (money goes to the
// distributor for the picture, not for an audi), so each statement ticks which
// of them it deducts — that is what stops a two-screen film from having the
// same advance withheld twice. Advances already deducted on another statement
// for the film are flagged and start unticked.
//
// Each generated statement is frozen into picture_ending_statements.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";

import { useSync } from "../../lib/hooks/SyncContext";
import { money } from "../../lib/format";
import { downloadCsv } from "../../lib/csv";
import {
  buildPictureEnding,
  defaultPictureEndingInputs,
  movieScreens,
  type PictureEndingAdvance,
  type PictureEndingComputed,
  type PictureEndingInputs,
} from "../../lib/pictureEnding";
import { downloadPictureEndingPdf, pictureEndingPdfBlob } from "../../lib/pictureEndingPdf";
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
import { Field, Input, Select, SearchSelect } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";

const inr = (x: number) => "₹" + (money(x) || "0.00");

/** YYYY-MM-DD → DD.MM.YYYY, matching the PDF/CSV house style. */
const dmy = (iso?: string | null): string => {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
};

const MODES = ["rtgs", "neft", "imps", "upi", "cheque", "cash", "adjustment"];

/** Stable identity for an advance line (persisted rows always carry an id). */
const advKey = (a: PictureEndingAdvance) => a.id ?? `${a.paidOn}:${a.amount}`;

/** distributor_payments row → the statement's advance shape. */
const toAdvance = (p: {
  id: string; paidOn: string; amount: number;
  mode?: string; instrumentRef?: string; bank?: string; note?: string;
}): PictureEndingAdvance => ({
  id: p.id, paidOn: p.paidOn, amount: p.amount,
  mode: p.mode, ref: p.instrumentRef, bank: p.bank, note: p.note,
});

/** Why the applied hold-over date differs (or not) from the detected one. The
 *  printed statement shows only the applied date — this note is screen-only. */
function holdOverHint(c: PictureEndingComputed): string {
  if (c.holdOverSource === "override") {
    return c.holdOverDate === c.detectedHoldOverDate
      ? "extension not given for this film — back to the detected date"
      : "set by hand on this statement";
  }
  if (c.holdOverSource === "rule") return "extended to the opening Sunday — distributor rule";
  if (!c.holdOverDate) return "never held over — publicity runs the whole run";
  return "same as detected";
}

export default function ReportsPictureEndingPage() {
  const { state } = useSync();
  const appState = state.appState;
  const cinemaId = state.cinemaId;
  const email = state.email ?? "system";

  const [profile, setProfile] = useState<CinemaProfile | null>(null);
  const [movieId, setMovieId] = useState<string>("");
  const [screenId, setScreenId] = useState<string>("");
  const [inputs, setInputs] = useState<PictureEndingInputs | null>(null);
  /** Every advance recorded against the FILM; `inputs.advances` is the ticked
   *  subset this screen's statement actually deducts. */
  const [movieAdvances, setMovieAdvances] = useState<PictureEndingAdvance[]>([]);
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

  // Screens this film actually played on — one statement per screen.
  const screens = useMemo(
    () => (appState && movieId ? movieScreens(appState, movieId) : []),
    [appState, movieId],
  );
  // The picker holds the previous film's screen for the one render before the
  // reset effect fires. Nothing downstream may settle a screen this film never
  // played, so read through this rather than the raw state.
  const activeScreenId = screens.some((s) => s.id === screenId) ? screenId : "";

  // Picture Ending catalogs (Settings → Box Office). Reps are scoped to the
  // film's distributor — you can only hand a statement to their own people.
  const formats = useMemo(
    () => [...(appState?.movieFormats ?? [])].sort((a, b) => a.code.localeCompare(b.code)),
    [appState],
  );
  const reps = useMemo(
    () =>
      distributor
        ? (appState?.representatives ?? [])
            .filter((r) => r.distributorId === distributor.id)
            .sort((a, b) => a.name.localeCompare(b.name))
        : [],
    [appState, distributor],
  );

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

  /** advance id → the statement number that already deducted it, for this film. */
  const claimedBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of saved) {
      if (s.movieId !== movieId) continue;
      for (const a of s.advances ?? []) {
        if (a.id && !m.has(a.id)) m.set(a.id, s.statementNo);
      }
    }
    return m;
  }, [saved, movieId]);

  // A new picture clears the screen; a film that only played one screen picks it.
  useEffect(() => {
    setScreenId(screens.length === 1 ? (screens[0]?.id ?? "") : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movieId]);

  // On picture/screen change, seed inputs from defaults + pull the film's
  // advances. Rates and identity are per film; the hold-over override this
  // resets is per screen, so switching screens must start clean.
  useEffect(() => {
    if (!movie || !activeScreenId || !cinemaId) { setInputs(null); setMovieAdvances([]); return; }
    setInputs(
      defaultPictureEndingInputs(profile?.gstin ?? appState?.cinema.gstin, distributor, {
        theatreName: profile?.name ?? appState?.cinema.name,
        representatives: reps,
      }),
    );
    void listDistributorPayments(cinemaId, { movieId: movie.id }).then((pays) => {
      const rows = pays.map(toAdvance);
      setMovieAdvances(rows);
      // Start with everything another statement for this film has not already
      // deducted — the preparer can still tick/untick any of them.
      setInputs((cur) =>
        cur ? { ...cur, advances: rows.filter((r) => !r.id || !claimedBy.has(r.id)) } : cur,
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movieId, activeScreenId]);

  const computed = useMemo(() => {
    if (!appState || !movie || !activeScreenId || !inputs) return null;
    return buildPictureEnding(appState, movie.id, activeScreenId, inputs);
  }, [appState, movie, activeScreenId, inputs]);

  function patch(p: Partial<PictureEndingInputs>) {
    setInputs((cur) => (cur ? { ...cur, ...p } : cur));
  }
  function num(v: string): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  // ── advances (persisted to distributor_payments, ticked per statement) ──
  const [adv, setAdv] = useState({ paidOn: "", amount: "", mode: "rtgs", ref: "", bank: "" });

  /** Re-pull the film's advances, keeping the current ticks (plus anything
   *  `alsoTick` claims — used to tick a line the preparer just added). */
  const refreshAdvances = useCallback(
    async (alsoTick: (a: PictureEndingAdvance) => boolean = () => false) => {
      if (!cinemaId || !movie) return;
      const rows = (await listDistributorPayments(cinemaId, { movieId: movie.id })).map(toAdvance);
      setMovieAdvances(rows);
      setInputs((cur) =>
        cur
          ? {
              ...cur,
              advances: rows.filter(
                (r) => alsoTick(r) || cur.advances.some((x) => advKey(x) === advKey(r)),
              ),
            }
          : cur,
      );
    },
    [cinemaId, movie],
  );

  /** Tick / untick one advance for THIS statement (keeps the table's order). */
  function toggleAdvance(a: PictureEndingAdvance, on: boolean) {
    setInputs((cur) =>
      cur
        ? {
            ...cur,
            advances: on
              ? movieAdvances.filter(
                  (r) =>
                    advKey(r) === advKey(a) ||
                    cur.advances.some((x) => advKey(x) === advKey(r)),
                )
              : cur.advances.filter((x) => advKey(x) !== advKey(a)),
          }
        : cur,
    );
  }

  async function addAdvance() {
    if (!cinemaId || !movie || !adv.paidOn || !num(adv.amount)) return;
    setBusy(true);
    try {
      const known = new Set(movieAdvances.map(advKey));
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
      // Anything that was not there before the insert is the new line — tick it.
      await refreshAdvances((r) => !known.has(advKey(r)));
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
      await refreshAdvances();
    } finally {
      setBusy(false);
    }
  }

  // ── preview (in-browser, before download) ──
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  function openPreview(statementNo?: number) {
    if (!computed || !profile) return;
    const blob = pictureEndingPdfBlob(computed, { cinema: profile, logoDataUrl: LOGO_DATA_URL, statementNo });
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });
  }
  function closePreview() {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }
  // Revoke any live object URL on unmount.
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

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
      setFlash(`Saved as statement #${rec.statementNo} — ${computed.screen.name}.`);
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
          End-of-run settlement statement for a distributor, one screen at a time — weekly
          share rolled from that screen's DCR, plus GST, publicity, TDS, expenses and
          advances. Exports a branded PDF and CSV.
        </p>
      </div>

      {/* picture × screen picker */}
      <Card>
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 items-end">
          <Field label="Picture">
            <SearchSelect
              value={movieId}
              onChange={(v) => setMovieId(v)}
              options={movies.map((m) => ({
                value: m.id,
                label: `${m.name}${m.release ? ` · ${m.release}` : ""}${m.distributor ? ` · ${m.distributor}` : ""}`,
              }))}
              placeholder="Search a finished movie…"
            />
          </Field>
          <Field
            label="Screen"
            hint={
              !movie
                ? "pick a picture first"
                : screens.length > 1
                  ? `ran on ${screens.length} screens — settle one statement each`
                  : undefined
            }
          >
            <Select
              value={activeScreenId}
              disabled={!movie}
              onChange={(e) => setScreenId(e.target.value)}
            >
              <option value="">{movie ? "Select a screen…" : "—"}</option>
              {screens.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
          {movie ? (
            <div className="text-sm text-ink-muted">
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
              <Field
                label="Format"
                hint={formats.length ? undefined : "add codes in Settings → Box Office → Formats"}
              >
                <Select value={inputs.movieFormat ?? ""}
                  onChange={(e) => patch({ movieFormat: e.target.value })}>
                  <option value="">—</option>
                  {formats.map((f) => (
                    <option key={f.id} value={f.code}>
                      {f.label ? `${f.code} — ${f.label}` : f.code}
                    </option>
                  ))}
                  {/* A code carried over from before the catalog existed (or
                      since removed) must stay selectable, not vanish. */}
                  {inputs.movieFormat && !formats.some((f) => f.code === inputs.movieFormat) ? (
                    <option value={inputs.movieFormat}>{inputs.movieFormat} (not in list)</option>
                  ) : null}
                </Select>
              </Field>
              <Field label="Name of theatre">
                <Input value={inputs.theatreName ?? ""}
                  onChange={(e) => patch({ theatreName: e.target.value })} />
              </Field>
              <Field
                label="Representative"
                hint={
                  !computed.distributor
                    ? "link this film to a distributor to pick one"
                    : reps.length
                      ? undefined
                      : `no reps for ${computed.distributor.name} yet`
                }
              >
                <Select value={inputs.representative ?? ""}
                  onChange={(e) => patch({ representative: e.target.value })}>
                  <option value="">—</option>
                  {reps.map((r) => (
                    <option key={r.id} value={r.name}>{r.name}</option>
                  ))}
                  {/* Keeps the distributor's POC name (the pre-catalog default)
                      and any historical value selectable. */}
                  {inputs.representative && !reps.some((r) => r.name === inputs.representative) ? (
                    <option value={inputs.representative}>{inputs.representative} (not in list)</option>
                  ) : null}
                </Select>
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
              <Field label="Hold-over date — detected" hint="best 3 shows below one full house">
                <Input value={computed.detectedHoldOverDate ?? "—"} readOnly className="bg-paper/60" />
              </Field>
              <Field
                label="Hold-over date — applied"
                hint={holdOverHint(computed)}
              >
                <div className="flex gap-2">
                  <Input
                    type="date"
                    value={computed.holdOverDate ?? ""}
                    max={computed.holdOverCeiling ?? undefined}
                    onChange={(e) => patch({ holdOverDateOverride: e.target.value || null })}
                  />
                  {computed.holdOverSource === "rule" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        patch({ holdOverDateOverride: computed.detectedHoldOverDate })
                      }
                      title="Do not extend for this film — charge publicity to the detected date"
                      className="whitespace-nowrap"
                    >
                      Don't extend
                    </Button>
                  ) : null}
                  {inputs.holdOverDateOverride ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => patch({ holdOverDateOverride: null })}
                      title="Drop the override and go back to the distributor's rule"
                    >
                      Reset
                    </Button>
                  ) : null}
                </div>
              </Field>
            </CardBody>
          </Card>

          {/* advances — recorded per film, ticked per statement */}
          <Card>
            <CardHeader>
              {/* CardHeader is a flex row — one child, or the note lands beside the title. */}
              <div>
                <CardTitle>Advances paid</CardTitle>
                <p className="text-xs text-ink-muted mt-1">
                  Advances belong to the picture. Tick the ones this screen's statement deducts —
                  anything already deducted on another statement for the film starts unticked.
                </p>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-ink-muted border-b border-line">
                      <th className="text-left px-5 py-3 font-semibold w-16">Use</th>
                      <th className="text-left px-5 py-3 font-semibold w-32">Date</th>
                      <th className="text-left px-5 py-3 font-semibold w-24">Mode</th>
                      <th className="text-left px-5 py-3 font-semibold">Bank / Instrument</th>
                      <th className="text-right px-5 py-3 font-semibold w-32">Amount</th>
                      <th className="px-5 py-3 w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {movieAdvances.length === 0 ? (
                      <tr><td colSpan={6} className="px-5 py-4 text-ink-muted">No advances recorded for this picture.</td></tr>
                    ) : movieAdvances.map((a) => {
                      const on = inputs.advances.some((x) => advKey(x) === advKey(a));
                      const claimed = a.id ? claimedBy.get(a.id) : undefined;
                      return (
                        <tr key={advKey(a)} className={"border-b border-line " + (on ? "" : "opacity-55")}>
                          <td className="px-5 py-2">
                            <input
                              type="checkbox"
                              checked={on}
                              aria-label={`Deduct the ${a.paidOn} advance on this statement`}
                              onChange={(e) => toggleAdvance(a, e.target.checked)}
                            />
                          </td>
                          <td className="px-5 py-2 tabular-nums">{a.paidOn}</td>
                          <td className="px-5 py-2 uppercase">{a.mode ?? "—"}</td>
                          <td className="px-5 py-2 text-ink-muted">
                            {[a.bank, a.ref ? "Ch# " + a.ref : ""].filter(Boolean).join(" · ") || "—"}
                            {claimed != null ? (
                              <span className={on ? "text-amber-600" : ""}>
                                {" "}· already on statement #{claimed}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-5 py-2 text-right tabular-nums">{inr(a.amount)}</td>
                          <td className="px-5 py-2 text-right">
                            <Button size="sm" variant="ghost" className="text-red-700"
                              disabled={busy} onClick={() => removeAdvance(a.id)}>×</Button>
                          </td>
                        </tr>
                      );
                    })}
                    {movieAdvances.length ? (
                      <tr className="bg-paper/60 font-semibold">
                        <td className="px-5 py-2" colSpan={4}>
                          Deducted on this statement ({inputs.advances.length} of {movieAdvances.length})
                        </td>
                        <td className="px-5 py-2 text-right tabular-nums">{inr(t.advances)}</td>
                        <td></td>
                      </tr>
                    ) : null}
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
              <CardHeader><CardTitle>Weekly run — {computed.screen.name}</CardTitle></CardHeader>
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
                      <tr key={`${w.week}-${w.from}`} className="border-b border-line">
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
                    <LedgerRow
                      label={
                        `Publicity — ${inputs.publicityPct}% of ex-share (${t.publicityDays} days` +
                        (computed.holdOverDate ? `, till hold-over ${dmy(computed.holdOverDate)})` : ")")
                      }
                      credit={t.publicityBase}
                    />
                    {inputs.taxKind === "inter" ? (
                      <LedgerRow label={`Publicity IGST @ ${inputs.gstPct}%`} credit={t.publicityIgst} />
                    ) : (
                      <>
                        <LedgerRow label={`Publicity SGST @ ${inputs.gstPct / 2}%`} credit={t.publicitySgst} />
                        <LedgerRow label={`Publicity CGST @ ${inputs.gstPct / 2}%`} credit={t.publicityCgst} />
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
              <Button disabled={!profile} onClick={() => openPreview()}>Preview PDF</Button>
              <Button variant="secondary" disabled={!profile} onClick={() => exportPdf()}>Export PDF</Button>
              <Button variant="secondary" disabled={!profile} onClick={() => exportCsv()}>Export CSV</Button>
              <Button disabled={busy || !profile} onClick={saveStatement}>Save &amp; number statement</Button>
              {!profile ? <span className="text-sm text-amber-600">Loading cinema profile…</span> : null}
              {flash ? <span className="text-sm text-ink-muted">{flash}</span> : null}
            </CardBody>
          </Card>

          {/* saved statements for this picture — every screen, so a second
              statement for the same film is filed with the first in view */}
          {savedForMovie.length ? (
            <Card>
              <CardHeader><CardTitle>Saved statements for this picture</CardTitle></CardHeader>
              <CardBody className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-ink-muted border-b border-line">
                      <th className="text-left px-5 py-2.5 font-semibold w-20">No.</th>
                      <th className="text-left px-5 py-2.5 font-semibold w-32">Date</th>
                      <th className="text-left px-5 py-2.5 font-semibold">Screen</th>
                      <th className="text-left px-5 py-2.5 font-semibold">Status</th>
                      <th className="text-right px-5 py-2.5 font-semibold">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {savedForMovie.map((s) => (
                      <tr key={s.id} className={"border-b border-line " + (s.screenId === activeScreenId ? "" : "text-ink-muted")}>
                        <td className="px-5 py-2 tabular-nums">#{s.statementNo}</td>
                        <td className="px-5 py-2 tabular-nums">{s.statementDate}</td>
                        <td className="px-5 py-2">{s.screenName ?? "—"}</td>
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
      ) : movie && !activeScreenId ? (
        <Card><CardBody className="text-sm text-ink-muted">Pick the screen to settle — this picture ran on {screens.length} of them.</CardBody></Card>
      ) : movie ? (
        <Card><CardBody className="text-sm text-ink-muted">No collecting days found for this picture on {screens.find((s) => s.id === activeScreenId)?.name ?? "this screen"}.</CardBody></Card>
      ) : null}

      <Modal
        open={!!previewUrl}
        onClose={closePreview}
        maxWidth="max-w-3xl"
        title={`Picture Ending — ${movie?.name ?? "preview"}${computed ? ` · ${computed.screen.name}` : ""}`}
        actions={
          <>
            <Button size="sm" onClick={() => exportPdf()}>Download</Button>
            <Button size="sm" variant="ghost" onClick={closePreview}>Close</Button>
          </>
        }
      >
        {previewUrl ? (
          <iframe title="Picture Ending PDF preview" src={previewUrl} className="w-full h-[78vh] rounded-lg border border-line" />
        ) : null}
      </Modal>
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
