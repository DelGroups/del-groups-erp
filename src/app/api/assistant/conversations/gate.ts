import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuthenticatedApi } from "@/lib/auth/apiAuth";
import { requireModuleApi } from "@/lib/modules/server";
import { assistantAudience, isAssistantV2On } from "@/lib/assistant/config";
import { isAdminRole } from "@/types/database.types";

/**
 * Who may use the history routes (AST-2): signed in, the plan's AI module, ASSISTANT_V2 on and in its
 * audience. No API key is needed to read one's own conversations. Returns the user's own client.
 */
export async function assistantHistoryGate(): Promise<{ error: NextResponse } | { error: null; client: SupabaseClient; userId: string }> {
  const auth = await requireAuthenticatedApi();
  if (auth.error) return { error: auth.error };
  const notInPlan = await requireModuleApi("ai");
  if (notInPlan) return { error: notInPlan };
  if (!isAssistantV2On() || (assistantAudience() === "admins" && !isAdminRole(auth.profile?.role))) {
    return { error: NextResponse.json({ error: "Assistant is not enabled" }, { status: 404 }) };
  }
  return { error: null, client: auth.client as unknown as SupabaseClient, userId: auth.user.id };
}
