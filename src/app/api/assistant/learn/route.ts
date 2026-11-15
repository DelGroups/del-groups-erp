import { type NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuthenticatedApi } from "@/lib/auth/apiAuth";
import { isValidUuid } from "@/lib/auth/validate";
import { requireModuleApi } from "@/lib/modules/server";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { assistantAccess } from "@/lib/assistant/config";
import { learnFromConversation } from "@/lib/assistant/learnServer";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { isAdminRole } from "@/types/database.types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { conversationId } (AST-3): the panel calls this when the user starts a new chat. A short Haiku pass
 * reads the finished conversation and keeps at most 3 notes (confidence ≥ 0.7) about this user (and, for
 * an admin, the company). The conversation must be the caller's own (checked with their client, RLS);
 * the notes are saved by the server. Nothing comes back but a count: employees never see memory.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedApi();
  if (auth.error) return auth.error;
  const notInPlan = await requireModuleApi("ai");
  if (notInPlan) return notInPlan;
  const isAdmin = isAdminRole(auth.profile?.role);
  const access = assistantAccess({ isAdmin });
  if (!access.enabled) return NextResponse.json({ error: "Assistant is not enabled" }, { status: 404 });
  const limit = rateLimit(`assistant-learn:${auth.user.id}:${getClientIp(request)}`, 6, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { conversationId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const id = typeof body.conversationId === "string" ? body.conversationId : "";
  if (!isValidUuid(id)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const own = await (auth.client as unknown as SupabaseClient).from("ai_conversations").select("id").eq("id", id).eq("user_id", auth.user.id).maybeSingle();
  if (own.error || !own.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await learnFromConversation({ apiKey: access.apiKey, db: await createSupabaseAdminClient(), conversationId: id, isAdmin });
  if (!result.ok && result.reason === "error") console.warn(`[assistant] learning failed: ${result.detail ?? "error"}`);
  return NextResponse.json({ ok: result.ok, saved: result.ok ? result.saved : 0 });
}
