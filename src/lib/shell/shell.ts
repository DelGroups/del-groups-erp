/**
 * Logic of the new app shell (prompt 16), pure so `node --test` covers it:
 *   - whether the new shell is shown (NEW_UI on the server, the admin's own choice, admins only);
 *   - the apps of the launcher, built from the module menus (registry + tenant_modules) and
 *     filtered exactly like the classic sidebar (enabled module, permission, admin);
 *   - which app a page belongs to (top-bar app name and menu tabs);
 *   - the breadcrumb trail that keeps the path when jumping between related records.
 * No React, Next or icon imports: item and section types are generic.
 */

import { crumbLabel, isFixedPath } from "../navigation/breadcrumbs";

// ── Flag ─────────────────────────────────────────────────────────────────────

/** Cookie with the user's choice ("1" = new shell, "0" = classic). Ignored unless NEW_UI is on. */
export const NEW_UI_COOKIE = "erp_new_ui";
export const NEW_UI_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Who gets the new shell while NEW_UI is on (server setting NEW_UI_AUDIENCE):
 *   admins  (default) only admins who turn it on, as before;
 *   all     every signed-in user by default; anyone can switch back to the classic shell.
 */
export type NewUiAudience = "admins" | "all";

export function parseNewUiAudience(value: string | null | undefined): NewUiAudience {
  return (value ?? "").trim().toLowerCase() === "all" ? "all" : "admins";
}

/** The user's choice: an explicit "1" / "0", otherwise the audience's default. */
export function parseNewUiCookie(value: string | null | undefined, audience: NewUiAudience = "admins"): boolean {
  if (value === "1") return true;
  if (value === "0") return false;
  return audience === "all";
}

/**
 * The new shell is shown when the deployment has NEW_UI on and the user's choice is the new
 * shell; with the "admins" audience the user must also be an admin, with "all" any signed-in
 * user. While sign-in is still loading the choice is trusted, so nobody sees the classic shell
 * flash first.
 */
export function newShellActive(input: { available: boolean; preferred: boolean; authReady: boolean; isAdmin: boolean; audience?: NewUiAudience; signedIn?: boolean }): boolean {
  if (!input.available || !input.preferred) return false;
  if (!input.authReady) return true;
  return input.audience === "all" ? input.signedIn !== false : input.isAdmin;
}

/** Whether the user may switch between the shells: admins, or every signed-in user with "all". */
export function newShellCanToggle(input: { available: boolean; isAdmin: boolean; audience?: NewUiAudience; signedIn?: boolean }): boolean {
  if (!input.available) return false;
  return input.audience === "all" ? input.signedIn !== false : input.isAdmin;
}

/** Window event the new shell's AI button sends; the AI assistant widget opens on it. */
export const AI_OPEN_EVENT = "erp:ai-open";

// ── Apps ─────────────────────────────────────────────────────────────────────

export interface ShellItem {
  path: string;
  titleKey: string;
  module: string;
}

export interface ShellSection<I extends ShellItem = ShellItem> {
  id: string;
  titleKey: string;
  items: readonly I[];
}

export interface Access {
  isEnabled: (module: string) => boolean;
  isAdmin: boolean;
  /** Permission a menu path needs (null = none). */
  permissionFor: (path: string) => string | null;
  can: (permission: string) => boolean;
}

/**
 * Pages the classic sidebar has no entry for (reached only through other pages or not at
 * all), added to the new shell's apps so every page is reachable from the launcher. Visibility
 * rules are the same as for menu items (module enabled, route permission).
 */
