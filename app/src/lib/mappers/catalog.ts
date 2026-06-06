// ============================================================================
// Catalog mappers — bridge the normalized tables (cinemas, classes, screens,
// price_cards, movies, etc) with the AppState shape the engine consumes.
//
// READ path (composeCatalogFromRows):
//   N parallel table fetches → CatalogReadResult { cinemaId, catalog }.
//   catalog is a Partial<AppState> that gets merged onto a base state.
//
// WRITE path (pushCatalogDeltas):
//   Compares a prev/next snapshot of the catalog and produces upserts +
//   deletes per table. Returns a promise that settles when all per-table
//   writes have completed (best-effort — failures are logged, not thrown).
//
// Dual-write Phase 3: config.data remains authoritative. These mappers
// keep the normalized tables in sync so we can validate them against the
// blob without flipping authority yet.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CinemaRow,
  ClassRow,
  MovieRow,
  OpeningRow,
  PriceCardPriceRow,
  PriceCardRow,
  ScreenClassRow,
  ScreenRow,
  SerialStartClassRow,
  SerialStartRow,
  TaxConfigRow,
} from "../db-types";
import type {
  AppState,
  Cinema,
  ClassDef,
  Movie,
  Opening,
  PriceCard,
  Screen,
  SerialStart,
  TaxConfig,
  UUID,
} from "../types";

// ── READ ────────────────────────────────────────────────────────────────

export interface CatalogReadResult {
  cinemaId: string;
  /** Partial<AppState> containing exactly the catalog slice. */
  catalog: Pick<
    AppState,
    "cinema" | "tax" | "classes" | "screens" | "movies" | "serialStarts" | "openings"
  >;
}

/**
 * Fetch every catalog table in parallel for the given cinema and compose the
 * AppState catalog slice. Returns null when the cinemas table is empty —
 * the caller should fall back to config.data in that case.
 */
export async function readCatalog(
  client: SupabaseClient,
  cinemaId?: string,
): Promise<CatalogReadResult | null> {
  // 1) Pick a cinema. For single-cinema setups (today's reality) just grab
  //    the first row. Multi-cinema future passes a specific id.
  let cid = cinemaId;
  if (!cid) {
    const c = await client
      .from("cinemas")
      .select("id")
      .is("archived_at", null)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    cid = (c.data as { id: string } | null)?.id;
    if (!cid) return null;
  }

  const [
    cinemaRes,
    taxRes,
    classRes,
    screenRes,
    screenClassRes,
    pcRes,
    pcpRes,
    movieRes,
    ssRes,
    sscRes,
    openingRes,
  ] = await Promise.all([
    client.from("cinemas").select("*").eq("id", cid).maybeSingle(),
    client.from("tax_configs").select("*").eq("cinema_id", cid),
    client.from("classes").select("*").eq("cinema_id", cid).is("archived_at", null),
    client.from("screens").select("*").eq("cinema_id", cid).is("archived_at", null),
    client.from("screen_classes").select("*, screens!inner(cinema_id)")
      .eq("screens.cinema_id", cid),
    client.from("price_cards").select("*, screens!inner(cinema_id)")
      .eq("screens.cinema_id", cid).is("archived_at", null),
    client.from("price_card_prices").select("*, price_cards!inner(screen_id, screens!inner(cinema_id))")
      .eq("price_cards.screens.cinema_id", cid),
    client.from("movies").select("*").eq("cinema_id", cid).is("archived_at", null),
    client.from("serial_starts").select("*, screens!inner(cinema_id)")
      .eq("screens.cinema_id", cid),
    client.from("serial_start_classes").select("*, serial_starts!inner(screen_id, screens!inner(cinema_id))")
      .eq("serial_starts.screens.cinema_id", cid),
    client.from("openings").select("*, screens!inner(cinema_id)")
      .eq("screens.cinema_id", cid),
  ]);

  return composeCatalogFromRows({
    cinemaId: cid,
    cinema:             (cinemaRes.data as CinemaRow | null),
    taxConfigs:         (taxRes.data       as TaxConfigRow[] | null) ?? [],
    classes:            (classRes.data     as ClassRow[]     | null) ?? [],
    screens:            (screenRes.data    as ScreenRow[]    | null) ?? [],
    screenClasses:      (screenClassRes.data as ScreenClassRow[] | null) ?? [],
    priceCards:         (pcRes.data        as PriceCardRow[] | null) ?? [],
    priceCardPrices:    (pcpRes.data       as PriceCardPriceRow[] | null) ?? [],
    movies:             (movieRes.data     as MovieRow[]     | null) ?? [],
    serialStarts:       (ssRes.data        as SerialStartRow[] | null) ?? [],
    serialStartClasses: (sscRes.data       as SerialStartClassRow[] | null) ?? [],
    openings:           (openingRes.data   as OpeningRow[]   | null) ?? [],
  });
}

