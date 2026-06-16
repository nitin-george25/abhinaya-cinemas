// ============================================================================
// Route page: /fb/checklist — interactive daily F&B SOP checklists.
//
// Staff pick a date + checklist (opening / mid-shift / closing), tick each SOP
// step, attach photo evidence where required, record the closing cash recon,
// and the Shift Manager signs off. Everything persists to Supabase
// (fb_checklist_runs / fb_checklist_items) so completion + evidence is
// auditable and feeds the compliance loop. Bilingual: English + Malayalam.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSync } from "../../lib/hooks/SyncContext";
import { todayIso } from "../../lib/dates";
import { fmtINR } from "../../lib/dashboard";
import type { DateISO } from "../../lib/types";
import {
  CHECKLISTS,
  CHECKLIST_ORDER,
  blankRun,
  loadRun,
  saveRun,
  uploadChecklistPhoto,
  runProgress,
  type ChecklistRun,
  type ChecklistType,
} from "../../lib/fbChecklist";

import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Field, Input, Select } from "../../components/ui/Input";

const TYPE_LABEL: Record<ChecklistType, string> = {
  opening: "Opening",
  midshift: "Mid-shift",
  closing: "Closing",
};

const N = (v: unknown): number | null => {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export default function FBChecklistPage() {
  const { state } = useSync();
  const cinemaId = state.cinemaId;
  const email = state.email;

  const [date, setDate] = useState<DateISO>(todayIso());
  const [type, setType] = useState<ChecklistType>("opening");
  const [shift, setShift] = useState("");
  const [run, setRun] = useState<ChecklistRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const def = CHECKLISTS[type];

  // Load the saved run for the current slot whenever the selector changes.
  useEffect(() => {
    if (!cinemaId) return;
    let alive = true;
    setLoading(true);
    setFeedback(null);
    loadRun(cinemaId, date, type, shift.trim())
      .then((loaded) => {
        if (!alive) return;
        setRun(loaded ?? blankRun(cinemaId, date, type, shift.trim()));
      })
      .catch(() => {
        if (alive) setRun(blankRun(cinemaId, date, type, shift.trim()));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [cinemaId, date, type, shift]);

  const progress = useMemo(
    () => (run ? runProgress(run) : { done: 0, total: def.items.length }),
    [run, def.items.length],
  );

  const recon = useMemo(() => {
    const e = run?.extra ?? {};
    const pos = N(e.posTotal);
    const cash = N(e.cashCounted);
    const upi = N(e.upiTotal);
    const variance =
      pos == null || cash == null || upi == null ? null : cash + upi - pos;
    return { pos, cash, upi, variance };
  }, [run]);

  const updateItem = useCallback(
    (code: string, patch: Partial<ChecklistRun["items"][number]>) => {
      setRun((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((it) =>
                it.code === code ? { ...it, ...patch } : it,
              ),
            }
          : prev,
      );
    },
    [],
  );

  const toggle = useCallback(
    (code: string, checked: boolean) => {
      updateItem(code, {
        checked,
        doneAt: checked ? new Date().toISOString() : null,
      });
    },
    [updateItem],
  );

  const setExtra = useCallback((key: string, value: string) => {
    setRun((prev) =>
      prev ? { ...prev, extra: { ...prev.extra, [key]: value } } : prev,
    );
  }, []);

  async function onPhoto(code: string, file: File | undefined) {
    if (!file || !cinemaId) return;
    setUploading(code);
    try {
      const url = await uploadChecklistPhoto(file, cinemaId, date, code);
      updateItem(code, { photoUrl: url, checked: true, doneAt: new Date().toISOString() });
    } catch (err) {
      setFeedback(`Photo upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(null);
    }
  }

  function signoff() {
    if (!email) return;
    setRun((prev) =>
      prev
        ? { ...prev, managerSignoffEmail: email, managerSignedAt: new Date().toISOString() }
        : prev,
    );
  }

  async function save() {
    if (!run || !email) return;
    setSaving(true);
    setFeedback(null);
    const allDone = run.items.every((i) => i.checked);
    const next: ChecklistRun = {
      ...run,
      staffEmail: run.staffEmail ?? email,
      status: allDone ? "completed" : "in_progress",
    };
    try {
      const id = await saveRun(next, email);
      setRun({ ...next, id });
      setFeedback("Saved");
    } catch (err) {
      setFeedback(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  if (!cinemaId || !state.appState) {
    return (
      <Card>
        <CardBody className="text-sm text-ink-muted">Loading cloud data…</CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight">F&amp;B checklist</h2>
        <p className="font-malayalam text-lg text-ink-muted mt-0.5 leading-relaxed">
          ദിവസേനയുള്ള F&amp;B SOP ചെക്ക്‌ലിസ്റ്റുകൾ — ഓപ്പണിങ്, ഷിഫ്റ്റിനിടയിൽ, ക്ലോസിങ്
        </p>
      </div>

      {/* Slot selector */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value as DateISO)} />
        </Field>
        <Field label="Checklist">
          <Select value={type} onChange={(e) => setType(e.target.value as ChecklistType)}>
            {CHECKLIST_ORDER.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Shift (optional)" hint="e.g. Matinee, Evening">
          <Input
            type="text"
            value={shift}
            onChange={(e) => setShift(e.target.value)}
            placeholder="—"
          />
        </Field>
      </div>

      {/* Instruction + progress */}
      <Card>
        <CardBody className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <CardTitle>{def.titleEn}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge tone={progress.done === progress.total ? "green" : "amber"}>
                {progress.done}/{progress.total} done
              </Badge>
              {run?.status === "completed" ? <Badge tone="green">Completed</Badge> : null}
            </div>
          </div>
          <p className="font-malayalam text-base text-ink leading-relaxed">{def.titleMl}</p>
          <p className="text-sm text-ink-muted">{def.instrEn}</p>
          <p className="font-malayalam text-sm text-ink-muted leading-relaxed">{def.instrML}</p>
        </CardBody>
      </Card>

      {loading || !run ? (
        <Card>
          <CardBody className="text-sm text-ink-muted">Loading checklist…</CardBody>
        </Card>
      ) : (
        <>
          {/* Items */}
          <div className="space-y-2">
            {def.items.map((d) => {
              const it = run.items.find((x) => x.code === d.code)!;
              return (
                <ChecklistRow
                  key={d.code}
                  code={d.code}
                  en={d.en}
                  ml={d.ml}
                  photo={!!d.photo}
                  checked={it.checked}
                  initial={it.initial}
                  photoUrl={it.photoUrl}
                  uploading={uploading === d.code}
                  onToggle={(c) => toggle(d.code, c)}
                  onInitial={(v) => updateItem(d.code, { initial: v })}
                  onPhoto={(f) => onPhoto(d.code, f)}
                  onRemovePhoto={() => updateItem(d.code, { photoUrl: null })}
                />
              );
            })}
          </div>

          {/* Closing cash reconciliation */}
          {type === "closing" ? (
            <Card>
              <CardHeader>
                <CardTitle>Cash reconciliation</CardTitle>
                {recon.variance != null ? (
                  <Badge tone={recon.variance === 0 ? "green" : "red"}>
                    Variance {fmtINR(recon.variance)}
                  </Badge>
                ) : null}
              </CardHeader>
              <CardBody className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Field label="POS sales total">
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={String(run.extra.posTotal ?? "")}
                    onChange={(e) => setExtra("posTotal", e.target.value)}
                    placeholder="₹"
                  />
                </Field>
                <Field label="Cash counted">
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={String(run.extra.cashCounted ?? "")}
                    onChange={(e) => setExtra("cashCounted", e.target.value)}
                    placeholder="₹"
                  />
                </Field>
                <Field label="UPI / card total">
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={String(run.extra.upiTotal ?? "")}
                    onChange={(e) => setExtra("upiTotal", e.target.value)}
                    placeholder="₹"
                  />
                </Field>
              </CardBody>
            </Card>
          ) : null}

          {/* Staff + notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Staff on counter">
              <Input
                type="text"
                value={run.staffName}
                onChange={(e) => setRun({ ...run, staffName: e.target.value })}
                placeholder="Name"
              />
            </Field>
            <Field label="Notes (optional)">
              <Input
                type="text"
                value={run.notes}
                onChange={(e) => setRun({ ...run, notes: e.target.value })}
                placeholder="Anything worth recording"
              />
            </Field>
          </div>

          {/* Manager sign-off */}
          <Card>
            <CardBody className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">Manager sign-off</div>
                <div className="font-malayalam text-sm text-ink-muted leading-relaxed">
                  മാനേജർ അംഗീകാരം
                </div>
                {run.managerSignoffEmail ? (
                  <div className="text-sm text-ink-muted mt-1">
                    Signed by {run.managerSignoffEmail}
                    {run.managerSignedAt
                      ? ` · ${new Date(run.managerSignedAt).toLocaleString()}`
                      : ""}
                  </div>
                ) : (
                  <div className="text-sm text-ink-muted mt-1">{def.signoffEn}</div>
                )}
              </div>
              {run.managerSignoffEmail ? (
                <Badge tone="green">Signed</Badge>
              ) : (
                <Button variant="secondary" onClick={signoff} disabled={!email}>
                  Sign off
                </Button>
              )}
            </CardBody>
          </Card>

          {/* Save */}
          <div className="flex items-center justify-end gap-3">
            {feedback ? (
              <span
                className={
                  feedback === "Saved" ? "text-sm text-green-700" : "text-sm text-red-700"
                }
              >
                {feedback}
              </span>
            ) : null}
            <Button onClick={save} disabled={saving || !email}>
              {saving ? "Saving…" : "Save checklist"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ── One checklist row ───────────────────────────────────────────────────────

interface RowProps {
  code: string;
  en: string;
  ml: string;
  photo: boolean;
  checked: boolean;
  initial: string;
  photoUrl: string | null;
  uploading: boolean;
  onToggle: (checked: boolean) => void;
  onInitial: (v: string) => void;
  onPhoto: (file: File | undefined) => void;
  onRemovePhoto: () => void;
}

function ChecklistRow({
  code,
  en,
  ml,
  photo,
  checked,
  initial,
  photoUrl,
  uploading,
  onToggle,
  onInitial,
  onPhoto,
  onRemovePhoto,
}: RowProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div
      className={
        "rounded-xl border bg-paper-card px-4 py-3 flex items-start gap-3 " +
        (checked ? "border-green-300" : "border-line")
      }
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-1 h-5 w-5 shrink-0 accent-amber-500 cursor-pointer"
        aria-label={`Mark ${code} done`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-ink-muted tracking-wide">{code}</span>
          {photo ? (
            <span className="text-[11px] text-amber-600 font-medium">photo required</span>
          ) : null}
        </div>
        <div className="text-sm text-ink">{en}</div>
        <div className="font-malayalam text-sm text-ink-muted leading-relaxed">{ml}</div>

        {photo ? (
          <div className="mt-2 flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => onPhoto(e.target.files?.[0])}
            />
            {photoUrl ? (
              <>
                <a href={photoUrl} target="_blank" rel="noreferrer">
                  <img
                    src={photoUrl}
                    alt={`${code} evidence`}
                    className="h-12 w-12 rounded-lg object-cover border border-line"
                  />
                </a>
                <Button size="sm" variant="ghost" onClick={onRemovePhoto}>
                  Remove
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? "Uploading…" : "Add photo"}
              </Button>
            )}
          </div>
        ) : null}
      </div>

      <div className="w-16 shrink-0">
        <input
          type="text"
          value={initial}
          onChange={(e) => onInitial(e.target.value)}
          placeholder="Init."
          aria-label={`Initials for ${code}`}
          className="w-full rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-center"
        />
      </div>
    </div>
  );
}
