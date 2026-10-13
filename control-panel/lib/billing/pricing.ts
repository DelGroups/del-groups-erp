/**
 * Price and limit math for plans and subscriptions (prompt 12, plan §4.2). Pure: no I/O,
 * no Date.now(); every amount is integer minor units (qəpik/cents) to avoid float drift.
 *
 *   monthly = base fee + Σ module price × (users if per-user, else 1) + Σ add-on price × quantity
 *   yearly  = monthly × 12 × (1 − annual discount)
 *
 * Limits a subscription grants (also computed in SQL by public.tenant_entitlements(); the
 * two are kept equal by tests):
 *   seats    = users + extra_users add-on × unit
 *   storage  = plan's included GB + storage add-on × unit GB   (plan null = unlimited)
 *   AI       = plan's included credit + AI add-on × unit USD    (plan null = unlimited)
 */

export type BillingPeriod = "monthly" | "yearly";
export const BILLING_PERIODS: readonly BillingPeriod[] = ["monthly", "yearly"];

export const ADDON_CODES = ["extra_users", "storage_gb", "ai_credit", "custom_domain"] as const;
export type AddonCode = (typeof ADDON_CODES)[number];

/** What one unit of each add-on gives (same values as the control-plane `addons` seed). */
export const ADDON_UNIT: Record<AddonCode, number> = {
  extra_users: 1, // seats
  storage_gb: 10, // GB
  ai_credit: 10, // USD of AI usage per month
  custom_domain: 1,
};

export const GIB = 1024 ** 3;

export interface ModuleInfo {
  id: string;
  depends: readonly string[];
  isCore: boolean;
}

/** A plan's prices, monthly, in major units as stored (numeric(12,2)). */
export interface PlanPricing {
  currency: string;
  baseFee: number;
  annualDiscountPct: number;
  /** Most users the plan allows (extra_users add-on goes beyond); null = no cap. */
  maxUsers: number | null;
  /** null = unlimited. */
  includedStorageGb: number | null;
  includedAiCreditUsd: number | null;
  includesCustomDomain: boolean;
  /** Modules the plan offers, with their price. */
  modules: readonly { moduleId: string; amount: number; perUser: boolean }[];
  /** Add-ons the plan sells, monthly price per unit. */
  addons: readonly { code: AddonCode; amount: number }[];
}

export interface SubscriptionChoice {
  period: BillingPeriod;
  userCount: number;
  /** Chosen modules (core and dependencies are added). */
  modules: readonly string[];
  addons: Partial<Record<AddonCode, number>>;
}

export interface QuoteLine {
  kind: "base" | "module" | "addon";
  id: string;
  quantity: number;
  unitCents: number;
  /** Monthly amount of the line. */
  totalCents: number;
}

export interface Quote {
  currency: string;
  period: BillingPeriod;
  /** Modules billed (chosen + core + dependencies), in catalog order. */
  modules: string[];
  lines: QuoteLine[];
  monthlyCents: number;
  /** Yearly discount (0 for monthly), positive number of cents taken off. */
  discountCents: number;
  /** What one billing period costs: monthly, or yearly after the discount. */
  periodCents: number;
}

export const toCents = (amount: number | string | null | undefined): number => Math.round(Number(amount ?? 0) * 100);
export const fromCents = (cents: number): number => Math.round(cents) / 100;

/** Chosen modules + core + everything they depend on, in catalog order. */
export function withDependencies(chosen: readonly string[], catalog: readonly ModuleInfo[]): string[] {
  const byId = new Map(catalog.map((m) => [m.id, m]));
  const result = new Set<string>();
  const visit = (id: string) => {
    if (result.has(id) || !byId.has(id)) return;
    result.add(id);
    for (const dep of byId.get(id)!.depends) visit(dep);
  };
  for (const m of catalog) if (m.isCore) visit(m.id);
  for (const id of chosen) visit(id);
  return catalog.map((m) => m.id).filter((id) => result.has(id));
}