/** Pure transform — testable without a Supabase client. */
export function composeCatalogFromRows(args: {
  cinemaId: string;
  cinema:             CinemaRow | null;
  taxConfigs:         TaxConfigRow[];
  classes:            ClassRow[];
  screens:            ScreenRow[];
  screenClasses:      ScreenClassRow[];
  priceCards:         PriceCardRow[];
  priceCardPrices:    PriceCardPriceRow[];
  movies:             MovieRow[];
  serialStarts:       SerialStartRow[];
  serialStartClasses: SerialStartClassRow[];
  openings:           OpeningRow[];
}): CatalogReadResult | null {
  if (!args.cinema) return null;

  // Cinema → legacy {name, gstin}. Composed display name keeps current UI.
  const cinema: Cinema = {
    name: `${args.cinema.brand_name}: ${args.cinema.location}`,
    gstin: args.cinema.gstin ?? "",
  };

  // Tax: pick the row currently in effect (valid_to is null OR valid_to >= today).
  const today = new Date().toISOString().slice(0, 10);
  const activeTax =
    args.taxConfigs.find((t) => t.valid_from <= today && (t.valid_to == null || t.valid_to >= today))
    ?? args.taxConfigs[args.taxConfigs.length - 1]
    ?? null;
  const tax: TaxConfig = activeTax
    ? {
        threshold: Number(activeTax.threshold),
        above: { etaxPct: Number(activeTax.above_etax_pct), gstPct: Number(activeTax.above_gst_pct) },
        below: { etaxPct: Number(activeTax.below_etax_pct), gstPct: Number(activeTax.below_gst_pct) },
        tmc:    Number(activeTax.tmc),
        cess:   Number(activeTax.cess),
        repDay: Number(activeTax.rep_day),
        repNight: Number(activeTax.rep_night),
        rep1: Number(activeTax.rep_1),
        rep2: Number(activeTax.rep_2),
        rep5: Number(activeTax.rep_5),
      }
    : {
        threshold: 0,
        above: { etaxPct: 0, gstPct: 0 },
        below: { etaxPct: 0, gstPct: 0 },
        tmc: 0, cess: 0, repDay: 0, repNight: 0, rep1: 0, rep2: 0, rep5: 0,
      };

  const classes: ClassDef[] = args.classes
    .slice()
    .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name))
    .map((c) => ({
      id: c.id as UUID,
      name: c.name,
      gstPct: Number(c.gst_pct),
    }));

  // Build per-screen class assignments + price cards.
  const screenClassesByScreen = groupBy(args.screenClasses, (r) => r.screen_id);
  const priceCardsByScreen    = groupBy(args.priceCards, (r) => r.screen_id);
  const priceCardPricesByCard = groupBy(args.priceCardPrices, (r) => r.price_card_id);

  const screens: Screen[] = args.screens
    .slice()
    .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name))
    .map((s) => {
      const scAssignments = (screenClassesByScreen[s.id] ?? []).map((sc) => ({
        classId: sc.class_id as UUID,
        seats:   Number(sc.seats),
      }));
      const cards: PriceCard[] = (priceCardsByScreen[s.id] ?? [])
        .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name))
        .map((pc) => {
          const prices: Record<UUID, number> = {};
          (priceCardPricesByCard[pc.id] ?? []).forEach((pp) => {
            prices[pp.class_id as UUID] = Number(pp.price);
          });
          return { id: pc.id as UUID, name: pc.name, prices };
        });
      return {
        id: s.id as UUID,
        name: s.name,
        classes: scAssignments,
        priceCards: cards,
      };
    });

  const movies: Movie[] = args.movies
    .slice()
    .sort((a, b) => (b.release_date ?? "").localeCompare(a.release_date ?? ""))
    .map((m) => ({
      id: m.id as UUID,
      name: m.name,
      distributor: m.distributor ?? undefined,
      release: m.release_date ?? undefined,
      share: Number(m.share_pct),
      posterUrl: m.poster_url ?? undefined,
      trailerUrl: m.trailer_url ?? undefined,
      featured: m.is_featured ?? false,
      statusOverride: m.status_override ?? undefined,
      // `status` is server-derived (migration 16) and read-only here.
      status: m.status ?? undefined,
    }));

  const ssClassesByStart = groupBy(args.serialStartClasses, (r) => r.serial_start_id);
  const serialStarts: SerialStart[] = args.serialStarts.map((ss) => {
    const starts: Record<UUID, number> = {};
    (ssClassesByStart[ss.id] ?? []).forEach((sk) => {
      starts[sk.class_id as UUID] = Number(sk.starting_number);
    });
    return {
      id: ss.id as UUID,
      screenId: ss.screen_id as UUID,
      date: ss.start_date,
      starts,
    };
  });

  const openings: Opening[] = args.openings.map((o) => ({
    id: o.id as UUID,
    movieId: o.movie_id as UUID,
    screenId: o.screen_id as UUID,
    date: o.open_date,
    vals: (o.vals ?? {}) as Opening["vals"],
  }));

  return {
    cinemaId: args.cinemaId,
    catalog: { cinema, tax, classes, screens, movies, serialStarts, openings },
  };
}

