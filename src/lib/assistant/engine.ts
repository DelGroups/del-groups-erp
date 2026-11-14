import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runNativeAgent, type AgentEvent, type AgentResult } from "@/lib/ai/native/agent";
import { resolveTierModels, routeRequest, type ModelTier, type RouteDecision } from "@/lib/ai/native/router";
import { nativeToolsByName, runTool } from "@/lib/ai/native/tools";
import { GUARD_AGENT_TOOLS, runGuardAgentTool } from "@/lib/guard/agentTools";
import type { GuardDb } from "@/lib/guard/server";
import { assistantBudgetUsd, assistantForcedTier } from "@/lib/assistant/config";
import { loadTurnContext, type ClientContext, type ContextDb, type TurnContext } from "@/lib/assistant/context";
import { assistantSystemPrompt, turnPreamble, type AssistantLanguage } from "@/lib/assistant/prompt";
import { selectSkills, skillById, type SkillId } from "@/lib/assistant/skills";
import type { UserProfile } from "@/types/database.types";

/**
 * One turn of Del Assistant (AST-1): context → skills → tools → router → the agent loop (streaming).
 * Everything the model can touch runs with the user's own Supabase client; the guard's tools are added
 * only for admins. The budget is checked before Claude is called.
 */

const GUARD_TOOL_NAMES = new Set(GUARD_AGENT_TOOLS.map((t) => t.name));

/** The tools of the chosen skills that this user may call, in a stable order. */
export function toolsForSkills(skills: readonly SkillId[], profile: UserProfile | null, enabledModules: ReadonlySet<string>, isAdmin: boolean): Anthropic.Beta.BetaTool[] {
  const names = skills.flatMap((id) => [...skillById(id).tools]);
  const native = nativeToolsByName(names, profile, enabledModules) as unknown as Anthropic.Beta.BetaTool[];
  const guard = isAdmin && skills.includes("accountant") ? GUARD_AGENT_TOOLS.filter((t) => names.includes(t.name)) : [];
  return [...native, ...guard];
}

/**
 * The tier for a turn: the assistant's router on the question, never above standard for non-admins (the
 * expensive model is kept for management analysis), and an admin's accountant work may go deep.
 */
export function routeAssistantTurn(question: string, input: { isAdmin: boolean; skills: readonly SkillId[]; forced: ModelTier | null }): RouteDecision {
  if (input.forced) return { tier: input.forced, reason: "forced" };
  const decision = routeRequest(question);
  if (decision.tier === "deep" && !input.isAdmin) return { tier: "standard", reason: `${decision.reason}_capped` };
  return decision;
}

export type AssistantTurnResult =
  | { ok: true; result: AgentResult; route: RouteDecision; skills: SkillId[]; context: TurnContext }
  | { ok: false; reason: "budget"; message: string; skills: SkillId[]; context: TurnContext };

export interface AssistantTurnInput {
  apiKey: string;
  /** The user's own Supabase client: every read goes through RLS. */
  db: SupabaseClient;
  profile: UserProfile | null;
  isAdmin: boolean;
  enabledModules: ReadonlySet<string>;
  language: AssistantLanguage;
  productName: string;
  company: { name: string; currency: string };
  userName: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  message: string;
  clientContext: ClientContext;
  /** This month's assistant cost so far (read by the server, admin rights). */
  monthSpent: () => Promise<number>;
  onEvent?: (event: AgentEvent) => void;
  today?: string;
  client?: Pick<Anthropic, "beta">;
  env?: Readonly<Record<string, string | undefined>>;
}

export async function runAssistantTurn(input: AssistantTurnInput): Promise<AssistantTurnResult> {
  const env = input.env ?? process.env;
  const context = await loadTurnContext(input.db as unknown as ContextDb, input.clientContext);
  const skills = selectSkills({ page: context.page, recordType: context.recordType, question: input.message, isAdmin: input.isAdmin });

  const budget = assistantBudgetUsd(env);
  const spent = await input.monthSpent();
  if (spent >= budget) {
    return { ok: false, reason: "budget", message: `Monthly AI budget reached (${spent.toFixed(2)} of ${budget} USD).`, skills, context };
  }

  const tools = toolsForSkills(skills, input.profile, input.enabledModules, input.isAdmin);
  const route = routeAssistantTurn(input.message, { isAdmin: input.isAdmin, skills, forced: assistantForcedTier(env) });
  const model = resolveTierModels(env)[route.tier];
  const preamble = turnPreamble({ page: context.page, recordSummary: context.summary });
  const ctx = { client: input.db, profile: input.profile, enabledModules: input.enabledModules };

  const result = await runNativeAgent({
    apiKey: input.apiKey,
    model,
    tier: route.tier,
    system: assistantSystemPrompt({
      productName: input.productName,
      company: input.company.name,
      currency: input.company.currency,
      language: input.language,
      userName: input.userName,
      role: input.profile?.role?.name ?? "user",
      isAdmin: input.isAdmin,
      skills,
    }),
    history: input.history,
    userMessage: preamble ? `${preamble}\n\n${input.message}` : input.message,
    today: input.today ?? new Date().toISOString().slice(0, 10),
    ctx,
    client: input.client,
    toolset: {
      tools,
      run: async (name, args) => {
        if (!tools.some((t) => t.name === name)) return { content: `Tool not available here: ${name}`, isError: true, links: [] };
        if (GUARD_TOOL_NAMES.has(name)) {
          if (!input.isAdmin) return { content: "Permission denied for this user.", isError: true, links: [] };
          return runGuardAgentTool(input.db as unknown as GuardDb, name, args);
        }
        return runTool(name, args, ctx);
      },
    },
    onEvent: input.onEvent,
  });
  return { ok: true, result, route, skills, context };
}
