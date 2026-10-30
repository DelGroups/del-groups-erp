/**
 * UI_STANDARD (UI-1, docs/ui-standard.md): one layer of UI rules for every screen. Server-only
 * switch, off unless the env value is "true". While on, the root layout sets `data-ui-standard`
 * on <html>, which turns on the token aliases (--erp-* → --ds-*), nowrap chips and badges, the
 * input width fix (src/design-system/ui-standard.css) and the DateField / Combobox controls in
 * the shared form view. While off nothing changes.
 */
export function isUiStandardEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.UI_STANDARD ?? "").trim().toLowerCase() === "true";
}

/**
 * /dev/ui-lab without signing in, for `npm run ui:guard` on a developer machine: only under
 * `next dev` (NODE_ENV=development) and only when UI_LAB_OPEN=true. A production build never
 * opens it (NODE_ENV is "production" there).
 */
export function isUiLabOpen(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.NODE_ENV === "development" && (env.UI_LAB_OPEN ?? "").trim().toLowerCase() === "true";
}
