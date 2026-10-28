/**
 * The home page layout (prompt 24b): three columns of widgets, each with a size and optional
 * settings. Stored per user (public.home_layouts) and as a company default
 * (public.home_layout_defaults). Pure, so tests load it directly; every function returns a new
 * layout and never mutates its input.
 */
import { HOME_COLUMNS, widgetDef, WIDGETS, visibleTo, type HomeColumn, type HomeContext, type WidgetDef, type WidgetSize } from "./registry";

export const LAYOUT_VERSION = 1;

export interface WidgetPlacement {
  id: string;
  size: WidgetSize;
  /** Per-widget settings (e.g. the weather city, the clock face), strings only. */
  settings?: Record<string, string>;
}

export interface HomeLayout {
  v: typeof LAYOUT_VERSION;
  columns: Record<HomeColumn, WidgetPlacement[]>;
}

const MAX_SETTINGS = 8;
const MAX_SETTING_LENGTH = 80;

export function emptyLayout(): HomeLayout {
  return { v: LAYOUT_VERSION, columns: { start: [], centre: [], end: [] } };
}

function cleanSettings(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_SETTINGS) break;
    if (!/^[a-z][a-zA-Z0-9_]{0,30}$/.test(k) || typeof v !== "string") continue;
    out[k] = v.slice(0, MAX_SETTING_LENGTH);
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * A layout as the user may see it: unknown widgets, widgets of disabled modules, widgets the
 * user may not see (permission, financial) and duplicates are dropped; sizes the widget does not
 * offer become its default size; the pinned apps grid is always there (centre, first, unless the
 * user moved it). Accepts anything (stored JSON), returns null when it is not a layout at all.
 */
export function sanitizeLayout(raw: unknown, ctx: HomeContext): HomeLayout | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const columns = (raw as { columns?: unknown }).columns;
  if (!columns || typeof columns !== "object" || Array.isArray(columns)) return null;
  const seen = new Set<string>();
  const out = emptyLayout();
  for (const col of HOME_COLUMNS) {
    const list = (columns as Record<string, unknown>)[col];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const id = String((item as { id?: unknown }).id ?? "");
      const def = widgetDef(id);
      if (!def || seen.has(id) || !visibleTo(def, ctx)) continue;
      seen.add(id);
      const size = String((item as { size?: unknown }).size ?? "") as WidgetSize;
      const settings = cleanSettings((item as { settings?: unknown }).settings);
      out.columns[col].push({ id, size: def.sizes.includes(size) ? size : def.defaultSize, ...(settings ? { settings } : {}) });
    }
  }
  for (const def of WIDGETS) {
    if (def.pinned && !seen.has(def.id) && visibleTo(def, ctx)) out.columns[def.defaultColumn].unshift({ id: def.id, size: def.defaultSize });
  }
  return out;
}

/**
 * The built-in default: start = personal widgets, centre = apps + quick actions (+ agenda),
 * end = management widgets for users who may see figures, operations widgets for everyone else.
 * Only widgets the user may see, each in its default size and order.
 */
const DEFAULT_START = ["greeting", "clock", "weather", "calendar", "my_activities", "my_todos", "approvals"];
const DEFAULT_CENTRE = ["apps", "quick_actions", "agenda"];
const DEFAULT_END_MANAGEMENT = ["sales_month", "revenue_trend", "net_profit", "cash_balances", "receivables", "top_customers"];
const DEFAULT_END_OPERATIONS = ["low_stock", "production_status", "away_today", "my_pipeline"];

export function builtInLayout(ctx: HomeContext): HomeLayout {
  const place = (ids: readonly string[]): WidgetPlacement[] =>
    ids
      .map((id) => widgetDef(id))
      .filter((d): d is WidgetDef => !!d && visibleTo(d, ctx))
      .map((d) => ({ id: d.id, size: d.defaultSize }));
  const end = place(ctx.financials ? DEFAULT_END_MANAGEMENT : DEFAULT_END_OPERATIONS);
  return {
    v: LAYOUT_VERSION,
    columns: {
      start: place(DEFAULT_START),
      centre: place(DEFAULT_CENTRE),
      // Nothing to manage or operate (e.g. a plain user): their operations column stays empty.
      end: end.length ? end : place(DEFAULT_END_OPERATIONS),
    },
  };
}

/**
 * The layout to show: the user's own, else the company default, else the built-in default;
 * whichever is used is sanitized for this user (a company default made by an admin never shows
 * a non-financial user money widgets). An own or company layout that sanitizes to nothing but the
 * pinned apps falls through to the next one.
 */
