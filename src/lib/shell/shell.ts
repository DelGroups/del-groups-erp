/**
 * Logic of the new app shell (prompt 16), pure so `node --test` covers it:
 *   - whether the new shell is shown (NEW_UI on the server, the admin's own choice, admins only);
 *   - the apps of the launcher, built from the module menus (registry + tenant_modules) and
 *     filtered exactly like the classic sidebar (enabled module, permission, admin);
 *   - which app a page belongs to (top-bar app name and menu tabs);
 *   - the breadcrumb trail that keeps the path when jumping between related records.
 * No React, Next or icon imports: item and section types are generic.
 */

// ── Flag ─────────────────────────────────────────────────────────────────────

/** Cookie with the admin's choice ("1" = new shell). Ignored unless NEW_UI is on. */
export const NEW_UI_COOKIE = "erp_new_ui";
export const NEW_UI_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseNewUiCookie(value: string | null | undefined): boolean {
  return value === "1";
}

/**
 * The new shell is shown when the deployment has NEW_UI on, the user turned it on, and the
 * user is an admin. While sign-in is still loading the choice is trusted (only admins can set
 * the cookie), so admins do not see the classic shell flash first.
 */
export function newShellActive(input: { available: boolean; preferred: boolean; authReady: boolean; isAdmin: boolean }): boolean {
  if (!input.available || !input.preferred) return false;
  return input.authReady ? input.isAdmin : true;
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
] as const;

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
 */
export function nextTrail(trail: readonly TrailEntry[], entry: TrailEntry, fromShell: boolean): TrailEntry[] {
  if (fromShell || trail.length === 0) return [entry];
  const at = trail.findIndex((e) => e.path === entry.path);
  if (at >= 0) return [...trail.slice(0, at), { ...trail[at], label: entry.label || trail[at].label }];
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

/** ⌘ on Apple devices, Ctrl elsewhere (shown in the search hint). */
export function shortcutModifier(platform: string | undefined): "⌘" | "Ctrl" {
  return /mac|iphone|ipad|ipod/i.test(platform ?? "") ? "⌘" : "Ctrl";
}
