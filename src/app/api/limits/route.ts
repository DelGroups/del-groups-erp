import { NextResponse } from "next/server";
import { requireAuthenticatedApi } from "@/lib/auth/apiAuth";
import { loadLimitStatus } from "@/lib/limits/server";

export const dynamic = "force-dynamic";

/** Plan limits and usage of the current tenant, for banners and the seat nudge. Counts only. */
export async function GET() {
  const auth = await requireAuthenticatedApi();
  if (auth.error) return auth.error;
  return NextResponse.json(await loadLimitStatus(), { headers: { "Cache-Control": "private, no-store" } });
}
