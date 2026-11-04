/**
 * Row actions of view-engine lists (UI-5, docs/ui-standard.md "Lists"): every list row has the
 * "…" menu again, with the actions of its record (view, edit, print, pay, send to warehouse,
 * e-qaimə, void / delete, as the model allows). A menu item opens the record with ?do=<key>, and
 * the record's FormView runs that action once it has loaded, so the availability rules and the
 * dialogs stay in one place (the module's FormView actions) and the list never duplicates them.
 * Pure, so `node --test` covers it.
 */

/** Query parameter a row action adds to the record link. */
export const ACTION_PARAM = "do";

/** What a screen declares for a row: the record's FormView action key, label and icon. */
export interface RowActionSpec {
  /** The FormView action key the record page runs (?do=key), e.g. "pay", "print", "void". */
  key: string;
  label: string;
  icon?: unknown;
  /** A command instead of the record link (actions without a form). */
  onSelect?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** Not offered for this row (status, permission). */
  hidden?: boolean;
}

/** One item of a row menu: a link (href), or a command (onSelect) for actions without a form. */
export interface RowActionItem {
  key: string;
  label: string;
  icon?: unknown;
  href?: string;
  onSelect?: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/** The record link with ?do=<key> (keeps the link's own query, replaces an older do=). */
export function actionHref(recordHref: string, key: string): string {
  const [path, hash = ""] = recordHref.split("#");
  const [base, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.set(ACTION_PARAM, key);
  return `${base}?${params.toString()}${hash ? `#${hash}` : ""}`;
}

/** The record link without ?do= (after the form ran it, so a refresh does not run it again). */
export function withoutAction(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete(ACTION_PARAM);
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}

/** The action the link asked for, when the form offers it and it is enabled; otherwise null. */
export function requestedAction<A extends { key: string; disabled?: boolean }>(actions: readonly A[], requested: string | null | undefined): A | null {
  if (!requested) return null;
  return actions.find((a) => a.key === requested && !a.disabled) ?? null;
}

/**
 * The menu of one row: "Open" first, then the record's actions as links with ?do=, destructive
 * ones (void, delete, cancel) last. Hidden items are dropped; an empty menu is not shown.
 */
export function rowMenu(recordHref: string | undefined, actions: readonly RowActionSpec[], openLabel?: string): RowActionItem[] {
  const visible = actions.filter((a) => !a.hidden);
  const toItem = (a: RowActionSpec): RowActionItem => {
    const href = a.onSelect || !recordHref ? undefined : actionHref(recordHref, a.key);
    return {
      key: a.key,
      label: a.label,
      icon: a.icon,
      destructive: a.destructive,
      disabled: a.disabled,
      href,
      // A ?do= link: remember that the user picked it, so the record's form may run it.
      onSelect: href ? () => rememberRowAction(typeof window === "undefined" ? null : window.sessionStorage, href, Date.now()) : a.onSelect,
    };
  };
  const items = [...visible.filter((a) => !a.destructive).map(toItem), ...visible.filter((a) => a.destructive).map(toItem)];
  return recordHref && openLabel ? [{ key: "open", label: openLabel, href: recordHref }, ...items] : items;
}

/**
 * A row action runs only when the user just picked it in a row menu, never from a link that was
 * bookmarked, shared or reloaded: the menu remembers the intent (session storage, one minute,
 * one use) and the form checks it before running.
 */
export const ROW_ACTION_INTENT_KEY = "ds-row-action";
export const ROW_ACTION_INTENT_MS = 60_000;

type IntentStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The path and action of a ?do= link, e.g. "/sales/42" and "pay"; null for other links. */
export function parseActionHref(href: string): { path: string; key: string } | null {
  const [path, query = ""] = href.split("#")[0].split("?");
  const key = new URLSearchParams(query).get(ACTION_PARAM);
  return key ? { path, key } : null;
}

export function rememberRowAction(store: IntentStore | null | undefined, href: string, now: number): void {
  const parsed = parseActionHref(href);
  if (!store || !parsed) return;
  try {
    store.setItem(ROW_ACTION_INTENT_KEY, JSON.stringify({ ...parsed, at: now }));
  } catch {
    // Storage blocked: the action then simply does not run on its own.
  }
}

/** The intent for this page and action is fresh (does not use it up). */
export function hasRowActionIntent(store: IntentStore | null | undefined, path: string, key: string, now: number): boolean {
  if (!store) return false;
  try {
    const raw = store.getItem(ROW_ACTION_INTENT_KEY);
    if (!raw) return false;
    const v = JSON.parse(raw) as { path?: unknown; key?: unknown; at?: unknown };
    return v.path === path && v.key === key && typeof v.at === "number" && now - v.at >= 0 && now - v.at <= ROW_ACTION_INTENT_MS;
  } catch {
    return false;
  }
}

export function forgetRowAction(store: IntentStore | null | undefined): void {
  try {
    store?.removeItem(ROW_ACTION_INTENT_KEY);
  } catch {
    // ignore
  }
}
