"use client";

import React from "react";
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

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setTheme(e.target.value as ThemeId);
  };

  const Icon = THEME_ICONS[theme];

  if (compact) {
    return (
      <select
        value={theme}
        onChange={handleChange}
        title={t("theme.label")}
        aria-label={t("theme.label")}
        className="sidebar-select w-full"
      >
        {THEMES.map((id) => (
          <option key={id} value={id}>
            {t(`theme.${id}`)}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="space-y-1">
      <label className="sidebar-label flex items-center gap-1.5">
        <Icon className="h-3 w-3" />
        {t("theme.label")}
      </label>
      <select value={theme} onChange={handleChange} className="sidebar-select w-full">
        {THEMES.map((id) => (
          <option key={id} value={id}>
            {t(`theme.${id}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
