"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronRight, Search, X } from "lucide-react";
import { EmptyState, PageHeader } from "@/design-system/components";
import { listItemVariants, listVariants, motionPreset } from "@/design-system/motion";
import { useEnabledModules } from "@/hooks/useEnabledModules";
import { useI18n } from "@/i18n/I18nProvider";
import { getSupabaseClient } from "@/lib/supabase";
import { filterSettingsItems, groupSettingsItems } from "@/lib/settings/items";
import { markShellNavigation } from "@/components/shell/useShell";
import { MODULES } from "@/modules/registry";
import { useSettingsItems, type SettingsNavItem } from "../useSettingsItems";
import { SettingsV2Page } from "./SettingsV2Page";

/** Number of user accounts (one HEAD count, only for admins who see the Users card). */
function useUserCount(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void getSupabaseClient()
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .then(({ count: n, error }) => {
        if (alive && !error && typeof n === "number") setCount(n);
      });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return count;
}

/**
 * Settings home with SETTINGS_V2 (SET-1): a search box and the settings pages as cards in groups
 * (dashboards/dashboards-sidebar-stat-cards for the card shape), instead of a long tab row. A card
 * shows a small status where it costs nothing extra (users, modules switched off).
 */
export function SettingsHub() {
  const { t } = useI18n();
  const { items } = useSettingsItems();
  const { isEnabled } = useEnabledModules();
  const reduced = useReducedMotion();
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const hasUsers = items.some((i) => i.id === "users");
  const userCount = useUserCount(hasUsers);
  const modulesOff = useMemo(() => MODULES.filter((m) => !isEnabled(m.id)).length, [isEnabled]);

  const status = (item: SettingsNavItem): string | null => {
    if (item.id === "users" && userCount !== null) return t("settingsNav.hub.usersCount", { count: userCount });
    if (item.id === "modules") return modulesOff ? t("settingsNav.hub.modulesOff", { count: modulesOff }) : t("settingsNav.hub.allModulesOn");
    return null;
  };

  const groups = groupSettingsItems(filterSettingsItems(items, query));

  // "/" focuses the search, as in the app's other lists.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || event.ctrlKey || event.metaKey || target?.closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <SettingsV2Page id={null}>
      <PageHeader title={t("nav.sections.settings")} description={t("settingsNav.hub.description")} />
      <div className="ds-settings-search" role="search">
        <Search className="ds-settings-search-icon h-4 w-4" aria-hidden />
        <input
          ref={input}
          type="search"
          className="ds-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("settingsNav.hub.searchPlaceholder")}
          aria-label={t("settingsNav.hub.search")}
          autoComplete="off"
        />
        {query ? (
          <button type="button" className="ds-icon-btn ds-settings-search-clear" aria-label={t("settingsNav.hub.clear")} onClick={() => setQuery("")}>
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : (
          <kbd className="ds-kbd ds-settings-search-clear hidden md:inline-flex" aria-hidden>
            /
          </kbd>
        )}
      </div>

      {groups.length ? (
        <div className="flex flex-col gap-6">
          {groups.map(({ group, items: groupItems }) => (
            <section key={group.id} aria-labelledby={`hub-${group.id}`}>
              <h2 id={`hub-${group.id}`} className="ds-settings-hub-group">
                {t(group.titleKey)}
              </h2>
              <motion.ul className="ds-settings-cards" variants={motionPreset(listVariants, reduced)} initial="initial" animate="enter">
                <AnimatePresence initial={false}>
                  {groupItems.map((item) => {
                    const note = status(item);
                    return (
                      <motion.li key={item.id} variants={motionPreset(listItemVariants, reduced)} layout={!reduced}>
                        <Link href={item.path} className="ds-settings-card" onClick={() => markShellNavigation()}>
                          <span className="ds-settings-card-icon" aria-hidden>
                            <item.Icon className="h-5 w-5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="ds-settings-card-title">{item.title}</span>
                            <span className="ds-settings-card-text">{item.description}</span>
                            {note ? <span className="ds-chip ds-chip-flat ds-settings-card-status">{note}</span> : null}
                          </span>
                          <ChevronRight className="ds-settings-card-arrow h-4 w-4" aria-hidden />
                        </Link>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </motion.ul>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Search}
          title={t("settingsNav.hub.empty", { query })}
          description={t("settingsNav.hub.emptyHint")}
          action={
            <button type="button" className="ds-btn" onClick={() => setQuery("")}>
              {t("settingsNav.hub.clear")}
            </button>
          }
        />
      )}
    </SettingsV2Page>
  );
}
