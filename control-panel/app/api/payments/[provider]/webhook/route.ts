import { billingDeps, serviceClient } from "@/lib/billing/billingServer";
import { MANUAL_PROVIDER_ID } from "@/lib/billing/providers/index";
import { afterPayment } from "@/lib/billing/run";

const MAX_BODY = 64 * 1024;

/**
 * Payment webhook of a card gateway (prompt 13): POST /api/payments/<provider id>/webhook.
 * No session: the provider's signature is the authentication (verifyWebhook). A payment the
 * gateway reports twice is recorded once (provider_reference); a successful one marks the
 * invoice paid, saves the card for later charges if the gateway sent a token, and reactivates
 * the tenant at once. Uses the control plane's service role (CONTROL_PLANE_SERVICE_ROLE_KEY).
 */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerId } = await params;
  const supabase = serviceClient();
  if (!supabase) return Response.json({ error: "not_configured" }, { status: 503 });
  const deps = billingDeps(supabase);
  const provider = providerId === MANUAL_PROVIDER_ID ? null : deps.providers.get(providerId);
  if (!provider) return Response.json({ error: "unknown_provider" }, { status: 404 });

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY) return Response.json({ error: "too_large" }, { status: 413 });
  const event = await provider.verifyWebhook({ headers: request.headers, rawBody, now: Date.now() });
  if (!event) return Response.json({ error: "invalid_signature" }, { status: 400 });

  const invoice = await supabase.from("invoices").select("id, tenant_id, currency").eq("id", event.invoiceId).maybeSingle();
  const row = invoice.data as { id: string; tenant_id: string; currency: string } | null;
  if (!row) return Response.json({ error: "unknown_invoice" }, { status: 404 });
  if (row.currency !== event.currency) return Response.json({ error: "currency_mismatch" }, { status: 422 });

  if (event.type === "payment.refunded") {
    await supabase
      .from("payments")
      .update({ status: "refunded", refunded_amount: event.amountCents / 100 })
      .eq("provider", provider.id)
      .eq("provider_reference", event.reference);
    return Response.json({ ok: true });
  }

  const { data, error } = await supabase.rpc("record_payment", {
    p: {
      invoice_id: row.id,
      amount: event.amountCents / 100,
      method: "card",
      provider: provider.id,
      provider_reference: event.reference,
      paid_at: event.occurredAt,
      status: event.type === "payment.succeeded" ? "succeeded" : "failed",
      failure_reason: event.failureReason ?? null,
    },
  });
  if (error) {
    // An invoice paid in the meantime (e.g. by bank transfer) is not the gateway's problem.
    if (/not open/.test(error.message)) return Response.json({ ok: true, note: "invoice_not_open" });
    console.error("[payments] record_payment failed:", error.message);
    return Response.json({ error: "record_failed" }, { status: 500 });
  }
  const recorded = data as { duplicate: boolean };
  if (!recorded.duplicate && event.type === "payment.succeeded") {
    if (event.savedCard) {
      await supabase.rpc("save_payment_method", {
        p_tenant_id: row.tenant_id,
        p_provider: provider.id,
        p_token: event.savedCard.token,
        p_brand: event.savedCard.brand,
        p_last4: event.savedCard.last4,
        p_exp_month: event.savedCard.expMonth,
        p_exp_year: event.savedCard.expYear,
      });
    }
    await afterPayment(deps, row.id, row.tenant_id, new Date().toISOString().slice(0, 10));
  }
  return Response.json({ ok: true, duplicate: recorded.duplicate });
}
