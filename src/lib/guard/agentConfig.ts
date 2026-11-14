import { timingSafeEqual } from "node:crypto";
import { isAccountingGuardEnabled } from "@/lib/features/accountingGuard";

/**
 * Switches of the accountant agent (GUARD-5). Everything is off unless Del sets it on the server:
 *   ACCOUNTING_GUARD=true            the guard itself (GUARD-1..4)
 *   ACCOUNTING_GUARD_AI=true         the agent on top of it
 *   ANTHROPIC_API_KEY                the Claude API key (server only, never in the repo)
 *   GUARD_CRON_SECRET                the secret of the scheduled job that asks for the daily / monthly report
 *   GUARD_AI_MONTHLY_BUDGET_USD      optional, default 15: when this month's cost reaches it the agent stops
 * Pure functions of an env object, so tests can pass their own.
 */

type Env = Readonly<Record<string, string | undefined>>;

function clean(value: string | undefined): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "");
}

export const DEFAULT_MONTHLY_BUDGET_USD = 15;

export type GuardAgentAccess =
  | { enabled: true; apiKey: string }
  | { enabled: false; reason: "guard_disabled" | "ai_disabled" | "no_api_key" };

export function guardAgentAccess(env: Env = process.env): GuardAgentAccess {
  if (!isAccountingGuardEnabled(env)) return { enabled: false, reason: "guard_disabled" };
  if (clean(env.ACCOUNTING_GUARD_AI).toLowerCase() !== "true") return { enabled: false, reason: "ai_disabled" };
  const apiKey = clean(env.ANTHROPIC_API_KEY);
  if (!apiKey) return { enabled: false, reason: "no_api_key" };
  return { enabled: true, apiKey };
}

/** The flag only (no key check): what the screens use to show the agent's buttons. */
export function isGuardAgentFlagOn(env: Env = process.env): boolean {
  return isAccountingGuardEnabled(env) && clean(env.ACCOUNTING_GUARD_AI).toLowerCase() === "true";
}

export function guardMonthlyBudgetUsd(env: Env = process.env): number {
  const n = Number(clean(env.GUARD_AI_MONTHLY_BUDGET_USD));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MONTHLY_BUDGET_USD;
}

/** Constant-time check of "Authorization: Bearer <secret>" against GUARD_CRON_SECRET. A missing secret refuses everyone. */
export function guardCronAuthorized(header: string | null, env: Env = process.env): boolean {
  const secret = clean(env.GUARD_CRON_SECRET);
  if (!secret || secret.length < 16) return false;
  const match = /^Bearer\s+(.+)$/i.exec((header ?? "").trim());
  if (!match) return false;
  const given = Buffer.from(match[1].trim());
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
