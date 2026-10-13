import { ADDON_CODES, type AddonCode } from "@/lib/billing/pricing";
import type { PlanRow } from "@/lib/billing/catalog";
import type { PlanEditorValues } from "./PlanEditor";

const text = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : String(Number(v)));

/** Editor values for an existing plan, or the defaults of a new one. */
export function planEditorValues(row: PlanRow | null, moduleIds: readonly string[]): PlanEditorValues {
  const monthly = (row?.plan_prices ?? []).filter((p) => p.billing_period === "monthly");
  const base = monthly.find((p) => p.module_id === null);
  const currency = base?.currency ?? "AZN";
  const modules: PlanEditorValues["modules"] = {};
  for (const id of moduleIds) {
    const price = monthly.find((p) => p.module_id === id && p.currency === currency);
    modules[id] = { offered: Boolean(price), price: price ? text(price.amount) : "", perUser: price ? price.per_user : true };
  }
  const addons = Object.fromEntries(
    ADDON_CODES.map((code) => [code, text((row?.plan_addon_prices ?? []).find((a) => a.addon_code === code && a.currency === currency)?.amount)])
  ) as Record<AddonCode, string>;
  return {
    code: row?.code ?? "",
    name: row?.name ?? "",
    description: row?.description ?? "",
    annual_discount_pct: row ? text(row.annual_discount_pct) : "17",
    is_active: row?.is_active ?? true,
    sort_order: String(row?.sort_order ?? 0),
    max_users: row?.max_users ? String(row.max_users) : "",
    included_storage_gb: text(row?.included_storage_gb),
    included_ai_credit_usd: text(row?.included_ai_credit_usd),
    includes_custom_domain: row?.includes_custom_domain ?? false,
    currency,
    base_fee: base ? text(base.amount) : "",
    modules,
    addons,
  };
}
