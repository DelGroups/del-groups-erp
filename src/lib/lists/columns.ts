/**
 * Column choice of a list (prompt 24c): which columns a user shows and in which order, per list
 * and per user, kept in this browser (localStorage, like the products page). Pure: no React, so
 * `node --test` loads it. The classic tables and the view engine's ListView both use it.
 */
import { PRODUCT_SLUG } from "../brand";

export interface ListColumnDef {
  key: string;
  /** i18n key of the header and of the picker label. */
  labelKey: string;
  /** Shown until the user chooses otherwise. */
  defaultVisible: boolean;
  /** Can never be hidden (the document number). */
  required?: boolean;
  /** Right-aligned amounts and counts. */
  numeric?: boolean;
}

/** What is stored: the visible keys and the order of every known key. */
export interface ColumnPrefs {
  visible: string[];
  order: string[];
  /** Column widths in px set by the user (DataGrid, UI-2); missing: the column's default. */
  widths?: Record<string, number>;
  /** Row density chosen in the grid toolbar (UI-2); missing: comfortable. */
  density?: "compact" | "comfortable";
}

/** What goes to storage: only the fields that are set. */
export function serializeColumnPrefs(prefs: ColumnPrefs): string {
  return JSON.stringify({
    visible: prefs.visible,
    order: prefs.order,
    ...(prefs.widths && Object.keys(prefs.widths).length ? { widths: prefs.widths } : {}),
    ...(prefs.density ? { density: prefs.density } : {}),
  });
}

/** Stored widths kept for known columns, as whole pixels between 24 and 2000. */
function readWidths(value: unknown, known: ReadonlySet<string>): Record<string, number> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (known.has(k) && typeof v === "number" && Number.isFinite(v) && v >= 24 && v <= 2000) out[k] = Math.round(v);
  }
  return Object.keys(out).length ? out : undefined;
}

/** One column's width set (UI-2 resize); the other prefs stay. */
export function setColumnWidth(prefs: ColumnPrefs, key: string, width: number): ColumnPrefs {
  return { ...prefs, widths: { ...prefs.widths, [key]: Math.round(width) } };
}

/** Back to the default width of every column (keeps order, visibility and density). */
export function clearColumnWidths(prefs: ColumnPrefs): ColumnPrefs {
  const rest: ColumnPrefs = { ...prefs };
  delete rest.widths;
  return rest;
}

/** Minimal Storage, so tests can pass a fake one. */
export interface ColumnStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type ColumnLike = Pick<ListColumnDef, "key" | "defaultVisible" | "required">;

export function columnPrefsKey(listKey: string, userId: string | null | undefined): string {
  return `${PRODUCT_SLUG}-cols-${listKey}-${userId || "anon"}`;
}

export function defaultColumnPrefs(defs: readonly ColumnLike[]): ColumnPrefs {
  return {
    visible: defs.filter((d) => d.defaultVisible || d.required).map((d) => d.key),
    order: defs.map((d) => d.key),
  };
}

const keyList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/**
 * Stored prefs checked against today's columns: unknown keys are dropped, columns added since
 * appear with their default (at their place in the definition), required columns are always
 * visible and at least one column stays visible. Anything unreadable gives the defaults.
 */
export function mergeColumnPrefs(defs: readonly ColumnLike[], stored: unknown): ColumnPrefs {
  const fallback = defaultColumnPrefs(defs);
  if (!stored || typeof stored !== "object") return fallback;
  const raw = stored as { visible?: unknown; order?: unknown; widths?: unknown; density?: unknown };
  const known = new Set(defs.map((d) => d.key));
  const extras: Pick<ColumnPrefs, "widths" | "density"> = {};
  const widths = readWidths(raw.widths, known);
  if (widths) extras.widths = widths;
  if (raw.density === "compact" || raw.density === "comfortable") extras.density = raw.density;
  const storedOrder = [...new Set(keyList(raw.order))].filter((k) => known.has(k));
  const storedVisible = new Set(keyList(raw.visible).filter((k) => known.has(k)));
  if (!storedOrder.length && !storedVisible.size) return { ...fallback, ...extras };

  // A column the stored order does not mention is new: it goes after its predecessor in the
  // definition (or first) and takes its default visibility.
  const seen = new Set(storedOrder);
  const order = [...storedOrder];
  defs.forEach((d, i) => {
    if (seen.has(d.key)) return;
    const prev = defs.slice(0, i).reverse().find((p) => seen.has(p.key));
    order.splice(prev ? order.indexOf(prev.key) + 1 : 0, 0, d.key);
    seen.add(d.key);
    if (d.defaultVisible) storedVisible.add(d.key);
  });
  for (const d of defs) if (d.required) storedVisible.add(d.key);
  const visible = order.filter((k) => storedVisible.has(k));
  if (!visible.length) return { ...fallback, ...extras };
  return { visible, order, ...extras };
}

