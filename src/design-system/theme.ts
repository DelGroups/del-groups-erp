/**
 * Theme, density and scope attributes of the new UI (prompt 15). Pure. The <DesignScope>
 * component applies scopeAttributes() to its root element; theme.css does the rest.
 */
import { brandCssVars } from "./brand";

export const DS_THEMES = ["light", "dark", "system"] as const;
export type DsTheme = (typeof DS_THEMES)[number];

export const DS_DENSITIES = ["comfortable", "compact"] as const;
export type DsDensity = (typeof DS_DENSITIES)[number];

export const DS_STORAGE_KEYS = { theme: "erp_ds_theme", density: "erp_ds_density" } as const;

export function resolveDsTheme(value: unknown, fallback: DsTheme = "system"): DsTheme {
  return (DS_THEMES as readonly unknown[]).includes(value) ? (value as DsTheme) : fallback;
}

export function resolveDsDensity(value: unknown, fallback: DsDensity = "comfortable"): DsDensity {
  return (DS_DENSITIES as readonly unknown[]).includes(value) ? (value as DsDensity) : fallback;
}

/** "system" resolved against the OS preference (for charts that need concrete colours). */
export function effectiveTheme(theme: DsTheme, prefersDark: boolean): "light" | "dark" {
  return theme === "system" ? (prefersDark ? "dark" : "light") : theme;
}

export interface ScopeOptions {
  theme: DsTheme;
  density: DsDensity;
  /** Tenant brand colour (hex); invalid or missing = the default brand. */
  brand?: string | null;
}

/** Attributes and inline style for the scope's root element. */
export function scopeAttributes(options: ScopeOptions): {
  "data-ds": "";
  "data-ds-theme": DsTheme;
  "data-ds-density": DsDensity;
  style: Record<string, string>;
} {
  return {
    "data-ds": "",
    "data-ds-theme": resolveDsTheme(options.theme),
    "data-ds-density": resolveDsDensity(options.density),
    style: brandCssVars(options.brand),
  };
}
