import { routeRequest, MODEL_TIERS, type ModelTier } from "@/lib/ai/native/router";

/**
 * Which model the accountant agent uses for a task (GUARD-5 router). Most of the work is light, so the
 * cheap model (Haiku) does it; the expensive ones are kept for work that needs thinking:
 *   fast      Haiku   a quiet day (no new findings of weight), a plain question
 *   standard  Sonnet  new serious findings, a busy day, a general review, an ordinary question
 *   deep      Opus    the monthly review, and questions that ask for analysis ("why", compare, forecast)
 * A light run that fails to produce a proper report is repeated once with the next tier (agent.ts).
 * GUARD_AI_FORCE_TIER (fast | standard | deep) pins one tier for everything, e.g. to test or to save more.
 * Pure module: the decision is a function of the task and the guard's numbers, so it is easy to test.
 */

export type RouterKind = "daily" | "monthly" | "on_demand";

export interface RouterInput {
  kind: RouterKind;
  /** The admin's question for an on-demand report (empty: a general review). */
  question?: string;
  /** Findings first seen in the last 36 hours and still open or acknowledged. */
  newFindings: number;
  /** Of those, how many are critical or high. */
  newSerious: number;
  /** Open and acknowledged findings in all (0: nothing to review). */
  openFindings: number;
  force?: string | null;
}

export interface RouterDecision {
  tier: ModelTier;
  reason: string;
}

/** More new findings than this in a day is a busy day: Sonnet, not Haiku. */
export const BUSY_DAY_NEW_FINDINGS = 10;

export function routeGuardTask(input: RouterInput): RouterDecision {
  const forced = (MODEL_TIERS as readonly string[]).includes(input.force ?? "") ? (input.force as ModelTier) : null;
  if (forced) return { tier: forced, reason: "forced" };
  if (input.kind === "monthly") return { tier: "deep", reason: "monthly" };
  if (input.kind === "on_demand") {
    const question = (input.question ?? "").trim();
    if (!question) return { tier: "standard", reason: "general_review" };
    const decision = routeRequest(question);
    return { tier: decision.tier, reason: `question_${decision.reason}` };
  }
  if (input.openFindings === 0) return { tier: "fast", reason: "nothing_open" };
  if (input.newSerious > 0) return { tier: "standard", reason: "new_serious" };
  if (input.newFindings > BUSY_DAY_NEW_FINDINGS) return { tier: "standard", reason: "busy_day" };
  return { tier: "fast", reason: "quiet_day" };
}

/** The next tier up for a repeat after a failed light run; null at the top (or for a forced tier). */
export function nextTier(tier: ModelTier): ModelTier | null {
  if (tier === "fast") return "standard";
  if (tier === "standard") return "deep";
  return null;
}

const NEW_WINDOW_MS = 36 * 60 * 60 * 1000;

/** The router's numbers from the open findings the agent is given (newest 30 are enough to tell a quiet day). */
export function routerStats(open: ReadonlyArray<{ first_seen_at?: unknown; severity?: unknown }>, now: Date): Pick<RouterInput, "newFindings" | "newSerious" | "openFindings"> {
  let newFindings = 0;
  let newSerious = 0;
  for (const f of open) {
    const seen = typeof f.first_seen_at === "string" ? Date.parse(f.first_seen_at) : NaN;
    if (!Number.isFinite(seen) || now.getTime() - seen > NEW_WINDOW_MS) continue;
    newFindings += 1;
    if (f.severity === "critical" || f.severity === "high") newSerious += 1;
  }
  return { newFindings, newSerious, openFindings: open.length };
}