// ── WRITE ───────────────────────────────────────────────────────────────

/** Track which IDs we've seen in each catalog table, so we can compute deletes. */
export interface CatalogSyncCache {
  classes:           Set<string>;
  screens:           Set<string>;
  screenClasses:     Set<string>;    // `${screen_id}|${class_id}`
  priceCards:        Set<string>;
  priceCardPrices:   Set<string>;    // `${price_card_id}|${class_id}`
  movies:            Set<string>;
  serialStarts:      Set<string>;
  serialStartClasses: Set<string>;   // `${serial_start_id}|${class_id}`
  openings:          Set<string>;
}

export function emptyCatalogSyncCache(): CatalogSyncCache {
  return {
    classes: new Set(), screens: new Set(), screenClasses: new Set(),
    priceCards: new Set(), priceCardPrices: new Set(),
    movies: new Set(), serialStarts: new Set(), serialStartClasses: new Set(),
    openings: new Set(),
  };
}

/** Populate the cache from a freshly-pulled CatalogReadResult. */
export function catalogCacheFromAppState(s: AppState): CatalogSyncCache {
  const out = emptyCatalogSyncCache();
  s.classes.forEach((c) => out.classes.add(c.id));
  s.screens.forEach((scr) => {
    out.screens.add(scr.id);
    scr.classes.forEach((sc) => out.screenClasses.add(`${scr.id}|${sc.classId}`));
    scr.priceCards.forEach((pc) => {
      out.priceCards.add(pc.id);
      Object.keys(pc.prices ?? {}).forEach((cid) =>
        out.priceCardPrices.add(`${pc.id}|${cid}`),
      );
    });
  });
  s.movies.forEach((m) => out.movies.add(m.id));
  s.serialStarts.forEach((ss) => {
    out.serialStarts.add(ss.id);
    Object.keys(ss.starts ?? {}).forEach((cid) =>
      out.serialStartClasses.add(`${ss.id}|${cid}`),
    );
  });
  s.openings.forEach((o) => out.openings.add(o.id));
  return out;
}

/**
 * Push the catalog half of `next` to the normalized tables. Compares with
 * `prevCache` (the IDs we last saw) to compute deletes.
 *
 * Returns nothing. Per-table errors are caught + console.error'd so a
 * partial failure doesn't break the simultaneous config.data write.
 */
