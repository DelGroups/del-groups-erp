import { type NextRequest, NextResponse } from "next/server";
import { assistantCronAuthorized } from "@/lib/assistant/learn";
import { isAssistantV2On } from "@/lib/assistant/config";
import { nightlyBriefings } from "@/lib/assistant/insights/briefingServer";
import { bakuToday } from "@/lib/assistant/watch/context";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The morning briefings (AST-6), called by .github/workflows/assistant-briefing.yml early every morning with
 * "Authorization: Bearer <ASSISTANT_CRON_SECRET>". A wrong or missing secret is a 401 before anything is
 * read; with ASSISTANT_V2 off the route does not exist (404). Writes one briefing per admin / manager for
 * today (Baku), inside the monthly AI budget; running it twice writes nothing new.
 */
export async function POST(request: NextRequest) {
  if (!assistantCronAuthorized(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAssistantV2On()) return NextResponse.json({ error: "Assistant is not enabled" }, { status: 404 });
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim().replace(/^["']|["']$/g, "");
  if (!apiKey) return NextResponse.json({ error: "Assistant is not enabled" }, { status: 404 });
  try {
    const result = await nightlyBriefings({ apiKey, db: await createSupabaseAdminClient(), today: bakuToday() });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.warn(`[assistant] briefings failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
