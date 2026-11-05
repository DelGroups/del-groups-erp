/**
 * Pure helpers of StandardGrid (UI-6, docs/ui-standard.md "Lists"): the shared column and format
 * rules every converted table uses, so `node --test` covers them. No React, no DOM.
 */

export type SortDir = "asc" | "desc";
export interface GridSort {
  key: string;
  dir: SortDir;
}

/** A header click: ascending, then descending, then back to the table's own order. */
export function toggleSort(current: GridSort | null | undefined, key: string): GridSort | null {
  if (!current || current.key !== key) return { key, dir: "asc" };
  return current.dir === "asc" ? { key, dir: "desc" } : null;
}

export type SortValue = string | number | boolean | Date | null | undefined;

const isEmpty = (v: SortValue) => v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));

/** Compares two sort values: numbers and dates by size, text in the language's order; empty values last. */
export function compareValues(a: SortValue, b: SortValue, locale?: string): number {
  const ea = isEmpty(a);
  const eb = isEmpty(b);
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  const na = a instanceof Date ? a.getTime() : typeof a === "boolean" ? Number(a) : a;
  const nb = b instanceof Date ? b.getTime() : typeof b === "boolean" ? Number(b) : b;
  if (typeof na === "number" && typeof nb === "number") return na - nb;
  return String(na).localeCompare(String(nb), locale, { numeric: true, sensitivity: "base" });
}

/**
 * Rows in the order of `sort` (a stable sort: equal rows keep the table's own order). Empty
 * values stay at the end in both directions. Without a sort, or for a column with no sort value,
 * the rows are returned as given.
 */
export function sortRows<R>(rows: readonly R[], sort: GridSort | null | undefined, valueOf: (row: R, key: string) => SortValue | undefined, locale?: string): readonly R[] {
  if (!sort) return rows;
  const decorated = rows.map((row, index) => ({ row, index, value: valueOf(row, sort.key) }));
  if (decorated.every((d) => d.value === undefined)) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  decorated.sort((x, y) => {
    const ex = isEmpty(x.value);
    const ey = isEmpty(y.value);
    if (ex || ey) return ex === ey ? x.index - y.index : ex ? 1 : -1;
    return sign * compareValues(x.value, y.value, locale) || x.index - y.index;
  });
  return decorated.map((d) => d.row);
}

/** One line instead of the code under the name (UI-6): "code · name", or whichever part exists. */
export function codeName(code: string | null | undefined, name: string | null | undefined): string {
  const c = code?.trim();
  const n = name?.trim();
  if (c && n) return c === n ? n : `${c} · ${n}`;
  return n || c || "—";
}

/** Sum of a numeric value over rows (null and NaN count as 0), rounded to cents against float noise. */
export function sumBy<R>(rows: readonly R[], valueOf: (row: R) => number | null | undefined): number {
  const total = rows.reduce((sum, row) => {
    const v = Number(valueOf(row));
    return Number.isFinite(v) ? sum + v : sum;
  }, 0);
  return Math.round(total * 10000) / 10000;
}

/** Storage key of a grid's widths and density (per user, through useColumnPrefs). */
export const standardGridKey = (id: string) => `grid:${id}`;
