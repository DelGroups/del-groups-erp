"use client";

import Link from "next/link";
import { useNewUi } from "@/components/shell/NewUiProvider";
import { useSettingsItems } from "./useSettingsItems";

/**
 * Settings navigation of the classic shell: two rows of icon tabs above every settings page.
 * The list, names and visibility rules come from the one settings list (src/lib/settings/items.ts,
 * SET-1). In the new shell it renders nothing: the shell's app tab bar (or, with SETTINGS_V2, the
 * settings side menu) is already the navigation, and two menus with the same items were shown.
 */
export default function SettingsTabs({ activeTab }: { activeTab: string }) {
  const { active: newShell } = useNewUi();
  const { items } = useSettingsItems();
  if (newShell) return null;

  return (
    <div className="app-glass flex flex-wrap gap-1 border-b border-app px-6" data-settings-tabs="">
      {items.map((tab) => {
        const Icon = tab.Icon;
        const active = tab.id === activeTab;
        return (
          <Link
            key={tab.id}
            href={tab.path}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-semibold transition-colors duration-300 ${
              active
                ? "border-[color:var(--app-accent)] text-app-accent"
                : "border-transparent text-app-muted hover:border-[color:var(--app-border-hover)] hover:text-app"
            }`}
          >
            <Icon className="h-4 w-4" />
            {tab.title}
          </Link>
        );
      })}
    </div>
  );
}
