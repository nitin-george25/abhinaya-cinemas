// ============================================================================
// Cinema profile DAL.
//
// The in-memory AppState.cinema is intentionally minimal (name + gstin). The
// Picture Ending Statement header needs the full statutory identity — address,
// PAN, ARN, TAN, phone, email — which lives on the `cinemas` row but not in the
// config blob. This reads that row directly. RLS scopes it to the caller's
// cinema, so a bare select is safe.
// ============================================================================

import { getSupabase } from "./supabase";
import type { CinemaRow } from "./db-types";

export interface CinemaProfile {
  id: string;
  name: string;
  location: string;
  gstin?: string;
  pan?: string;
  arn?: string;
  tan?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  phone?: string;
  email?: string;
}

function toProfile(r: CinemaRow): CinemaProfile {
  return {
    id: r.id,
    name: r.brand_name,
    location: r.location,
    gstin: r.gstin ?? undefined,
    pan: r.pan ?? undefined,
    arn: r.arn ?? undefined,
    tan: r.tan ?? undefined,
    addressLine1: r.address_line1 ?? undefined,
    addressLine2: r.address_line2 ?? undefined,
    city: r.city ?? undefined,
    state: r.state ?? undefined,
    pincode: r.pincode ?? undefined,
    country: r.country ?? undefined,
    phone: r.phone ?? undefined,
    email: r.email ?? undefined,
  };
}

/** Full cinema profile for the statement header. null on error / not found. */
export async function getCinemaProfile(cinemaId: string): Promise<CinemaProfile | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("cinemas")
    .select("*")
    .eq("id", cinemaId)
    .maybeSingle();
  if (error) {
    console.warn("[cinemaProfile] getCinemaProfile", error.message);
    return null;
  }
  return data ? toProfile(data as CinemaRow) : null;
}

/** One-line postal address built from the parts that are present. */
export function formatCinemaAddress(p: CinemaProfile): string {
  return [p.addressLine1, p.addressLine2, p.city, p.state, p.pincode]
    .filter((x) => x && String(x).trim())
    .join(", ");
}