function quantity(choice: SubscriptionChoice, code: AddonCode): number {
  const q = Math.floor(Number(choice.addons[code] ?? 0));
  return Number.isFinite(q) && q > 0 ? q : 0;
}

export function quote(plan: PlanPricing, choice: SubscriptionChoice, catalog: readonly ModuleInfo[]): Quote {
  const users = Math.max(1, Math.floor(choice.userCount) || 1);
  const modules = withDependencies(choice.modules, catalog);
  const lines: QuoteLine[] = [];

  const base = toCents(plan.baseFee);
  if (base > 0) lines.push({ kind: "base", id: "base", quantity: 1, unitCents: base, totalCents: base });

  const priced = new Map(plan.modules.map((m) => [m.moduleId, m]));
  for (const id of modules) {
    const price = priced.get(id);
    if (!price) continue; // not sold separately (e.g. core with no price row)
    const unit = toCents(price.amount);
    const qty = price.perUser ? users : 1;
    lines.push({ kind: "module", id, quantity: qty, unitCents: unit, totalCents: unit * qty });
  }

  const addonPrices = new Map(plan.addons.map((a) => [a.code, a]));
  for (const code of ADDON_CODES) {
    const qty = quantity(choice, code);
    const price = addonPrices.get(code);
    if (!qty || !price) continue;
    const unit = toCents(price.amount);
    lines.push({ kind: "addon", id: code, quantity: qty, unitCents: unit, totalCents: unit * qty });
  }

  const monthlyCents = lines.reduce((sum, l) => sum + l.totalCents, 0);
  if (choice.period === "monthly") {
    return { currency: plan.currency, period: "monthly", modules, lines, monthlyCents, discountCents: 0, periodCents: monthlyCents };
  }
  const gross = monthlyCents * 12;
  const pct = Math.min(100, Math.max(0, Number(plan.annualDiscountPct) || 0));
  const discountCents = Math.round((gross * pct) / 100);
  return { currency: plan.currency, period: "yearly", modules, lines, monthlyCents, discountCents, periodCents: gross - discountCents };
}

export interface Entitlements {
  seatLimit: number;
  /** null = unlimited */
  storageLimitBytes: number | null;
  aiLimitUsd: number | null;
  customDomain: boolean;
}

export function entitlements(plan: PlanPricing, choice: SubscriptionChoice): Entitlements {
  const users = Math.max(1, Math.floor(choice.userCount) || 1);
  return {
    seatLimit: users + quantity(choice, "extra_users") * ADDON_UNIT.extra_users,
    storageLimitBytes:
      plan.includedStorageGb === null
        ? null
        : Math.round((Number(plan.includedStorageGb) + quantity(choice, "storage_gb") * ADDON_UNIT.storage_gb) * GIB),
    aiLimitUsd:
      plan.includedAiCreditUsd === null
        ? null
        : Number(plan.includedAiCreditUsd) + quantity(choice, "ai_credit") * ADDON_UNIT.ai_credit,
    customDomain: plan.includesCustomDomain || quantity(choice, "custom_domain") > 0,
  };
}

export type ChoiceError =
  | "usersInvalid"
  | "usersAbovePlan"
  | "moduleNotInPlan"
  | "addonNotInPlan"
  | "addonQuantityInvalid"
  | "periodInvalid";

