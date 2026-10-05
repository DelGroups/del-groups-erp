import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidUuid } from "@/lib/auth/validate";
import type { AgentResult } from "@/lib/ai/native/agent";

/**
 * Conversation history and usage log for the native assistant
 * (tables from supabase/migrations/20261005100000_ai_native_assistant.sql).
 *
 * Writes go through the user's own client, so RLS keeps every user to their
 * own rows. If the migration has not been applied yet, every call here logs a
 * warning and returns quietly: chat keeps working, just without history.
 */

type Turn = { role: "user" | "assistant"; content: string };

function warn(label: string, error: { message: string } | null) {
  if (error) console.warn(`[ai-native] ${label}: ${error.message}`);
}

export async function loadHistory(
  client: SupabaseClient,
  conversationId: string | null,
  max: number
): Promise<Turn[] | null> {
  if (!conversationId || !isValidUuid(conversationId)) return null;
  const { data, error } = await client
    .from("ai_messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(max);
  if (error) {
    warn("load history", error);
    return null;
  }
  return (data || [])
    .reverse()
    .filter((row) => row.role === "user" || row.role === "assistant")
    .map((row) => ({ role: row.role as Turn["role"], content: String(row.content || "") }))
    .filter((turn) => turn.content);
}

export async function ensureConversation(
  client: SupabaseClient,
  userId: string,
  conversationId: string | null,
  firstMessage: string
): Promise<string | null> {
  if (conversationId && isValidUuid(conversationId)) {
    const { error } = await client
      .from("ai_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);
    warn("touch conversation", error);
    return conversationId;
  }
  const { data, error } = await client
    .from("ai_conversations")
    .insert({ user_id: userId, title: firstMessage.slice(0, 80) })
    .select("id")
    .single();
  warn("create conversation", error);
  return data?.id ? String(data.id) : null;
}

export async function saveTurn(
  client: SupabaseClient,
  input: {
    userId: string;
    conversationId: string | null;
    userMessage: string;
    result: AgentResult | null;
    routeReason: string;
    latencyMs: number;
    status: string;
  }
): Promise<void> {
  const { userId, conversationId, result } = input;
  if (conversationId) {
    const rows: Array<Record<string, unknown>> = [
      { conversation_id: conversationId, user_id: userId, role: "user", content: input.userMessage },
    ];
    if (result?.reply) {
      rows.push({
        conversation_id: conversationId,
        user_id: userId,
        role: "assistant",
        content: result.reply,
        model: result.model,
        tier: result.tier,
        steps: result.steps,
      });
    }
    const { error } = await client.from("ai_messages").insert(rows);
    warn("save messages", error);
  }
  const { error } = await client.from("ai_usage_log").insert({
    user_id: userId,
    conversation_id: conversationId,
    model: result?.model ?? null,
    tier: result?.tier ?? null,
    route_reason: input.routeReason,
    input_tokens: result?.usage.input_tokens ?? 0,
    output_tokens: result?.usage.output_tokens ?? 0,
    cache_read_tokens: result?.usage.cache_read_tokens ?? 0,
    cache_write_tokens: result?.usage.cache_write_tokens ?? 0,
    cost_usd: result?.costUsd ?? null,
    tool_calls: result?.steps.length ?? 0,
    latency_ms: input.latencyMs,
    status: input.status,
  });
  warn("save usage", error);
}
