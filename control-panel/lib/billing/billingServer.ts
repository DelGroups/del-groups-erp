/**
 * Server side of the billing screens and the payment webhook: the run's dependencies from env
 * (email, payment providers, ERP notice) and, for the webhook only, a service-role client of
 * the control plane (CONTROL_PLANE_SERVICE_ROLE_KEY; never NEXT_PUBLIC_, never in a browser).
 */
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { notifyErpTenantChanged } from "../erpWebhook.ts";
import { supabaseBillingStore } from "./billingStore.ts";
import { emailSenderFromEnv } from "./email.ts";
import { renderInvoicePdf } from "./pdf.ts";
import { providerRegistry } from "./providers/index.ts";
import type { BillingDeps } from "./run.ts";

const SECRET_ENV = ["CONTROL_PLANE_SERVICE_ROLE_KEY", "BILLING_EMAIL_API_KEY", "CARD_GATEWAY_SECRET_KEY", "CARD_GATEWAY_WEBHOOK_SECRET", "TENANT_WEBHOOK_SECRET"];

export function billingDeps(supabase: SupabaseClient): BillingDeps {
  const store = supabaseBillingStore(supabase);
  return {
    store,
    providers: providerRegistry(process.env, () => store.settings()),
    email: emailSenderFromEnv(process.env, (input, init) => fetch(input, init)),
    renderPdf: (doc) => renderInvoicePdf(doc),
    notifyTenantChanged: notifyErpTenantChanged,
    secrets: SECRET_ENV.map((k) => process.env[k] ?? ""),
  };
}

/** What is configured, for the Billing page (names of missing settings only, never values). */
export function billingSetup() {
  const deps = providerRegistry(process.env, async () => ({}));
  return {
    emailMissing: [...emailSenderFromEnv(process.env, fetch).missing],
    card: { id: deps.card.id, missing: [...deps.card.missing] },
    webhookReady: Boolean(serviceClient()),
    providers: deps.available().map((p) => p.id),
  };
}

/** Service-role client of the control plane, or null when the key is not set. */
export function serviceClient(): SupabaseClient | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (process.env.CONTROL_PLANE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) return null;
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