export function mergeWithDefaults(user: unknown, tenant: unknown, ctx: HomeContext): { layout: HomeLayout; source: "user" | "tenant" | "builtin" } {
  const meaningful = (l: HomeLayout | null) => !!l && HOME_COLUMNS.some((c) => l.columns[c].some((p) => !widgetDef(p.id)?.pinned));
  const own = sanitizeLayout(user, ctx);
  if (own && meaningful(own)) return { layout: own, source: "user" };
  const company = sanitizeLayout(tenant, ctx);
  if (company && meaningful(company)) return { layout: company, source: "tenant" };
  return { layout: builtInLayout(ctx), source: "builtin" };
}

export function findWidget(layout: HomeLayout, id: string): { column: HomeColumn; index: number } | null {
  for (const column of HOME_COLUMNS) {
    const index = layout.columns[column].findIndex((p) => p.id === id);
    if (index >= 0) return { column, index };
  }
  return null;
}

function clone(layout: HomeLayout): HomeLayout {
  return { v: LAYOUT_VERSION, columns: { start: [...layout.columns.start], centre: [...layout.columns.centre], end: [...layout.columns.end] } };
}

/** Moves a widget to `column` at `index` (clamped); unknown ids leave the layout as it is. */
export function moveWidget(layout: HomeLayout, id: string, column: HomeColumn, index: number): HomeLayout {
  const at = findWidget(layout, id);
  if (!at || !HOME_COLUMNS.includes(column)) return layout;
  const next = clone(layout);
  const [item] = next.columns[at.column].splice(at.index, 1);
  const target = next.columns[column];
  const i = Math.max(0, Math.min(Number.isFinite(index) ? Math.trunc(index) : target.length, target.length));
  target.splice(i, 0, item);
  return next;
}

/** Up (-1) or down (+1) inside its column. */
export function moveBy(layout: HomeLayout, id: string, delta: -1 | 1): HomeLayout {
  const at = findWidget(layout, id);
  if (!at) return layout;
  return moveWidget(layout, id, at.column, at.index + delta);
}

/** One column to the start (-1) or the end (+1), at the same position (clamped). */
export function moveAcross(layout: HomeLayout, id: string, delta: -1 | 1): HomeLayout {
  const at = findWidget(layout, id);
  if (!at) return layout;
  const column = HOME_COLUMNS[HOME_COLUMNS.indexOf(at.column) + delta];
  return column ? moveWidget(layout, id, column, at.index) : layout;
}

/** Removes a widget; the pinned apps grid stays. */
export function removeWidget(layout: HomeLayout, id: string): HomeLayout {
  if (widgetDef(id)?.pinned) return layout;
  const at = findWidget(layout, id);
  if (!at) return layout;
  const next = clone(layout);
  next.columns[at.column].splice(at.index, 1);
  return next;
}

/** Adds a widget the user may see (at the end of `column`, default: its own column); already there = unchanged. */
export function addWidget(layout: HomeLayout, id: string, ctx: HomeContext, column?: HomeColumn): HomeLayout {
  const def = widgetDef(id);
  if (!def || !visibleTo(def, ctx) || findWidget(layout, id)) return layout;
  const next = clone(layout);
  next.columns[column ?? def.defaultColumn].push({ id, size: def.defaultSize });
  return next;
}

export function resizeWidget(layout: HomeLayout, id: string, size: WidgetSize): HomeLayout {
  const def = widgetDef(id);
  const at = findWidget(layout, id);
  if (!def || !at || !def.sizes.includes(size)) return layout;
  const next = clone(layout);
  next.columns[at.column][at.index] = { ...next.columns[at.column][at.index], size };
  return next;
}

export function setWidgetSettings(layout: HomeLayout, id: string, settings: Record<string, string>): HomeLayout {
  const at = findWidget(layout, id);
  if (!at) return layout;
  const next = clone(layout);
  const clean = cleanSettings(settings);
  const current = next.columns[at.column][at.index];
  next.columns[at.column][at.index] = clean ? { id: current.id, size: current.size, settings: clean } : { id: current.id, size: current.size };
  return next;
}

/** Widgets the user may add (visible, not on the page yet), grouped by category in registry order. */
export function addable(layout: HomeLayout, ctx: HomeContext): WidgetDef[] {
  return WIDGETS.filter((d) => !d.pinned && visibleTo(d, ctx) && !findWidget(layout, d.id));
}

/** Every widget id on the page, in reading order (start, centre, end): the mobile order. */
export function readingOrder(layout: HomeLayout): WidgetPlacement[] {
  return HOME_COLUMNS.flatMap((c) => layout.columns[c]);
}

export function sameLayout(a: HomeLayout, b: HomeLayout): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
