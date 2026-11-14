import { type NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { guardAgentAccess, guardCronAuthorized } from "@/lib/guard/agentConfig";
import { generateGuardReport, type AgentReportKind, type GuardWriteDb } from "@/lib/guard/agent";
import type { GuardDb } from "@/lib/guard/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { loadCompanyProfile } from "@/lib/company/loadCompanyProfile";
import { companyDisplayName, EMPTY_COMPANY_PROFILE } from "@/lib/company/profile";
import { PRODUCT_NAME } from "@/lib/brand";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The scheduled job (GitHub Actions, .github/workflows/accounting-guard.yml) asks here for the daily
 * or monthly report: POST {"mode": "daily" | "monthly"} with "Authorization: Bearer <GUARD_CRON_SECRET>".
 * Nobody else can: a wrong or missing secret is a 401 before anything is read, and with the flags off
 * the route does not exist (404). It runs with the server's database client; the guard's functions trust
 * a caller with no signed-in user and the agent's tools can only read and write what agentTools.ts allows.
 */
export async function POST(request: NextRequest) {
  if (!guardCronAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const access = guardAgentAccess();
  if (!access.enabled) return NextResponse.json({ error: "Accounting Guard agent is not enabled" }, { status: 404 });

  let mode: AgentReportKind;
  try {
    const body = (await request.json()) as { mode?: string };
    if (body.mode !== "daily" && body.mode !== "monthly") throw new Error("mode");
    mode = body.mode;
  } catch {
    return NextResponse.json({ error: "mode must be daily or monthly" }, { status: 400 });
  }

  const admin = await createSupabaseAdminClient();
  const { profile } = await loadCompanyProfile(admin as unknown as SupabaseClient).catch(() => ({ profile: EMPTY_COMPANY_PROFILE }));
  const result = await generateGuardReport({
    kind: mode,
    db: admin as unknown as GuardDb,
    writeDb: admin as unknown as GuardWriteDb,
    apiKey: access.apiKey,
    language: "az",
    company: { name: companyDisplayName(profile, PRODUCT_NAME), currency: profile.defaultCurrency },
    userId: null,
  });
  if (!result.ok) {
    // A reached budget is an answer, not a failure of the job.
    return NextResponse.json({ ok: false, reason: result.reason, message: result.message }, { status: result.reason === "budget" ? 200 : 502 });
  }
  return NextResponse.json({ ok: true, reportId: result.reportId, costUsd: result.costUsd, status: result.status });
}
