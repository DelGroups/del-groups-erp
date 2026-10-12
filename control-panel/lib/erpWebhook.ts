/**
 * Tells the ERP that a tenant changed, so it drops its 60 s tenant cache right away
 * (ERP side: src/app/api/tenant/invalidate). Signed with HMAC-SHA256 over the body;
 * the ERP rejects bodies older than five minutes. Server only.
 *
 * Optional: without ERP_TENANT_WEBHOOK_URL / TENANT_WEBHOOK_SECRET nothing is sent and
 * the ERP picks the change up when its cache expires.
 */
import { createHmac } from "node:crypto";

export const WEBHOOK_SIGNATURE_HEADER = "x-erp-signature";

/** Body and signature of one webhook call (pure, for tests). */
export function signedWebhookRequest(tenantId: string, secret: string, now: number): { body: string; signature: string } {
  const body = JSON.stringify({ event: "tenant.changed", tenantId, sentAt: now });
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  return { body, signature };
}

export async function notifyErpTenantChanged(tenantId: string): Promise<void> {
  const url = (process.env.ERP_TENANT_WEBHOOK_URL ?? "").trim();
  const secret = (process.env.TENANT_WEBHOOK_SECRET ?? "").trim();
  if (!url || !secret) return;

  const { body, signature } = signedWebhookRequest(tenantId, secret, Date.now());
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", [WEBHOOK_SIGNATURE_HEADER]: signature },
      body,
      signal: AbortSignal.timeout(3_000),
    });
  } catch (error) {
    // Not fatal: the ERP's cache expires within 60 s anyway.
    console.warn("[erp-webhook] not delivered:", error instanceof Error ? error.message : error);
  }
}
