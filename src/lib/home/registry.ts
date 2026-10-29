/**
 * Widgets of the home page (prompt 24b): one typed entry per widget. Pure (no React, Next or
 * Supabase), so tests load it directly. Visibility is decided by visibleTo(): the tenant must
 * have the widget's module, the user must hold its permission path, and financial widgets
 * (money amounts, sales/purchase counts) need canViewFinancials. The server enforces the same
 * rule in /api/home/widgets/[id] and the database in the home_* functions.
 */

export type WidgetCategory = "personal" | "operations" | "management";
export type WidgetSize = "S" | "M" | "L";
export type HomeColumn = "start" | "centre" | "end";

export const HOME_COLUMNS: readonly HomeColumn[] = ["start", "centre", "end"];
export const WIDGET_SIZES: readonly WidgetSize[] = ["S", "M", "L"];
export const WIDGET_CATEGORIES: readonly WidgetCategory[] = ["personal", "operations", "management"];

export interface WidgetDef {
  id: string;
  /** i18n key of the title (home.widgets.<id>.title). */
  titleKey: string;
  /** i18n key of the one-line description in the "Add widget" panel. */
  descriptionKey: string;
  category: WidgetCategory;
  sizes: readonly WidgetSize[];
  defaultSize: WidgetSize;
  /** Module the tenant must have (src/modules ids); none = always. */
  module?: string;
  /** Role matrix path the user must hold (e.g. "sales.view"); none = everyone. */
  permission?: string;
  /** Money amounts or sales/purchase counts: dashboard.view_financials only. */
  financial: boolean;
  defaultColumn: HomeColumn;
  /** Position in its default column (ascending). */
  defaultOrder: number;
  /** Always on the page: may be moved and resized, never removed (the apps grid). */
  pinned?: boolean;
  /** Feature that must be on; until then the widget is registered but never shown. */
  requires?: "newCrm";
  /** Loads its data from /api/home/widgets/[id] (false: computed in the browser, e.g. the clock). */
  remote: boolean;
  /** Refresh interval in ms (on focus as well); none = load once. */
  refreshMs?: number;
}

const w = (def: Omit<WidgetDef, "titleKey" | "descriptionKey">): WidgetDef => ({
  ...def,
  titleKey: `home.widgets.${def.id}.title`,
  descriptionKey: `home.widgets.${def.id}.description`,
});

const LIVE = 60_000;

