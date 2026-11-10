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

/**
 * Where a click on a link would take the user inside the app, or null when the unsaved-changes
 * guard must let it through: no link, a new tab or window (modifier, middle button, target),
 * a download, another site, or the same page.
 */
export function leaveTarget(
  anchor: { href: string; target?: string; download?: boolean } | null,
  click: { button: number; modified: boolean; defaultPrevented: boolean },
  here: { origin: string; pathname: string; search: string }
): string | null {
  if (!anchor || click.defaultPrevented || click.button !== 0 || click.modified) return null;
  if (anchor.download || (anchor.target && anchor.target !== "_self")) return null;
  let url: URL;
  try {
    url = new URL(anchor.href, here.origin);
  } catch {
    return null;
  }
  if (url.origin !== here.origin) return null;
  if (url.pathname === here.pathname && url.search === here.search) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
