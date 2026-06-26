// ============================================================================
// Schedule import — upload a Vista session export (.xls / .xlsx / .csv) and
// turn it into the day's programme. SheetJS decodes the file to a cell grid;
// scheduleImport.ts interprets the Vista layout; the user maps Vista's screen
// / film / price-card names to the catalog before confirming.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Input, Select, SearchSelect, Field } from "../ui/Input";
import { IconSpinner } from "../icons";

import { useSync } from "../../lib/hooks/SyncContext";
import {
  parseVistaWorkbook,
  matchByName,
  matchPriceCard,
  buildScheduleRows,
  priceCardKey,
  type ParsedVistaSchedule,
  type ImportMapping,
} from "../../lib/scheduleImport";
import type { AppState, DateISO, ShowSchedule, UUID } from "../../lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Confirmed import — schedule rows to apply for `date`. */
  onImport: (rows: ShowSchedule[], date: DateISO) => void;
}

const uniq = (xs: string[]) => [...new Set(xs)];

export function ScheduleImportModal({ open, onClose, onImport }: Props) {
  const { state } = useSync();
  const appState = state.appState;
  const cinemaId = (state.cinemaId ?? "") as UUID;

  const [filename, setFilename] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedVistaSchedule | null>(null);
  const [date, setDate] = useState<DateISO>("");
  const [mapping, setMapping] = useState<ImportMapping>({ screens: {}, films: {}, priceCards: {} });

  function reset() {
    setFilename(null); setBusy(false); setError(null);
    setParsed(null); setDate(""); setMapping({ screens: {}, films: {}, priceCards: {} });
  }
  function close() { reset(); onClose(); }

  // Distinct Vista names from the parsed file.
  const screenNames = useMemo(() => uniq((parsed?.rows ?? []).map((r) => r.screen)), [parsed]);
  const filmNames = useMemo(() => uniq((parsed?.rows ?? []).map((r) => r.film)), [parsed]);
  const pricePairs = useMemo(
    () => uniq((parsed?.rows ?? []).map((r) => priceCardKey(r.screen, r.priceCard)))
      .map((k) => { const [screen = "", priceCard = ""] = k.split("||"); return { key: k, screen, priceCard }; })
      .filter((p) => p.priceCard),
    [parsed],
  );

  // Auto-map by name whenever a new file is parsed.
  useEffect(() => {
    if (!parsed || !appState) return;
    const screens: Record<string, UUID> = {};
    for (const n of uniq(parsed.rows.map((r) => r.screen)))
      screens[n] = (matchByName(n, appState.screens) ?? "") as UUID;
    const films: Record<string, UUID> = {};
    for (const n of uniq(parsed.rows.map((r) => r.film)))
      films[n] = (matchByName(n, appState.movies) ?? "") as UUID;
    setMapping({ screens, films, priceCards: autoMatchPriceCards(parsed, screens, appState) });
    setDate(parsed.date ?? "");
  }, [parsed, appState]);

  function pickFile() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";
    inp.onchange = () => {
      const file = inp.files?.[0];
      if (!file) return;
      setFilename(file.name); setError(null); setBusy(true); setParsed(null);
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const data = new Uint8Array(rd.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: "array" });
          const wsName = wb.SheetNames[0];
          const ws = wsName ? wb.Sheets[wsName] : undefined;
          if (!ws) throw new Error("The file has no sheets.");
          const grid = XLSX.utils.sheet_to_json<string[]>(ws, {
            header: 1, raw: false, defval: "",
          }) as unknown as string[][];
          setParsed(parseVistaWorkbook(grid));
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      };
      rd.onerror = () => { setError("Couldn't read that file."); setBusy(false); };
      rd.readAsArrayBuffer(file);
    };
    inp.click();
  }

  const { rows, skipped } = useMemo(
    () => (parsed && date && appState
      ? buildScheduleRows(parsed, date, mapping, cinemaId)
      : { rows: [] as ShowSchedule[], skipped: [] }),
    [parsed, date, mapping, cinemaId, appState],
  );

  // Screen lookup for the preview.
  const screenName = (id: string) => appState?.screens.find((s) => s.id === id)?.name ?? id;
  const movieName = (id: string) => appState?.movies.find((m) => m.id === id)?.name ?? id;

  function confirm() {
    if (!date || rows.length === 0) return;
    onImport(rows, date);
    close();
  }

  if (!appState) return <Modal open={open} onClose={close}>{null}</Modal>;

  const movieOptions = appState.movies.map((m) => ({ value: m.id, label: m.name }));

  return (
    <Modal
      open={open}
      onClose={close}
      maxWidth="max-w-3xl"
      title="Upload schedule (Vista export)"
      actions={<Button variant="ghost" size="sm" onClick={close} title="Close (Esc)">✕</Button>}
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">
          Pick a Vista session export (.xls, .xlsx or .csv). Map its screens and
          films to your catalog, then import — it replaces that day's programme
          for the screens in the file.
        </p>

        <div className="flex items-center gap-3">
          <Button onClick={pickFile} disabled={busy} variant="primary">
            {busy ? <IconSpinner className="w-4 h-4" /> : null}
            {parsed ? "Pick a different file" : "Pick file"}
          </Button>
          {filename ? <span className="text-sm text-ink-muted truncate">{filename}</span> : null}
        </div>

        {error ? (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            <b>Couldn't read that file: </b>{error}
          </div>
        ) : null}

        {parsed ? (
          <>
            {parsed.warnings.length > 0 ? (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-ink-soft space-y-0.5">
                {parsed.warnings.map((w, i) => <div key={i}>{w}</div>)}
              </div>
            ) : null}

            <div className="max-w-xs">
              <Field label="Schedule date" hint={parsed.date ? undefined : "Couldn't read a date from the file — set it"}>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>

            {/* Screen mapping */}
            <MapSection title="Screens">
              {screenNames.map((n) => (
                <MapRow key={n} label={n} unmapped={!mapping.screens[n]}>
                  <Select
                    value={mapping.screens[n] ?? ""}
                    onChange={(e) => setMapping((m) => {
                      const screens = { ...m.screens, [n]: e.target.value as UUID };
                      // Re-match this screen's price cards against the new screen.
                      const priceCards = { ...m.priceCards };
                      for (const r of parsed?.rows ?? []) {
                        if (r.screen !== n || !r.priceCard) continue;
                        const cards = appState.screens.find((s) => s.id === screens[n])?.priceCards ?? [];
                        priceCards[priceCardKey(n, r.priceCard)] = (matchPriceCard(r.priceCard, cards) ?? "") as UUID;
                      }
                      return { ...m, screens, priceCards };
                    })}
                  >
                    <option value="">— pick screen —</option>
                    {appState.screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                </MapRow>
              ))}
            </MapSection>

            {/* Film mapping */}
            <MapSection title="Films">
              {filmNames.map((n) => (
                <MapRow key={n} label={n} unmapped={!mapping.films[n]}>
                  <SearchSelect
                    value={mapping.films[n] ?? ""}
                    onChange={(v) => setMapping((m) => ({ ...m, films: { ...m.films, [n]: v as UUID } }))}
                    options={movieOptions}
                    placeholder="Search movie…"
                  />
                </MapRow>
              ))}
            </MapSection>

            {/* Price-card mapping (optional) */}
            {pricePairs.length > 0 ? (
              <MapSection title="Price cards (optional)">
                {pricePairs.map((p) => {
                  const scrId = mapping.screens[p.screen];
                  const cards = appState.screens.find((s) => s.id === scrId)?.priceCards ?? [];
                  return (
                    <MapRow key={p.key} label={`${p.priceCard}  ·  ${p.screen}`} unmapped={false}>
                      <Select
                        value={mapping.priceCards[p.key] ?? ""}
                        onChange={(e) => setMapping((m) => ({ ...m, priceCards: { ...m.priceCards, [p.key]: e.target.value as UUID } }))}
                      >
                        <option value="">— none —</option>
                        {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </Select>
                    </MapRow>
                  );
                })}
              </MapSection>
            ) : null}

            {/* Preview */}
            <div className="rounded-lg border border-line bg-paper p-4 space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <Badge tone={rows.length ? "green" : "neutral"}>{rows.length} shows ready</Badge>
                {skipped.length ? <Badge tone="amber">{skipped.length} skipped (unmapped)</Badge> : null}
                {date ? <Badge tone="blue">{date}</Badge> : null}
              </div>
              {rows.length ? (
                <div className="max-h-56 overflow-auto text-sm">
                  <table className="w-full">
                    <thead className="text-[11px] uppercase tracking-wider text-ink-muted">
                      <tr><th className="text-left py-1 pr-3">Time</th><th className="text-left py-1 pr-3">Screen</th><th className="text-left py-1 pr-3">Film</th></tr>
                    </thead>
                    <tbody>
                      {rows.slice().sort((a, b) => a.screenId.localeCompare(b.screenId) || a.showtime.localeCompare(b.showtime)).map((r) => (
                        <tr key={r.id} className="border-t border-line">
                          <td className="py-1 pr-3 tabular-nums">{r.showtime}</td>
                          <td className="py-1 pr-3">{screenName(r.screenId)}</td>
                          <td className="py-1 pr-3">{movieName(r.movieId)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-ink-muted">
                  Map every screen and film above to see the shows that will import.
                </p>
              )}
              {skipped.length ? (
                <p className="text-xs text-ink-soft">
                  {skipped.length} show(s) will be omitted until their screen + film are mapped.
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={close}>Cancel</Button>
          <Button onClick={confirm} disabled={!date || rows.length === 0 || busy}>
            Import {rows.length || ""} shows
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Auto-match each Vista (screen, price-card) pair to a card on the mapped
 *  catalog screen, by its printed prices (then name). */
function autoMatchPriceCards(
  parsed: ParsedVistaSchedule,
  screens: Record<string, UUID>,
  appState: AppState,
): Record<string, UUID> {
  const priceCards: Record<string, UUID> = {};
  for (const r of parsed.rows) {
    if (!r.priceCard) continue;
    const scrId = screens[r.screen];
    const cards = appState.screens.find((s) => s.id === scrId)?.priceCards ?? [];
    const hit = matchPriceCard(r.priceCard, cards);
    if (hit) priceCards[priceCardKey(r.screen, r.priceCard)] = hit as UUID;
  }
  return priceCards;
}

function MapSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-wider text-ink-muted font-semibold">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function MapRow({ label, unmapped, children }: { label: string; unmapped: boolean; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr] gap-2 sm:items-center">
      <div className="text-sm flex items-center gap-2 min-w-0">
        <span className="truncate">{label}</span>
        {unmapped ? <Badge tone="amber">map</Badge> : null}
      </div>
      {children}
    </div>
  );
}
