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

export function matchesCountQuery(line: InventoryCountSearchable, query: string): boolean {
  const q = normalizeCountQuery(query);
  if (!q) return true;
  return [line.product_name, line.product_code, line.barcode].some((field) =>
    normalizeCountQuery(field).includes(q)
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
  const words = normalizeCountQuery(query)
    .replace(/[%_*,()\\"]/g, " ")
    .split(" ")
    .filter(Boolean);
  if (words.join("").length < COUNT_CATALOG_MIN_QUERY) return null;
  return `%${words.join("%")}%`;
}

/** Catalog hits that are not already lines of the count. */
export function productsMissingFromCount<T extends { id: string }>(
  hits: T[],
  lines: { product_id: string }[]
): T[] {
  const listed = new Set(lines.map((line) => line.product_id));
  return hits.filter((hit) => !listed.has(hit.id));
}
