import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estimateCostUsd, resolveTierModels } from "@/lib/ai/native/router";
import { assistantBudgetUsd } from "@/lib/assistant/config";
import { userHasLegacyPermission } from "@/lib/auth/permissionMatrix";
import { fetchAllProfiles } from "@/lib/auth/profile";
import { isAdminRole, type UserProfile } from "@/types/database.types";
import { addDays } from "./compute";
import { BRIEFING_SYSTEM_PROMPT, briefingFacts, briefingLinks, briefingUserMessage, cleanBriefingBody, type BriefingAccess, type BriefingData, type BriefingLanguage } from "./briefing";
import { readLines, readProducts, readSales, type InsightDb } from "./tools";
import { readBriefingSetting } from "./briefingSetting";

type Env = Readonly<Record<string, string | undefined>>;
type Claude = Pick<Anthropic, "messages">;

/** Lines are read for the last 120 days (margin: 30, stock cover: 60, slow movers: 90). */
export const BRIEFING_LINE_DAYS = 120;

/** Who gets a briefing: active admins, and active users who may see financial reports. */
export function briefingRecipients(profiles: UserProfile[]): UserProfile[] {
  return profiles.filter((p) => p.is_active !== false && (isAdminRole(p.role) || userHasLegacyPermission(p, "can_view_financial_reports")));
}

export function briefingAccess(p: UserProfile): BriefingAccess {
  const can = (perm: string) => userHasLegacyPermission(p, perm as never);
  return { isAdmin: isAdminRole(p.role), sales: can("can_view_sales"), finance: can("can_view_finance"), customers: can("can_view_customers"), products: can("can_view_products") };
}

export function briefingLanguage(p: UserProfile): BriefingLanguage {
  const l = (p as unknown as { locale?: string | null }).locale;
  return l === "en" || l === "ru" ? l : "az";
}

/** Company-wide rows, read once with the server client; each person's facts are then cut to their access. */
export async function readBriefingData(db: SupabaseClient, today: string): Promise<BriefingData> {
  const { rows: sales } = await readSales(db as unknown as InsightDb, null, today);
  const lineFrom = addDays(today, -BRIEFING_LINE_DAYS);
  const recent = sales.filter((s) => (s.doc_date ?? "") >= lineFrom).map((s) => s.id);
  const [lines, products, accounts, findings] = await Promise.all([
    readLines(db as unknown as InsightDb, recent),
    readProducts(db as unknown as InsightDb),
    db.from("accounts").select("name, type, balance").limit(200),
    db.from("guard_findings").select("severity, first_seen_at").eq("status", "open").gte("first_seen_at", `${addDays(today, -1)}T00:00:00`).limit(2000),
  ]);
  return {
    sales,
    lines,
    products,
    accounts: ((accounts.data ?? []) as Array<{ name: string; type?: string | null; balance: number }>),
    findings: findings.error ? [] : ((findings.data ?? []) as Array<{ severity: string; first_seen_at: string }>),
  };
}

export type BriefingOutcome = { userId: string; status: "written" | "exists" | "budget" | "error" };

/** One person's briefing: facts → Haiku → one row. Skips a person who already has today's. */
export async function writeBriefing(input: {
  db: SupabaseClient;
  client: Claude;
  model: string;
  profile: UserProfile;
  data: BriefingData;
  today: string;
}): Promise<BriefingOutcome> {
  const { db, profile, today } = input;
  const existing = await db.from("assistant_briefings").select("id").eq("user_id", profile.id).eq("day", today).maybeSingle();
  if (existing.data) return { userId: profile.id, status: "exists" };
  const facts = briefingFacts(input.data, briefingAccess(profile), today);
  const language = briefingLanguage(profile);
  const name = (profile.full_name || profile.email || "").split(/\s+/)[0] || "";
  let text = "";
  let usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 };
  try {
    const response = await input.client.messages.create({
      model: input.model,
      max_tokens: 700,
      system: BRIEFING_SYSTEM_PROMPT,
      messages: [{ role: "user", content: briefingUserMessage(facts, name, language) }],
    });
    for (const block of response.content) if (block.type === "text") text += block.text;
    usage = {
      input_tokens: response.usage.input_tokens ?? 0,
      output_tokens: response.usage.output_tokens ?? 0,
      cache_read_tokens: response.usage.cache_read_input_tokens ?? 0,
      cache_write_tokens: response.usage.cache_creation_input_tokens ?? 0,
    };
  } catch {
    await db.from("ai_usage_log").insert({ user_id: profile.id, model: input.model, tier: "fast", route_reason: "briefing", status: "error", source: "assistant_v2" } as never);
    return { userId: profile.id, status: "error" };
  }
  await db.from("ai_usage_log").insert({ user_id: profile.id, model: input.model, tier: "fast", route_reason: "briefing", ...usage, cost_usd: estimateCostUsd(input.model, usage), status: "ok", source: "assistant_v2" } as never);
  const body = cleanBriefingBody(text);
  if (!body) return { userId: profile.id, status: "error" };
  const { error } = await db
    .from("assistant_briefings")
    .upsert({ user_id: profile.id, day: today, language, body, all_well: facts.all_well, facts, links: briefingLinks(facts), model: input.model } as never, { onConflict: "user_id,day", ignoreDuplicates: true });
  return { userId: profile.id, status: error ? "error" : "written" };
}

/** The nightly job: every recipient, inside the monthly budget. */
export async function nightlyBriefings(input: { apiKey: string; db: SupabaseClient; env?: Env; today: string; client?: Claude; profiles?: UserProfile[] }) {
  const env = input.env ?? process.env;
  // AST-7: the admins' switch on the home widget. Off (the default) → nothing is read, no Claude call.
  const setting = await readBriefingSetting(input.db);
  if (!setting.enabled) return { recipients: 0, written: 0, existing: 0, errors: 0, budget: false, switchedOff: true };
  const model = resolveTierModels(env).fast;
  const client = input.client ?? new Anthropic({ apiKey: input.apiKey });
  const recipients = briefingRecipients(input.profiles ?? (await fetchAllProfiles(input.db as never)));
  const result = { recipients: recipients.length, written: 0, existing: 0, errors: 0, budget: false, switchedOff: false };
  if (!recipients.length) return result;
  const data = await readBriefingData(input.db, input.today);
  for (const profile of recipients) {
    const { data: spent } = await input.db.rpc("assistant_month_cost" as never);
    if ((Number(spent) || 0) >= assistantBudgetUsd(env)) {
      result.budget = true;
      break;
    }
    const r = await writeBriefing({ db: input.db, client, model, profile, data, today: input.today });
    if (r.status === "written") result.written += 1;
    else if (r.status === "exists") result.existing += 1;
    else result.errors += 1;
  }
  return result;
}
