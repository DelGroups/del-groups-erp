"use client";

import React, { useEffect, useState } from "react";
import { Moon, Palette, Sun } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { THEMES, type ThemeId } from "@/theme/types";

const THEME_ICONS: Record<ThemeId, React.ComponentType<{ className?: string }>> = {
  dark: Moon,
  light: Sun,
  emerald: Palette,
};

interface ThemeSwitcherProps {
  compact?: boolean;
}

export default function ThemeSwitcher({ compact = false }: ThemeSwitcherProps) {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const Icon = THEME_ICONS[theme];

  if (!mounted) {
    return compact ? (
      <div className="sidebar-select h-9 w-full" aria-hidden />
    ) : (
      <div className="space-y-1" aria-hidden>
        <div className="sidebar-label h-3 w-16 rounded bg-app-card-hover" />
        <div className="theme-seg h-12" />
      </div>
    );
  }

  if (compact) {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    return (
      <button
        type="button"
        title={`${t("theme.label")}: ${t(`theme.${theme}`)}`}
        aria-label={`${t("theme.label")}: ${t(`theme.${theme}`)}`}
        onClick={() => setTheme(next)}
        className="sidebar-select flex w-full items-center justify-center py-2"
      >
        <Icon className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <p className="sidebar-label flex items-center gap-1.5">
        <Icon className="h-3 w-3" />
        {t("theme.label")}
      </p>
      <div className="theme-seg" role="group" aria-label={t("theme.label")}>
        {THEMES.map((id) => {
          const ThemeIcon = THEME_ICONS[id];
          const active = theme === id;
          return (
            <button
              key={id}
              type="button"
              data-active={active ? "true" : "false"}
              title={t(`theme.${id}`)}
              aria-label={t(`theme.${id}`)}
              aria-pressed={active}
              onClick={() => setTheme(id)}
            >
              <ThemeIcon className="mx-auto mb-0.5 h-3.5 w-3.5" />
              <span className="block truncate">{t(`theme.${id}`)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
