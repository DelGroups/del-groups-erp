/**
 * Edits of one sales invoice line (GRID-2). The rules the old line table had inline, moved here
 * unchanged so the old editor and the LineGrid (behind UI_STANDARD) produce the same lines, and
 * so the same lines give the same submitSale payload. Pure: no React, no database.
 */
import { POLYWOOD_INVENTORY_MODE } from "@/lib/polywood/constants";
import { calcLineTotal, type InvoiceCurrency, type PriceTier, type SaleItem } from "@/types/database.types";
import { isDimensionalInvoiceProduct, resolveInvoiceLineUnitPrice, type InvoiceProductLike } from "./resolveInvoiceLinePrice";

/** What these rules read of a product (the form keeps its own, wider product rows). */
type Product = InvoiceProductLike;

export function isPolywoodProductRow(product: Product | null | undefined): boolean {
  return product?.inventory_mode === POLYWOOD_INVENTORY_MODE || product?.is_dimensional === true;
}

export function isPolywoodMeterLine(row: SaleItem, product: Product | null | undefined): boolean {
  return isPolywoodProductRow(product) && (row.polywood_sale_mode === "linear_m" || row.unit === "Metr");
}

/** A patch applied to a line; the line total is recomputed (quantity × price − discount). */
export function applySaleLinePatch(row: SaleItem, patch: Partial<SaleItem>): SaleItem {
  const updated = { ...row, ...patch };
  updated.total = calcLineTotal(updated.quantity, updated.unit_price, updated.discount_percent, updated.discount_type);
  return updated;
}

/** A typed quantity. Metre lines also set their length and re-price by length. */
export function saleQuantityPatch(row: SaleItem, product: Product | undefined, nextQuantity: number): Partial<SaleItem> {
  const patch: Partial<SaleItem> = { quantity: nextQuantity };
  if (isPolywoodMeterLine(row, product) || row.unit === "Metr") {
    patch.polywood_cut_confirmed = false;
    patch.polywood_length_m = row.unit === "Metr" ? nextQuantity : null;
    if (product && row.unit === "Metr") {
      patch.unit_price = resolveInvoiceLineUnitPrice(product, {
        unit: row.unit,
        quantity: nextQuantity,
        polywood_sale_mode: "linear_m",
        polywood_length_m: nextQuantity,
        polywood_full_sheet_length_m: row.polywood_full_sheet_length_m || Number(product.full_sheet_length_m) || 4,
        priceTier: row.price_tier,
      });
    }
  }
  return patch;
}

/**
 * Leaving the quantity of a metre line: the price for the final length. null for other lines.
 * The caller then runs its smart-cut check (handlePolywoodQuantityBlur).
 */
export function saleQuantityBlurPatch(row: SaleItem, product: Product | undefined): Partial<SaleItem> | null {
  const meterLine = isPolywoodMeterLine(row, product) || (product && row.unit === "Metr" && isDimensionalInvoiceProduct(product));
  if (!meterLine) return null;
  return {
    unit_price: resolveInvoiceLineUnitPrice(product, {
      unit: row.unit,
      quantity: row.quantity,
      polywood_sale_mode: "linear_m",
      polywood_length_m: row.polywood_length_m ?? row.quantity,
      polywood_full_sheet_length_m: row.polywood_full_sheet_length_m || Number(product?.full_sheet_length_m) || 4,
      priceTier: row.price_tier,
    }),
  };
}

/** Another price type (retail / wholesale / distributor): the product's price of that type. */
export function salePriceTierPatch(row: SaleItem, product: Product | undefined, nextTier: PriceTier): Partial<SaleItem> {
  return {
    price_tier: nextTier,
    unit_price: resolveInvoiceLineUnitPrice(product, {
      unit: row.unit,
      quantity: row.quantity,
      polywood_sale_mode: row.polywood_sale_mode,
      polywood_length_m: row.polywood_length_m,
      polywood_full_sheet_length_m: row.polywood_full_sheet_length_m,
      priceTier: nextTier,
    }),
  };
}

/** Another line currency: AZN has rate 1, a foreign currency keeps its rate (1 when unset). */
export function saleCurrencyPatch(row: SaleItem, nextCurrency: InvoiceCurrency): Partial<SaleItem> {
  return { currency: nextCurrency, exchange_rate: nextCurrency === "AZN" ? 1 : row.exchange_rate || 1 };
}

/**
 * A copy of a line under a new id, right after it. A confirmed cut is not copied: the copy needs
 * its own smart-cut check before the invoice is posted.
 */
export function duplicateSaleLine(lines: readonly SaleItem[], id: string, newId: string): SaleItem[] {
  return lines.flatMap((row) => (row.id === id ? [row, { ...row, id: newId, polywood_cut_confirmed: false }] : [row]));
}

/** A metre line's "price per bar" hint, or null (the rule of the old table's price cell). */
export function saleMetricHint(
  row: SaleItem,
  product: (Product & { base_length?: number | null }) | undefined
): { unitPrice: number; barLengthM: number; mode: "linear_m" | "full_sheet" } | null {
  const metricLine =
    isPolywoodMeterLine(row, product) ||
    (row.unit === "Metr" && product && isDimensionalInvoiceProduct(product)) ||
    (row.polywood_sale_mode && product && isPolywoodProductRow(product));
  if (!metricLine || !row.unit_price) return null;
  const barLengthM = row.polywood_full_sheet_length_m || Number(product?.base_length ?? product?.full_sheet_length_m) || 4;
  return { unitPrice: row.unit_price, barLengthM, mode: row.polywood_sale_mode || "linear_m" };
}

/**
 * A scanned product (scan bar or a grid product cell): one more on the line that already has it,
 * else it fills the first empty line (quantity 1), else a new line is added at the end.
 */
export function addScannedLine(
  lines: readonly SaleItem[],
  productId: string,
  apply: (row: SaleItem, quantity: number) => SaleItem,
  newRow: () => SaleItem,
  /** The line the scan was typed into (a grid product cell): filled first when it is empty. */
  intoId?: string
): SaleItem[] {
  const existing = lines.find((r) => r.product_id === productId);
  if (existing) return lines.map((row) => (row.id === existing.id ? apply(row, row.quantity + 1) : row));
  const isEmpty = (r: SaleItem) => !r.product_id && !r.product_name.trim();
  const empty = lines.find((r) => r.id === intoId && isEmpty(r)) ?? lines.find(isEmpty);
  if (empty) return lines.map((row) => (row.id === empty.id ? apply(row, 1) : row));
  return [...lines, apply(newRow(), 1)];
}