export const WIDGETS: readonly WidgetDef[] = [
  // ── Personal (everyone, filtered by module and permission) ──
  w({ id: "greeting", category: "personal", sizes: ["M", "L"], defaultSize: "M", financial: false, defaultColumn: "start", defaultOrder: 10, remote: false }),
  w({ id: "clock", category: "personal", sizes: ["S", "M"], defaultSize: "S", financial: false, defaultColumn: "start", defaultOrder: 20, remote: false }),
  w({ id: "weather", category: "personal", sizes: ["S", "M"], defaultSize: "S", financial: false, defaultColumn: "start", defaultOrder: 30, remote: true, refreshMs: 30 * 60_000 }),
  w({ id: "calendar", category: "personal", sizes: ["M", "L"], defaultSize: "M", financial: false, defaultColumn: "start", defaultOrder: 40, remote: true, refreshMs: LIVE }),
  w({ id: "my_activities", category: "personal", sizes: ["S", "M"], defaultSize: "M", financial: false, defaultColumn: "start", defaultOrder: 50, remote: true, refreshMs: LIVE }),
  w({ id: "my_todos", category: "personal", sizes: ["M", "L"], defaultSize: "M", module: "todo", financial: false, defaultColumn: "start", defaultOrder: 60, remote: true, refreshMs: LIVE }),
  w({ id: "agenda", category: "personal", sizes: ["M", "L"], defaultSize: "M", module: "calendar", financial: false, defaultColumn: "centre", defaultOrder: 30, remote: true, refreshMs: LIVE }),
  w({ id: "quick_actions", category: "personal", sizes: ["M", "L"], defaultSize: "L", financial: false, defaultColumn: "centre", defaultOrder: 20, remote: false }),
  w({ id: "approvals", category: "personal", sizes: ["M", "L"], defaultSize: "M", module: "expenses", permission: "finance.manage_expenses", financial: false, defaultColumn: "start", defaultOrder: 70, remote: true, refreshMs: LIVE }),
  w({ id: "saved_views", category: "personal", sizes: ["S", "M"], defaultSize: "M", financial: false, defaultColumn: "start", defaultOrder: 80, remote: true }),
  w({ id: "recent_documents", category: "personal", sizes: ["M", "L"], defaultSize: "M", module: "documents", financial: false, defaultColumn: "start", defaultOrder: 90, remote: true, refreshMs: LIVE }),
  // ── Apps (pinned) ──
  w({ id: "apps", category: "personal", sizes: ["L"], defaultSize: "L", financial: false, defaultColumn: "centre", defaultOrder: 10, pinned: true, remote: false }),
  // ── Operations (no money amounts) ──
  w({ id: "low_stock", category: "operations", sizes: ["M", "L"], defaultSize: "M", module: "inventory", permission: "inventory.view", financial: false, defaultColumn: "end", defaultOrder: 10, remote: true, refreshMs: LIVE }),
  w({ id: "production_status", category: "operations", sizes: ["S", "M"], defaultSize: "M", module: "production", permission: "production.view", financial: false, defaultColumn: "end", defaultOrder: 20, remote: true, refreshMs: LIVE }),
  w({ id: "away_today", category: "operations", sizes: ["S", "M"], defaultSize: "M", module: "hr", permission: "hr.view", financial: false, defaultColumn: "end", defaultOrder: 30, remote: true, refreshMs: LIVE }),
  w({ id: "my_pipeline", category: "operations", sizes: ["S", "M"], defaultSize: "M", module: "crm", permission: "crm.view_pipeline", financial: false, defaultColumn: "end", defaultOrder: 40, remote: true, refreshMs: LIVE }),
  // ── Management (financial) ──
  w({ id: "sales_month", category: "management", sizes: ["S", "M"], defaultSize: "M", module: "sales", permission: "sales.view", financial: true, defaultColumn: "end", defaultOrder: 10, remote: true, refreshMs: LIVE }),
  w({ id: "revenue_trend", category: "management", sizes: ["M", "L"], defaultSize: "L", module: "sales", permission: "sales.view", financial: true, defaultColumn: "end", defaultOrder: 20, remote: true, refreshMs: LIVE }),
  w({ id: "net_profit", category: "management", sizes: ["S", "M"], defaultSize: "S", module: "accounting", permission: "finance.view", financial: true, defaultColumn: "end", defaultOrder: 30, remote: true, refreshMs: LIVE }),
  w({ id: "purchases_month", category: "management", sizes: ["S", "M"], defaultSize: "S", module: "purchases", permission: "purchases.view", financial: true, defaultColumn: "end", defaultOrder: 40, remote: true, refreshMs: LIVE }),
  w({ id: "cash_balances", category: "management", sizes: ["M", "L"], defaultSize: "M", module: "accounting", permission: "finance.view", financial: true, defaultColumn: "end", defaultOrder: 50, remote: true, refreshMs: LIVE }),
  w({ id: "receivables", category: "management", sizes: ["M", "L"], defaultSize: "M", module: "sales", permission: "sales.view", financial: true, defaultColumn: "end", defaultOrder: 60, remote: true, refreshMs: LIVE }),
  w({ id: "payables_due", category: "management", sizes: ["M", "L"], defaultSize: "M", module: "purchases", permission: "purchases.view", financial: true, defaultColumn: "end", defaultOrder: 70, remote: true, refreshMs: LIVE }),
  w({ id: "top_customers", category: "management", sizes: ["M", "L"], defaultSize: "M", module: "sales", permission: "sales.view", financial: true, defaultColumn: "end", defaultOrder: 80, remote: true, refreshMs: LIVE }),
  w({ id: "top_products", category: "management", sizes: ["M", "L"], defaultSize: "M", module: "sales", permission: "sales.view", financial: true, defaultColumn: "end", defaultOrder: 90, remote: true, refreshMs: LIVE }),
  w({ id: "sales_by_seller", category: "management", sizes: ["M", "L"], defaultSize: "M", module: "sales", permission: "sales.view", financial: true, defaultColumn: "end", defaultOrder: 100, remote: true, refreshMs: LIVE }),
  w({ id: "expenses_by_category", category: "management", sizes: ["M", "L"], defaultSize: "M", module: "expenses", permission: "finance.view_expenses", financial: true, defaultColumn: "end", defaultOrder: 110, remote: true, refreshMs: LIVE }),
  w({ id: "inventory_value", category: "management", sizes: ["S", "M"], defaultSize: "S", module: "inventory", permission: "inventory.view", financial: true, defaultColumn: "end", defaultOrder: 120, remote: true, refreshMs: LIVE }),
  w({ id: "week_over_week", category: "management", sizes: ["M", "L"], defaultSize: "L", module: "sales", permission: "sales.view", financial: true, defaultColumn: "end", defaultOrder: 130, remote: true, refreshMs: LIVE }),
  w({ id: "ar_discrepancy", category: "management", sizes: ["M", "L"], defaultSize: "M", module: "sales", permission: "sales.view", financial: true, defaultColumn: "end", defaultOrder: 140, remote: true, refreshMs: LIVE }),
  // Targets and pipeline value need the new CRM (prompt 21, NEW_CRM): hidden until it is on.
  w({ id: "sales_target", category: "management", sizes: ["M", "L"], defaultSize: "M", module: "crm", permission: "crm.view_pipeline", financial: true, defaultColumn: "end", defaultOrder: 150, requires: "newCrm", remote: true, refreshMs: LIVE }),
  w({ id: "pipeline_value", category: "management", sizes: ["M", "L"], defaultSize: "M", module: "crm", permission: "crm.view_pipeline", financial: true, defaultColumn: "end", defaultOrder: 160, requires: "newCrm", remote: true, refreshMs: LIVE }),
];

