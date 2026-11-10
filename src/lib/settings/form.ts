/**
 * Form helpers of the SETTINGS_V2 pages (SET-1), pure so `node --test` covers them.
 */

/** Same value, whatever the key order (a saved config against the one being edited). */
export function sameValue(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : v
  );
}

/** The unsaved-changes guard's link rule; it lives with the shared form parts now (UI-7). */
export { leaveTarget } from "../../design-system/logic";
