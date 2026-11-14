/**
 * The app side menu of the unified UI (UI-7, docs/ui-standard.md NAV-1): which pages of an app
 * sit in which labelled group. The pages themselves are the shell's one page list (module menus +
 * SHELL_EXTRA_ITEMS, and the settings list for Settings); this file only groups them, so a page
 * keeps one name and one visibility rule everywhere. Pure, so `node --test` covers it.
 */

import { SETTINGS_GROUPS } from "../settings/items";

export interface MenuGroupDef {
  id: string;
  /** i18n key of the group heading. */
  titleKey: string;
  /** Pages of the group, in no particular order (the menu keeps the app's own order). */
  paths: readonly string[];
}

/**
 * Groups per app id (NAV_SECTIONS ids). Apps not listed show one list without a heading.
 * Settings items carry their group from src/lib/settings/items.ts, so Settings needs only the
 * headings here.
 */
export const APP_MENU_GROUPS: Readonly<Record<string, readonly MenuGroupDef[]>> = {
  trade: [
    { id: "sales", titleKey: "uiUnified.menuGroups.tradeSales", paths: ["/sales", "/contracts", "/consignments"] },
    { id: "purchases", titleKey: "uiUnified.menuGroups.tradePurchases", paths: ["/purchases", "/imports"] },
  ],
  inventory: [
    { id: "products", titleKey: "uiUnified.menuGroups.inventoryProducts", paths: ["/products", "/inventory", "/inventory/lots", "/polywood"] },
    { id: "movements", titleKey: "uiUnified.menuGroups.inventoryMovements", paths: ["/inventory/transfers/new", "/dashboard/warehouse/slips", "/products/damaged-goods"] },
    { id: "counts", titleKey: "uiUnified.menuGroups.inventoryCounts", paths: ["/inventory/counts", "/warehouse/initial-balance"] },
    { id: "setup", titleKey: "uiUnified.menuGroups.inventorySetup", paths: ["/warehouses"] },
  ],
  crm: [
    { id: "pipeline", titleKey: "uiUnified.menuGroups.crmPipeline", paths: ["/crm", "/crm/leads", "/calendar", "/crm/reports", "/crm/config"] },
    { id: "contacts", titleKey: "uiUnified.menuGroups.crmContacts", paths: ["/customers", "/suppliers", "/dashboard/partners"] },
  ],
  finance: [
    { id: "money", titleKey: "uiUnified.menuGroups.financeMoney", paths: ["/cash-bank", "/dashboard/payments", "/expenses"] },
    { id: "accounting", titleKey: "uiUnified.menuGroups.financeAccounting", paths: ["/finance", "/finance/opening-balances", "/finance/guard"] },
  ],
  reports: [
    { id: "general", titleKey: "uiUnified.menuGroups.reportsGeneral", paths: ["/reports", "/imports/reports"] },
    { id: "financial", titleKey: "uiUnified.menuGroups.reportsFinancial", paths: ["/dashboard/reports/financial", "/dashboard/reports/osv", "/dashboard/reports/reconciliation", "/dashboard/reports/partner-statement", "/dashboard/reports/debtors"] },
    { id: "inventory", titleKey: "uiUnified.menuGroups.reportsInventory", paths: ["/dashboard/reports/inventory-turnover"] },
  ],
  settings: SETTINGS_GROUPS.map((g) => ({ id: g.id, titleKey: g.titleKey, paths: [] })),
};

export interface MenuItemLike {
  path: string;
  /** Group id given by the page list itself (Settings); otherwise found by path. */
  group?: string;
}

export interface MenuGroup<I extends MenuItemLike> {
  /** null: the leading list without a heading (an app's hub, an app without groups). */
  id: string | null;
  titleKey: string | null;
  items: I[];
}

/**
 * The app's pages in their groups. Every page appears exactly once, in the app's own order inside
 * a group; pages no group names come first without a heading (an app's hub, or a page added to a
 * module menu before it got a group, so it is never lost). Empty groups are left out.
 */
export function groupAppItems<I extends MenuItemLike>(appId: string, items: readonly I[]): MenuGroup<I>[] {
  const defs = APP_MENU_GROUPS[appId] ?? [];
  const groupOf = (item: I): string | null => {
    if (item.group && defs.some((d) => d.id === item.group)) return item.group;
    return defs.find((d) => d.paths.includes(item.path))?.id ?? null;
  };
  const loose = items.filter((i) => groupOf(i) === null);
  const out: MenuGroup<I>[] = loose.length ? [{ id: null, titleKey: null, items: [...loose] }] : [];
  for (const def of defs) {
    const inGroup = items.filter((i) => groupOf(i) === def.id);
    if (inGroup.length) out.push({ id: def.id, titleKey: def.titleKey, items: inGroup });
  }
  return out;
}

/** Pages where the shell shows no app side menu: the home page and the app launcher. */
const NO_MENU_PATHS = new Set(["/", "/apps"]);

/**
 * Does this page get the app side menu? Apps with one page have none (NAV-1). With SETTINGS_V2
 * the settings pages draw their own side menu (SettingsV2Page) until phase 3 moves them over.
 */
export function showsAppMenu(input: { appId: string | null; itemCount: number; pathname: string; settingsV2: boolean }): boolean {
  if (!input.appId || input.itemCount < 2) return false;
  const path = input.pathname.replace(/\/+$/, "") || "/";
  if (NO_MENU_PATHS.has(path)) return false;
  if (input.appId === "settings" && input.settingsV2) return false;
  return true;
}

/** localStorage key of the collapsed (icon rail) state of the side menu. */
export const APP_MENU_COLLAPSED_KEY = "erp_app_menu_collapsed";

export function parseCollapsed(raw: string | null | undefined): boolean {
  return raw === "1";
}