export const SHELL_EXTRA_ITEMS = [
  { section: "inventory", path: "/polywood", titleKey: "newShell.extra_polywood", module: "polywood", icon: "Layers" },
  { section: "hr", path: "/comissions/report", titleKey: "newShell.extra_commissionReport", module: "commissions", icon: "FileBarChart" },
  { section: "crm", path: "/calendar", titleKey: "newShell.extra_calendar", module: "calendar", icon: "CalendarDays" },
  { section: "dashboard", path: "/todo", titleKey: "newShell.extra_todo", module: "todo", icon: "ListTodo" },
  { section: "dashboard", path: "/documents", titleKey: "newShell.extra_documents", module: "documents", icon: "FolderOpen" },
  // New CRM (prompt 21): only while NEW_CRM is on.
  { section: "crm", path: "/crm/leads", titleKey: "newShell.extra_crmLeads", module: "crm", icon: "Inbox", flag: "newCrm" },
  { section: "crm", path: "/crm/reports", titleKey: "newShell.extra_crmReports", module: "crm", icon: "ChartColumn", flag: "newCrm" },
  { section: "crm", path: "/crm/config", titleKey: "newShell.extra_crmConfig", module: "crm", icon: "SlidersHorizontal", flag: "newCrm" },
  // Imports (IMP-1): only while NEW_IMPORTS is on; the route permissions are imports.view and settings.
  { section: "trade", path: "/imports", titleKey: "newShell.extra_imports", module: "imports", icon: "Ship", flag: "newImports" },
  { section: "settings", path: "/settings/imports", titleKey: "newShell.extra_importsSettings", module: "imports", icon: "Ship", flag: "newImports" },
  { section: "reports", path: "/imports/reports", titleKey: "newShell.extra_importsReports", module: "imports", icon: "BarChart3", flag: "newImports" },
  // Partner statement (LED-3): only while PARTNER_LEDGERS is on for this user; the route needs can_view_financial_reports.
  { section: "reports", path: "/dashboard/reports/partner-statement", titleKey: "nav.items.partnerStatement", module: "accounting", icon: "FileCheck2", flag: "partnerLedgers" },
  // Debtors and creditors (LED-4): same flag and permission.
  { section: "reports", path: "/dashboard/reports/debtors", titleKey: "nav.items.debtorReports", module: "accounting", icon: "Scale", flag: "partnerLedgers" },
] as const;

/** The extra items of the features that are on (items without a flag always). */
export function extraItemsFor<E extends object>(extras: readonly E[], flags: { newCrm: boolean; newImports?: boolean; partnerLedgers?: boolean }): E[] {
  return extras.filter((e) => {
    const flag = "flag" in e ? (e as { flag?: string }).flag : undefined;
    return (
      !flag ||
      (flag === "newCrm" && flags.newCrm) ||
      (flag === "newImports" && flags.newImports === true) ||
      (flag === "partnerLedgers" && flags.partnerLedgers === true)
    );
  });
}

/** Sections with the extra items appended to their section (sections that do not exist are skipped). */
export function withExtraItems<I extends ShellItem, S extends ShellSection<I>>(
  sections: readonly S[],
  extras: readonly { section: string; path: string; titleKey: string; module: string }[],
  toItem: (extra: { section: string; path: string; titleKey: string; module: string }) => I
): S[] {
  return sections.map((section) => {
    const add = extras.filter((e) => e.section === section.id && !section.items.some((i) => i.path === e.path)).map(toItem);
    return add.length ? { ...section, items: [...section.items, ...add] } : section;
  });
}

/** Sections with the items this user may open: the classic sidebar's rule, unchanged. */
export function visibleSections<I extends ShellItem, S extends ShellSection<I>>(sections: readonly S[], access: Access): (S & { items: I[] })[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (!access.isEnabled(item.module)) return false;
        if (access.isAdmin) return true;
        const permission = access.permissionFor(item.path);
        return !permission || access.can(permission);
      }),
    }))
    .filter((section) => section.items.length > 0);
}

/**
 * Puts one app's items in place of what the module menus gave it (SET-1: the Settings app comes
 * from the one settings list, src/lib/settings/items.ts). The app keeps its place in `order`
 * (section ids of every app, in menu order); with no items it is left out.
 */
export function replaceSectionItems<I extends ShellItem, S extends ShellSection<I>>(
  sections: readonly (S & { items: I[] })[],
  order: readonly string[],
  section: S,
  items: I[]
): (S & { items: I[] })[] {
  const rest = sections.filter((s) => s.id !== section.id);
  if (!items.length) return rest;
  const rank = (id: string) => {
    const at = order.indexOf(id);
    return at < 0 ? order.length : at;
  };
  const at = rest.findIndex((s) => rank(s.id) > rank(section.id));
  const next = { ...section, items };
  return at < 0 ? [...rest, next] : [...rest.slice(0, at), next, ...rest.slice(at)];
}