const BY_ID = new Map(WIDGETS.map((d) => [d.id, d] as const));

export function widgetDef(id: string): WidgetDef | undefined {
  return BY_ID.get(id);
}

/** What the user and tenant allow; built from useAuth, useEnabledModules and useNewUi (or the server's equivalents). */
export interface HomeContext {
  isEnabled: (module: string) => boolean;
  /** Role matrix path (admins: always true). */
  can: (path: string) => boolean;
  financials: boolean;
  flags: { newCrm: boolean };
}

/** May this user see (and add) this widget? */
export function visibleTo(def: WidgetDef, ctx: HomeContext): boolean {
  if (def.requires === "newCrm" && !ctx.flags.newCrm) return false;
  if (def.module && !ctx.isEnabled(def.module)) return false;
  if (def.permission && !ctx.can(def.permission)) return false;
  if (def.financial && !ctx.financials) return false;
  return true;
}

/**
 * The API's answer for loading a widget (GET /api/home/widgets/[id]): unknown → 404; a financial
 * widget without dashboard.view_financials → 403 before anything else; otherwise visibleTo().
 */
export function widgetAccess(id: string, ctx: HomeContext): 200 | 403 | 404 {
  const def = widgetDef(id);
  if (!def) return 404;
  if (def.financial && !ctx.financials) return 403;
  return visibleTo(def, ctx) ? 200 : 403;
}

/** Widgets this user may see, grouped by category in registry order. */
export function widgetsFor(ctx: HomeContext): Record<WidgetCategory, WidgetDef[]> {
  const out: Record<WidgetCategory, WidgetDef[]> = { personal: [], operations: [], management: [] };
  for (const def of WIDGETS) if (visibleTo(def, ctx)) out[def.category].push(def);
  return out;
}
