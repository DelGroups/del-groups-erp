import { NextResponse, type NextRequest } from "next/server";
import { verifyWebhook, WEBHOOK_SIGNATURE_HEADER } from "@/lib/tenant/resolve";
import { tenantResolver } from "@/lib/tenant/server";

export const dynamic = "force-dynamic";

/**
 * Webhook from the control panel after a tenant, domain or database changed: clears the
 * tenant cache (otherwise entries expire after 60 s). The body is signed with
 * TENANT_WEBHOOK_SECRET (HMAC-SHA256, header x-erp-signature) and must be less than five
 * minutes old. Without the secret, or in single-tenant mode, the endpoint does not exist.
 */
export async function POST(request: NextRequest) {
  const secret = (process.env.TENANT_WEBHOOK_SECRET ?? "").trim();
  const resolver = tenantResolver();
  if (!secret || !resolver) return new NextResponse(null, { status: 404 });

  const body = await request.text();
  if (!verifyWebhook(body, request.headers.get(WEBHOOK_SIGNATURE_HEADER), secret, Date.now())) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  resolver.clear();
  return new NextResponse(null, { status: 204 });
}