export async function pushCatalogDeltas(
  client: SupabaseClient,
  next: AppState,
  cinemaId: string,
  email: string,
  prevCache: CatalogSyncCache,
): Promise<CatalogSyncCache> {
  // Build the desired-state row arrays from AppState.
  const wantClasses = next.classes.map((c, i) => ({
    id: c.id,
    cinema_id: cinemaId,
    name: c.name,
    gst_pct: c.gstPct,
    display_order: i,
    updated_by: email,
  }));
  const wantScreens = next.screens.map((s, i) => ({
    id: s.id,
    cinema_id: cinemaId,
    name: s.name,
    display_order: i,
    updated_by: email,
  }));
  const wantScreenClasses = next.screens.flatMap((s) =>
    s.classes.map((sc) => ({
      screen_id: s.id,
      class_id: sc.classId,
      seats: sc.seats,
    })),
  );
  const wantPriceCards = next.screens.flatMap((s) =>
    s.priceCards.map((pc, i) => ({
      id: pc.id,
      screen_id: s.id,
      name: pc.name,
      display_order: i,
      updated_by: email,
    })),
  );
  const wantPriceCardPrices = next.screens.flatMap((s) =>
    s.priceCards.flatMap((pc) =>
      Object.entries(pc.prices ?? {}).map(([cid, price]) => ({
        price_card_id: pc.id,
        class_id: cid,
        price: Number(price),
      })),
    ),
  );
  const wantMovies = next.movies.map((m) => ({
    id: m.id,
    cinema_id: cinemaId,
    name: m.name,
    distributor: m.distributor ?? null,
    release_date: m.release ?? null,
    share_pct: m.share,
    poster_url: m.posterUrl ?? null,
    trailer_url: m.trailerUrl ?? null,
    is_featured: m.featured ?? false,
    // `status` is owned by the server-side engine (migration 16); the app
    // only writes the manual override (null = Auto). Writing `status` here
    // would clobber the calc on every config push.
    status_override: m.statusOverride ?? null,
    updated_by: email,
  }));
  const wantSerialStarts = next.serialStarts.map((ss) => ({
    id: ss.id,
    screen_id: ss.screenId,
    start_date: ss.date,
    updated_by: email,
  }));
  const wantSerialStartClasses = next.serialStarts.flatMap((ss) =>
    Object.entries(ss.starts ?? {}).map(([cid, sn]) => ({
      serial_start_id: ss.id,
      class_id: cid,
      starting_number: Number(sn),
    })),
  );
  const wantOpenings = next.openings.map((o) => ({
    id: o.id,
    movie_id: o.movieId,
    screen_id: o.screenId,
    open_date: o.date,
    vals: o.vals ?? {},
    updated_by: email,
  }));

  // Build the new cache up-front (we'll diff against prevCache for deletes).
  const nextCache = catalogCacheFromAppState(next);

  // ── upserts ────────────────────────────────────────────────────────
  const tasks: Array<Promise<unknown>> = [];
  if (wantClasses.length)            tasks.push(safeUpsert(client, "classes", wantClasses, "id"));
  if (wantScreens.length)            tasks.push(safeUpsert(client, "screens", wantScreens, "id"));
  if (wantScreenClasses.length)      tasks.push(safeUpsert(client, "screen_classes", wantScreenClasses, "screen_id,class_id"));
  if (wantPriceCards.length)         tasks.push(safeUpsert(client, "price_cards", wantPriceCards, "id"));
  if (wantPriceCardPrices.length)    tasks.push(safeUpsert(client, "price_card_prices", wantPriceCardPrices, "price_card_id,class_id"));
  if (wantMovies.length)             tasks.push(safeUpsert(client, "movies", wantMovies, "id"));
  if (wantSerialStarts.length)       tasks.push(safeUpsert(client, "serial_starts", wantSerialStarts, "id"));
  if (wantSerialStartClasses.length) tasks.push(safeUpsert(client, "serial_start_classes", wantSerialStartClasses, "serial_start_id,class_id"));
  if (wantOpenings.length)           tasks.push(safeUpsert(client, "openings", wantOpenings, "id"));

  // ── deletes (id present in prevCache, missing in nextCache) ────────
  const droppedSingle = (prev: Set<string>, next: Set<string>) =>
    [...prev].filter((k) => !next.has(k));
  const droppedCompound = (prev: Set<string>, next: Set<string>): Array<[string, string]> =>
    [...prev]
      .filter((k) => !next.has(k))
      .map((k) => {
        const parts = k.split("|");
        return [parts[0] ?? "", parts[1] ?? ""] as [string, string];
      });

  const dClasses    = droppedSingle(prevCache.classes,    nextCache.classes);
  const dScreens    = droppedSingle(prevCache.screens,    nextCache.screens);
  const dPriceCards = droppedSingle(prevCache.priceCards, nextCache.priceCards);
  const dMovies     = droppedSingle(prevCache.movies,     nextCache.movies);
  const dSs         = droppedSingle(prevCache.serialStarts, nextCache.serialStarts);
  const dOpenings   = droppedSingle(prevCache.openings,   nextCache.openings);

  const dScreenClasses        = droppedCompound(prevCache.screenClasses,        nextCache.screenClasses);
  const dPriceCardPrices      = droppedCompound(prevCache.priceCardPrices,      nextCache.priceCardPrices);
  const dSerialStartClasses   = droppedCompound(prevCache.serialStartClasses,   nextCache.serialStartClasses);

  if (dClasses.length)    tasks.push(safeDelete(client, "classes", "id", dClasses));
  if (dScreens.length)    tasks.push(safeDelete(client, "screens", "id", dScreens));
  if (dPriceCards.length) tasks.push(safeDelete(client, "price_cards", "id", dPriceCards));
  if (dMovies.length)     tasks.push(safeDelete(client, "movies", "id", dMovies));
  if (dSs.length)         tasks.push(safeDelete(client, "serial_starts", "id", dSs));
  if (dOpenings.length)   tasks.push(safeDelete(client, "openings", "id", dOpenings));

  for (const [sid, cid] of dScreenClasses) {
    tasks.push(safeDeleteCompound(client, "screen_classes", { screen_id: sid, class_id: cid }));
  }
  for (const [pcid, cid] of dPriceCardPrices) {
    tasks.push(safeDeleteCompound(client, "price_card_prices", { price_card_id: pcid, class_id: cid }));
  }
  for (const [ssid, cid] of dSerialStartClasses) {
    tasks.push(safeDeleteCompound(client, "serial_start_classes", { serial_start_id: ssid, class_id: cid }));
  }

  await Promise.allSettled(tasks);
  return nextCache;
}

