/**
 * The tenant's billing data from the control plane (prompt 13), server only. Called with the
 * control plane's service key (CONTROL_PLANE_URL / CONTROL_PLANE_SERVICE_ROLE_KEY, as the
 * tenant lookup), always for the tenant of the current request; the key never reaches the
 * browser. Returns nothing unless the billing page is enabled and the app is multi-tenant.
 */
import { controlPlane } from "@/lib/tenant/server";
import { currentTenant } from "@/lib/tenant/request";
import type { TenantConfigSource } from "@/lib/tenant/config";
import { billingPageEnabled, parseBillingOverview, type BillingOverview, type PlanRequestInput } from "./overview";

const TIMEOUT_MS = 5_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The control plane and this request's tenant id, or null when billing is not available here. */
export async function billingContext(source?: TenantConfigSource): Promise<{ url: string; key: string; tenantId: string } | null> {
  if (!billingPageEnabled(process.env)) return null;
  const cp = controlPlane();
  if (!cp) return null;
  const { tenantId } = (await currentTenant(source)).config;
  if (!tenantId || !UUID.test(tenantId)) return null;
  return { url: cp.url, key: cp.serviceRoleKey, tenantId };
}

async function rpc(ctx: { url: string; key: string }, name: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${ctx.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: ctx.key, Authorization: `Bearer ${ctx.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`control plane ${name}: HTTP ${response.status}`);
  return response.json();
}

export async function loadBillingOverview(source?: TenantConfigSource): Promise<BillingOverview | null> {
  const ctx = await billingContext(source);
  if (!ctx) return null;
  return parseBillingOverview(await rpc(ctx, "erp_billing_overview", { p_tenant_id: ctx.tenantId }));
}

export async function requestPlanChange(
  input: PlanRequestInput,
  requester: { email: string | null; name: string | null },
  source?: TenantConfigSource
): Promise<void> {
  const ctx = await billingContext(source);
  if (!ctx) throw new Error("billing is not available");
  await rpc(ctx, "erp_request_plan_change", {
    p_tenant_id: ctx.tenantId,
    p: { ...input, requested_by_email: requester.email, requested_by_name: requester.name },
  });
}

/** The PDF of one of this tenant's invoices from the control plane's private Storage, or null. */
export async function fetchInvoicePdf(invoiceId: string, source?: TenantConfigSource): Promise<{ body: ArrayBuffer; name: string } | null> {
  const ctx = await billingContext(source);
  if (!ctx || !UUID.test(invoiceId)) return null;
  const path = await rpc(ctx, "erp_invoice_pdf_path", { p_tenant_id: ctx.tenantId, p_invoice_id: invoiceId });
  if (typeof path !== "string" || !path.startsWith(`${ctx.tenantId}/`) || path.includes("..")) return null;
  const response = await fetch(`${ctx.url}/storage/v1/object/invoices/${path.split("/").map(encodeURIComponent).join("/")}`, {
    headers: { apikey: ctx.key, Authorization: `Bearer ${ctx.key}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) return null;
  return { body: await response.arrayBuffer(), name: path.split("/").pop() ?? "invoice.pdf" };
}
