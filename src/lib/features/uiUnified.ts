/**
 * UI_UNIFIED (UI-7 phase 2, docs/ui-standard.md): the one navigation pattern and the shared page
 * parts of the UI rulebook. Server-only switch, off unless the env value is "true"; it only takes
 * effect inside the new shell (NEW_UI). With it on:
 *   - every app with two or more pages gets the grouped left side menu, the shell shows no app tabs;
 *   - breadcrumbs are App › Page › Record from one route map, and the back button goes to the parent;
 *   - the shell's quick-actions button is not a primary button;
 *   - legacy --app-* colours alias the design tokens and the body font is Inter.
 * UI_UNIFIED_AUDIENCE: "admins" (default) shows it to admins only, "all" to everyone.
 */
export type UiUnifiedAudience = "admins" | "all";

export function isUiUnifiedEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.UI_UNIFIED ?? "").trim().toLowerCase() === "true";
}

export function uiUnifiedAudience(env: Readonly<Record<string, string | undefined>> = process.env): UiUnifiedAudience {
  return (env.UI_UNIFIED_AUDIENCE ?? "").trim().toLowerCase() === "all" ? "all" : "admins";
}

/**
 * Does this user get the unified UI? Only inside the new shell; with the "admins" audience the
 * user must be an admin. While sign-in is loading an admin-only rollout stays off, so nobody who
 * is not an admin sees it flash.
 */
export function uiUnifiedActive(input: { enabled: boolean; audience: UiUnifiedAudience; shellActive: boolean; isAdmin: boolean; authReady: boolean }): boolean {
  if (!input.enabled || !input.shellActive) return false;
  if (input.audience === "all") return true;
  return input.authReady && input.isAdmin;
}

/** Attribute the root element carries while the unified UI is on (ui-unified.css keys off it). */
export const UI_UNIFIED_ATTR = "data-ui-unified";
