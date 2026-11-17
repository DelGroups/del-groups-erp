import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estimateCostUsd, resolveTierModels } from "@/lib/ai/native/router";
import { assistantBudgetUsd } from "@/lib/assistant/config";
import { LEARN_SYSTEM_PROMPT, parseProposedNotes } from "@/lib/assistant/memory";
import { conversationTranscript, detectCorrections, detectRoutines, detectWatchPatterns, worthLearning, type AuditRow, type LearnedNote, type WatchEventRow } from "@/lib/assistant/learn";
import { isAdminRole } from "@/types/database.types";

/**
 * The server side of the assistant's learning (AST-3). Runs with the server's database client (service
 * role): assistant_memory_save trusts it, and it saves notes only about the conversation's own user (or,
 * for an admin's conversation, the company). Nothing here is reachable from the browser except through
 * /api/assistant/learn, which first checks that the conversation belongs to the signed-in user.
 */

type Env = Readonly<Record<string, string | undefined>>;
type Claude = Pick<Anthropic, "messages">;

export type LearnResult = { ok: true; saved: number } | { ok: false; reason: "not_found" | "not_worth" | "budget" | "error"; detail?: string };

async function monthSpent(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.rpc("assistant_month_cost" as never);
  if (error) throw new Error(error.message);
  const n = Number(data);
  return Number.isFinite(n) ? n : 0;
}

async function markLearned(db: SupabaseClient, conversationId: string, context: unknown, saved: number) {
  const base = context && typeof context === "object" && !Array.isArray(context) ? (context as Record<string, unknown>) : {};
  await db.from("ai_conversations").update({ context: { ...base, learnedAt: new Date().toISOString(), learnedNotes: saved } } as never).eq("id", conversationId);
}

/** One finished conversation → at most 3 notes (Haiku proposes, only confidence ≥ 0.7 is kept). */
export async function learnFromConversation(input: {
  apiKey: string;
  db: SupabaseClient;
  conversationId: string;
  isAdmin: boolean;
  env?: Env;
  client?: Claude;
}): Promise<LearnResult> {
  const env = input.env ?? process.env;
  const conv = await input.db.from("ai_conversations").select("id, user_id, context").eq("id", input.conversationId).maybeSingle();
  const row = conv.data as { id: string; user_id: string; context: Record<string, unknown> | null } | null;
  if (conv.error || !row) return { ok: false, reason: "not_found" };
  const { data: messages } = await input.db
    .from("ai_messages")
    .select("role, content, created_at")
    .eq("conversation_id", row.id)
    .order("created_at", { ascending: true })
    .limit(60);
  const list = (messages ?? []) as Array<{ role: string; content: string }>;
  if (!worthLearning({ userMessages: list.filter((m) => m.role === "user").length, learnedAt: row.context?.learnedAt })) {
    return { ok: false, reason: "not_worth" };
  }
  try {
    if ((await monthSpent(input.db)) >= assistantBudgetUsd(env)) return { ok: false, reason: "budget" };
  } catch (err) {
    return { ok: false, reason: "error", detail: err instanceof Error ? err.message : String(err) };
  }

  const model = resolveTierModels(env).fast;
  const client = input.client ?? new Anthropic({ apiKey: input.apiKey });
  let text = "";
  let usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 };
  let status = "ok";
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: LEARN_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `${input.isAdmin ? "The user is an administrator." : "The user is an employee."}\n\n${conversationTranscript(list)}` }],
    });
    for (const block of response.content) if (block.type === "text") text += block.text;
    usage = {
      input_tokens: response.usage.input_tokens ?? 0,
      output_tokens: response.usage.output_tokens ?? 0,
      cache_read_tokens: response.usage.cache_read_input_tokens ?? 0,
      cache_write_tokens: response.usage.cache_creation_input_tokens ?? 0,
    };
  } catch (err) {
    status = "error";
    const detail = err instanceof Anthropic.APIError ? `API ${err.status}` : err instanceof Error ? err.message : String(err);
    await input.db.from("ai_usage_log").insert({ user_id: row.user_id, conversation_id: row.id, model, tier: "fast", route_reason: "memory_learn", status, source: "assistant_v2" } as never);
    return { ok: false, reason: "error", detail };
  }

  const notes = parseProposedNotes(text, { isAdmin: input.isAdmin });
  let saved = 0;
  for (const n of notes) {
    const { error } = await input.db.rpc("assistant_memory_save" as never, {
      p_scope: n.scope,
      p_subject: n.subject,
      p_body: n.body,
      p_kind: n.kind,
      p_subject_id: n.scope === "user" ? row.user_id : null,
      p_source: "assistant",
      p_confidence: n.confidence,
      p_evidence: { conversation_id: row.id },
    } as never);
    if (!error) saved += 1;
  }
  await input.db.from("ai_usage_log").insert({
    user_id: row.user_id,
    conversation_id: row.id,
    model,
    tier: "fast",
    route_reason: "memory_learn",
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_tokens: usage.cache_read_tokens,
    cache_write_tokens: usage.cache_write_tokens,
    cost_usd: estimateCostUsd(model, usage),
    status,
    source: "assistant_v2",
  } as never);
  await markLearned(input.db, row.id, row.context, saved);
  return { ok: true, saved };
}

