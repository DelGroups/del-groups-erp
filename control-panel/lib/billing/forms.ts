/**
 * Validation of the plan and subscription editors (prompt 12). Pure; error values are i18n
 * keys under billing.errors. The results are the JSON public.save_plan() and
 * public.save_subscription() take.
 */
import { ADDON_CODES, BILLING_PERIODS, type AddonCode, type BillingPeriod } from "./pricing.ts";

type Raw = Readonly<Record<string, unknown>>;
const str = (raw: Raw, key: string) => (typeof raw[key] === "string" ? (raw[key] as string).trim() : "");
const flag = (raw: Raw, key: string) => raw[key] === "on" || raw[key] === "true" || raw[key] === true;

/** "" → null; otherwise a number with at most 2 decimals, or NaN. */
function amount(text: string): number | null {
  if (!text) return null;
  const normalized = text.replace(",", ".");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}

export interface PlanInput {
  id: string | null;
  code: string;
  name: string;
  description: string;
  annual_discount_pct: number;
  is_active: boolean;
  sort_order: number;
  max_users: number | null;
  included_storage_gb: number | null;
  included_ai_credit_usd: number | null;
  includes_custom_domain: boolean;
  currency: string;
  base_fee: number;
  modules: { module_id: string; amount: number; per_user: boolean }[];
  addons: { addon_code: AddonCode; amount: number }[];
}

export type PlanErrors = Partial<Record<string, string>>;

/**
 * Fields: code, name, description, annual_discount_pct, is_active, sort_order, max_users,
 * included_storage_gb, included_ai_credit_usd, includes_custom_domain, currency, base_fee,
 * module_<id> (offered), price_<id>, per_user_<id>, addon_<code> (empty = not sold).
 */
export function parsePlanForm(raw: Raw, moduleIds: readonly string[], id: string | null = null):
  | { ok: true; value: PlanInput }
  | { ok: false; errors: PlanErrors } {
  const errors: PlanErrors = {};
  const code = str(raw, "code").toLowerCase();
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(code)) errors.code = "codeInvalid";
  const name = str(raw, "name");
  if (!name || name.length > 120) errors.name = "nameRequired";
  const description = str(raw, "description");
  if (description.length > 500) errors.description = "tooLong";

  const discount = amount(str(raw, "annual_discount_pct")) ?? 0;
  if (Number.isNaN(discount) || discount > 100) errors.annual_discount_pct = "percentInvalid";
  const sortOrder = Number(str(raw, "sort_order") || 0);
  if (!Number.isInteger(sortOrder) || Math.abs(sortOrder) > 10000) errors.sort_order = "numberInvalid";

  const maxText = str(raw, "max_users");
  const maxUsers = maxText ? Number(maxText) : null;
  if (maxUsers !== null && (!Number.isInteger(maxUsers) || maxUsers < 1 || maxUsers > 10000)) errors.max_users = "usersInvalid";
  const storage = amount(str(raw, "included_storage_gb"));
  if (storage !== null && Number.isNaN(storage)) errors.included_storage_gb = "numberInvalid";
  const ai = amount(str(raw, "included_ai_credit_usd"));
  if (ai !== null && Number.isNaN(ai)) errors.included_ai_credit_usd = "numberInvalid";

  const currency = (str(raw, "currency") || "AZN").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.currency = "currencyInvalid";
  const baseFee = amount(str(raw, "base_fee")) ?? 0;
  if (Number.isNaN(baseFee)) errors.base_fee = "amountInvalid";

  const modules: PlanInput["modules"] = [];
  for (const moduleId of moduleIds) {
    if (!flag(raw, `module_${moduleId}`)) continue;
    const price = amount(str(raw, `price_${moduleId}`)) ?? 0;
    if (Number.isNaN(price)) errors[`price_${moduleId}`] = "amountInvalid";
    else modules.push({ module_id: moduleId, amount: price, per_user: flag(raw, `per_user_${moduleId}`) });
  }

  const addons: PlanInput["addons"] = [];
  for (const code of ADDON_CODES) {
    const price = amount(str(raw, `addon_${code}`));
    if (price === null) continue;
    if (Number.isNaN(price)) errors[`addon_${code}`] = "amountInvalid";
    else addons.push({ addon_code: code, amount: price });
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      id,
      code,
      name,
      description,
      annual_discount_pct: discount,
      is_active: flag(raw, "is_active"),
      sort_order: sortOrder,
      max_users: maxUsers,
      included_storage_gb: storage,
      included_ai_credit_usd: ai,
      includes_custom_domain: flag(raw, "includes_custom_domain"),
      currency,
      base_fee: baseFee,
      modules,
      addons,
    },
  };
}

export const SUBSCRIPTION_STATUSES = ["trial", "active", "past_due", "cancelled"] as const;
export type EditableSubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface SubscriptionInput {
  tenant_id: string;
  plan_id: string;
  status: EditableSubscriptionStatus;
  billing_period: BillingPeriod;
  user_count: number;
  current_period_start: string;
  current_period_end: string;
  trial_ends_at: string;
  modules: string[];
  addons: { addon_code: AddonCode; quantity: number }[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Shape and ranges only; plan rules (cap, offered modules) are checked with validateChoice(). */
export function parseSubscriptionForm(raw: Raw, tenantId: string, planIds: readonly string[], moduleIds: readonly string[]):
  | { ok: true; value: SubscriptionInput }
  | { ok: false; errors: Partial<Record<string, string>> } {
  const errors: Partial<Record<string, string>> = {};
  const planId = str(raw, "plan_id");
  if (!planIds.includes(planId)) errors.plan_id = "planRequired";
  const status = str(raw, "status") as EditableSubscriptionStatus;
  if (!(SUBSCRIPTION_STATUSES as readonly string[]).includes(status)) errors.status = "statusInvalid";
  const period = str(raw, "billing_period") as BillingPeriod;
  if (!BILLING_PERIODS.includes(period)) errors.billing_period = "periodInvalid";
  const users = Number(str(raw, "user_count"));
  if (!Number.isInteger(users) || users < 1 || users > 10000) errors.user_count = "usersInvalid";

  const start = str(raw, "current_period_start");
  const end = str(raw, "current_period_end");
  if ((start && !ISO_DATE.test(start)) || (end && !ISO_DATE.test(end))) errors.current_period_start = "dateInvalid";
  else if (start && end && end < start) errors.current_period_end = "periodOrder";
  const trialEnds = str(raw, "trial_ends_at");
  if (trialEnds && !ISO_DATE.test(trialEnds)) errors.trial_ends_at = "dateInvalid";

  const modules = moduleIds.filter((id) => flag(raw, `module_${id}`));
  const addons: SubscriptionInput["addons"] = [];
  for (const code of ADDON_CODES) {
    const text = str(raw, `addon_${code}`);
    const q = text ? Number(text) : 0;
    if (!Number.isInteger(q) || q < 0 || q > 10000 || (code === "custom_domain" && q > 1)) errors[`addon_${code}`] = "quantityInvalid";
    else if (q > 0) addons.push({ addon_code: code, quantity: q });
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      tenant_id: tenantId,
      plan_id: planId,
      status,
      billing_period: period,
      user_count: users,
      current_period_start: start,
      current_period_end: end,
      trial_ends_at: trialEnds,
      modules,
      addons,
    },
  };
}
