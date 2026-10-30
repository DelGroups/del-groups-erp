/**
 * Logic of DataGrid (UI-2, docs/ui-standard.md "Lists"), pure so `node --test` covers it:
 * column widths per type, surplus space, sticky offsets, edge shadows, the floating
 * scrollbar, wheel direction and keyboard movement. No React, no DOM.
 */

export type GridDensity = "compact" | "comfortable";
export type GridColumnType = "text" | "code" | "number" | "money" | "date" | "datetime" | "status";

/** Row height per density (px): every row is exactly one line. */
export const GRID_ROW_HEIGHT: Record<GridDensity, number> = { compact: 32, comfortable: 40 };

/** Width of the selection and row-actions columns (px). */
export const SELECT_COLUMN_WIDTH = 40;
export const ACTIONS_COLUMN_WIDTH = 48;

/** Default width per type (px). Numbers and statuses are sized to their content instead when samples exist. */
export const TYPE_WIDTH: Record<GridColumnType, number> = {
  text: 180,
  code: 136,
  number: 96,
  money: 120,
  date: 96,
  datetime: 132,
  status: 128,
};

/** Narrowest a column may be dragged to (px). Dates never go below their full text. */
export const TYPE_MIN_WIDTH: Record<GridColumnType, number> = {
  text: 80,
  code: 72,
  number: 64,
  money: 80,
  date: 96,
  datetime: 132,
  status: 72,
};

export const MAX_COLUMN_WIDTH = 640;
/** Horizontal padding of a cell (both sides, px) and of a chip inside it. */
export const CELL_PADDING = 24;
const CHIP_PADDING = 18;
/** Average glyph width of the 14 px UI font (px). */
export const CHAR_WIDTH = 7.4;
/** Width of a tabular digit / amount glyph (px): wider than the average letter. */
export const DIGIT_WIDTH = 8.6;

const isNumeric = (type: GridColumnType) => type === "number" || type === "money";
/** Columns that take the free space when the grid is wider than its columns. */
export const isFlexible = (type: GridColumnType) => type === "text";

/** Estimated text width (px) without measuring: characters × average glyph width. */
export function estimateTextWidth(text: string, charWidth = CHAR_WIDTH): number {
  return Math.ceil([...text].length * charWidth);
}

export function clampWidth(type: GridColumnType, width: number): number {
  if (!Number.isFinite(width)) return TYPE_WIDTH[type];
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(TYPE_MIN_WIDTH[type], width)));
}

export interface WidthColumn {
  key: string;
  type: GridColumnType;
  /** A fixed starting width from the page (px). */
  width?: number;
  /** Texts the column shows (labels of a status, sample amounts), to size it to its content. */
  samples?: readonly string[];
  header?: string;
}

/**
 * Starting width of a column: the page's width; dates and codes their fixed width; numbers and
 * statuses the widest sample (a status chip sized to its longest label, an amount to its longest
 * figure); else the type's default, widened for the header up to the text default.
 */
export function initialColumnWidth(col: WidthColumn): number {
  if (col.width) return clampWidth(col.type, col.width);
  // Dates and codes have one width; a long header ellipsizes instead.
  if (col.type === "date" || col.type === "datetime" || col.type === "code") return TYPE_WIDTH[col.type];
  const header = col.header ? estimateTextWidth(col.header) + CELL_PADDING + 16 : 0; // + sort arrow
  if ((isNumeric(col.type) || col.type === "status") && col.samples?.length) {
    const extra = col.type === "status" ? CHIP_PADDING : 0;
    const charWidth = isNumeric(col.type) ? DIGIT_WIDTH : CHAR_WIDTH;
    const widest = Math.max(...col.samples.map((s) => estimateTextWidth(s, charWidth))) + CELL_PADDING + extra;
    return clampWidth(col.type, Math.max(widest, Math.min(header, TYPE_WIDTH[col.type])));
  }
  return clampWidth(col.type, Math.max(TYPE_WIDTH[col.type], Math.min(header, TYPE_WIDTH.text)));
}

/** Widths for every column: the user's stored width when there is one, else the starting width. */
export function resolveWidths(columns: readonly WidthColumn[], stored: Readonly<Record<string, number>> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of columns) {
    const saved = stored?.[c.key];
    out[c.key] = typeof saved === "number" && saved > 0 ? clampWidth(c.type, saved) : initialColumnWidth(c);
  }
  return out;
}