/** Is this user an active admin? (Decides whether their conversation may teach company notes.) */
export async function userIsAdmin(db: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await db.from("profiles").select("is_active, role:roles(name, permissions)").eq("id", userId).maybeSingle();
  const p = data as { is_active?: boolean; role?: unknown } | null;
  return !!p && p.is_active !== false && isAdminRole(p.role as never);
}

/** The nightly job: finished conversations not learned yet, then routines and repeated corrections. */
export async function nightlyLearning(input: { apiKey: string; db: SupabaseClient; env?: Env; now?: Date; client?: Claude; maxConversations?: number }) {
  const now = input.now ?? new Date();
  const result = { conversations: 0, conversationNotes: 0, auditNotes: 0, errors: 0 };

  // 1. Conversations that ended (no message for 10 minutes) in the last day.
  const { data: convs } = await input.db
    .from("ai_conversations")
    .select("id, user_id, context, updated_at")
    .gte("updated_at", new Date(now.getTime() - 26 * 3600_000).toISOString())
    .lte("updated_at", new Date(now.getTime() - 10 * 60_000).toISOString())
    .order("updated_at", { ascending: false })
    .limit(200);
  const pending = ((convs ?? []) as Array<{ id: string; user_id: string; context: Record<string, unknown> | null }>)
    .filter((c) => !c.context?.learnedAt && !c.context?.hidden)
    .slice(0, input.maxConversations ?? 40);
  const adminCache = new Map<string, boolean>();
  for (const c of pending) {
    if (!adminCache.has(c.user_id)) adminCache.set(c.user_id, await userIsAdmin(input.db, c.user_id));
    const r = await learnFromConversation({ apiKey: input.apiKey, db: input.db, conversationId: c.id, isAdmin: adminCache.get(c.user_id) === true, env: input.env, client: input.client });
    if (r.ok) {
      result.conversations += 1;
      result.conversationNotes += r.saved;
    } else if (r.reason === "budget") {
      break;
    } else if (r.reason === "error") {
      result.errors += 1;
    }
  }

  // 2. Routines and repeated corrections from the audit log (no LLM).
  const { data: rows } = await input.db
    .from("audit_logs")
    .select("user_id, action, table_name, record_id, created_at")
    .gte("created_at", new Date(now.getTime() - 28 * 86_400_000).toISOString())
    .order("created_at", { ascending: true })
    .limit(50_000);
  const audit = (rows ?? []) as AuditRow[];
  const { data: active } = await input.db.from("profiles").select("id").eq("is_active", true);
  const activeIds = new Set(((active ?? []) as Array<{ id: string }>).map((p) => p.id));
  // 3. The active watch (AST-5): which warnings this employee keeps fixing, and which they always ignore.
  const { data: watchRows } = await input.db
    .from("assistant_watch_events" as never)
    .select("user_id, code, action, created_at")
    .gte("created_at", new Date(now.getTime() - 14 * 86_400_000).toISOString())
    .in("action", ["fixed", "ignored"])
    .limit(50_000);
  const watch = (watchRows ?? []) as unknown as WatchEventRow[];
  const notes: LearnedNote[] = [...detectRoutines(audit, now), ...detectCorrections(audit, now), ...detectWatchPatterns(watch, now)].filter((n) => activeIds.has(n.userId));
  for (const n of notes) {
    const { error } = await input.db.rpc("assistant_memory_save" as never, {
      p_scope: "user",
      p_subject: n.subject,
      p_body: n.body,
      p_kind: n.kind,
      p_subject_id: n.userId,
      p_source: "assistant",
      p_confidence: n.confidence,
      p_evidence: n.evidence,
      // A routine that stops being true fades out instead of staying for ever.
      p_expires_at: new Date(now.getTime() + 45 * 86_400_000).toISOString(),
    } as never);
    if (error) result.errors += 1;
    else result.auditNotes += 1;
  }
  return result;
}
