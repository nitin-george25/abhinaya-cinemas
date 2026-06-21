// ============================================================================
// Domain types for the Abhinaya Cinemas DCR engine.
//
// Mirrors the in-memory shape used by admin/dcr/js/01-box-office.js so the
// TypeScript port can consume the same data without conversion. Field names
// and structure are intentionally identical to the legacy JS state — do NOT
// rename or restructure without a corresponding migration plan.
// ============================================================================

export type UUID = string;
export type DateISO = string;     // YYYY-MM-DD
export type TimeHHMM = string;    // HH:MM in 24-hour, e.g. "13:30"

// ── Configuration ────────────────────────────────────────────────────────

export interface Cinema {
  name: string;
  gstin: string;
  /** WhatsApp integration config (Cloud API). Optional — when unset the
   *  Send via WhatsApp button is hidden and auto-send is a no-op. */
  whatsapp?: WhatsappConfig;
}

/** WhatsApp Cloud API integration config. Stored in `config.cinema.whatsapp`. */
export interface WhatsappConfig {
  /** E.164 recipient number, e.g. "+919876543210". */
  recipient?: string;
  /** When true, the entry-save hook fires send for any show with
   *  lastShow=true that has no whatsappSentAt yet. */
  autoSendOnLastShow?: boolean;
  /** Approved template name registered with Meta. */
  templateName?: string;
  /** Language code for the template — defaults to "en". */
  templateLang?: string;
}

/** Slab-specific eTax / GST percentages. */
export interface TaxRates {
  etaxPct: number;
  gstPct: number;
}

/**
 * Full tax configuration. Two slabs — above/below a threshold ticket price —
 * plus fixed per-ticket charges and a representative-batta lookup table.
 *
 * Locked by the business; do not rename fields or change defaults without
 * Nitin's explicit sign-off — these flow into legal DCR PDFs.
 */
export interface TaxConfig {
  threshold: number;     // gross ticket price at/below which `below` rates apply
  above: TaxRates;       // rates when gross > threshold
  below: TaxRates;       // rates when gross <= threshold
  tmc: number;           // theatre maintenance cess (₹/ticket)
  cess: number;          // additional cess (₹/ticket)
  repDay: number;        // representative batta — daytime show (per show)
  repNight: number;      // representative batta — night show (per show, 23:00–08:59)
  rep1: number;          // entry-wide rep batta when 1 real show
  rep2: number;          // entry-wide rep batta when 2-4 real shows
  rep5: number;          // entry-wide rep batta when 5+ real shows
}

// ── Catalog ──────────────────────────────────────────────────────────────

export interface ClassDef {
  id: UUID;
  name: string;
  gstPct: number;        // legacy field kept on the class itself for migration;
                         // engine uses TaxConfig at runtime, not this value.
}

export interface ScreenClassAssignment {
  classId: UUID;
  seats: number;
  /**
   * False for historical-era classes kept only so old entries still compute
   * (e.g. backfilled 2019-26 layouts). Absent/true = part of the screen's
   * CURRENT layout: offered on new entries and counted in occupancy.
   */
  active?: boolean;
}

export interface PriceCard {
  id: UUID;
  name: string;
  prices: Record<UUID, number>;   // classId -> printed ticket price (gross)
}

export interface Screen {
  id: UUID;
  name: string;
  classes: ScreenClassAssignment[];
  priceCards: PriceCard[];
}

export type MovieStatus = "coming_soon" | "now_showing" | "past";

/** A distributor (the company a film's box-office share is settled with),
 *  with a point-of-contact for chasing settlements. Cinema-scoped. */
export interface Distributor {
  id: UUID;
  name: string;
  pocName?: string;
  pocContact?: string;
  pocEmail?: string;
}

