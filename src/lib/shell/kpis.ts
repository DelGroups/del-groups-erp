/**
 * Live figures on the launcher tiles (prompt 16), one per app. Pure: the rows come from the
 * user's own Supabase session (RLS applies), these functions only add them up. Anything that
 * cannot be read becomes null and the tile shows "—".
 */

export type AppKpiId = "dashboard" | "trade" | "inventory" | "production" | "crm" | "finance" | "hr" | "settings";

export interface AppKpi {
  /** Raw value; the tile formats it. */
  value: number | null;
  /** "money" values are AZN amounts, "count" are whole numbers. */
  kind: "money" | "count";
  /** What the figure is when it is not the app's usual one (e.g. the user's own activities today). */
  label?: "activitiesToday";
}

export type AppKpis = Partial<Record<AppKpiId, AppKpi>>;

/** Documents that do not count (kept for the audit trail). */
const NOT_COUNTED = new Set(["cancelled", "canceled", "void", "voided", "draft", "deleted"]);
const CLOSED_PRODUCTION = new Set(["completed", "done", "finished", "cancelled", "canceled", "closed"]);

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** First day of the month of `today` (ISO date), for "this month" figures. */
export function monthStart(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

export function salesThisMonth(rows: readonly { total_amount?: unknown; status?: unknown }[] | null): { total: number; count: number } | null {
  if (!rows) return null;
  let total = 0;
  let count = 0;
  for (const r of rows) {
    if (NOT_COUNTED.has(String(r.status ?? "").toLowerCase())) continue;
    total += num(r.total_amount);
    count += 1;
  }
  return { total: Math.round(total * 100) / 100, count };
}

/** Physical products at or below their minimum stock (services and products without a minimum are skipped). */
export function lowStockCount(rows: readonly { stock?: unknown; min_stock?: unknown; min_stock_level?: unknown; is_service?: unknown }[] | null): number | null {
  if (!rows) return null;
  return rows.filter((r) => {
    if (r.is_service === true) return false;
    const min = num(r.min_stock ?? r.min_stock_level);
    return min > 0 && num(r.stock) <= min;
  }).length;
}

export function openProductionOrders(rows: readonly { status?: unknown }[] | null): number | null {
  if (!rows) return null;
  return rows.filter((r) => !CLOSED_PRODUCTION.has(String(r.status ?? "").toLowerCase())).length;
}

export interface KpiInputs {
  /** canViewFinancials for this user (prompt 24b). */
  financials: boolean;
  salesRows?: readonly { total_amount?: unknown; status?: unknown }[] | null;
  accountRows?: readonly { balance?: unknown }[] | null;
  productRows?: Parameters<typeof lowStockCount>[0];
  productionRows?: Parameters<typeof openProductionOrders>[0];
  customers?: number | null;
  employees?: number | null;
  users?: number | null;
  /** The user's own open activities due today (shown on the trade tile without financials). */
  activitiesToday?: number | null;
}

/**
 * The tile figures. Without financials no money amount and no sales count is returned, even if
 * rows were passed: the trade tile shows the user's own activities due today instead.
 */
export function composeAppKpis(input: KpiInputs): AppKpis {
  const kpis: AppKpis = {
    inventory: { value: lowStockCount(input.productRows ?? null), kind: "count" },
    production: { value: openProductionOrders(input.productionRows ?? null), kind: "count" },
    crm: { value: input.customers ?? null, kind: "count" },
    hr: { value: input.employees ?? null, kind: "count" },
    settings: { value: input.users ?? null, kind: "count" },
  };
  if (input.financials) {
    const s = salesThisMonth(input.salesRows ?? null);
    kpis.dashboard = { value: s?.total ?? null, kind: "money" };
    kpis.trade = { value: s?.count ?? null, kind: "count" };
    kpis.finance = { value: totalBalance(input.accountRows ?? null), kind: "money" };
  } else {
    kpis.trade = { value: input.activitiesToday ?? null, kind: "count", label: "activitiesToday" };
  }
  return kpis;
}

export function totalBalance(rows: readonly { balance?: unknown }[] | null): number | null {
  if (!rows) return null;
  return Math.round(rows.reduce((s, r) => s + num(r.balance), 0) * 100) / 100;
}
