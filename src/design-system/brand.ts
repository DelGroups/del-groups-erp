/**
 * Per-tenant brand colour (prompt 15): from one hex colour in the company settings
 * (system_settings key "ui_brand", value {"primary": "#0f766e"}) to the four CSS variables
 * the design system reads inside [data-ds]: --ds-brand, --ds-brand-hover, --ds-brand-fg
 * (readable text on the brand colour, WCAG contrast) and --ds-brand-soft (a tint).
 * Pure; no React or Next imports, so `node --test` loads it.
 */

export const DEFAULT_BRAND = "#0f766e";
export const BRAND_SETTING_KEY = "ui_brand";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** "#0F766E", "0f766e" or "#08f" → normalised "#0f766e", or null. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let hex = value.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(hex)) hex = hex.split("").map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/.test(hex) ? `#${hex}` : null;
}

export function hexToRgb(hex: string): Rgb {
  const n = normalizeHex(hex) ?? DEFAULT_BRAND;
  return { r: parseInt(n.slice(1, 3), 16), g: parseInt(n.slice(3, 5), 16), b: parseInt(n.slice(5, 7), 16) };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours, 1 … 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** White or near-black text, whichever reads better on `background`. */
export function readableOn(background: string): "#ffffff" | "#111318" {
  return contrastRatio(background, "#ffffff") >= contrastRatio(background, "#111318") ? "#ffffff" : "#111318";
}

/** Mixes `hex` towards black (amount > 0) or white (amount < 0); amount in 0…1. */
export function shade(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const t = Math.min(1, Math.abs(amount));
  const target = amount >= 0 ? 0 : 255;
  return rgbToHex({ r: r + (target - r) * t, g: g + (target - g) * t, b: b + (target - b) * t });
}

/** The CSS variables for a brand colour; an invalid colour gives the default brand. */
export function brandCssVars(primary: unknown): Record<"--ds-brand" | "--ds-brand-hover" | "--ds-brand-fg" | "--ds-brand-soft" | "--ds-heat", string> {
  const brand = normalizeHex(primary) ?? DEFAULT_BRAND;
  const { r, g, b } = hexToRgb(brand);
  // Very dark brands lighten on hover, the rest darken.
  const hover = luminance(brand) < 0.05 ? shade(brand, -0.18) : shade(brand, 0.1);
  return {
    "--ds-brand": brand,
    "--ds-brand-hover": hover,
    "--ds-brand-fg": readableOn(brand),
    "--ds-brand-soft": `rgb(${r} ${g} ${b} / 0.12)`,
    "--ds-heat": `${r} ${g} ${b}`,
  };
}

/** Reads the ui_brand setting value ({primary}) leniently; null when absent or invalid. */
export function parseBrandSetting(value: unknown): { primary: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const primary = normalizeHex((value as Record<string, unknown>).primary);
  return primary ? { primary } : null;
}