export interface Movie {
  id: UUID;
  name: string;
  /** Denormalized distributor name. Kept as the display string written onto
   *  every DCR / PDF / CSV (a filed document must render the name it was
   *  filed with). Set from the linked `distributorId` on save. */
  distributor?: string;
  /** FK into the `distributors` catalog. The Movies UI picks this from a
   *  dropdown; `distributor` above is kept in sync as the display name. */
  distributorId?: UUID;
  release?: DateISO;
  share: number;                  // distributor share %, e.g. 60
  /** Public URL to the movie poster in the `movie-posters` bucket. The
   *  create form makes this mandatory client-side; pre-existing rows
   *  may have it undefined (column is nullable per migration 13). */
  posterUrl?: string;
  /** YouTube (or any) trailer URL. Played by the landing-page hero CTA.
   *  Migration 16. */
  trailerUrl?: string;
  /** When true, this movie drives the landing-page hero film. At most one
   *  movie is featured at a time (enforced in the Movies settings UI).
   *  Migration 16. */
  featured?: boolean;
  /** Owner's manual status pin. `undefined` = "Auto": the server-side
   *  engine derives status from release date + last DCR (migration 16).
   *  When set, the engine respects this value. This is the only status the
   *  app authoritatively writes. */
  statusOverride?: MovieStatus;
  /** Effective programme status, DERIVED server-side (migration 16) and
   *  read-only in the app. Drives the public landing page. May be undefined
   *  until the first sync after a movie is created. */
  status?: MovieStatus;
  /** Per-run-week distributor share % overrides, keyed by 1-based run week
   *  (week 1 = release day .. release+6). When a week has a value, the engine
   *  uses it for EVERY DCR whose date falls in that run week (see
   *  resolveShare), overriding the entry's stored share. Edited in
   *  Settings → Movies and NOT subject to the 2-day DCR edit lock; resolved at
   *  compute time so a change reflects across all of that week's DCRs without
   *  rewriting any entry. Weeks left unset fall back to the entry's own share
   *  (which itself defaults from `share`). */
  weekShares?: Record<number, number>;
}

export interface SerialStart {
  id: UUID;
  screenId: UUID;
  date: DateISO;
  starts: Record<UUID, number>;   // classId -> starting ticket serial that day
}

/** Pre-tool opening balances (manually entered for movies that ran before
 * adoption of the tool). Added to cumulative totals. */
export interface Opening {
  id: UUID;
  movieId: UUID;
  screenId: UUID;
  date: DateISO;
  vals: Partial<CumulativeRow>;
}

// ── Daily entry ──────────────────────────────────────────────────────────

export interface ShowRow {
  tickets?: number;
}

export interface Show {
  showtime?: TimeHHMM;
  freePass?: number;
  priceCardId?: UUID;
  rows?: Record<UUID, ShowRow>;   // classId -> { tickets }
  /** Marks the last show of the day — message generator appends day totals. */
  lastShow?: boolean;
  /** Optional online ticket sales (₹), used in the after-show message card. */
  online?: number;
  /** ISO timestamp recording when this show's WhatsApp message was sent.
   *  Used by the auto-send hook to avoid duplicate fires. */
  whatsappSentAt?: string;
}

export interface Entry {
  id: UUID;
  date?: DateISO;
  movieId: UUID;
  screenId: UUID;
  share: number;                  // distributor share % for this run
  shows?: Show[];
  /** Count of shows scheduled but NOT run that day (strike, power cut,
   *  festival closure…). Lets the calculated movie status (cash_20) tell
   *  a genuine cancelled day (still "now showing") apart from an
   *  accidental empty entry (0 tickets, 0 cancelled → ignored). Never
   *  read by the DCR math engine. */
  cancelledShows?: number;
}

// ── Top-level app state (engine input) ───────────────────────────────────

export interface AppState {
  cinema: Cinema;
  tax: TaxConfig;
  classes: ClassDef[];
  screens: Screen[];
  movies: Movie[];
  distributors: Distributor[];
  serialStarts: SerialStart[];
  openings: Opening[];
  entries: Entry[];
  fbEntries: FbEntry[];
  fbProducts: FbProduct[];
  draft: Entry | null;
}