// ── helpers ─────────────────────────────────────────────────────────────

function groupBy<T, K extends string>(
  arr: T[],
  key: (item: T) => K,
): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const x of arr) {
    const k = key(x);
    (out[k] ??= [] as T[]).push(x);
  }
  return out;
}

async function safeUpsert(
  client: SupabaseClient,
  table: string,
  rows: Array<Record<string, unknown>>,
  onConflict: string,
): Promise<void> {
  try {
    const r = await client.from(table).upsert(rows, { onConflict });
    if (r.error) console.error(`upsert ${table}:`, r.error.message);
  } catch (e) {
    console.error(`upsert ${table} threw:`, e);
  }
}

async function safeDelete(
  client: SupabaseClient,
  table: string,
  column: string,
  values: string[],
): Promise<void> {
  if (!values.length) return;
  try {
    const r = await client.from(table).delete().in(column, values);
    if (r.error) console.error(`delete ${table}:`, r.error.message);
  } catch (e) {
    console.error(`delete ${table} threw:`, e);
  }
}

async function safeDeleteCompound(
  client: SupabaseClient,
  table: string,
  match: Record<string, string>,
): Promise<void> {
  try {
    const r = await client.from(table).delete().match(match);
    if (r.error) console.error(`delete ${table}:`, r.error.message);
  } catch (e) {
    console.error(`delete ${table} threw:`, e);
  }
}
