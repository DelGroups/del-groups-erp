import { isValidUuid } from "@/lib/auth/validate";
import type { Product, SaleItem } from "@/types/database.types";

export const SALE_PRODUCT_ID_NOT_FOUND = "Məhsul ID-si tapılmadı";

function productCode(product: Product): string {
  return (product.code || "").trim();
}

/** Resolve catalog product UUID from line item fields (never returns row client ids). */
export function resolveSaleItemProductId(
  item: SaleItem,
  products?: Product[]
): string | null {
  const direct = item.product_id?.trim();
  if (direct && isValidUuid(direct)) return direct;

  if (products?.length) {
    const name = item.product_name?.trim();
    const code = item.product_code?.trim();
    const match = products.find(
      (product) =>
        (name && product.name === name) ||
        (code && productCode(product) === code)
    );
    if (match?.id && isValidUuid(match.id)) return match.id;
  }

  const fallback = item.id?.trim();
  if (fallback && isValidUuid(fallback)) return fallback;

  return null;
}

export function normalizeSaleItemProductId(
  item: SaleItem,
  products?: Product[]
): SaleItem {
  const productId = resolveSaleItemProductId(item, products);
  return productId ? { ...item, product_id: productId } : item;
}

export function validateSaleItemsHaveProductIds(
  items: SaleItem[],
  products?: Product[]
): string | null {
  const lines = items.filter((item) => item.product_id || item.product_name.trim());
  for (const item of lines) {
    if (!resolveSaleItemProductId(item, products)) {
      return SALE_PRODUCT_ID_NOT_FOUND;
    }
  }
  return null;
}
