// ============================================================================
// Distributor payments DAL.
//
// Money already paid to a distributor — the "ADVANCE" lines on a Picture
// Ending Statement (RTGS / cheque / etc.) plus the final settlement payment.
// A transactional table loaded on demand (not part of the config blob), mirror
// of the guides / invoices DAL pattern. RLS scopes every query to the caller's
// cinema + owner/manager/accountant role.
// ============================================================================

import { getSupabase } from "./supabase";
import type { DistributorPaymentRow } from "./db-types";

export interface DistributorPayment {
  id: string;
  cinemaId: string;
  distributorId?: string;
  movieId?: string;
  paidOn: string;        // YYYY-MM-DD
  amount: number;
  mode?: string;
  instrumentRef?: string;
  bank?: string;
  kind: "advance" | "settlement";
  note?: string;
}

export interface DistributorPaymentInput {
  distributorId?: string | null;
  movieId?: string | null;
  paidOn: string;
  amount: number;
  mode?: string | null;
  instrumentRef?: string | null;
  bank?: string | null;
  kind?: "advance" | "settlement";
  note?: string | null;
}

function toPayment(r: DistributorPaymentRow): DistributorPayment {
  return {
    id: r.id,
    cinemaId: r.cinema_id,
    distributorId: r.distributor_id ?? undefined,
    movieId: r.movie_id ?? undefined,
    paidOn: r.paid_on,
    amount: Number(r.amount),
    mode: r.mode ?? undefined,
    instrumentRef: r.instrument_ref ?? undefined,
    bank: r.bank ?? undefined,
    kind: r.kind,
    note: r.note ?? undefined,
  };
}

export interface ListPaymentsOpts {
  movieId?: string;
  distributorId?: string;
}

/**
 * Payments for a cinema, newest first. Filter to a movie and/or distributor —
 * the Picture Ending page pulls the advances tied to the film being settled.
 * Returns [] (and warns) on error so the page still renders.
 */
export async function listDistributorPayments(
  cinemaId: string,
  opts: ListPaymentsOpts = {},
): Promise<DistributorPayment[]> {
  const sb = getSupabase();
  let q = sb
    .from("distributor_payments")
    .select("*")
    .eq("cinema_id", cinemaId)
    .order("paid_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (opts.movieId) q = q.eq("movie_id", opts.movieId);
  if (opts.distributorId) q = q.eq("distributor_id", opts.distributorId);
  const { data, error } = await q;
  if (error) {
    console.warn("[distributorPayments] list", error.message);
    return [];
  }
  return ((data as DistributorPaymentRow[] | null) ?? []).map(toPayment);
}

function toRow(input: DistributorPaymentInput) {
  return {
    distributor_id: input.distributorId ?? null,
    movie_id: input.movieId ?? null,
    paid_on: input.paidOn,
    amount: input.amount,
    mode: input.mode ?? null,
    instrument_ref: input.instrumentRef ?? null,
    bank: input.bank ?? null,
    kind: input.kind ?? "advance",
    note: input.note ?? null,
  };
}

/** Record a payment. Returns the created row. */
export async function addDistributorPayment(
  cinemaId: string,
  input: DistributorPaymentInput,
  email: string,
): Promise<DistributorPayment> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("distributor_payments")
    .insert({ cinema_id: cinemaId, ...toRow(input), created_by: email, updated_by: email })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return toPayment(data as DistributorPaymentRow);
}

/** Update a payment. */
export async function updateDistributorPayment(
  id: string,
  input: DistributorPaymentInput,
  email: string,
): Promise<DistributorPayment> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("distributor_payments")
    .update({ ...toRow(input), updated_by: email })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return toPayment(data as DistributorPaymentRow);
}

/** Delete a payment. */
export async function deleteDistributorPayment(id: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("distributor_payments").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
