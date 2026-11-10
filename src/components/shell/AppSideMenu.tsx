"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tooltip from "@radix-ui/react-tooltip";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { useDesignScope } from "@/design-system/components";
import { motionPreset, overlayVariants, transitions } from "@/design-system/motion";
import { useI18n } from "@/i18n/I18nProvider";
import { tabScrollEdges } from "@/lib/shell/shell";
import { APP_MENU_COLLAPSED_KEY, groupAppItems, parseCollapsed, type MenuGroup } from "@/lib/shell/appMenu";
import { markShellNavigation, type ShellApp } from "./useShell";

type Item = ShellApp["items"][number];

// The collapsed (icon rail) choice, remembered per browser. A tiny external store, so the server
// and hydration render the open menu and the browser switches once it has read the choice.
const listeners = new Set<() => void>();
let memory: boolean | null = null;
function readCollapsed(): boolean {
  try {
    return parseCollapsed(localStorage.getItem(APP_MENU_COLLAPSED_KEY));
  } catch {
    return false;
  }
}
function writeCollapsed(on: boolean) {
  try {
    localStorage.setItem(APP_MENU_COLLAPSED_KEY, on ? "1" : "0");
  } catch {
    // storage unavailable: the choice lasts until the page reloads
  }
  memory = on;
  for (const fn of listeners) fn();
}
function useCollapsed(): [boolean, (on: boolean) => void] {
  const value = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => memory ?? readCollapsed(),
    () => false
  );
  return [value, writeCollapsed];
}

function MenuLinks({ groups, currentPath, rail, onNavigate, idPrefix }: { groups: MenuGroup<Item>[]; currentPath: string | null; rail?: boolean; onNavigate?: () => void; idPrefix: string }) {
  const { t } = useI18n();
  const { portalContainer } = useDesignScope();
  const go = () => {
    markShellNavigation();
    onNavigate?.();
  };
  const link = (item: Item) => {
    const active = item.path === currentPath;
    const el = (
      <Link href={item.path} onClick={go} className="ds-side-link" aria-current={active ? "page" : undefined} aria-label={rail ? item.title : undefined} title={rail ? undefined : item.title}>
        <item.icon className="h-4 w-4 shrink-0" aria-hidden />
        {rail ? null : <span className="truncate">{item.title}</span>}
      </Link>
    );
    if (!rail) return el;
    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{el}</Tooltip.Trigger>
        <Tooltip.Portal container={portalContainer ?? undefined}>
          <Tooltip.Content side="right" sideOffset={8} className="ds-tooltip">
            {item.title}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    );
  };
  return (
    <>
      {groups.map((group, gi) => {
        const headingId = group.id ? `${idPrefix}-${group.id}` : undefined;
        return (
          <div key={group.id ?? `loose-${gi}`} className="ds-side-group" role={group.titleKey ? "group" : undefined} aria-labelledby={group.titleKey && !rail ? headingId : undefined} aria-label={group.titleKey && rail ? t(group.titleKey) : undefined}>
            {group.titleKey && !rail ? (
              <p id={headingId} className="ds-side-group-title">
                {t(group.titleKey)}
              </p>
            ) : null}
            {rail && gi > 0 ? <span className="ds-side-rail-sep" aria-hidden /> : null}
            <ul>
              {group.items.map((item) => (
                <li key={item.path}>{link(item)}</li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}

/**
 * The app side menu of the unified UI (UI-7, docs/ui-standard.md NAV-1): the app's pages in
 * labelled groups, the current page highlighted. Desktop (≥ 1024 px): sticky inside the page
 * scroller, 15 rem, collapsible to an icon rail with tooltips (remembered). Below 1024 px: a
 * button at the top of the page that opens the same menu as a bottom sheet. Ideas from
 * nav/nav-collapsible-sidebar-nav and nav/nav-mobile-drawer-menu, rebuilt with our tokens.
 */
export function AppSideMenu({ app, currentPath }: { app: ShellApp; currentPath: string | null }) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useCollapsed();
  const groups = groupAppItems(app.id, app.items);
  const label = t("newShell.appMenu", { app: app.title });
  const navRef = useRef<HTMLElement | null>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  // Live check (UI-7): a long menu on a short window scrolls inside itself with a hidden
  // scrollbar; fades show on the side that hides links (NAV-1). The header with the collapse
  // button stays put, so it never scrolls out of reach.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const update = () => {
      const next = tabScrollEdges(nav.scrollTop, nav.clientHeight, nav.scrollHeight);
      setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
    };
    // First measure after paint (and on every scroll or resize).
    const frame = requestAnimationFrame(update);
    nav.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    return () => {
      cancelAnimationFrame(frame);
      nav.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [collapsed, groups.length]);
  return (
    <aside className="ds-side-aside" data-collapsed={collapsed ? "" : undefined}>
      <div className="ds-side-head">
        {collapsed ? null : <p className="ds-side-app">{app.title}</p>}
        <button
          type="button"
          className="ds-icon-btn ds-side-toggle"
          aria-label={collapsed ? t("uiUnified.menu.expand") : t("uiUnified.menu.collapse")}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}
        </button>
      </div>
      <Tooltip.Provider delayDuration={200}>
        <nav ref={navRef} aria-label={label} className="ds-side-nav" data-fade-start={edges.start ? "" : undefined} data-fade-end={edges.end ? "" : undefined}>
          <MenuLinks groups={groups} currentPath={currentPath} rail={collapsed} idPrefix={`side-${app.id}`} />
        </nav>
      </Tooltip.Provider>
    </aside>
  );
}

/** Phone and tablet (< 1024 px): the current page and its app, opening the menu as a bottom sheet. */
export function AppMenuSheet({ app, currentPath }: { app: ShellApp; currentPath: string | null }) {
  const { t } = useI18n();
  const { portalContainer } = useDesignScope();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const groups = groupAppItems(app.id, app.items);
  const active = app.items.find((i) => i.path === currentPath) ?? null;
  const Icon = active?.icon ?? app.icon;
  const label = t("newShell.appMenu", { app: app.title });
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="ds-side-sheet-trigger" aria-label={t("uiUnified.menu.open", { app: app.title })}>
        <span className="ds-side-sheet-icon" aria-hidden>
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 text-start">
          <span className="block truncate text-[length:var(--ds-text-xs)] ds-muted">{app.title}</span>
          <span className="block truncate font-semibold">{active?.title ?? app.title}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 ds-muted" aria-hidden />
      </Dialog.Trigger>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount container={portalContainer ?? undefined}>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="ds-overlay" variants={motionPreset(overlayVariants, reduced)} initial="initial" animate="enter" exit="exit" />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="ds-sheet"
                initial={reduced ? { opacity: 0 } : { y: "100%" }}
                animate={reduced ? { opacity: 1 } : { y: 0 }}
                exit={reduced ? { opacity: 0 } : { y: "100%" }}
                transition={reduced ? transitions.instant : transitions.base}
              >
                <div className="ds-dialog-header">
                  <Dialog.Title className="ds-dialog-title min-w-0 flex-1 truncate">{app.title}</Dialog.Title>
                  <Dialog.Close className="ds-icon-btn" aria-label={t("newShell.close")}>
                    <X className="h-5 w-5" aria-hidden />
                  </Dialog.Close>
                </div>
                <nav aria-label={label} className="ds-dialog-body ds-scroll-quiet">
                  <MenuLinks groups={groups} currentPath={currentPath} onNavigate={() => setOpen(false)} idPrefix={`sheet-${app.id}`} />
                </nav>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}
