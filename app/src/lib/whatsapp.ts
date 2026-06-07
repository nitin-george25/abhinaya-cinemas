// ============================================================================
// Client helper for the WhatsApp Cloud API integration.
//
// Renders a show card to PNG, uploads to the public `show-messages` bucket,
// then invokes the `send-whatsapp-show` Edge Function with the URL + the
// plain-text body. The Edge Function holds the Meta access token; the
// browser never sees it.
//
// Usage:
//   await sendShowMessage({ state, entry, showIdx, computed });
//
// Returns the Edge Function response or throws on user-actionable errors.
// ============================================================================

import { getSupabase } from "./supabase";
import {
  drawShowCard, showMessageData, buildShowText, safeName,
} from "./whatsappMessage";
import type { AppState, ComputedEntry, Entry } from "./types";

interface SendArgs {
  state: AppState;
  entry: Entry;
  showIdx: number;
  computed: ComputedEntry;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Render the show card image, upload to Storage, then send via the Edge
 * Function. Throws Error with a human-readable message on bad config.
 */
export async function sendShowMessage(args: SendArgs): Promise<SendResult> {
  const { state, entry, showIdx, computed } = args;

  const wa = state.cinema?.whatsapp;
  const recipient = (wa?.recipient ?? "").trim();
  if (!recipient) {
    throw new Error("WhatsApp recipient not configured. Set one in Settings → WhatsApp.");
  }

  const data = showMessageData(state, entry, showIdx, computed);
  if (!data) throw new Error("Couldn't compute the show data.");

  // Render canvas → PNG blob
  const canvas = document.createElement("canvas");
  // Logo is best-effort; if it fails to load we still render without it.
  const logo = await loadLogo("/admin/dcr/img/logomark-white.png").catch(() => null);
  drawShowCard(canvas, data, logo, state.cinema?.name);
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });

  // Upload to Storage
  const sb = getSupabase();
  const path = [
    data.date || "undated",
    `${safeName(data.screen)}_${safeName(data.movie)}_${safeName(data.time || data.ordinal)}_${Date.now()}.png`,
  ].join("/");
  const up = await sb.storage.from("show-messages").upload(path, blob, {
    cacheControl: "3600",
    upsert: false,
    contentType: "image/png",
  });
  if (up.error) {
    throw new Error(`Upload failed: ${up.error.message}`);
  }
  const { data: pub } = sb.storage.from("show-messages").getPublicUrl(path);
  const mediaUrl = pub.publicUrl;

  // Invoke Edge Function
  const text = buildShowText(data);
  const fn = await sb.functions.invoke("send-whatsapp-show", {
    body: {
      recipient,
      mediaUrl,
      text,
      entryDate: entry.date,
      movieId: entry.movieId,
      screenId: entry.screenId,
      showIdx,
    },
  });
  if (fn.error) {
    // Supabase JS surfaces non-2xx as a generic error; try to read the body.
    const body = (fn.data as { error?: string } | null) ?? null;
    return { ok: false, error: body?.error ?? fn.error.message };
  }
  const out = fn.data as SendResult;
  return out;
}

function loadLogo(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("logo load failed"));
    img.src = src;
  });
}
