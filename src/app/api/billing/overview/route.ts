import { NextResponse } from "next/server";
import { requireBillingAdmin } from "@/lib/billing/apiAuth";
import { loadBillingOverview } from "@/lib/billing/server";
import { loadLimitStatus } from "@/lib/limits/server";

export const dynamic = "force-dynamic";

/** The tenant's plan, usage, invoices and pending plan change, for its administrators (prompt 13). */
export async function GET() {
  const auth = await requireBillingAdmin();
  if (auth.error) return auth.error;
  try {
    const [overview, limits] = await Promise.all([loadBillingOverview(), loadLimitStatus()]);
    if (!overview) return NextResponse.json({ error: "not_available" }, { status: 404 });
    return NextResponse.json({ overview, limits }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[billing] overview failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "control_plane_unavailable" }, { status: 503 });
  }
}
