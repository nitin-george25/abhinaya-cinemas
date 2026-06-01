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

export interface Movie {
  id: UUID;
  name: string;
  distributor?: string;
  release?: DateISO;
  share: number;                  // distributor share %, e.g. 60
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
}

export interface Entry {
  id: UUID;
  date?: DateISO;
  movieId: UUID;
  screenId: UUID;
  share: number;                  // distributor share % for this run
  shows?: Show[];
}

// ── Top-level app state (engine input) ───────────────────────────────────

export interface AppState {
  cinema: Cinema;
  tax: TaxConfig;
  classes: ClassDef[];
  screens: Screen[];
  movies: Movie[];
  serialStarts: SerialStart[];
  openings: Opening[];
  entries: Entry[];
  fbEntries: FbEntry[];
  draft: Entry | null;
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
}

export interface SerialRange {
  from: number | string;
  to: number | string;
}
