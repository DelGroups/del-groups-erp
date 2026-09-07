import { createEmptySaleItem, type SaleItem } from "@/types/database.types";
import { createEmptyPurchaseLineItem } from "@/lib/purchases/helpers";
import type { PurchaseLineItem } from "@/types/database.types";

export const DEFAULT_INVOICE_ROW_COUNT = 5;

export function createEmptySaleItems(
  count: number,
  warehouseId = "",
  warehouseName = ""
): SaleItem[] {
  return Array.from({ length: count }, (_, index) => ({
    ...createEmptySaleItem(warehouseId, warehouseName),
    id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
  }));
}

export function createEmptyPurchaseLineItems(count: number): PurchaseLineItem[] {
  return Array.from({ length: count }, (_, index) => ({
    ...createEmptyPurchaseLineItem(),
    id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
  }));
}