/**
 * The app tab bar (SET-1 fix): whether there is more to scroll on either side. Its scrollbar is
 * hidden; arrow buttons and edge fades show only on the side that hides tabs.
 */
export function tabScrollEdges(scrollLeft: number, clientWidth: number, scrollWidth: number): { start: boolean; end: boolean } {
  const max = Math.max(0, scrollWidth - clientWidth);
  const left = Math.abs(scrollLeft); // negative in RTL
  return { start: left > 1, end: max - left > 1 };
}

/** scrollLeft that brings a tab fully into view with `pad` px of room; unchanged when already visible. */
export function scrollLeftToReveal(tabLeft: number, tabWidth: number, scrollLeft: number, clientWidth: number, pad = 32): number {
  if (tabLeft - pad < scrollLeft) return Math.max(0, tabLeft - pad);
  if (tabLeft + tabWidth + pad > scrollLeft + clientWidth) return tabLeft + tabWidth + pad - clientWidth;
  return scrollLeft;
}

/** Is `path` (a menu item) the page at `pathname`? Longest-prefix logic lives in bestItem(). */
function covers(path: string, pathname: string): boolean {
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** The menu item a page belongs to: the most specific item covering the path, across all apps. */
export function bestItem<I extends ShellItem, S extends ShellSection<I>>(sections: readonly S[], pathname: string): { section: S; item: I } | null {
  let best: { section: S; item: I } | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      if (covers(item.path, pathname) && (!best || item.path.length > best.item.path.length)) best = { section, item };
    }
  }
  return best;
}

/** The app (section) of a page, or null (e.g. a page only reached through a link). */
export function appForPath<I extends ShellItem, S extends ShellSection<I>>(sections: readonly S[], pathname: string): S | null {
  return bestItem<I, S>(sections, pathname)?.section ?? null;
}

/** The home menu: the app launcher. "/" shows it too while the new shell is on. */
export const SHELL_HOME = "/apps";
const HOME_PATHS = new Set(["/", SHELL_HOME]);

/**
 * The back-to-home button of the top bar (module icon, turning into a back arrow): shown inside
 * every module (sub-pages and sub-tabs included), never on the home menu itself, and only when
 * the page belongs to an app.
 */
export function shellBackButton(pathname: string, appId: string | null): { show: boolean; href: string } {
  const path = pathname.replace(/\/+$/, "") || "/";
  return { show: !!appId && !HOME_PATHS.has(path), href: SHELL_HOME };
}

/** Launcher filter: app title or any of its items (labels already translated), every word. */
export function filterApps<A extends { title: string; itemTitles: readonly string[] }>(apps: readonly A[], query: string): A[] {
  const norm = (s: string) => s.replace(/İ/g, "i").replace(/ı/g, "i").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ə/g, "e");
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...apps];
  return apps.filter((a) => {
    const hay = norm([a.title, ...a.itemTitles].join(" "));
    return words.every((w) => hay.includes(w));
  });
}

// ── Breadcrumb trail ─────────────────────────────────────────────────────────

export interface TrailEntry {
  path: string;
  label: string;
}

export const TRAIL_MAX = 8;
export const TRAIL_STORAGE_KEY = "erp_shell_trail";

/**
 * Where a navigation came from: the shell's own navigation (launcher, app tabs, palette,
 * drawer) starts a new trail; any other link (a related record inside a page) extends it;
 * returning to a page already in the trail (Back, or its crumb) cuts the trail there.
 * A page with a fixed address (a list, a "new" form) also starts a new trail: its path crumbs
 * already say where it is, and a typed URL or a reload must not chain unrelated pages (UI-5).
 */
export function nextTrail(trail: readonly TrailEntry[], entry: TrailEntry, fromShell: boolean): TrailEntry[] {
  if (fromShell || trail.length === 0) return [entry];
  const at = trail.findIndex((e) => e.path === entry.path);
  if (at >= 0) return [...trail.slice(0, at), { ...trail[at], label: entry.label || trail[at].label }];
  if (isFixedPath(entry.path)) return [entry];
  return [...trail, entry].slice(-TRAIL_MAX);
}

