import { NextResponse, type NextRequest } from "next/server";
import { toPublicTenantConfig } from "@/lib/tenant/config";
import { getServerTenantConfig } from "@/lib/tenant/server";

export const dynamic = "force-dynamic";

/** Serves the current tenant's public Supabase config from the runtime server env. */
export async function GET(request: NextRequest) {
  const tenant = getServerTenantConfig(request);
  const config = toPublicTenantConfig(tenant);

  if (!config) {
    return NextResponse.json(
      {
        configured: false,
        issue: tenant.issue,
        urlPreview: tenant.urlPreview,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    { configured: true, ...config },
    // Per-host value; short private cache so tabs don't refetch on every load.
    { headers: { "Cache-Control": "private, max-age=300", Vary: "Host" } }
  );
}
