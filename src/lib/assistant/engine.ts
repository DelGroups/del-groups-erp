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
import { checkNote, MEMORY_TOOL_NAMES, MEMORY_TOOLS, memoryBlock, type TurnNote } from "@/lib/assistant/memory";
import { PROPOSAL_TOOL_NAMES, proposalToolsFor, type ProposalCard } from "@/lib/assistant/proposals";
import { runProposalTool } from "@/lib/assistant/proposeServer";
import { userHasLegacyPermission } from "@/lib/auth/permissionMatrix";
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
  /**
   * AST-4: proposals (drafts the user confirms). The server client stores them; the card goes to onProposal.
   * Left out, the turn offers no proposal tools.
   */
  proposals?: { admin: SupabaseClient; userId: string; confirmLimit: number; onProposal: (card: ProposalCard) => void };
  /** The conversation this turn belongs to (evidence of notes the assistant saves). */
  conversationId?: string | null;
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

  const can = (permission: string) => input.isAdmin || userHasLegacyPermission(input.profile, permission as never);
  const proposalTools = input.proposals ? proposalToolsFor(can) : [];
  const tools = [...toolsForSkills(skills, input.profile, input.enabledModules, input.isAdmin), ...MEMORY_TOOLS, ...proposalTools];
  const memory = await loadTurnMemory(input.db, context);
  const route = routeAssistantTurn(input.message, { isAdmin: input.isAdmin, skills, forced: assistantForcedTier(env) });
  const model = resolveTierModels(env)[route.tier];
  const preamble = [turnPreamble({ page: context.page, recordSummary: context.summary }), memory.text].filter(Boolean).join("\n\n");
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
        if (MEMORY_TOOL_NAMES.has(name)) return runMemoryTool(input.db, name, args, input.conversationId ?? null);
        if (PROPOSAL_TOOL_NAMES.has(name) && input.proposals) {
          return runProposalTool(name, args, {
            db: input.db,
            admin: input.proposals.admin,
            userId: input.proposals.userId,
            conversationId: input.conversationId ?? null,
            can,
            today: input.today ?? new Date().toISOString().slice(0, 10),
            confirmLimit: input.proposals.confirmLimit,
            onProposal: input.proposals.onProposal,
          });
        }
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

/**
 * The notes for this turn (AST-3): company + this user's own + the record in view they may see, read with the
 * user's own client through assistant_memory_for_turn, cut to about 2 000 tokens and marked as used. Before
 * the memory migration is run (or on any error) the turn simply has no notes.
 */
export async function loadTurnMemory(db: SupabaseClient, context: TurnContext): Promise<{ text: string; usedIds: string[] }> {
  try {
    const { data, error } = await db.rpc("assistant_memory_for_turn" as never, { p_record_type: context.recordType, p_record_id: context.recordId } as never);
    if (error || !Array.isArray(data)) return { text: "", usedIds: [] };
    const block = memoryBlock(data as TurnNote[]);
    if (block.usedIds.length) await db.rpc("assistant_memory_touch" as never, { p_ids: block.usedIds } as never);
    return block;
  } catch {
    return { text: "", usedIds: [] };
  }
}

type ToolOut = { content: string; isError: boolean; links: Array<{ label: string; href: string }> };

/** remember / recall, with the user's own client: the database decides what this user may write and read. */
export async function runMemoryTool(db: SupabaseClient, name: string, args: unknown, conversationId: string | null): Promise<ToolOut> {
  const input = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const fail = (content: string): ToolOut => ({ content, isError: true, links: [] });
  if (name === "remember") {
    const check = checkNote(input);
    if (!check.ok) return fail(check.reason === "forbidden" ? "Not saved: this is a topic that is never remembered." : "Not saved: give scope, a subject (3-120 characters), a body (3-1000) and, for partner or product, its subject_id.");
    const n = check.note;
    const { data, error } = await db.rpc("assistant_memory_save" as never, {
      p_scope: n.scope,
      p_subject: n.subject,
      p_body: n.body,
      p_kind: n.kind,
      p_subject_id: n.subjectId,
      p_source: "assistant",
      p_confidence: 1,
      p_evidence: conversationId ? { conversation_id: conversationId } : {},
    } as never);
    if (error) return fail(/forbidden/.test(error.message) ? "Not saved: this user may not save that note." : "Not saved: " + error.message);
    return { content: JSON.stringify({ saved: true, id: data }), isError: false, links: [] };
  }
  const query = typeof input.query === "string" ? input.query.slice(0, 80) : "";
  const { data, error } = await db.rpc("assistant_memory_recall" as never, { p_query: query, p_limit: 10 } as never);
  if (error) return fail("Memory is not available: " + error.message);
  const rows = (Array.isArray(data) ? data : []) as Array<{ scope: string; kind: string; subject: string; body: string }>;
  return { content: JSON.stringify(rows.map((r) => ({ scope: r.scope, kind: r.kind, subject: r.subject, body: r.body }))), isError: false, links: [] };
}
