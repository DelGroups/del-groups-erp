import { type NextRequest, NextResponse } from "next/server";
import { assistantCronAuthorized } from "@/lib/assistant/learn";
import { isAssistantV2On } from "@/lib/assistant/config";
import { nightlyLearning } from "@/lib/assistant/learnServer";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The assistant's nightly learning (AST-3), called by .github/workflows/assistant-memory.yml with
 * "Authorization: Bearer <ASSISTANT_CRON_SECRET>". A wrong or missing secret is a 401 before anything is
 * read; with ASSISTANT_V2 off the route does not exist (404). It learns from conversations that ended
 * without "New chat" and saves routines and repeated corrections from the audit log.
 */
export async function POST(request: NextRequest) {
  if (!assistantCronAuthorized(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAssistantV2On()) return NextResponse.json({ error: "Assistant is not enabled" }, { status: 404 });
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim().replace(/^["']|["']$/g, "");
  if (!apiKey) return NextResponse.json({ error: "Assistant is not enabled" }, { status: 404 });
  try {
    const result = await nightlyLearning({ apiKey, db: await createSupabaseAdminClient() });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.warn(`[assistant] nightly learning failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
