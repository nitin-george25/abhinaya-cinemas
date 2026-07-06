// ============================================================================
// extract-invoice — read an uploaded invoice (PDF or image) and return the key
// fields as structured JSON, so a team member only has to upload the file and
// review (pipeline #19: "auto-filled from invoice — review").
//
// Calls the Claude Messages API (Sonnet 5) with the file as a document/image
// block and output_config.format = json_schema so the response is guaranteed to
// match the shape below. Best-effort: on any failure the caller falls back to
// manual entry, so extraction never blocks the payment flow.
//
// Invoked from the console by a signed-in raiser (verify_jwt=true). Body:
//   { fileBase64: string (no data: prefix), mediaType: string }
// Secret (per project): ANTHROPIC_API_KEY. No-ops with 200 when it's absent.
// ============================================================================

import { corsHeaders, json } from "../_shared/slack.ts";

const MODEL = "claude-sonnet-5";

// Structured-output schema. All fields required + nullable + additionalProperties
// false (structured outputs requires this shape); the model returns null for
// anything it can't read.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    vendor:      { type: ["string", "null"] },
    invoiceNo:   { type: ["string", "null"] },
    invoiceDate: { type: ["string", "null"], description: "ISO date YYYY-MM-DD if determinable" },
    subtotal:    { type: ["number", "null"] },
    gst:         { type: ["number", "null"], description: "total GST/tax on the invoice" },
    freight:     { type: ["number", "null"], description: "freight / shipping / delivery charges" },
    total:       { type: ["number", "null"], description: "grand total payable" },
    currency:    { type: ["string", "null"] },
  },
  required: ["vendor", "invoiceNo", "invoiceDate", "subtotal", "gst", "freight", "total", "currency"],
};

const PROMPT =
  "You are reading a purchase invoice for a cinema's accounts team. Extract the " +
  "fields defined by the schema. Amounts are plain numbers (no currency symbol, " +
  "no thousands separators). If the invoice is Indian, currency is INR. Use null " +
  "for any field you cannot read confidently. Do not guess totals — read them.";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!API_KEY) return json({ ok: false, skipped: "ANTHROPIC_API_KEY not configured" });

  let body: { fileBase64?: string; mediaType?: string };
  try { body = await req.json(); }
  catch { return json({ error: "invalid JSON body" }, 400); }
  const { fileBase64, mediaType } = body;
  if (!fileBase64 || !mediaType) return json({ error: "fileBase64 and mediaType required" }, 400);

  // PDF → document block; image/* → image block. Anything else is unsupported.
  const isPdf = mediaType === "application/pdf";
  const isImage = mediaType.startsWith("image/");
  if (!isPdf && !isImage) return json({ ok: false, skipped: `unsupported media type ${mediaType}` });

  const fileBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: fileBase64 } };

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: [fileBlock, { type: "text", text: PROMPT }] }],
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
      }),
    });
    const j = await r.json();
    if (!r.ok) return json({ ok: false, error: j?.error?.message ?? `HTTP ${r.status}` }, 502);
    if (j.stop_reason === "refusal") return json({ ok: false, error: "declined" });

    // With output_config.format the JSON is returned as the text block content.
    // deno-lint-ignore no-explicit-any
    const textBlock = (j.content ?? []).find((b: any) => b.type === "text");
    if (!textBlock?.text) return json({ ok: false, error: "no content" });
    let fields: unknown;
    try { fields = JSON.parse(textBlock.text); }
    catch { return json({ ok: false, error: "unparseable extraction" }); }

    return json({ ok: true, fields });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
