/**
 * Search helpers for the inventory count screen. Product names are typed by
 * hand ("1070 MATT  SINELIK"), so matching ignores case and repeated spaces.
 */

export interface InventoryCountSearchable {
  product_name: string;
  product_code: string | null;
  barcode: string | null;
}

/** A catalog product that can be added to an open count. */
export interface InventoryCountProductHit {
  id: string;
  code: string | null;
  name: string;
  unit: string | null;
  is_metric: boolean;
}

export function normalizeCountQuery(value: string | null | undefined): string {
  return (value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The words of the search box, in order. Characters that break the PostgREST
 * `or=(...)` filter are treated as spaces, the same way for the list and the catalog.
 */
function queryWords(query: string): string[] {
  return normalizeCountQuery(query)
    .replace(/[%_*,()\\"]/g, " ")
    .split(" ")
    .filter(Boolean);
}

/** True when every word appears in the field, in order (like the catalog's ilike pattern). */
function containsWordsInOrder(field: string, words: string[]): boolean {
  let from = 0;
  for (const word of words) {
    const at = field.indexOf(word, from);
    if (at < 0) return false;
    from = at + word.length;
  }
  return true;
}

/**
 * List filter. Matches the same way as the catalog search, so a product found
 * in the catalog and added to the count also shows in the filtered table.
 */
export function matchesCountQuery(line: InventoryCountSearchable, query: string): boolean {
  const words = queryWords(query);
  if (words.length === 0) return true;
  return [line.product_name, line.product_code, line.barcode].some((field) =>
    containsWordsInOrder(normalizeCountQuery(field), words)
  );
}

/** Minimum query length before the product catalog is searched. */
export const COUNT_CATALOG_MIN_QUERY = 2;

/**
 * Turns the search box text into a PostgREST ilike pattern. Spaces become
 * wildcards so "401 matt" also finds "401  MATT"; characters that break the
 * `or=(...)` filter syntax are dropped.
 */
export function catalogIlikePattern(query: string): string | null {
  const words = queryWords(query);
  if (words.join("").length < COUNT_CATALOG_MIN_QUERY) return null;
  return `%${words.join("%")}%`;
}

/**
 * What the catalog list above the table shows for the search box text:
 * "hidden" (no text or the count is not in progress), "short" (too few
 * characters to search the catalog), "loading" (results for this text have not
 * arrived yet) or "ready".
 */
export type CountCatalogState = "hidden" | "short" | "loading" | "ready";

export function countCatalogState(editable: boolean, query: string, resultsFor: string | null): CountCatalogState {
  if (!editable || !normalizeCountQuery(query)) return "hidden";
  if (catalogIlikePattern(query) === null) return "short";
  return resultsFor === query ? "ready" : "loading";
}

/**
 * Catalog hits marked with whether they are already lines of the count.
 * Products that can still be added come first; each group keeps catalog order.
 */
export function markCatalogHits<T extends { id: string }>(
  hits: T[],
  lines: { product_id: string }[]
): (T & { inCount: boolean })[] {
  const listed = new Set(lines.map((line) => line.product_id));
  const marked = hits.map((hit) => ({ ...hit, inCount: listed.has(hit.id) }));
  return [...marked.filter((hit) => !hit.inCount), ...marked.filter((hit) => hit.inCount)];
}
