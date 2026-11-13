/**
 * The one list of Settings pages (SET-1). The shell's Settings app (tab bar, launcher, command
 * palette), the classic SettingsTabs, the breadcrumbs, and the SETTINGS_V2 hub and side menu all
 * read it, so every place shows the same pages, in the same order, under the same name, and
 * filters them by the same rules. Pure (no React, Next or icon imports) so `node --test` covers it.
 */

export type SettingsGroupId = "company" | "access" | "trade" | "inventory" | "system";

export interface SettingsGroup {
  id: SettingsGroupId;
  titleKey: string;
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: "company", titleKey: "settingsNav.groups.company" },
  { id: "access", titleKey: "settingsNav.groups.access" },
  { id: "trade", titleKey: "settingsNav.groups.trade" },
  { id: "inventory", titleKey: "settingsNav.groups.inventory" },
  { id: "system", titleKey: "settingsNav.groups.system" },
];

/** Feature switches an item depends on, besides its module. */
export type SettingsItemFlag = "barcode" | "billing" | "newImports" | "docDateChange";

export interface SettingsItem {
  id: string;
  /** Address of the page (the company profile moves to COMPANY_V2_PATH with SETTINGS_V2). */
  path: string;
  /** Name everywhere: shell tab, SettingsTabs, breadcrumb, palette, hub card, side menu, page title. */
  titleKey: string;
  /** One line under the title (hub card, page header). */
  descriptionKey: string;
  /** lucide icon name; the React side maps it (src/components/settings/settingsIcons.ts). */
  icon: string;
  group: SettingsGroupId;
  permission: string;
  /** Hidden when the tenant does not have this module. */
  module?: string;
  adminOnly?: boolean;
  /** Shown only while the new shell (NEW_UI) is on for this user. */
  newUiOnly?: boolean;
  flag?: SettingsItemFlag;
}

/** The hub (SETTINGS_V2) and, without it, the company profile. */
export const SETTINGS_HOME = "/settings";
/** The company profile's own address while SETTINGS_V2 is on (the hub takes /settings). */
export const COMPANY_V2_PATH = "/settings/company";
/** Title of the hub and first crumb of every settings page ("Tənzimləmələr"). */
export const SETTINGS_HOME_TITLE_KEY = "nav.sections.settings";

const t = (id: string) => ({ titleKey: `settingsNav.${id}.title`, descriptionKey: `settingsNav.${id}.description` });

export const SETTINGS_ITEMS: readonly SettingsItem[] = [
  // Company
  { id: "company", path: SETTINGS_HOME, ...t("company"), icon: "Building2", group: "company", permission: "can_view_settings" },
  { id: "initial-setup", path: "/settings/initial-setup", ...t("initialSetup"), icon: "Landmark", group: "company", permission: "can_manage_settings" },
  { id: "tax-payroll", path: "/settings/tax-payroll", ...t("taxPayroll"), icon: "Scale", group: "company", permission: "can_manage_settings", module: "tax-az" },
  // Users and access
  { id: "users", path: "/users", ...t("users"), icon: "Users", group: "access", permission: "can_manage_users" },
  { id: "roles", path: "/settings/roles", ...t("roles"), icon: "ShieldCheck", group: "access", permission: "can_manage_roles" },
  { id: "audit", path: "/settings/audit", ...t("audit"), icon: "ScrollText", group: "access", permission: "can_manage_settings" },
  // DATE-1 (DOC_DATE_CHANGE): who changed the date of which posted invoice, and why.
  { id: "date-changes", path: "/settings/date-changes", ...t("dateChanges"), icon: "CalendarClock", group: "access", permission: "can_manage_settings", adminOnly: true, flag: "docDateChange" },
  // Sales and purchasing
  { id: "commissions", path: "/settings/commissions", ...t("commissions"), icon: "Percent", group: "trade", permission: "can_manage_commissions", module: "commissions" },
  { id: "procurement", path: "/settings/procurement", ...t("procurement"), icon: "ShoppingBag", group: "trade", permission: "can_manage_settings", module: "purchases" },
  { id: "imports", path: "/settings/imports", ...t("imports"), icon: "Ship", group: "trade", permission: "can_manage_settings", module: "imports", newUiOnly: true, flag: "newImports" },
  { id: "crm", path: "/settings/crm", ...t("crm"), icon: "KanbanSquare", group: "trade", permission: "can_manage_settings", module: "crm" },
  { id: "activity-types", path: "/settings/activity-types", ...t("activityTypes"), icon: "CalendarClock", group: "trade", permission: "can_manage_settings", adminOnly: true, newUiOnly: true },
  // Inventory
  { id: "barcode", path: "/settings/barcode", ...t("barcode"), icon: "Barcode", group: "inventory", permission: "can_manage_settings", module: "barcode", flag: "barcode" },
  { id: "stock-integrity", path: "/settings/stock-integrity", ...t("stockIntegrity"), icon: "ClipboardCheck", group: "inventory", permission: "can_manage_settings", module: "inventory", adminOnly: true },
  // System
  { id: "modules", path: "/settings/modules", ...t("modules"), icon: "Boxes", group: "system", permission: "can_manage_settings", adminOnly: true },
  { id: "studio", path: "/settings/studio", ...t("studio"), icon: "Blocks", group: "system", permission: "can_manage_settings", module: "studio" },
  { id: "ai", path: "/settings/ai", ...t("ai"), icon: "Sparkles", group: "system", permission: "can_manage_settings", module: "ai" },
  { id: "backup", path: "/settings/backup", ...t("backup"), icon: "Database", group: "system", permission: "can_manage_settings" },
  { id: "billing", path: "/settings/billing", ...t("billing"), icon: "CreditCard", group: "system", permission: "can_manage_settings", adminOnly: true, flag: "billing" },
];

