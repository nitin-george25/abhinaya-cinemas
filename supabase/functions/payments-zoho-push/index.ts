// ============================================================================
// payments-zoho-push — push a paid F&B payment to Zoho Books as an expense
// (§10, D6). One-way, best-effort, retryable; never blocks the payment.
//
// Invoked from the console right after mark-paid (and re-invocable to retry a
// failed push). Reuses the existing Zoho OAuth/env helpers. When Zoho secrets
// are absent (e.g. staging), it marks the push 'skipped' and returns 200.
//
// Match key: vendor + invoice no. (§13-e). Operator config (per-env secrets):
//   ZOHO_FB_EXPENSE_ACCOUNT  — Zoho expense account name (F&B purchases head)
//   ZOHO_FB_PAID_THROUGH     — Zoho paid-through account name (the bank)
// plus the existing ZOHO_CLIENT_ID / _SECRET / _REFRESH_TOKEN / _ORG_ID / _DC.
// ============================================================================

import { apiHost, fetchWithTimeout, getAccessToken, serviceClient, zohoEnv } from "../_shared/zoho.ts";
import { json } from "../_shared/slack.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let paymentId: string | undefined;
  try { paymentId = (await req.json())?.paymentId; }
  catch { return json({ error: "invalid JSON" }, 400); }
  if (!paymentId) return json({ error: "paymentId required" }, 400);

  const svc = serviceClient();

  // Load the payment + its type (for the accounting head) + the bank account.
  const { data: p } = await svc
    .from("payment_requests")
    .select("id, payee_name, amount, paid_amount, purpose, bank_reference, paid_at, " +
            "payment_type_id, payment_types(name, accounting_head, zoho_push)")
    .eq("id", paymentId).maybeSingle();
  if (!p) return json({ error: "payment not found" }, 404);
  // deno-lint-ignore no-explicit-any
  const pr = p as any;
  if (!pr.payment_types?.zoho_push) {
    return json({ ok: true, skipped: "type not flagged for Zoho push" });
  }

  async function record(status: string, fields: Record<string, unknown>) {
    await svc.from("payment_zoho_pushes").upsert({
      payment_id: paymentId, status, updated_at: new Date().toISOString(), ...fields,
    });
  }

  const env = zohoEnv();
  if (!env) { await record("skipped", { error: "Zoho not configured in this environment" }); return json({ ok: true, skipped: "no zoho env" }); }

  const EXPENSE_ACCOUNT = Deno.env.get("ZOHO_FB_EXPENSE_ACCOUNT");
  const PAID_THROUGH = Deno.env.get("ZOHO_FB_PAID_THROUGH");

  try {
    const token = await getAccessToken(env);
    const amount = Number(pr.paid_amount ?? pr.amount);
    const body: Record<string, unknown> = {
      account_name: EXPENSE_ACCOUNT ?? pr.payment_types?.accounting_head ?? "F&B purchases",
      paid_through_account_name: PAID_THROUGH ?? undefined,
      date: (pr.paid_at ?? new Date().toISOString()).slice(0, 10),
      amount,
      vendor_name: pr.payee_name,
      reference_number: pr.bank_reference ?? undefined,
      description: pr.purpose ?? "F&B supplier payment",
    };
    const url = `${apiHost(env.dc)}/books/v3/expenses?organization_id=${env.orgId}`;
    const r = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Zoho-oauthtoken ${token}` },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok || j.code !== 0) {
      const msg = j.message ?? `HTTP ${r.status}`;
      await svc.from("payment_zoho_pushes").upsert({
        payment_id: paymentId, status: "failed", error: String(msg),
        attempts: (pr.attempts ?? 0) + 1, updated_at: new Date().toISOString(),
      });
      return json({ ok: false, error: msg }, 502);
    }
    await record("synced", { zoho_expense_id: j.expense?.expense_id ?? null, error: null });
    return json({ ok: true, expenseId: j.expense?.expense_id ?? null });
  } catch (e) {
    await record("failed", { error: e instanceof Error ? e.message : String(e) });
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
