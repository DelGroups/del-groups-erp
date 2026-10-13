/**
 * Plans and subscriptions as stored in the control plane, mapped to the pricing model
 * (lib/billing/pricing.ts). Pure mapping plus the Supabase reads the pages share.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ADDON_CODES, type AddonCode, type BillingPeriod, type ModuleInfo, type PlanPricing, type SubscriptionChoice } from "./pricing.ts";

export interface PlanRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  annual_discount_pct: number | string;
  is_active: boolean;
  sort_order: number;
  max_users: number | null;
  included_storage_gb: number | string | null;
  included_ai_credit_usd: number | string | null;
  includes_custom_domain: boolean;
  plan_prices: { module_id: string | null; billing_period: BillingPeriod; currency: string; amount: number | string; per_user: boolean }[];
  plan_addon_prices: { addon_code: string; currency: string; amount: number | string }[];
}

export const PLAN_SELECT =
  "id, code, name, description, annual_discount_pct, is_active, sort_order, max_users, included_storage_gb, included_ai_credit_usd, includes_custom_domain, plan_prices(module_id, billing_period, currency, amount, per_user), plan_addon_prices(addon_code, currency, amount)";

const num = (v: number | string | null | undefined): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

/** Monthly prices of a plan in one currency (the plan's base-fee currency, AZN by default). */
export function toPlanPricing(row: PlanRow): PlanPricing {
  const monthly = row.plan_prices.filter((p) => p.billing_period === "monthly");
  const currency = monthly.find((p) => p.module_id === null)?.currency ?? monthly[0]?.currency ?? "AZN";
  const inCurrency = monthly.filter((p) => p.currency === currency);
  return {
    currency,
    baseFee: Number(inCurrency.find((p) => p.module_id === null)?.amount ?? 0),
    annualDiscountPct: Number(row.annual_discount_pct) || 0,
    maxUsers: row.max_users ?? null,
    includedStorageGb: num(row.included_storage_gb),
    includedAiCreditUsd: num(row.included_ai_credit_usd),
    includesCustomDomain: Boolean(row.includes_custom_domain),
    modules: inCurrency
      .filter((p) => p.module_id !== null)
      .map((p) => ({ moduleId: p.module_id as string, amount: Number(p.amount), perUser: p.per_user }))
      .sort((a, b) => a.moduleId.localeCompare(b.moduleId)),
    addons: row.plan_addon_prices
      .filter((a) => a.currency === currency && (ADDON_CODES as readonly string[]).includes(a.addon_code))
      .map((a) => ({ code: a.addon_code as AddonCode, amount: Number(a.amount) }))
      .sort((a, b) => ADDON_CODES.indexOf(a.code) - ADDON_CODES.indexOf(b.code)),
  };
}

export interface SubscriptionRow {
  id: string;
  plan_id: string;
  status: "trial" | "active" | "past_due" | "cancelled" | "expired";
  billing_period: BillingPeriod;
  currency: string;
  user_count: number;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  sync_status: "not_synced" | "synced" | "failed";
  synced_at: string | null;
  sync_error: string | null;
  subscription_items: { module_id: string }[];
  subscription_addons: { addon_code: string; quantity: number }[];
}

export const SUBSCRIPTION_SELECT =
  "id, plan_id, status, billing_period, currency, user_count, current_period_start, current_period_end, trial_ends_at, sync_status, synced_at, sync_error, subscription_items(module_id), subscription_addons(addon_code, quantity)";

export function toChoice(row: SubscriptionRow): SubscriptionChoice {
  const addons: SubscriptionChoice["addons"] = {};
  for (const a of row.subscription_addons) {
    if ((ADDON_CODES as readonly string[]).includes(a.addon_code) && a.quantity > 0) addons[a.addon_code as AddonCode] = a.quantity;
  }
  return {
    period: row.billing_period,
    userCount: row.user_count,
    modules: row.subscription_items.map((i) => i.module_id).sort(),
    addons,
  };
}

function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function loadModules(supabase: SupabaseClient): Promise<(ModuleInfo & { name: string })[]> {
  const rows = check(
    await supabase.from("modules").select("id, name, depends, is_core").eq("is_active", true).order("is_core", { ascending: false }).order("name")
  ) as { id: string; name: string; depends: string[] | null; is_core: boolean }[];
  return rows.map((m) => ({ id: m.id, name: m.name, depends: m.depends ?? [], isCore: m.is_core }));
}

export async function loadPlans(supabase: SupabaseClient): Promise<PlanRow[]> {
  return check(await supabase.from("plans").select(PLAN_SELECT).order("sort_order").order("name")) as PlanRow[];
}

/** The tenant's live subscription (trial / active / past_due), if any. */
export async function loadLiveSubscription(supabase: SupabaseClient, tenantId: string): Promise<SubscriptionRow | null> {
  return check(
    await supabase
      .from("subscriptions")
      .select(SUBSCRIPTION_SELECT)
      .eq("tenant_id", tenantId)
      .in("status", ["trial", "active", "past_due"])
      .maybeSingle()
  ) as SubscriptionRow | null;
}
