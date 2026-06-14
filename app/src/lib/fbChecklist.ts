// ============================================================================
// F&B SOP checklists — bilingual step definitions + Supabase persistence.
//
// The step *wording* (English + Malayalam) lives here, keyed by SOP code, so
// it stays in one place and matches the printed SOP Manual word-for-word. The
// DB (fb_checklist_runs / fb_checklist_items) only stores which steps were
// done + the evidence. See migrations/fb-checklist/.
// ============================================================================

import { getSupabase } from "./supabase";
import type { DateISO } from "./types";
import type { FbChecklistRunRow, FbChecklistItemRow } from "./db-types";

export type ChecklistType = "opening" | "midshift" | "closing";

export interface ChecklistItemDef {
  /** Stable SOP code, e.g. "FB-OPEN-04". Shared with the SOP Manual + audit. */
  code: string;
  en: string;
  ml: string;
  /** Photo evidence required — must be attached before the step counts. */
  photo?: boolean;
}

export interface ChecklistDef {
  type: ChecklistType;
  titleEn: string;
  titleMl: string;
  instrEn: string;
  instrML: string;
  signoffEn: string;
  signoffMl: string;
  items: ChecklistItemDef[];
}

// ── The three daily checklists (ported from the SOP Manual) ────────────────

export const CHECKLISTS: Record<ChecklistType, ChecklistDef> = {
  opening: {
    type: "opening",
    titleEn: "Opening checklist",
    titleMl: "ഓപ്പണിങ് ചെക്ക്‌ലിസ്റ്റ്",
    instrEn:
      "Complete every line in order, 45 minutes before the first show. Photo tasks must be attached. The Shift Manager signs before the counter opens.",
    instrML:
      "ആദ്യ ഷോയ്ക്ക് 45 മിനിറ്റ് മുമ്പ് ഓരോ വരിയും ക്രമത്തിൽ പൂർത്തിയാക്കുക. ഫോട്ടോ ജോലികൾ അറ്റാച്ച് ചെയ്യണം. കൗണ്ടർ തുറക്കുന്നതിന് മുമ്പ് ഷിഫ്റ്റ് മാനേജർ ഒപ്പിടുന്നു.",
    signoffEn: "Counter opened to SOP before serving any customer.",
    signoffMl:
      "ഏതെങ്കിലും ഉപഭോക്താവിന് സേവനം നൽകുന്നതിന് മുമ്പ് കൗണ്ടർ SOP പ്രകാരം തുറന്നു.",
    items: [
      { code: "FB-OPEN-01", en: "Signed in on duty register", ml: "ഡ്യൂട്ടി രജിസ്റ്ററിൽ സൈൻ ഇൻ ചെയ്തു" },
      { code: "FB-OPEN-02", en: "Clean uniform + cap, hands washed & sanitised", ml: "വൃത്തിയുള്ള യൂണിഫോം + തൊപ്പി, കൈ കഴുകി സാനിറ്റൈസ് ചെയ്തു" },
      { code: "FB-OPEN-03", en: "Machines, chiller, warmer, POS switched on", ml: "മെഷീനുകൾ, ചില്ലർ, വാർമർ, POS ഓൺ ചെയ്തു" },
      { code: "FB-OPEN-04", en: "Chiller ≤4°C & warmer ≥60°C — logged", ml: "ചില്ലർ ≤4°C, വാർമർ ≥60°C — ലോഗ് ചെയ്തു", photo: true },
      { code: "FB-OPEN-05", en: "Counter, glass, trays, machines sanitised", ml: "കൗണ്ടർ, ഗ്ലാസ്, ട്രേ, മെഷീൻ സാനിറ്റൈസ് ചെയ്തു", photo: true },
      { code: "FB-OPEN-06", en: "Opening float counted & matches slip", ml: "ഓപ്പണിങ് ഫ്ലോട്ട് എണ്ണി സ്ലിപ്പുമായി ഒത്തു" },
      { code: "FB-OPEN-07", en: "Counter stocked to par, FIFO order", ml: "പാർ വരെ സ്റ്റോക്ക്, FIFO ക്രമം" },
      { code: "FB-OPEN-08", en: "POS price = menu board (no mismatch)", ml: "POS വില = മെനു ബോർഡ് (വ്യത്യാസമില്ല)" },
      { code: "FB-OPEN-09", en: "First popcorn batch fresh (≤20 min before doors)", ml: "ആദ്യ പോപ്‌കോൺ ബാച്ച് പുതിയത് (വാതിലിന് ≤20 മിനിറ്റ് മുമ്പ്)" },
      { code: "FB-OPEN-10", en: "Shift Manager confirmed 'ready'", ml: "ഷിഫ്റ്റ് മാനേജർ 'തയ്യാർ' സ്ഥിരീകരിച്ചു" },
    ],
  },
  midshift: {
    type: "midshift",
    titleEn: "Mid-shift & interval checklist",
    titleMl: "ഷിഫ്റ്റിനിടയിലെ ചെക്ക്‌ലിസ്റ്റ്",
    instrEn:
      "Tick once at each show interval. These keep quality and hygiene steady during the busiest moments.",
    instrML:
      "ഓരോ ഷോ ഇടവേളയിലും ഒരുതവണ ടിക് ചെയ്യുക. തിരക്കേറിയ സമയങ്ങളിൽ ഗുണനിലവാരവും ശുചിത്വവും നിലനിർത്താൻ ഇവ സഹായിക്കുന്നു.",
    signoffEn: "Interval checks completed for every show in this shift.",
    signoffMl: "ഈ ഷിഫ്റ്റിലെ ഓരോ ഷോയ്ക്കും ഇടവേള പരിശോധനകൾ പൂർത്തിയാക്കി.",
    items: [
      { code: "FB-CLN-01", en: "Counter & machine fronts wiped", ml: "കൗണ്ടറും മെഷീൻ മുൻഭാഗവും തുടച്ചു" },
      { code: "FB-PREP-02", en: "Old popcorn (>2 hrs) discarded & logged", ml: "പഴയ പോപ്‌കോൺ (>2 മ.) ഉപേക്ഷിച്ച് ലോഗ് ചെയ്തു" },
      { code: "FB-PREP-03", en: "Temperatures re-checked (chiller/warmer)", ml: "താപനില വീണ്ടും പരിശോധിച്ചു (ചില്ലർ/വാർമർ)" },
      { code: "FB-OPEN-07", en: "Counter restocked to par (FIFO)", ml: "പാർ വരെ വീണ്ടും സ്റ്റോക്ക് (FIFO)" },
      { code: "FB-PREP-06", en: "Machine kettle / nozzles cleaned", ml: "മെഷീൻ കെറ്റിൽ / നോസിലുകൾ വൃത്തിയാക്കി" },
      { code: "FB-CLN-03", en: "Bins emptied at changeover", ml: "മാറ്റത്തിൽ ബിന്നുകൾ ഒഴിച്ചു" },
      { code: "FB-STK-03", en: "Any wastage logged with reason", ml: "പാഴായത് കാരണം സഹിതം ലോഗ് ചെയ്തു" },
      { code: "FB-SVC-07", en: "Counter never left unattended", ml: "കൗണ്ടർ ആളില്ലാതെ വിട്ടില്ല" },
    ],
  },
  closing: {
    type: "closing",
    titleEn: "Closing checklist",
    titleMl: "ക്ലോസിങ് ചെക്ക്‌ലിസ്റ്റ്",
    instrEn:
      "Complete after the last show audience is served. Nothing left half-done. The Shift Manager signs the cash reconciliation.",
    instrML:
      "അവസാന ഷോ പ്രേക്ഷകർക്ക് സേവനം നൽകിയ ശേഷം പൂർത്തിയാക്കുക. ഒന്നും പാതിയിൽ വിടരുത്. ക്യാഷ് ഒത്തുനോക്കലിൽ ഷിഫ്റ്റ് മാനേജർ ഒപ്പിടുന്നു.",
    signoffEn: "Cash reconciled to the POS report; any variance explained.",
    signoffMl: "POS റിപ്പോർട്ടുമായി ക്യാഷ് ഒത്തുനോക്കി; വ്യത്യാസമുണ്ടെങ്കിൽ വിശദീകരിച്ചു.",
    items: [
      { code: "FB-CLOSE-01", en: "Sales stopped after last show; machines off", ml: "അവസാന ഷോയ്ക്ക് ശേഷം വിൽപ്പന നിർത്തി; മെഷീൻ ഓഫ്" },
      { code: "FB-CLOSE-02", en: "Leftover prepared food discarded & logged", ml: "ബാക്കി ഭക്ഷണം ഉപേക്ഷിച്ച് ലോഗ് ചെയ്തു" },
      { code: "FB-CLOSE-03", en: "Sealed stock returned to store & recorded", ml: "സീൽ ചെയ്ത സ്റ്റോക്ക് സ്റ്റോറിലേക്ക് തിരികെ, രേഖപ്പെടുത്തി" },
      { code: "FB-CLOSE-04", en: "Machines, counter, trays, floor, bins deep-cleaned", ml: "മെഷീൻ, കൗണ്ടർ, ട്രേ, തറ, ബിൻ ആഴത്തിൽ വൃത്തിയാക്കി", photo: true },
      { code: "FB-CLOSE-05", en: "Cash counted & reconciled to POS report", ml: "ക്യാഷ് എണ്ണി POS റിപ്പോർട്ടുമായി ഒത്തു" },
      { code: "FB-STK-05", en: "Items at/below par flagged for reorder", ml: "പാർ-ലെവലിലുള്ള ഇനങ്ങൾ റീഓർഡറിന് അടയാളപ്പെടുത്തി" },
      { code: "FB-CLOSE-06", en: "Chiller/POS/lights off, counter locked", ml: "ചില്ലർ/POS/ലൈറ്റ് ഓഫ്, കൗണ്ടർ പൂട്ടി" },
      { code: "FB-CLOSE-07", en: "Signed out on duty register", ml: "ഡ്യൂട്ടി രജിസ്റ്ററിൽ സൈൻ ഔട്ട് ചെയ്തു" },
    ],
  },
};