/** The visible columns, in the user's order. */
export function visibleColumns<T extends ColumnLike>(defs: readonly T[], prefs: ColumnPrefs): T[] {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const shown = new Set(prefs.visible);
  return prefs.order.filter((k) => shown.has(k)).map((k) => byKey.get(k)).filter((d): d is T => !!d);
}

/** Shows or hides one column; required columns and the last visible one stay. */
export function toggleColumn(defs: readonly ColumnLike[], prefs: ColumnPrefs, key: string): ColumnPrefs {
  const def = defs.find((d) => d.key === key);
  if (!def) return prefs;
  const shown = new Set(prefs.visible);
  if (shown.has(key)) {
    if (def.required || shown.size <= 1) return prefs;
    shown.delete(key);
  } else {
    shown.add(key);
  }
  return { ...prefs, visible: prefs.order.filter((k) => shown.has(k)) };
}

/** Moves a column one place up (-1) or down (+1) in the order. */
export function moveColumn(prefs: ColumnPrefs, key: string, delta: -1 | 1): ColumnPrefs {
  const from = prefs.order.indexOf(key);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= prefs.order.length) return prefs;
  const order = [...prefs.order];
  [order[from], order[to]] = [order[to], order[from]];
  return setColumnOrder(prefs, order);
}

/** A new full order (drag and drop); keys it does not hold keep their place at the end. */
export function setColumnOrder(prefs: ColumnPrefs, order: readonly string[]): ColumnPrefs {
  const known = new Set(prefs.order);
  const next = [...new Set(order)].filter((k) => known.has(k));
  for (const k of prefs.order) if (!next.includes(k)) next.push(k);
  const shown = new Set(prefs.visible);
  return { ...prefs, order: next, visible: next.filter((k) => shown.has(k)) };
}

export function sameColumnPrefs(a: ColumnPrefs, b: ColumnPrefs): boolean {
  return (
    a.order.join("\u0000") === b.order.join("\u0000") &&
    a.visible.join("\u0000") === b.visible.join("\u0000") &&
    JSON.stringify(a.widths ?? {}) === JSON.stringify(b.widths ?? {}) &&
    (a.density ?? "") === (b.density ?? "")
  );
}

function browserStorage(): ColumnStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadColumnPrefs(
  listKey: string,
  userId: string | null | undefined,
  defs: readonly ColumnLike[],
  storage: ColumnStorage | null = browserStorage()
): ColumnPrefs {
  if (!storage) return defaultColumnPrefs(defs);
  try {
    const raw = storage.getItem(columnPrefsKey(listKey, userId));
    return raw ? mergeColumnPrefs(defs, JSON.parse(raw)) : defaultColumnPrefs(defs);
  } catch {
    return defaultColumnPrefs(defs);
  }
}

export function saveColumnPrefs(
  listKey: string,
  userId: string | null | undefined,
  prefs: ColumnPrefs,
  storage: ColumnStorage | null = browserStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(columnPrefsKey(listKey, userId), serializeColumnPrefs(prefs));
  } catch {
    // Private mode or a full quota: the choice lasts until the page is left.
  }
}

export function resetColumnPrefs(
  listKey: string,
  userId: string | null | undefined,
  storage: ColumnStorage | null = browserStorage()
): void {
  if (!storage) return;
  try {
    storage.removeItem(columnPrefsKey(listKey, userId));
  } catch {
    // Nothing stored that could be removed.
  }
}

/** A column of a list that knows prompt 24c's flag (LIST_COLUMNS). */
export interface FlaggedColumnDef extends ListColumnDef {
  /** One of the standard columns (Issued at, Salesperson, Created by): only while the flag is on. */
  standard?: boolean;
  /** Header while the flag is off, when today's differs (e.g. "Date" before "Invoice date"). */
  offLabelKey?: string;
}

/**
 * The columns a list shows. Flag off: exactly today's (defaults without the standard ones, in
 * definition order). Flag on: the user's choice.
 */
export function columnsForFlag<T extends FlaggedColumnDef>(defs: readonly T[], enabled: boolean, prefs: ColumnPrefs): T[] {
  return enabled ? visibleColumns(defs, prefs) : defs.filter((d) => d.defaultVisible && !d.standard);
}

export function columnLabelKey(def: FlaggedColumnDef, enabled: boolean): string {
  return !enabled && def.offLabelKey ? def.offLabelKey : def.labelKey;
}
