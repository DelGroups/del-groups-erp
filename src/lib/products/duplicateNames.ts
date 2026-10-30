/**
 * Duplicate product names (fix F4). The database refuses a second product with the same code or
 * barcode, but not with the same name, and the same name can be legitimate: these helpers only
 * warn. Same rule as the duplicate_name kind of stock_integrity_report()
 * (supabase/migrations/20261029300000_duplicate_product_names.sql): lower(btrim(name)), stockable
 * products only.
 */

/** The fields the checks read; Product satisfies it. */
export interface NameCheckProduct {
  id: string;
  code: string | null;
  name: string | null;
  stock?: number | null;
  is_service?: boolean | null;
  is_composite?: boolean | null;
}

/** Postgres lower(btrim(name)): btrim drops leading and trailing spaces only. */
export function normalizeProductName(name: string | null | undefined): string {
  return (name ?? "").replace(/^ +| +$/g, "").toLowerCase();
}

/** Services and composites are not counted in a warehouse, so a shared name costs nothing. */
export function isStockableProduct(product: Pick<NameCheckProduct, "is_service" | "is_composite">): boolean {
  return !product.is_service && !product.is_composite;
}

/**
 * Other stockable products with the same normalised name. `excludeId` is the product being edited.
 * Empty when the name is blank.
 */
export function findSameNameProducts<T extends NameCheckProduct>(
  name: string | null | undefined,
  products: readonly T[],
  excludeId?: string | null
): T[] {
  const key = normalizeProductName(name);
  if (!key) return [];
  return products.filter(
    (product) => product.id !== excludeId && isStockableProduct(product) && normalizeProductName(product.name) === key
  );
}

/** An import that put the name into the code column: code and name are the same text. */
export function codeLooksLikeName(code: string | null | undefined, name: string | null | undefined): boolean {
  const normalizedCode = normalizeProductName(code);
  return normalizedCode !== "" && normalizedCode === normalizeProductName(name);
}

/** What the product import preview shows next to one row. */
export interface ImportNameCheck {
  /** Existing stockable products with the same name. */
  existing: NameCheckProduct[];
  /** Other rows of the file with the same name (their row numbers). */
  fileRows: number[];
  codeLooksLikeName: boolean;
}

export interface ImportNameCheckRow {
  rowNumber: number;
  code: string;
  name: string;
  /** An invalid row is never imported (default: valid). */
  isValid?: boolean;
}

export function hasImportNameWarning(check: ImportNameCheck | undefined): boolean {
  return Boolean(check && (check.existing.length > 0 || check.fileRows.length > 0 || check.codeLooksLikeName));
}

/**
 * Name checks for every row of a product import, keyed by row number; rows without a warning are
 * left out. Only rows the import would add are checked and compared: invalid rows are never sent,
 * and /api/products/bulk skips a row whose code already exists, so neither can create a second
 * product of a name.
 */
export function checkImportNames(
  rows: readonly ImportNameCheckRow[],
  products: readonly NameCheckProduct[]
): Map<number, ImportNameCheck> {
  const byName = new Map<string, NameCheckProduct[]>();
  for (const product of products) {
    if (!isStockableProduct(product)) continue;
    const key = normalizeProductName(product.name);
    if (!key) continue;
    const list = byName.get(key) ?? [];
    list.push(product);
    byName.set(key, list);
  }

  const existingCodes = new Set(products.map((product) => (product.code ?? "").trim().toLowerCase()).filter(Boolean));

  const added = rows.filter(
    (row) => row.isValid !== false && !existingCodes.has(row.code.trim().toLowerCase())
  );

  const rowsByName = new Map<string, number[]>();
  for (const row of added) {
    const key = normalizeProductName(row.name);
    if (!key) continue;
    const list = rowsByName.get(key) ?? [];
    list.push(row.rowNumber);
    rowsByName.set(key, list);
  }

  const checks = new Map<number, ImportNameCheck>();
  for (const row of added) {
    const key = normalizeProductName(row.name);
    const existing = key ? (byName.get(key) ?? []) : [];
    const fileRows = key ? (rowsByName.get(key) ?? []).filter((number) => number !== row.rowNumber) : [];
    const check: ImportNameCheck = { existing, fileRows, codeLooksLikeName: codeLooksLikeName(row.code, row.name) };
    if (hasImportNameWarning(check)) checks.set(row.rowNumber, check);
  }
  return checks;
}

/** Rows the import sends: valid and not skipped by the user. */
export function rowsToImport<T extends { rowNumber: number; isValid: boolean }>(
  rows: readonly T[],
  skipped: ReadonlySet<number>
): T[] {
  return rows.filter((row) => row.isValid && !skipped.has(row.rowNumber));
}

/** Link to one product: the products page opens it (`?highlight=<id>`). */
export function productHref(productId: string): string {
  return `/products?highlight=${encodeURIComponent(productId)}`;
}
