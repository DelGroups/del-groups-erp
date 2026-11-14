/**
 * Rules of the assistant panel (AST-2): open / close / views, the Ctrl+J shortcut, the width and how the
 * panel sits next to the page. Pure, so `npm test` checks it.
 */

/**
 * Does this user get the new panel instead of the old widget? ASSISTANT_V2 on (server env, passed down),
 * the plan's AI module, signed in, and in the audience (admins by default). While sign-in is loading an
 * admin-only rollout stays off, so nobody who is not an admin sees it flash.
 */
export function assistantUiActive(input: {
  enabled: boolean;
  audience: "admins" | "all";
  aiModule: boolean;
  signedIn: boolean;
  isAdmin: boolean;
  authReady: boolean;
}): boolean {
  if (!input.enabled || !input.aiModule || !input.signedIn) return false;
  if (input.audience === "all") return true;
  return input.authReady && input.isAdmin;
}

export const PANEL_MIN_WIDTH = 360;
export const PANEL_MAX_WIDTH = 560;
export const PANEL_DEFAULT_WIDTH = 400;
/** One arrow-key step of the resize handle. */
export const PANEL_WIDTH_STEP = 16;

export function clampPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return PANEL_DEFAULT_WIDTH;
  return Math.round(Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, width)));
}

/** The panel is on the right edge: dragging the handle to the left makes it wider. */
export function resizedWidth(startWidth: number, startX: number, currentX: number): number {
  return clampPanelWidth(startWidth + (startX - currentX));
}

export function panelWidthKey(userId: string): string {
  return `del-assistant-width:${userId}`;
}

type WidthStorage = Pick<Storage, "getItem" | "setItem">;

/** The remembered width of this user, or the default; storage may be missing or throw. */
export function readPanelWidth(storage: WidthStorage | null | undefined, userId: string): number {
  try {
    const raw = storage?.getItem(panelWidthKey(userId));
    return raw ? clampPanelWidth(Number(raw)) : PANEL_DEFAULT_WIDTH;
  } catch {
    return PANEL_DEFAULT_WIDTH;
  }
}

export function writePanelWidth(storage: WidthStorage | null | undefined, userId: string, width: number): void {
  try {
    storage?.setItem(panelWidthKey(userId), String(clampPanelWidth(width)));
  } catch {
    // Private window or blocked storage: the width lives for this visit only.
  }
}

/**
 * How the panel sits (RESP-1 breakpoints):
 *   sheet    phones (< 768): a bottom sheet over the page
 *   overlay  tablets and normal desktops (768–1439): docked on the right, over the page
 *   push     wide screens (≥ 1440): docked on the right, the page shrinks beside it
 */
export type PanelLayout = "sheet" | "overlay" | "push";

export function panelLayout(viewportWidth: number): PanelLayout {
  if (viewportWidth < 768) return "sheet";
  if (viewportWidth < 1440) return "overlay";
  return "push";
}

export interface ShortcutKey {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/** Ctrl+J (Windows, Linux) or Cmd+J (macOS) toggles the panel. */
export function isToggleShortcut(e: ShortcutKey): boolean {
  return (e.ctrlKey === true || e.metaKey === true) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j";
}

export type PanelView = "chat" | "history";

export interface PanelState {
  open: boolean;
  view: PanelView;
}

export type PanelAction = { type: "open" } | { type: "close" } | { type: "toggle" } | { type: "history" } | { type: "chat" };

export const INITIAL_PANEL: PanelState = { open: false, view: "chat" };

export function panelReducer(s: PanelState, a: PanelAction): PanelState {
  switch (a.type) {
    case "open":
      return s.open ? s : { ...s, open: true };
    case "close":
      return s.open ? { open: false, view: "chat" } : s;
    case "toggle":
      return s.open ? { open: false, view: "chat" } : { ...s, open: true };
    case "history":
      return { open: true, view: "history" };
    case "chat":
      return { ...s, view: "chat" };
    default:
      return s;
  }
}

/** Escape closes the panel unless something inside it (a menu, a dialog) handled the key first. */
export function closesOnEscape(e: { key: string; defaultPrevented?: boolean }): boolean {
  return e.key === "Escape" && !e.defaultPrevented;
}

/** Rows the composer grows to before it scrolls. */
export const COMPOSER_MAX_ROWS = 6;

/** Enter sends, Shift+Enter is a new line, and nothing is sent while an IME is composing. */
export function composerKeyAction(e: { key: string; shiftKey?: boolean; isComposing?: boolean }): "send" | "newline" | null {
  if (e.key !== "Enter" || e.isComposing) return null;
  return e.shiftKey ? "newline" : "send";
}