/** Problems that stop saving. `belowActiveUsers` is a warning: existing users stay, new ones are blocked. */
export function validateChoice(
  plan: PlanPricing,
  choice: SubscriptionChoice,
  catalog: readonly ModuleInfo[],
  activeUsers: number | null = null
): { errors: ChoiceError[]; missingModules: string[]; belowActiveUsers: boolean } {
  const errors = new Set<ChoiceError>();
  if (!BILLING_PERIODS.includes(choice.period)) errors.add("periodInvalid");
  if (!Number.isInteger(choice.userCount) || choice.userCount < 1 || choice.userCount > 10_000) errors.add("usersInvalid");
  else if (plan.maxUsers !== null && choice.userCount > plan.maxUsers) errors.add("usersAbovePlan");

  const offered = new Set(plan.modules.map((m) => m.moduleId));
  const coreIds = new Set(catalog.filter((m) => m.isCore).map((m) => m.id));
  const missingModules = withDependencies(choice.modules, catalog).filter((id) => !offered.has(id) && !coreIds.has(id));
  if (missingModules.length) errors.add("moduleNotInPlan");

  const sold = new Set(plan.addons.map((a) => a.code));
  for (const [code, raw] of Object.entries(choice.addons)) {
    const q = Number(raw ?? 0);
    if (!(ADDON_CODES as readonly string[]).includes(code) || !Number.isInteger(q) || q < 0 || q > 10_000) {
      errors.add("addonQuantityInvalid");
      continue;
    }
    if (q > 0 && !sold.has(code as AddonCode)) errors.add("addonNotInPlan");
    if (code === "custom_domain" && q > 1) errors.add("addonQuantityInvalid");
  }

  const seats = entitlements(plan, choice).seatLimit;
  return { errors: [...errors], missingModules, belowActiveUsers: activeUsers !== null && seats < activeUsers };
}

// ── Proration ────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** Days between two ISO dates (YYYY-MM-DD), b − a. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

export function addPeriod(start: string, period: BillingPeriod): string {
  const d = new Date(`${start}T00:00:00Z`);
  const day = d.getUTCDate();
  if (period === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  // 31 Jan + 1 month → 28/29 Feb, not 3 Mar.
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

export interface Proration {
  /** Days in the current period and days still unused at the change date. */
  daysTotal: number;
  daysLeft: number;
  /** Unused part of what was paid for the current period (≥ 0). */
  creditCents: number;
  /** New price for the rest of the period, or a full new period when the period changes. */
  chargeCents: number;
  /** charge − credit; negative = credit carried to the next invoice. */
  dueCents: number;
  /** When the next full charge happens and how much it is. */
  nextChargeDate: string;
  nextChargeCents: number;
}

/**
 * Cost of changing a subscription on `changeDate` (ISO date), billed per day.
 * Same billing period: credit the unused old price, charge the new price for the same
 * remaining days; the renewal date stays. Period changes (monthly ↔ yearly): credit the
 * unused old price and start a full new period on the change date.
 * Without a current period (new subscription, trial) nothing is credited and the first
 * full period is charged.
 */
export function prorate(input: {
  current: { periodCents: number; period: BillingPeriod; periodStart: string | null; periodEnd: string | null } | null;
  next: { periodCents: number; period: BillingPeriod };
  changeDate: string;
}): Proration {
  const { current, next, changeDate } = input;
  const fresh = (credit: number): Proration => ({
    daysTotal: 0,
    daysLeft: 0,
    creditCents: credit,
    chargeCents: next.periodCents,
    dueCents: next.periodCents - credit,
    nextChargeDate: addPeriod(changeDate, next.period),
    nextChargeCents: next.periodCents,
  });
  if (!current || !current.periodStart || !current.periodEnd) return fresh(0);

  const daysTotal = Math.max(1, daysBetween(current.periodStart, current.periodEnd));
  const daysLeft = Math.min(daysTotal, Math.max(0, daysBetween(changeDate, current.periodEnd)));
  const creditCents = Math.round((current.periodCents * daysLeft) / daysTotal);
  if (current.period !== next.period) return { ...fresh(creditCents), daysTotal, daysLeft };

  const chargeCents = Math.round((next.periodCents * daysLeft) / daysTotal);
  return {
    daysTotal,
    daysLeft,
    creditCents,
    chargeCents,
    dueCents: chargeCents - creditCents,
    nextChargeDate: current.periodEnd,
    nextChargeCents: next.periodCents,
  };
}

/** Share of a limit used: "unlimited", "ok", "warning" at 80 %, "blocked" at 100 %. */
export type LimitState = "unlimited" | "ok" | "warning" | "blocked";
export const WARN_AT = 0.8;
export function limitState(used: number, limit: number | null): LimitState {
  if (limit === null) return "unlimited";
  if (limit <= 0 || used >= limit) return "blocked";
  return used >= limit * WARN_AT ? "warning" : "ok";
}