export const CHECKLIST_ORDER: ChecklistType[] = ["opening", "midshift", "closing"];

// ── Runtime shapes ─────────────────────────────────────────────────────────

export interface ChecklistItemState {
  code: string;
  checked: boolean;
  initial: string;
  doneAt: string | null;
  photoUrl: string | null;
}

export interface ClosingRecon {
  posTotal: number | null;
  cashCounted: number | null;
  upiTotal: number | null;
}

export interface ChecklistRun {
  id?: string;
  cinemaId: string;
  date: DateISO;
  type: ChecklistType;
  shift: string;
  status: "in_progress" | "completed";
  staffName: string;
  staffEmail: string | null;
  managerSignoffEmail: string | null;
  managerSignedAt: string | null;
  notes: string;
  extra: Record<string, unknown>;
  items: ChecklistItemState[];
}

/** A fresh, empty run for the given slot (every step unchecked). */
export function blankRun(
  cinemaId: string,
  date: DateISO,
  type: ChecklistType,
  shift = "",
): ChecklistRun {
  return {
    cinemaId,
    date,
    type,
    shift,
    status: "in_progress",
    staffName: "",
    staffEmail: null,
    managerSignoffEmail: null,
    managerSignedAt: null,
    notes: "",
    extra: {},
    items: CHECKLISTS[type].items.map((d) => ({
      code: d.code,
      checked: false,
      initial: "",
      doneAt: null,
      photoUrl: null,
    })),
  };
}

