/**
 * Stock of each product in one warehouse, from its warehouse_stocks rows (fix F3). The legacy
 * row without a warehouse counts for the default warehouse only, as in the database
 * (public.stock_available).
 */
export interface WarehouseStockRow {
  product_id: string;
  warehouse_id: string | null;
  current_stock: number | string | null;
}

export function warehouseStockMap(
  rows: readonly WarehouseStockRow[],
  warehouseId: string,
  isDefaultWarehouse: boolean
): Map<string, number> {
  const exact = new Map<string, number>();
  const legacy = new Map<string, number>();
  for (const row of rows) {
    const qty = Number(row.current_stock) || 0;
    if (row.warehouse_id === warehouseId) exact.set(row.product_id, qty);
    else if (row.warehouse_id === null && isDefaultWarehouse) legacy.set(row.product_id, qty);
  }
  for (const [productId, qty] of legacy) if (!exact.has(productId)) exact.set(productId, qty);
  return exact;
}

/** Products a write-off can take from this warehouse: stocked here, not a service, kit or Polywood. */
export function writeoffCandidates<
  P extends { id: string; stock?: number | null; is_service?: boolean | null; is_composite?: boolean | null; inventory_mode?: string | null },
>(products: readonly P[], stock: Map<string, number>): P[] {
  return products
    .filter((p) => !p.is_service && !p.is_composite && p.inventory_mode !== "polywood" && (stock.get(p.id) ?? 0) > 0)
    .map((p) => ({ ...p, stock: stock.get(p.id) ?? 0 }));
}