export function parseTrail(raw: string | null): TrailEntry[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter((e): e is TrailEntry => !!e && typeof e === "object" && typeof (e as TrailEntry).path === "string" && (e as TrailEntry).path.startsWith("/") && typeof (e as TrailEntry).label === "string")
      .slice(-TRAIL_MAX);
  } catch {
    return [];
  }
}

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Crumbs shown in the header: the path-based crumbs of the first page of the trail (its place
 * in the app), then every later page of the trail. The current page is last, without a link.
 */
export function trailCrumbs(trail: readonly TrailEntry[], baseCrumbs: readonly Crumb[]): Crumb[] {
  if (!trail.length) return [...baseCrumbs];
  const [first, ...rest] = trail;
  const head: Crumb[] = baseCrumbs.length ? baseCrumbs.map((c) => ({ ...c })) : [{ label: first.label }];
  if (!rest.length) return head.map((c, i) => (i === head.length - 1 ? { label: c.label } : c));
  head[head.length - 1] = { label: head[head.length - 1].label, href: first.path };
  return [...head, ...rest.map((e, i) => (i === rest.length - 1 ? { label: e.label } : { label: e.label, href: e.path }))];
}

/** More than `max` crumbs: keep the first and the last `max - 2`, the middle goes behind "…". */
export function collapseCrumbs(crumbs: readonly Crumb[], max = 4): { visible: Crumb[]; hidden: Crumb[]; collapsedAt: number | null } {
  if (crumbs.length <= max) return { visible: [...crumbs], hidden: [], collapsedAt: null };
  const tail = crumbs.slice(crumbs.length - (max - 2));
  return { visible: [crumbs[0], ...tail], hidden: crumbs.slice(1, crumbs.length - (max - 2)), collapsedAt: 1 };
}

// ── Unified UI (UI-7): App › Page › Record and the back button ───────────────

/**
 * Crumbs of a page in the unified UI (docs/ui-standard.md NAV-2): the app first (linking to its
 * first page), then the menu page the path belongs to, then every deeper segment (a "new" form, a
 * record) with its route-map label. The last crumb is the current page, without a link. Home, the
 * launcher and a page no menu lists have no crumbs.
 */
export function appCrumbs(input: {
  app: { title: string; href: string } | null;
  item: { path: string; title: string } | null;
  pathname: string;
  t: (key: string, params?: Record<string, string | number>) => string;
}): Crumb[] {
  const { app, item, t } = input;
  const path = input.pathname.replace(/\/+$/, "") || "/";
  // Home and the launcher have no crumbs (NAV-2; live check, UI-7).
  if (!app || !item || HOME_PATHS.has(path)) return [];
  const crumbs: Crumb[] = [
    { label: app.title, href: app.href },
    { label: item.title, href: item.path },
  ];
  const rest = path === item.path ? [] : path.slice(item.path === "/" ? 1 : item.path.length + 1).split("/").filter(Boolean);
  let acc = item.path === "/" ? "" : item.path;
  for (const segment of rest) {
    acc += `/${segment}`;
    crumbs.push({ label: crumbLabel(acc, segment, t), href: acc });
  }
  return crumbs.map((c, i) => (i === crumbs.length - 1 ? { label: c.label } : c));
}

/**
 * Where the shell back button goes in the unified UI (NAV-4): the nearest crumb above the current
 * page that is another page; on an app's first page (its only parent is the page itself) the
 * launcher. Never the browser history.
 */
export function parentCrumbHref(crumbs: readonly Crumb[], pathname: string): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  for (let i = crumbs.length - 2; i >= 0; i--) {
    const href = crumbs[i].href;
    if (href && href !== path) return href;
  }
  return SHELL_HOME;
}

/** ⌘ on Apple devices, Ctrl elsewhere (shown in the search hint). */
export function shortcutModifier(platform: string | undefined): "⌘" | "Ctrl" {
  return /mac|iphone|ipad|ipod/i.test(platform ?? "") ? "⌘" : "Ctrl";
}