function runRowToRun(row: FbChecklistRunRow, items: FbChecklistItemRow[]): ChecklistRun {
  const def = CHECKLISTS[row.checklist_type];
  const byCode = new Map(items.map((it) => [it.sop_code, it]));
  return {
    id: row.id,
    cinemaId: row.cinema_id,
    date: row.run_date as DateISO,
    type: row.checklist_type,
    shift: row.shift ?? "",
    status: row.status,
    staffName: row.staff_name ?? "",
    staffEmail: row.staff_email,
    managerSignoffEmail: row.manager_signoff_email,
    managerSignedAt: row.manager_signed_at,
    notes: row.notes ?? "",
    extra: row.extra ?? {},
    // Always project against the current definition so newly-added steps appear.
    items: def.items.map((d) => {
      const it = byCode.get(d.code);
      return {
        code: d.code,
        checked: it?.checked ?? false,
        initial: it?.initial ?? "",
        doneAt: it?.done_at ?? null,
        photoUrl: it?.photo_url ?? null,
      };
    }),
  };
}

// ── Reads (warn + sensible default, never throw) ───────────────────────────

/** Load the saved run for a slot, or null if none exists yet. */
export async function loadRun(
  cinemaId: string,
  date: DateISO,
  type: ChecklistType,
  shift = "",
): Promise<ChecklistRun | null> {
  const sb = getSupabase();
  const { data: runRow, error } = await sb
    .from("fb_checklist_runs")
    .select("*")
    .eq("cinema_id", cinemaId)
    .eq("run_date", date)
    .eq("checklist_type", type)
    .eq("shift", shift)
    .maybeSingle();
  if (error) {
    console.warn("[fbChecklist] loadRun", error.message);
    return null;
  }
  if (!runRow) return null;
  const run = runRow as FbChecklistRunRow;
  const { data: itemRows, error: itemErr } = await sb
    .from("fb_checklist_items")
    .select("*")
    .eq("run_id", run.id);
  if (itemErr) {
    console.warn("[fbChecklist] loadRun items", itemErr.message);
    return runRowToRun(run, []);
  }
  return runRowToRun(run, (itemRows as FbChecklistItemRow[] | null) ?? []);
}

