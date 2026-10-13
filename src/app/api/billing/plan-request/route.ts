import { NextResponse } from "next/server";
import { requireBillingAdmin } from "@/lib/billing/apiAuth";
import { validatePlanRequest } from "@/lib/billing/overview";
import { loadBillingOverview, requestPlanChange } from "@/lib/billing/server";

export const dynamic = "force-dynamic";

/**
 * Upgrade / downgrade request from the tenant's administrator (prompt 13). It is only a
 * request: the platform team changes the subscription in the control panel. Allowed in read-only
 * mode too (src/proxy.ts), so a tenant that cannot pay can still ask for a smaller plan.
 */
export async function POST(request: Request) {
  const auth = await requireBillingAdmin();
  if (auth.error) return auth.error;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  try {
    const overview = await loadBillingOverview();
    if (!overview) return NextResponse.json({ error: "not_available" }, { status: 404 });
    const checked = validatePlanRequest(body, overview.plans);
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
    await requestPlanChange(checked.value, { email: auth.user.email ?? null, name: auth.profile?.full_name ?? null });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[billing] plan request failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "control_plane_unavailable" }, { status: 503 });
  }
}