/**
 * Space left over when the columns are narrower than the grid goes to the text columns, in
 * proportion to their width (none: to the last data column), so the grid fills its box without
 * stretching dates or amounts.
 */
export function distributeSurplus(columns: readonly WidthColumn[], widths: Readonly<Record<string, number>>, available: number, fixed = 0): Record<string, number> {
  const total = columns.reduce((sum, c) => sum + (widths[c.key] ?? 0), fixed);
  const surplus = Math.floor(available - total);
  if (surplus <= 0 || !columns.length) return { ...widths };
  const flex = columns.filter((c) => isFlexible(c.type));
  const targets = flex.length ? flex : [columns[columns.length - 1]];
  const base = targets.reduce((sum, c) => sum + (widths[c.key] ?? 0), 0) || 1;
  const out = { ...widths };
  let given = 0;
  targets.forEach((c, i) => {
    const share = i === targets.length - 1 ? surplus - given : Math.floor((surplus * (widths[c.key] ?? 0)) / base);
    out[c.key] = (widths[c.key] ?? 0) + share;
    given += share;
  });
  return out;
}

/** Width after a drag of `delta` px (positive = wider, in reading direction). */
export function resizeWidth(type: GridColumnType, start: number, delta: number): number {
  return clampWidth(type, start + delta);
}

/** Auto-fit (double-click on the handle): the widest cell or the header, plus padding. */
export function fitWidth(type: GridColumnType, contentWidths: readonly number[], headerWidth: number): number {
  const widest = Math.max(0, headerWidth + 16, ...contentWidths);
  return clampWidth(type, widest + CELL_PADDING);
}

/**
 * Offsets (px from the inline start) of the columns that stay put on the start side: the
 * selection column, then the first data column. Returns one offset per sticky column.
 */
export function stickyStartOffsets(widths: readonly number[]): number[] {
  const out: number[] = [];
  let at = 0;
  for (const w of widths) {
    out.push(at);
    at += w;
  }
  return out;
}

export interface ScrollBox {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

/**
 * Which sides hide columns, for the edge shadows. `scrollLeft` is 0 at the start in LTR and
 * 0 or negative in RTL (browsers count from the start edge), so the distance from the start
 * is its absolute value either way.
 */
export function edgeShadows(box: ScrollBox): { start: boolean; end: boolean } {
  const fromStart = Math.abs(box.scrollLeft);
  const room = box.scrollWidth - box.clientWidth;
  if (room <= 1) return { start: false, end: false };
  return { start: fromStart > 1, end: fromStart < room - 1 };
}

/**
 * The floating scrollbar at the bottom of the window: needed while the grid scrolls sideways
 * and its own bottom edge (with the real scrollbar) is below the window while its top is
 * visible.
 */
export function floatingScrollbar(rect: { top: number; bottom: number }, viewportHeight: number, box: Pick<ScrollBox, "scrollWidth" | "clientWidth">): boolean {
  if (box.scrollWidth - box.clientWidth <= 1) return false;
  return rect.bottom > viewportHeight && rect.top < viewportHeight - 48;
}

/**
 * Sideways distance for a wheel event: a trackpad's own horizontal movement, or a vertical
 * wheel with Shift held. Zero means "let the page scroll".
 */
export function horizontalWheelDelta(e: { deltaX: number; deltaY: number; shiftKey: boolean }): number {
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return e.deltaX;
  return e.shiftKey ? e.deltaY : 0;
}

/** The focused row after a key (arrows, Home/End, PageUp/PageDown); null: the key is not ours. */
export function nextRowIndex(current: number, key: string, count: number, page = 10): number | null {
  if (count <= 0) return null;
  const at = Math.min(Math.max(current, 0), count - 1);
  switch (key) {
    case "ArrowDown":
      return Math.min(count - 1, current < 0 ? 0 : at + 1);
    case "ArrowUp":
      return Math.max(0, at - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "PageDown":
      return Math.min(count - 1, at + page);
    case "PageUp":
      return Math.max(0, at - page);
    default:
      return null;
  }
}

/** Width of the whole table (px): the data columns plus the selection and actions columns. */
export function tableWidth(widths: readonly number[], withSelect: boolean, withActions: boolean): number {
  return widths.reduce((a, b) => a + b, 0) + (withSelect ? SELECT_COLUMN_WIDTH : 0) + (withActions ? ACTIONS_COLUMN_WIDTH : 0);
}
