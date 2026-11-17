import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estimateCostUsd, resolveTierModels } from "@/lib/ai/native/router";
import { assistantBudgetUsd } from "@/lib/assistant/config";
import { loadTurnMemory } from "@/lib/assistant/engine";
import { parseUnusualReply, UNUSUAL_SYSTEM_PROMPT, unusualUserMessage, type DraftSummary } from "./unusual";

type Env = Readonly<Record<string, string | undefined>>;
type Claude = Pick<Anthropic, "messages">;

export type UnusualResult = { ok: true; note: string | null } | { ok: false; reason: "budget" | "error" };

const LANGUAGES: Record<string, string> = { az: "Azerbaijani", en: "English", ru: "Russian" };

/**
 * One Haiku pass over one draft summary (AST-5). The memory is read with the user's own client (only the
 * notes this user may see); the budget and the usage log use the server client, like the other assistant
 * jobs. Returns the note to show, or null when the draft looks fine.
 */
export async function checkUnusualDraft(input: {
  apiKey: string;
  userDb: SupabaseClient;
  serverDb: SupabaseClient;
  userId: string;
  summary: DraftSummary;
  locale: string;
  env?: Env;
  client?: Claude;
}): Promise<UnusualResult> {
  const env = input.env ?? process.env;
  try {
    const { data, error } = await input.serverDb.rpc("assistant_month_cost" as never);
    if (error) return { ok: false, reason: "error" };
    const spent = Number(data);
    if ((Number.isFinite(spent) ? spent : 0) >= assistantBudgetUsd(env)) return { ok: false, reason: "budget" };
  } catch {
    return { ok: false, reason: "error" };
  }

  const memory = await loadTurnMemory(input.userDb, { page: null, recordType: null, recordId: null, summary: null });
  const model = resolveTierModels(env).fast;
  const client = input.client ?? new Anthropic({ apiKey: input.apiKey });
  const log = (status: string, usage?: { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number }) =>
    input.serverDb.from("ai_usage_log").insert({
      user_id: input.userId,
      model,
      tier: "fast",
      route_reason: "watch_unusual",
      ...(usage ?? {}),
      cost_usd: usage ? estimateCostUsd(model, usage) : null,
      status,
      source: "assistant_v2",
    } as never);

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 200,
      system: UNUSUAL_SYSTEM_PROMPT,
      messages: [{ role: "user", content: unusualUserMessage(input.summary, LANGUAGES[input.locale] ?? "Azerbaijani", memory.text) }],
    });
    let text = "";
    for (const block of response.content) if (block.type === "text") text += block.text;
    await log("ok", {
      input_tokens: response.usage.input_tokens ?? 0,
      output_tokens: response.usage.output_tokens ?? 0,
      cache_read_tokens: response.usage.cache_read_input_tokens ?? 0,
      cache_write_tokens: response.usage.cache_creation_input_tokens ?? 0,
    });
    return { ok: true, note: parseUnusualReply(text) };
  } catch {
    await log("error");
    return { ok: false, reason: "error" };
  }
}