export interface SettingsAccess {
  can: (permission: string) => boolean;
  isAdmin: boolean;
  /** Module check; `undefined` (no module) is always enabled. */
  isEnabled: (module: string | undefined) => boolean;
  /** The new shell is on for this user. */
  newUi: boolean;
  flags: Readonly<Record<SettingsItemFlag, boolean>>;
  /** SETTINGS_V2 is on for this user (new shell + server flag): the company profile moves. */
  v2?: boolean;
}

/** Whether this user may see an item: permission, admin, new shell, module and feature flag. */
export function settingsItemVisible(item: SettingsItem, access: SettingsAccess): boolean {
  return (
    access.can(item.permission) &&
    (!item.adminOnly || access.isAdmin) &&
    (!item.newUiOnly || access.newUi) &&
    access.isEnabled(item.module) &&
    (!item.flag || access.flags[item.flag] === true)
  );
}

/** The item with its address for this user (the company profile moves with SETTINGS_V2). */
export function resolveSettingsItem(item: SettingsItem, v2: boolean | undefined): SettingsItem {
  return v2 && item.id === "company" ? { ...item, path: COMPANY_V2_PATH } : item;
}

/** The items this user may open, in menu order, with their addresses resolved. */
export function visibleSettingsItems(access: SettingsAccess, items: readonly SettingsItem[] = SETTINGS_ITEMS): SettingsItem[] {
  return items.filter((item) => settingsItemVisible(item, access)).map((item) => resolveSettingsItem(item, access.v2));
}

/** Items by group, in group order; empty groups are left out. */
export function groupSettingsItems<I extends Pick<SettingsItem, "group">>(items: readonly I[]): { group: SettingsGroup; items: I[] }[] {
  return SETTINGS_GROUPS.map((group) => ({ group, items: items.filter((i) => i.group === group.id) })).filter((g) => g.items.length > 0);
}

/** The settings item a page belongs to (most specific path), or null (the hub, or an unknown page). */
export function settingsItemForPath<I extends Pick<SettingsItem, "path">>(items: readonly I[], pathname: string): I | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  let best: I | null = null;
  for (const item of items) {
    const hit = item.path === SETTINGS_HOME ? path === SETTINGS_HOME : path === item.path || path.startsWith(`${item.path}/`);
    if (hit && (!best || item.path.length > best.path.length)) best = item;
  }
  return best;
}

/** Folds Azerbaijani and Russian text for search: case, accents, ə/ı/İ. */
export function foldSearch(s: string): string {
  return s
    .replace(/İ/g, "i")
    .replace(/ı/g, "i")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ə/g, "e")
    .replace(/ё/g, "е");
}

/** Hub search: every word must appear in the title, description or group name (translated). */
export function filterSettingsItems<I extends { title: string; description: string; groupTitle: string }>(items: readonly I[], query: string): I[] {
  const words = foldSearch(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...items];
  return items.filter((item) => {
    const hay = foldSearch(`${item.title} ${item.description} ${item.groupTitle}`);
    return words.every((w) => hay.includes(w));
  });
}

/** Path → crumb label key for every settings page (lib/navigation/breadcrumbs.ts). */
export function settingsCrumbKeys(): Record<string, string> {
  const out: Record<string, string> = { [SETTINGS_HOME]: SETTINGS_HOME_TITLE_KEY };
  for (const item of SETTINGS_ITEMS) {
    if (item.path !== SETTINGS_HOME) out[item.path] = item.titleKey;
  }
  out[COMPANY_V2_PATH] = SETTINGS_ITEMS[0].titleKey;
  return out;
}