/** F&B menu catalog item. Owner-only edit; everyone reads. */
export interface FbProduct {
  id: UUID;
  name: string;
  category: string;
  defaultRate: number;
  defaultGstPct: number;
  posItemNumber?: string;
  isActive: boolean;
}

// ── Food & Beverage ────────────────────────────────────────────────────
//
// One row per date (the cinema is single-screen for F&B reporting; the
// `fb_entries.entry_date` column is the table's unique key). `summary`
// and `items` are stored in the DB as JSONB blobs.

export interface FbItem {
  name: string;
  qty: number;
  netAmount: number;
  category?: string;
}

/**
 * The shape the legacy app stores in `fb_entries.summary`. All fields are
 * optional because not every POS export populates every figure. Use N()
 * to coerce when reading.
 */
export interface FbSummary {
  grossSales?: number;
  foodSales?: number;
  beveragesSales?: number;
  addTax?: number;
  netSalesWithTax?: number;
  bills?: number | null;
  // Escape hatch for any fields we haven't typed yet.
  [key: string]: unknown;
}

export interface FbEntry {
  id: UUID;
  date: DateISO;
  summary: FbSummary;
  items: FbItem[];
  notes?: string;
  /** Write origin. 'zoho' rows are imported from Zoho Books (source of truth
   *  for F&B sales) and are read-only in the UI + never pushed/reaped by the
   *  sync engine. Undefined / 'manual' = operator- or DSR-entered. */
  source?: "manual" | "zoho";
}

// ── Computed output shapes ───────────────────────────────────────────────

export interface TaxBreakdown {
  gross: number;
  poa: number;
  etax: number;
  gst: number;
  tmc: number;
  cess: number;
  etaxPct: number;
  gstPct: number;
}

export interface ComputedShowRow {
  cls: string;
  seats: number;
  poa: number;
  gross: number;
  from: number | string;          // ticket serial range start — '' when no
  to: number | string;            // starting serial defined; 'NA' for empty shows
  tickets: number;
  grossColl: number;
  totalPOA: number;
  tmc: number;
  cess: number;
  etax: number;
  total: number;                  // totalPOA + tmc + cess + etax
  gst: number;
}

export interface ComputedShowTotals {
  tickets: number;
  grossColl: number;
  totalPOA: number;
  tmc: number;
  cess: number;
  etax: number;
  total: number;
  gst: number;
}

export interface ComputedShow {
  showtime?: TimeHHMM;
  freePass?: number;
  card: PriceCard | undefined;
  rows: ComputedShowRow[];
  totals: ComputedShowTotals;
  repBatta: number;               // per-show batta from repDay/repNight
}

export interface ComputedEntryGrand extends ComputedShowTotals {
  repBatta: number;               // OVERWRITTEN with entry-wide lookup by realShowCount
}

export interface CumulativeRow {
  grossColl: number;
  tmc: number;
  cess: number;
  fund: number;
  repBatta: number;
  netShare: number;
  distShare: number;
  exShare: number;
  etax: number;
  gst: number;
  audience: number;
}

export interface ComputedEntry {
  movie: Movie | undefined;
  screen: Screen | undefined;
  entry: Entry;
  shows: ComputedShow[];
  grand: ComputedEntryGrand;
  today: CumulativeRow;
  previous: CumulativeRow;
  total: CumulativeRow;            // previous + today
  runningDay: number | '';
  share: number;
  fund: number;
}

// Re-exported for convenience in engine internals.
export interface ResolvedClass {
  classId: UUID;
  name: string;
  gstPct: number;
  seats: number;
  /** Mirrors ScreenClassAssignment.active (absent = true). */
  active: boolean;
}

export interface SerialRange {
  from: number | string;
  to: number | string;
}
