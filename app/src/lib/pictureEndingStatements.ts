// ============================================================================
// Picture Ending statements DAL.
//
// Persists a generated statement with a running per-cinema statement number,
// plus a frozen snapshot of the computed weeks/totals/advances so a re-print
// is identical even if the underlying DCR entries are later edited.
// Transactional table, loaded on demand. RLS scopes to cinema + role.
// ============================================================================

import { getSupabase } from "./supabase";
import type { PictureEndingStatementRow } from "./db-types";
import type {
  PictureEndingAdvance,
  PictureEndingComputed,
  PictureEndingTotals,
  PictureEndingWeek,
} from "./pictureEnding";

export interface SavedPictureEndingStatement {
  id: string;
  statementNo: number;
  movieId?: string;
  distributorId?: string;
  movieName?: string;
  movieFormat?: string;
  distributorName?: string;
  theatreName?: string;
  representative?: string;
  statementDate: string;
  runFrom?: string;
  runTo?: string;
  holdOverDate?: string;
  taxKind: "intra" | "inter";
  gstPct: number;
  publicityPct: number;
  tdsPct: number;
  flexCharge: number;
  holdOverAmount: number;
  roundOff: number;
  weeks: PictureEndingWeek[];
  totals: PictureEndingTotals;
  advances: PictureEndingAdvance[];
  status: "draft" | "final" | "sent";
  notes?: string;
  createdAt?: string;
}

function toSaved(r: PictureEndingStatementRow): SavedPictureEndingStatement {
  return {
    id: r.id,
    statementNo: r.statement_no,
    movieId: r.movie_id ?? undefined,
    distributorId: r.distributor_id ?? undefined,
    movieName: r.movie_name ?? undefined,
    movieFormat: r.movie_format ?? undefined,
    distributorName: r.distributor_name ?? undefined,
    theatreName: r.theatre_name ?? undefined,
    representative: r.representative ?? undefined,
    statementDate: r.statement_date,
    runFrom: r.run_from ?? undefined,
    runTo: r.run_to ?? undefined,
    holdOverDate: r.hold_over_date ?? undefined,
    taxKind: r.tax_kind,
    gstPct: Number(r.gst_pct),
    publicityPct: Number(r.publicity_pct),
    tdsPct: Number(r.tds_pct),
    flexCharge: Number(r.flex_charge),
    holdOverAmount: Number(r.hold_over_amount),
    roundOff: Number(r.round_off),
    weeks: (r.weeks as PictureEndingWeek[] | null) ?? [],
    totals: (r.totals as PictureEndingTotals | null) ?? ({} as PictureEndingTotals),
    advances: (r.advances as PictureEndingAdvance[] | null) ?? [],
    status: r.status,
    notes: r.notes ?? undefined,
    createdAt: r.created_at ?? undefined,
  };
}

/** All statements for a cinema, newest first. */
export async function listPictureEndingStatements(
  cinemaId: string,
): Promise<SavedPictureEndingStatement[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("picture_ending_statements")
    .select("*")
    .eq("cinema_id", cinemaId)
    .order("statement_no", { ascending: false });
  if (error) {
    console.warn("[pictureEndingStatements] list", error.message);
    return [];
  }
  return ((data as PictureEndingStatementRow[] | null) ?? []).map(toSaved);
}

export interface SaveStatementOpts {
  movieFormat?: string;
  theatreName?: string;
  representative?: string;
  status?: "draft" | "final" | "sent";
  notes?: string;
}

/**
 * Persist a computed statement with the next per-cinema statement number.
 * Snapshots the identity + computed weeks/totals so a re-print is stable.
 */
export async function savePictureEndingStatement(
  cinemaId: string,
  computed: PictureEndingComputed,
  email: string,
  opts: SaveStatementOpts = {},
): Promise<SavedPictureEndingStatement> {
  const sb = getSupabase();

  // Next running number: one past the current max for this cinema.
  const { data: maxRow } = await sb
    .from("picture_ending_statements")
    .select("statement_no")
    .eq("cinema_id", cinemaId)
    .order("statement_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextNo = ((maxRow as { statement_no: number } | null)?.statement_no ?? 0) + 1;

  const { inputs, totals } = computed;
  const { data, error } = await sb
    .from("picture_ending_statements")
    .insert({
      cinema_id: cinemaId,
      statement_no: nextNo,
      movie_id: computed.movie.id,
      distributor_id: computed.movie.distributorId ?? null,
      movie_name: computed.movie.name,
      movie_format: opts.movieFormat ?? inputs.movieFormat ?? null,
      distributor_name: computed.distributor?.name ?? computed.movie.distributor ?? null,
      theatre_name: opts.theatreName ?? inputs.theatreName ?? null,
      representative: opts.representative ?? inputs.representative ?? null,
      statement_date: inputs.statementDate,
      run_from: computed.runFrom ?? null,
      run_to: computed.runTo ?? null,
      hold_over_date: computed.holdOverDate,
      tax_kind: inputs.taxKind,
      gst_pct: inputs.gstPct,
      publicity_pct: inputs.publicityPct,
      tds_pct: inputs.tdsPct,
      flex_charge: inputs.flexCharge,
      hold_over_amount: inputs.holdOverAmount,
      round_off: totals.roundOff,
      weeks: computed.weeks,
      totals,
      advances: inputs.advances,
      status: opts.status ?? "final",
      notes: opts.notes ?? null,
      created_by: email,
      updated_by: email,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return toSaved(data as PictureEndingStatementRow);
}

/** Delete a statement (owner cleanup). */
export async function deletePictureEndingStatement(id: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("picture_ending_statements").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
