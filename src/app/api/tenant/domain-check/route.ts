import { NextResponse, type NextRequest } from "next/server";
import { normalizeHost } from "@/lib/tenant/resolve";
import { tenantResolver } from "@/lib/tenant/server";

export const dynamic = "force-dynamic";

/**
 * Caddy's on-demand TLS "ask" endpoint (DEPLOYMENT.md): 200 only for a domain that may
 * get a certificate, 404 otherwise.
 * - Multi-tenant mode: the domain is registered for a tenant that is not cancelled.
 * - Single-tenant mode: the domain is the host of NEXT_PUBLIC_SITE_URL.
 */
export async function GET(request: NextRequest) {
  const domain = normalizeHost(request.nextUrl.searchParams.get("domain"));
  if (!domain) return new NextResponse(null, { status: 404 });

  const resolver = tenantResolver();
  if (!resolver) {
    const siteHost = normalizeHost(safeHost(process.env.NEXT_PUBLIC_SITE_URL));
    return new NextResponse(null, { status: siteHost && siteHost === domain ? 200 : 404 });
  }

  try {
    const record = await resolver.byHost(domain);
    return new NextResponse(null, { status: record && record.status !== "cancelled" ? 200 : 404 });
  } catch (error) {
    console.error("[tenant] domain check failed:", error instanceof Error ? error.message : error);
    return new NextResponse(null, { status: 503 });
  }
}

function safeHost(url: string | undefined): string | null {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
}
