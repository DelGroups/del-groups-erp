import { type NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuthenticatedApi } from "@/lib/auth/apiAuth";
import { clampString } from "@/lib/auth/validate";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { guardAgentAccess } from "@/lib/guard/agentConfig";
import { generateGuardReport, type AgentLanguage, type GuardWriteDb } from "@/lib/guard/agent";
import type { GuardDb } from "@/lib/guard/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { loadCompanyProfile } from "@/lib/company/loadCompanyProfile";
import { companyDisplayName, EMPTY_COMPANY_PROFILE } from "@/lib/company/profile";
import { PRODUCT_NAME } from "@/lib/brand";
import { checkUsage } from "@/lib/limits/server";
import { limitResponse } from "@/lib/limits/messages";
import { isAdminRole } from "@/types/database.types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_QUESTION = 1500;

/**
 * An admin asks the accountant a question (or presses "Build report"). The answer is saved as an
 * on-demand report, so it can be read again and printed. Admins only, with the flags on; the agent
 * reads with the admin's own session (so the database knows who asked) and counts against the plan's AI credit.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedApi();
  if (auth.error) return auth.error;
  if (!isAdminRole(auth.profile?.role)) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const access = guardAgentAccess();
  if (!access.enabled) return NextResponse.json({ error: "Accounting Guard agent is not enabled" }, { status: 404 });

  const limit = rateLimit(`guard-agent:${auth.user.id}:${getClientIp(request)}`, 6, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const quota = await checkUsage("ai");
  if (!quota.allowed) return limitResponse("ai", quota.usage);

  let body: { question?: string; locale?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const question = clampString(String(body.question ?? ""), MAX_QUESTION);
  const language: AgentLanguage = body.locale === "en" || body.locale === "ru" ? body.locale : "az";

  const client = auth.client as unknown as SupabaseClient;
  const { profile } = await loadCompanyProfile(client).catch(() => ({ profile: EMPTY_COMPANY_PROFILE }));
  const admin = await createSupabaseAdminClient();
  const result = await generateGuardReport({
    kind: "on_demand",
    db: auth.client as unknown as GuardDb,
    writeDb: admin as unknown as GuardWriteDb,
    apiKey: access.apiKey,
    language,
    company: { name: companyDisplayName(profile, PRODUCT_NAME), currency: profile.defaultCurrency },
    userId: auth.user.id,
    question: question || undefined,
  });
  if (!result.ok) {
    console.warn(`[guard-agent] on-demand report not saved (${result.reason}): ${result.message}`);
    const status = result.reason === "budget" ? 429 : 502;
    return NextResponse.json({ error: result.message, reason: result.reason }, { status });
  }
  return NextResponse.json({ ok: true, reportId: result.reportId, title: result.title, headline: result.summary.headline });
}
