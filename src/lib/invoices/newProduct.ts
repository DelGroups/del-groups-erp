/**
 * INV-1: the "New product" button of the sales and purchase invoice forms. Pure rules, so the
 * forms and the tests share them.
 */

/** Is the "New product" button shown? */
export function showInvoiceNewProduct(input: {
  /** INVOICE_TOOLS is on. */
  flag: boolean;
  /** canQuickCreate("product", …) for this user. */
  canCreate: boolean;
  /** The sales form in polywood-only mode (like "Select products", the button is hidden). */
  polywoodOnly?: boolean;
}): boolean {
  return input.flag && input.canCreate && !input.polywoodOnly;
}

/** Where a created product goes: an existing empty line, or a new line at the end. */
export type CreatedProductTarget = { kind: "line"; id: string } | { kind: "new" };

/** The first empty line takes the created product; with none, a new line is added. */
export function createdProductTarget<T>(
  lines: readonly T[],
  isEmpty: (line: T) => boolean,
  idOf: (line: T) => string
): CreatedProductTarget {
  const empty = lines.find(isEmpty);
  return empty ? { kind: "line", id: idOf(empty) } : { kind: "new" };
}

/** A sales line is empty when no product is chosen (the same test as "Select products"). */
export function isEmptySaleLine(line: { product_id?: string | null }): boolean {
  return !line.product_id;
}

/** A purchase line is empty when it has no product and no typed name (as the barcode scan). */
export function isEmptyPurchaseLine(line: { product_id?: string | null; product_name?: string | null }): boolean {
  return !line.product_id && !(line.product_name ?? "").trim();
}
