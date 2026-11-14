import { NextResponse } from "next/server";
import { HISTORY_LIMIT, toConversationItems } from "@/lib/assistant/history";
import { assistantHistoryGate } from "./gate";

export const dynamic = "force-dynamic";

/** GET: the signed-in user's own assistant conversations, newest first, without soft-deleted ones (AST-2). */
export async function GET() {
  const gate = await assistantHistoryGate();
  if (gate.error) return gate.error;
  const { data, error } = await gate.client
    .from("ai_conversations")
    .select("id, title, updated_at, context")
    .eq("user_id", gate.userId)
    .order("updated_at", { ascending: false })
    .limit(HISTORY_LIMIT * 2);
  if (error) return NextResponse.json({ error: "Could not load conversations" }, { status: 500 });
  return NextResponse.json({ conversations: toConversationItems(data).slice(0, HISTORY_LIMIT) });
}
