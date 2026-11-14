import { MODEL_TIERS, type ModelTier } from "@/lib/ai/native/router";

/**
 * Switches of Del Assistant (AST-1, docs/assistant/ASSISTANT-plan-and-prompts.md). Off unless Del sets them on the server:
 *   ASSISTANT_V2=true                 the new assistant (engine, and from AST-2 its panel)
 *   ASSISTANT_V2_AUDIENCE             admins (default) | all
 *   ANTHROPIC_API_KEY                 the Claude API key (server only, never in the repo)
 *   ASSISTANT_MONTHLY_BUDGET_USD      optional, default 30: at this month's cost the assistant stops calling Claude
 *   ASSISTANT_FORCE_TIER              optional: fast | standard | deep for every turn
 * Pure functions of an env object, so tests can pass their own.
 */

type Env = Readonly<Record<string, string | undefined>>;

function clean(value: string | undefined): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "");
}

export const DEFAULT_ASSISTANT_BUDGET_USD = 30;

export type AssistantAudience = "admins" | "all";

export function isAssistantV2On(env: Env = process.env): boolean {
  return clean(env.ASSISTANT_V2).toLowerCase() === "true";
}

export function assistantAudience(env: Env = process.env): AssistantAudience {
  return clean(env.ASSISTANT_V2_AUDIENCE).toLowerCase() === "all" ? "all" : "admins";
}

export type AssistantAccess =
  | { enabled: true; apiKey: string }
  | { enabled: false; reason: "disabled" | "not_in_audience" | "no_api_key" };

export function assistantAccess(input: { isAdmin: boolean }, env: Env = process.env): AssistantAccess {
  if (!isAssistantV2On(env)) return { enabled: false, reason: "disabled" };
  if (assistantAudience(env) === "admins" && !input.isAdmin) return { enabled: false, reason: "not_in_audience" };
  const apiKey = clean(env.ANTHROPIC_API_KEY);
  if (!apiKey) return { enabled: false, reason: "no_api_key" };
  return { enabled: true, apiKey };
}

export function assistantBudgetUsd(env: Env = process.env): number {
  const n = Number(clean(env.ASSISTANT_MONTHLY_BUDGET_USD));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ASSISTANT_BUDGET_USD;
}

export function assistantForcedTier(env: Env = process.env): ModelTier | null {
  const v = clean(env.ASSISTANT_FORCE_TIER).toLowerCase();
  return (MODEL_TIERS as readonly string[]).includes(v) ? (v as ModelTier) : null;
}
