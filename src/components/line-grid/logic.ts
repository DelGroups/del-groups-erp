/**
 * Logic of LineGrid (UI-3, docs/ui-standard.md "Line grids"), pure so `node --test` covers it:
 * the keyboard map, adding / removing / duplicating / moving lines, totals, number parsing,
 * the optional columns the user shows and barcode detection. No React, no DOM.
 */
import { initialColumnWidth, ACTIONS_COLUMN_WIDTH, type GridColumnType } from "../../design-system/grid";

// ── Keyboard ───────────────────────────────────────────────────────────────────────────────

export type LineGridAction =
  /** Move the focus to this row and column (column = index among the visible columns). */
  | { type: "focus"; row: number; col: number }
  /** Add a line at the bottom and focus its first editable cell. */
  | { type: "add" }
  /** Remove this line. */
  | { type: "remove"; row: number };

export interface LineKey {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * What a key does in an editable cell (Tab / Shift+Tab are left to the browser: the cells are
 * in reading order and nothing else in the grid takes a tab stop):
 * - Enter: the same column one row down; at the last row a new line is added.
 * - Shift+Enter: the same column one row up.
 * - Ctrl/⌘+Enter: add a line wherever the focus is.
 * - Ctrl/⌘+Delete: remove the line.
 * Esc (revert the cell) is handled by the cell itself. Returns null for keys that are not ours.
 */
export function lineKeyAction(e: LineKey, at: { row: number; col: number }, rowCount: number): LineGridAction | null {
  const mod = Boolean(e.ctrlKey || e.metaKey);
  if (e.key === "Enter") {
    if (e.altKey) return null;
    if (mod) return { type: "add" };
    if (e.shiftKey) return at.row > 0 ? { type: "focus", row: at.row - 1, col: at.col } : null;
    if (at.row < rowCount - 1) return { type: "focus", row: at.row + 1, col: at.col };
    return { type: "add" };
  }
  if (e.key === "Delete" && mod && !e.altKey && !e.shiftKey) {
    return at.row >= 0 && at.row < rowCount ? { type: "remove", row: at.row } : null;
  }
  return null;
}

/** The row to focus after a line is removed: the one that took its place, else the one above. */
export function focusAfterRemove(removed: number, rowCountAfter: number): number | null {
  if (rowCountAfter <= 0) return null;
  return Math.min(removed, rowCountAfter - 1);
}

// ── Lines ──────────────────────────────────────────────────────────────────────────────────

/** The list with one item moved from `from` to `to` (both clamped); the same list when nothing moves. */
export function moveLine<T>(lines: readonly T[], from: number, to: number): T[] {
  const n = lines.length;
  if (n === 0) return [];
  const a = Math.min(Math.max(from, 0), n - 1);
  const b = Math.min(Math.max(to, 0), n - 1);
  if (a === b) return [...lines];
  const next = [...lines];
  const [item] = next.splice(a, 1);
  next.splice(b, 0, item);
  return next;
}

/** The list in the order of `keys` (a drag result); lines whose key is missing keep their place at the end. */
export function reorderByKeys<T>(lines: readonly T[], keys: readonly string[], keyOf: (line: T) => string): T[] {
  const byKey = new Map(lines.map((l) => [keyOf(l), l]));
  const out: T[] = [];
  for (const k of keys) {
    const line = byKey.get(k);
    if (line) {
      out.push(line);
      byKey.delete(k);
    }
  }
  return [...out, ...byKey.values()];
}

/** The list without the line at `index`. */
export function removeLineAt<T>(lines: readonly T[], index: number): T[] {
  if (index < 0 || index >= lines.length) return [...lines];
  return lines.filter((_, i) => i !== index);
}

/** The list with a copy of the line at `index` (made by `clone`, which gives it a new key) right below it. */
export function duplicateLineAt<T>(lines: readonly T[], index: number, clone: (line: T) => T): T[] {
  if (index < 0 || index >= lines.length) return [...lines];
  const next = [...lines];
  next.splice(index + 1, 0, clone(lines[index]));
  return next;
}

/** Sum of a value over the lines, rounded to `digits` decimals (money: 2), ignoring non-numbers. */
export function sumLines<T>(lines: readonly T[], value: (line: T) => number | null | undefined, digits = 2): number {
  const total = lines.reduce((sum, l) => {
    const v = Number(value(l));
    return Number.isFinite(v) ? sum + v : sum;
  }, 0);
  const f = 10 ** digits;
  return Math.round((total + Number.EPSILON) * f) / f;
}

// ── Number cells ───────────────────────────────────────────────────────────────────────────

export interface ParsedNumber {
  /** null: the cell is empty. */
  value: number | null;
  /** false: what is typed is not (yet) a valid number (e.g. "1,2,3", "-" with min 0). */
  valid: boolean;
}

/**
 * Parses what is typed in a number cell: a comma or a point as decimal separator, spaces as
 * thousand separators. Text in the middle of typing ("12," or "0.") is valid; the value is the
 * number so far. Below `min` or above `max` is invalid.
 */
export function parseDecimalInput(text: string, bounds: { min?: number; max?: number } = {}): ParsedNumber {
  const raw = text.replace(/[\s ]/g, "").replace(",", ".");
  if (raw === "") return { value: null, valid: true };
  if (!/^-?\d*\.?\d*$/.test(raw) || raw === "-" || raw === "." || raw === "-.") return { value: null, valid: false };
  const value = Number(raw.endsWith(".") ? raw.slice(0, -1) : raw);
  if (!Number.isFinite(value)) return { value: null, valid: false };
  if (bounds.min !== undefined && value < bounds.min) return { value, valid: false };
  if (bounds.max !== undefined && value > bounds.max) return { value, valid: false };
  return { value, valid: true };
}

/** The text a number cell shows for a value (no thousand separators, so it stays editable). */
export function numberInputText(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return String(value);
}

// ── Columns ────────────────────────────────────────────────────────────────────────────────

export interface LineColumnShape {
  key: string;
  type?: GridColumnType;
  width?: number;
  header?: string;
  /** Hidden until the user shows it (Columns button); always editable in the details drawer. */
  optional?: boolean;
}

/** Visible columns: every required one, plus the optional ones the user turned on, in the given order. */
export function visibleLineColumns<C extends LineColumnShape>(columns: readonly C[], shown: ReadonlySet<string>): C[] {
  return columns.filter((c) => !c.optional || shown.has(c.key));
}

/** The set of shown optional columns after a toggle. */
export function toggleShown(shown: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(shown);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** Shown optional columns from localStorage (a JSON array of keys); anything else is "none". */
export function parseShown(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    return new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

export function lineGridStorageKey(id: string): string {
  return `line-grid:${id}:shown`;
}

/** Starting width of the visible columns plus the drag handle and row actions (px). */
export function defaultLineGridWidth(columns: readonly LineColumnShape[], options: { reorder?: boolean } = {}): number {
  const data = columns.reduce((sum, c) => sum + initialColumnWidth({ key: c.key, type: c.type ?? "text", width: c.width, header: c.header }), 0);
  return data + ACTIONS_COLUMN_WIDTH + (options.reorder ? DRAG_COLUMN_WIDTH : 0);
}

/** Width of the drag-handle column (px). */
export const DRAG_COLUMN_WIDTH = 28;

/**
 * Room a document form has for its line grid on a 1280 px window: the window minus the sidebar
 * (240 px) and the page and card padding. The default columns of every grid must fit in it.
 */
export const LINE_GRID_ROOM_AT_1280 = 1280 - 240 - 96;

// ── Product cell ───────────────────────────────────────────────────────────────────────────

/** A scanner's input in a product search: 6–14 digits (EAN-8/13, UPC, ITF-14). */
export function isBarcodeLike(query: string): boolean {
  return /^\d{6,14}$/.test(query.trim());
}
