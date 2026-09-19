export const THEMES = ["graphite", "daylight", "midnight"] as const;
export type ThemeId = (typeof THEMES)[number];

export const DEFAULT_THEME: ThemeId = "graphite";
export const THEME_STORAGE_KEY = "erp_theme";

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return THEMES.includes(value as ThemeId);
}

export function resolveTheme(value: string | null | undefined): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME;
}
