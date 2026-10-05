import Anthropic from "@anthropic-ai/sdk";
import { estimateCostUsd, type ModelTier, type TokenUsage } from "@/lib/ai/native/router";
import { runTool, toolsForProfile, type ToolContext } from "@/lib/ai/native/tools";

/**
 * Tool-use loop for the native assistant (Claude API, no n8n in between).
 * The loop is written out by hand so every tool call is permission-checked,
 * capped, and recorded as a visible "step" and in the usage log.
 */

export type AgentStep = { tool: string; ok: boolean; summary: string };

export type AgentResult = {
  reply: string;
  model: string;
  tier: ModelTier;
  steps: AgentStep[];
  links: Array<{ label: string; href: string }>;
  usage: TokenUsage;
  costUsd: number | null;
  status: "ok" | "refusal" | "max_steps" | "max_tokens";
};

const MAX_ITERATIONS = 6;
const MAX_TOKENS = 16000;

/** Effort per tier (Haiku 4.5 does not take effort). */
const TIER_EFFORT: Record<ModelTier, "low" | "medium" | null> = {
  fast: null,
  standard: "low",
  deep: "medium",
};

function summarizeInput(input: unknown): string {
  try {
    const text = JSON.stringify(input ?? {});
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  } catch {
    return "";
  }
}

function supportsFallbacks(model: string): boolean {
  return /^claude-(opus-5|sonnet-5-5|fable-5)/.test(model);
}

export async function runNativeAgent(input: {
  apiKey: string;
  model: string;
  tier: ModelTier;
  system: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  today: string;
  ctx: ToolContext;
}): Promise<AgentResult> {
  const client = new Anthropic({ apiKey: input.apiKey, timeout: 60_000, maxRetries: 2 });
  const tools = toolsForProfile(input.ctx.profile);
  const effort = TIER_EFFORT[input.tier];
  const useFallbacks = supportsFallbacks(input.model);

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...input.history.map((turn) => ({ role: turn.role, content: turn.content })),
    {
      role: "user",
      content: [
        { type: "text", text: `Today is ${input.today}.` },
        { type: "text", text: input.userMessage },
      ],
    },
  ];

  const usage: TokenUsage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 };
  let cost = 0;
  let costKnown = true;
  let servedModel = input.model;
  const steps: AgentStep[] = [];
  const links: Array<{ label: string; href: string }> = [];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const response = await client.beta.messages.create({
      model: input.model,
      max_tokens: MAX_TOKENS,
      // Stable system prompt + fixed tool order → cacheable prefix.
      system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
      tools,
      messages,
      ...(effort ? { output_config: { effort } } : {}),
      ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });

    servedModel = response.model || input.model;
    const turnUsage: TokenUsage = {
      input_tokens: response.usage.input_tokens || 0,
      output_tokens: response.usage.output_tokens || 0,
      cache_read_tokens: response.usage.cache_read_input_tokens || 0,
      cache_write_tokens: response.usage.cache_creation_input_tokens || 0,
    };
    usage.input_tokens += turnUsage.input_tokens;
    usage.output_tokens += turnUsage.output_tokens;
    usage.cache_read_tokens += turnUsage.cache_read_tokens;
    usage.cache_write_tokens += turnUsage.cache_write_tokens;
    const turnCost = estimateCostUsd(servedModel, turnUsage);
    if (turnCost === null) costKnown = false;
    else cost += turnCost;

    const finish = (reply: string, status: AgentResult["status"]): AgentResult => ({
      reply,
      model: servedModel,
      tier: input.tier,
      steps,
      links,
      usage,
      costUsd: costKnown ? Math.round(cost * 1_000_000) / 1_000_000 : null,
      status,
    });

    const text = response.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (response.stop_reason === "refusal") return finish(text, "refusal");
    if (response.stop_reason === "max_tokens") return finish(text, "max_tokens");
    if (response.stop_reason !== "tool_use") return finish(text, "ok");

    const toolUses = response.content.filter(
      (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use"
    );
    messages.push({ role: "assistant", content: response.content as Anthropic.Beta.BetaContentBlockParam[] });

    // Parallel tool calls run together and go back in one user message.
    const results = await Promise.all(
      toolUses.map(async (block) => {
        const result = await runTool(block.name, block.input, input.ctx);
        steps.push({ tool: block.name, ok: !result.isError, summary: summarizeInput(block.input) });
        links.push(...result.links);
        return {
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: result.content,
          is_error: result.isError,
        };
      })
    );
    messages.push({ role: "user", content: results });

    if (iteration === MAX_ITERATIONS - 1) return finish(text, "max_steps");
  }

  // Unreachable: the loop always returns on its last iteration.
  return {
    reply: "",
    model: servedModel,
    tier: input.tier,
    steps,
    links,
    usage,
    costUsd: null,
    status: "max_steps",
  };
}