/** All runs for a date — used to show which of the three slots are done. */
export async function listRunsForDate(
  cinemaId: string,
  date: DateISO,
): Promise<FbChecklistRunRow[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("fb_checklist_runs")
    .select("*")
    .eq("cinema_id", cinemaId)
    .eq("run_date", date);
  if (error) {
    console.warn("[fbChecklist] listRunsForDate", error.message);
    return [];
  }
  return (data as FbChecklistRunRow[] | null) ?? [];
}

// ── Writes (throw on error, like fbProducts) ───────────────────────────────

/** Upsert a run + its item rows. Returns the run id. */
export async function saveRun(run: ChecklistRun, updatedBy: string): Promise<string> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("fb_checklist_runs")
    .upsert(
      {
        cinema_id: run.cinemaId,
        run_date: run.date,
        checklist_type: run.type,
        shift: run.shift,
        status: run.status,
        staff_name: run.staffName || null,
        staff_email: run.staffEmail,
        manager_signoff_email: run.managerSignoffEmail,
        manager_signed_at: run.managerSignedAt,
        notes: run.notes || null,
        extra: run.extra ?? {},
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "cinema_id,run_date,checklist_type,shift" },
    )
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const runId = (data as { id: string }).id;

  // Replace the item rows wholesale — simplest correct sync for ≤10 rows.
  const { error: delErr } = await sb
    .from("fb_checklist_items")
    .delete()
    .eq("run_id", runId);
  if (delErr) throw new Error(delErr.message);

  const rows = run.items.map((it, idx) => ({
    run_id: runId,
    sop_code: it.code,
    checked: it.checked,
    done_at: it.doneAt,
    initial: it.initial || null,
    photo_url: it.photoUrl,
    position: idx,
  }));
  const { error: insErr } = await sb.from("fb_checklist_items").insert(rows);
  if (insErr) throw new Error(insErr.message);

  return runId;
}

/** Upload one photo-evidence image, return its public URL. */
export async function uploadChecklistPhoto(
  file: File,
  cinemaId: string,
  date: DateISO,
  sopCode: string,
): Promise<string> {
  const sb = getSupabase();
  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `${cinemaId}/${date}/${sopCode}-${Date.now()}.${ext}`;
  const { error } = await sb.storage
    .from("fb-checklist-photos")
    .upload(path, file, { upsert: false });
  if (error) throw new Error(error.message);
  const { data } = sb.storage.from("fb-checklist-photos").getPublicUrl(path);
  return data.publicUrl;
}

/** Progress helper: how many steps are checked. */
export function runProgress(run: ChecklistRun): { done: number; total: number } {
  return { done: run.items.filter((i) => i.checked).length, total: run.items.length };
}
