// ============================================================================
// Abhinaya Cinemas — Public contact form (Supabase Edge Function).
//
// Receives a JSON POST from the landing page contact form and forwards the
// message to hello@abhinayacinemas.com via Resend. Runs alongside the daily
// and weekly digest functions and reuses the same RESEND_API_KEY secret.
//
// Endpoint:  POST https://<project>.supabase.co/functions/v1/contact
// Headers:   apikey: <SUPABASE_ANON_KEY>
//            Authorization: Bearer <SUPABASE_ANON_KEY>
//            Content-Type: application/json
// Body:      { name, email, phone?, message }
// Returns:   200 { ok: true }  |  4xx/5xx { error: string }
//
// Env vars (Supabase Dashboard → Edge Functions → Secrets):
//   RESEND_API_KEY   (already set — shared with daily/weekly digests)
//   CONTACT_TO       (optional — defaults to hello@abhinayacinemas.com)
//   CONTACT_FROM     (optional — defaults to noreply@mail.abhinayacinemas.com)
//
// `verify_jwt = false` is set in supabase/config.toml so the function is
// publicly callable without an authenticated user — anyone hitting the
// public landing page can submit. The apikey header is still required.
//
// Manual test:
//   curl -X POST 'https://xkmjygegtpmmwwnyoufn.supabase.co/functions/v1/contact' \
//     -H "apikey: <SUPABASE_ANON_KEY>" \
//     -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
//     -H "Content-Type: application/json" \
//     -d '{"name":"Test","email":"test@example.com","message":"hello"}'
// ============================================================================

import { Resend } from "https://esm.sh/resend@4.0.0";

interface ContactPayload {
  name?: string;
  email?: string;
  phone?: string;
  message?: string;
}

const TO_DEFAULT   = "hello@abhinayacinemas.com";
const FROM_DEFAULT = "Abhinaya Cinemas <noreply@mail.abhinayacinemas.com>";

const MAX_LEN = { name: 120, email: 254, phone: 40, message: 5000 };

// CORS for direct browser POSTs from the marketing site.
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  // -- parse + validate ----------------------------------------------------
  let body: ContactPayload;
  try {
    body = (await req.json()) as ContactPayload;
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const name    = (body.name    ?? "").trim();
  const email   = (body.email   ?? "").trim();
  const phone   = (body.phone   ?? "").trim();
  const message = (body.message ?? "").trim();

  if (!name || !email || !message) {
    return json(400, { error: "Name, email and message are required" });
  }
  if (name.length > MAX_LEN.name || email.length > MAX_LEN.email ||
      phone.length > MAX_LEN.phone || message.length > MAX_LEN.message) {
    return json(400, { error: "One or more fields exceed maximum length" });
  }
  if (!isEmail(email)) {
    return json(400, { error: "Email address looks invalid" });
  }

  // -- env -----------------------------------------------------------------
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    console.error("[contact] Missing RESEND_API_KEY env var");
    return json(500, { error: "Email service not configured" });
  }
  const to   = Deno.env.get("CONTACT_TO")   || TO_DEFAULT;
  const from = Deno.env.get("CONTACT_FROM") || FROM_DEFAULT;

  // -- compose -------------------------------------------------------------
  const safeName    = escapeHtml(name);
  const safeEmail   = escapeHtml(email);
  const safePhone   = escapeHtml(phone);
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br>");

  const html = `
    <div style="font-family:system-ui,sans-serif;color:#151515;max-width:560px;">
      <h2 style="margin:0 0 16px;color:#FF3720;">New contact form submission</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 12px 6px 0;color:#666;width:90px;">From</td><td>${safeName}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666;">Email</td><td><a href="mailto:${safeEmail}">${safeEmail}</a></td></tr>
        ${phone ? `<tr><td style="padding:6px 12px 6px 0;color:#666;">Phone</td><td>${safePhone}</td></tr>` : ""}
      </table>
      <h3 style="margin:24px 0 8px;font-size:14px;color:#666;text-transform:uppercase;letter-spacing:0.08em;">Message</h3>
      <div style="padding:16px;background:#f6f5ec;border-radius:8px;font-size:15px;line-height:1.55;">${safeMessage}</div>
      <p style="margin-top:24px;font-size:12px;color:#999;">Sent from abhinayacinemas.com contact form.</p>
    </div>
  `.trim();

  const text = [
    `New contact form submission`,
    ``,
    `From:    ${name}`,
    `Email:   ${email}`,
    phone ? `Phone:   ${phone}` : null,
    ``,
    `Message:`,
    message,
    ``,
    `Sent from abhinayacinemas.com contact form.`,
  ].filter(Boolean).join("\n");

  // -- send ----------------------------------------------------------------
  try {
    const resend = new Resend(resendKey);
    const { error } = await resend.emails.send({
      from,
      to,
      replyTo: email,
      subject: `Contact form — ${name}`,
      html,
      text,
    });
    if (error) {
      console.error("[contact] Resend error", error);
      return json(502, { error: "Could not deliver your message — please email us directly." });
    }
  } catch (err) {
    console.error("[contact] Unexpected error", err);
    return json(500, { error: "Server error — please email us directly." });
  }

  return json(200, { ok: true });
});
