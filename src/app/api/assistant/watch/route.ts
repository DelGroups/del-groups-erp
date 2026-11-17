import { type NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuthenticatedApi } from "@/lib/auth/apiAuth";
import { requireModuleApi } from "@/lib/modules/server";
import { rateLimit } from "@/lib/rateLimit";
import { assistantAccess } from "@/lib/assistant/config";
import { createAnswerCache, draftHash, parseDraftSummary, WATCH_AI_CACHE_MS, WATCH_AI_INTERVAL_MS } from "@/lib/assistant/watch/unusual";
import { checkUnusualDraft } from "@/lib/assistant/watch/unusualServer";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { isAdminRole } from "@/types/database.types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const FORM_RE = /^[a-z][a-z0-9_.]{1,39}$/;
/** userId:hash → the note (or null for "looks fine"). Per server process. */
const answers = createAnswerCache<string | null>(WATCH_AI_CACHE_MS);

/**
 * POST { form, locale, summary } (AST-5): the "unusual draft" check. The browser sends a summary of the
 * draft only when it shows a signal the rules cannot judge. The same draft gets the cached answer; a new
 * one is asked at most once every 20 seconds per user and form, inside the monthly AI budget.
 * Answers { note: string | null }; 429 when asked too often (the browser simply tries later).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedApi();
  if (auth.error) return auth.error;
  const notInPlan = await requireModuleApi("ai");
  if (notInPlan) return notInPlan;
  const access = assistantAccess({ isAdmin: isAdminRole(auth.profile?.role) });
  if (!access.enabled) return NextResponse.json({ error: "Assistant is not enabled" }, { status: 404 });

  let body: { form?: unknown; locale?: unknown; summary?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const form = typeof body.form === "string" && FORM_RE.test(body.form) ? body.form : null;
  const summary = parseDraftSummary(body.summary);
  if (!form || !summary) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const locale = body.locale === "en" || body.locale === "ru" ? body.locale : "az";

  const cacheKey = `${auth.user.id}:${locale}:${draftHash(summary)}`;
  const cached = answers.get(cacheKey);
  if (cached !== undefined) return NextResponse.json({ note: cached, cached: true });

  const limit = rateLimit(`assistant-watch:${auth.user.id}:${form}`, 1, WATCH_AI_INTERVAL_MS);
  if (!limit.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const result = await checkUnusualDraft({
    apiKey: access.apiKey,
    userDb: auth.client as unknown as SupabaseClient,
    serverDb: await createSupabaseAdminClient(),
    userId: auth.user.id,
    summary,
    locale,
  });
  if (!result.ok) return NextResponse.json({ note: null, reason: result.reason });
  answers.set(cacheKey, result.note);
  return NextResponse.json({ note: result.note });
}
