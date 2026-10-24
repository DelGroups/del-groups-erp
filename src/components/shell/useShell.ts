"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { CalendarDays, FileBarChart, FolderOpen, Layers, ListTodo, type LucideIcon } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useEnabledModules } from "@/hooks/useEnabledModules";
import { useI18n } from "@/i18n/I18nProvider";
import { getNavItemPermission, getRequiredPermission } from "@/lib/auth/routePermissions";
import { NAV_SECTIONS, type NavItem, type NavSection } from "@/lib/navigation/navConfig";
import { buildBreadcrumbsFromPath } from "@/lib/navigation/breadcrumbs";
import {
  appForPath,
  bestItem,
  nextTrail,
  parseTrail,
  trailCrumbs,
  SHELL_EXTRA_ITEMS,
  TRAIL_STORAGE_KEY,
  visibleSections,
  withExtraItems,
  type Crumb,
  type TrailEntry,
} from "@/lib/shell/shell";

const EXTRA_ICONS: Record<string, LucideIcon> = { "/polywood": Layers, "/comissions/report": FileBarChart, "/calendar": CalendarDays, "/todo": ListTodo, "/documents": FolderOpen };

export interface ShellApp {
  id: string;
  title: string;
  icon: LucideIcon;
  /** Where the tile opens: the app's first menu item. */
  href: string;
  items: { path: string; title: string; icon: LucideIcon }[];
}

/** The apps this user may open (same rule as the classic sidebar) and the app of the current page. */
export function useShellApps(): { apps: ShellApp[]; current: ShellApp | null; currentItemPath: string | null } {
  const { t } = useI18n();
  const { can, isAdmin } = useAuth();
  const { isEnabled } = useEnabledModules();
  const pathname = usePathname();

  const sections = useMemo(
    () =>
      visibleSections<NavItem, NavSection>(
        withExtraItems<NavItem, NavSection>(NAV_SECTIONS, SHELL_EXTRA_ITEMS, (e) => ({
          path: e.path,
          titleKey: e.titleKey,
          module: e.module as NavItem["module"],
          icon: EXTRA_ICONS[e.path] ?? Layers,
        })),
        {
        isEnabled: (m) => isEnabled(m as Parameters<typeof isEnabled>[0]),
        isAdmin,
        // Menu items: their menu permission; extra pages: the page's route permission.
          permissionFor: (path) => getNavItemPermission(path) ?? getRequiredPermission(path),
          can: (p) => can(p as Parameters<typeof can>[0]),
        }
      ),
    [can, isAdmin, isEnabled]
  );

  const apps = useMemo<ShellApp[]>(
    () =>
      sections.map((s) => ({
        id: s.id,
        title: t(s.titleKey),
        icon: s.icon,
        href: s.items[0].path,
        items: s.items.map((i) => ({ path: i.path, title: t(i.titleKey), icon: i.icon })),
      })),
    [sections, t]
  );

  const currentSection = appForPath<NavItem, NavSection>(sections, pathname);
  const current = currentSection ? (apps.find((a) => a.id === currentSection.id) ?? null) : null;
  const currentItemPath = bestItem<NavItem, NavSection>(sections, pathname)?.item.path ?? null;
  return { apps, current, currentItemPath };
}

// ── Breadcrumb trail ─────────────────────────────────────────────────────────

let shellNavigationPending = false;

/** Call before navigating from the shell's own navigation: the next page starts a new trail. */
export function markShellNavigation(): void {
  shellNavigationPending = true;
}

function readTrail(): TrailEntry[] {
  try {
    return parseTrail(sessionStorage.getItem(TRAIL_STORAGE_KEY));
  } catch {
    return [];
  }
}

// The trail as a small external store: the server (and hydration) see an empty trail, the
// browser the stored one once the page has mounted.
const EMPTY: TrailEntry[] = [];
let trailSnapshot: TrailEntry[] = EMPTY;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
function publish(next: TrailEntry[]) {
  trailSnapshot = next;
  for (const fn of listeners) fn();
}

// Names of record pages ("/crm/<id>" → the deal's title), set by the page once it has loaded
// the record, so crumbs show the name instead of an id.
const recordLabels = new Map<string, string>();

/** A record page names its crumb (view engine forms, prompt 17). */
export function useRecordCrumb(label: string | null | undefined): void {
  const pathname = usePathname();
  useEffect(() => {
    if (!label) return;
    recordLabels.set(pathname, label);
    const trail = readTrail();
    const next = trail.map((e) => (e.path === pathname ? { ...e, label } : e));
    try {
      sessionStorage.setItem(TRAIL_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable: the trail lives only in memory
    }
    publish(trail.length ? next : [...trailSnapshot]);
  }, [label, pathname]);
}

function withRecordLabel(crumbs: Crumb[], path: string): Crumb[] {
  const label = recordLabels.get(path);
  if (!label || !crumbs.length) return crumbs;
  return [...crumbs.slice(0, -1), { ...crumbs[crumbs.length - 1], label }];
}

/**
 * Crumbs of the current page that keep the path between related records: opening invoice B
 * from customer A shows "Customers › A › B"; going back to A cuts the trail at A; anything
 * opened from the launcher, app tabs, palette or drawer starts fresh.
 */
export function useBreadcrumbTrail(): Crumb[] {
  const pathname = usePathname();
  const { t } = useI18n();
  const trail = useSyncExternalStore(subscribe, () => trailSnapshot, () => EMPTY);

  useEffect(() => {
    const base = buildBreadcrumbsFromPath(pathname, t);
    const label = recordLabels.get(pathname) ?? base.at(-1)?.label ?? document.title ?? pathname;
    const next = nextTrail(readTrail(), { path: pathname, label }, shellNavigationPending);
    shellNavigationPending = false;
    try {
      sessionStorage.setItem(TRAIL_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable: the trail lives only in memory
    }
    publish(next);
  }, [pathname, t]);

  return useMemo(() => {
    if (!trail.length || trail.at(-1)?.path !== pathname) return withRecordLabel(buildBreadcrumbsFromPath(pathname, t), pathname);
    return trailCrumbs(trail, withRecordLabel(buildBreadcrumbsFromPath(trail[0].path, t), trail[0].path));
  }, [trail, pathname, t]);
}
