"use client";

import { useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, LayoutGrid, X } from "lucide-react";
import { useDesignScope } from "@/design-system/components";
import { motionPreset, overlayVariants, transitions } from "@/design-system/motion";
import { useI18n } from "@/i18n/I18nProvider";
import { groupSettingsItems, SETTINGS_HOME } from "@/lib/settings/items";
import { markShellNavigation } from "@/components/shell/useShell";
import type { SettingsNavItem } from "../useSettingsItems";

/** Groups and links of the settings menu; the active page is marked with aria-current. */
function MenuList({ items, activeId, onNavigate }: { items: SettingsNavItem[]; activeId: string | null; onNavigate?: () => void }) {
  const { t } = useI18n();
  const go = () => {
    markShellNavigation();
    onNavigate?.();
  };
  return (
    <>
      <Link href={SETTINGS_HOME} onClick={go} className="ds-settings-link" aria-current={activeId === null ? "page" : undefined}>
        <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">{t("settingsNav.allSettings")}</span>
      </Link>
      {groupSettingsItems(items).map(({ group, items: groupItems }) => (
        <div key={group.id} className="ds-settings-group" role="group" aria-labelledby={`settings-group-${group.id}`}>
          <p id={`settings-group-${group.id}`} className="ds-settings-group-title">
            {t(group.titleKey)}
          </p>
          <ul>
            {groupItems.map((item) => (
              <li key={item.id}>
                <Link href={item.path} onClick={go} className="ds-settings-link" aria-current={item.id === activeId ? "page" : undefined} title={item.title}>
                  <item.Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="truncate">{item.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

/**
 * Desktop side menu of every settings page (SETTINGS_V2). It sticks inside the page scroller and
 * only scrolls itself when it is taller than the window. Ideas from nav/nav-collapsible-sidebar-nav
 * and nav/nav-anchor-nav-with-scroll-spy, rebuilt with our tokens.
 */
export function SettingsSideMenu({ items, activeId }: { items: SettingsNavItem[]; activeId: string | null }) {
  const { t } = useI18n();
  return (
    <aside className="ds-settings-aside hidden lg:block">
      <nav aria-label={t("settingsNav.menu")}>
        <MenuList items={items} activeId={activeId} />
      </nav>
    </aside>
  );
}

/**
 * Phone and tablet: the side menu becomes a button at the top of the page (current page and its
 * group) that opens the same menu as a bottom sheet (nav/nav-mobile-drawer-menu).
 */
export function SettingsMobileMenu({ items, activeId }: { items: SettingsNavItem[]; activeId: string | null }) {
  const { t } = useI18n();
  const { portalContainer } = useDesignScope();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const active = items.find((i) => i.id === activeId) ?? null;
  const Icon = active?.Icon ?? LayoutGrid;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="ds-settings-mobile-trigger lg:hidden" aria-label={t("settingsNav.menuOpen")}>
        <span className="ds-settings-card-icon" aria-hidden>
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 text-start">
          <span className="block truncate text-[length:var(--ds-text-xs)] ds-muted">{active?.groupTitle ?? t("nav.sections.settings")}</span>
          <span className="block truncate font-semibold">{active?.title ?? t("settingsNav.allSettings")}</span>
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
                className="ds-settings-sheet"
                initial={reduced ? { opacity: 0 } : { y: "100%" }}
                animate={reduced ? { opacity: 1 } : { y: 0 }}
                exit={reduced ? { opacity: 0 } : { y: "100%" }}
                transition={reduced ? transitions.instant : transitions.base}
              >
                <div className="flex items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: "var(--ds-border)" }}>
                  <Dialog.Title className="truncate font-semibold">{t("settingsNav.menu")}</Dialog.Title>
                  <Dialog.Close className="ds-icon-btn" aria-label={t("newShell.close")}>
                    <X className="h-5 w-5" aria-hidden />
                  </Dialog.Close>
                </div>
                <nav aria-label={t("settingsNav.menu")} className="min-h-0 flex-1 overflow-y-auto p-3">
                  <MenuList items={items} activeId={activeId} onNavigate={() => setOpen(false)} />
                </nav>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}
