import { POLYWOOD_INVENTORY_MODE, POLYWOOD_WAREHOUSE_TYPE } from "@/lib/polywood/constants";

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

type StockAdminClient = ReturnType<
  typeof import("@/lib/supabaseAdmin").createSupabaseAdminClient
>;

export function resolveCatalogWarehouseStock(
  movementBalances: Map<string, number>,
  productId: string,
  catalogStock: number
): number {
  const productStock = Math.max(0, num(catalogStock));
  const movementStock = movementBalances.get(productId);

  if (movementStock !== undefined) {
    const ledgerStock = Math.max(0, movementStock);
    if (ledgerStock <= 0 && productStock > 0) return productStock;
    return ledgerStock;
  }

  return productStock;
}

export function resolveRealWarehouseStock(
  movementBalances: Map<string, number>,
  productId: string,
  catalogStock: number,
  options?: {
    productWarehouseId?: string | null;
    selectedWarehouseId?: string;
  }
): number {
  void options;
  return resolveCatalogWarehouseStock(movementBalances, productId, catalogStock);
}

/** @deprecated Use resolveRealWarehouseStock */
export function resolveStandardProductWarehouseStock(
  movementBalances: Map<string, number>,
  productId: string,
  globalStock: number
): number {
  return resolveRealWarehouseStock(movementBalances, productId, globalStock);
}

export async function warehouseStockBalancesFromMovements(
  admin: StockAdminClient,
  warehouseId: string
): Promise<Map<string, number>> {
  const { data, error } = await admin
    .from("stock_movements")
    .select("product_id, movement_type, quantity")
    .eq("warehouse_id", warehouseId);

  if (error || !data?.length) return new Map();

  const balances = new Map<string, number>();
  for (const row of data) {
    if (!row.product_id) continue;
    const delta = row.movement_type === "in" ? num(row.quantity) : -num(row.quantity);
    balances.set(row.product_id, (balances.get(row.product_id) || 0) + delta);
  }
  return balances;
}

export async function getPolywoodWarehouseProductStock(
  admin: StockAdminClient,
  warehouseId: string,
  productId: string
): Promise<number> {
  const { data, error } = await admin
    .from("polywood_pieces")
    .select("length_m")
    .eq("warehouse_id", warehouseId)
    .eq("product_id", productId)
    .eq("status", "available");

  if (error || !data?.length) return 0;

  const total = data.reduce((sum, piece) => sum + num(piece.length_m), 0);
  return Math.round(total * 100) / 100;
}

export async function getWarehouseProductAvailableStock(
  admin: StockAdminClient,
  input: {
    warehouseId: string;
    productId: string;
    globalStock: number;
    productWarehouseId?: string | null;
    inventoryMode?: string | null;
    warehouseType?: string | null;
  }
): Promise<number> {
  const isPolywood =
    input.warehouseType === POLYWOOD_WAREHOUSE_TYPE ||
    input.inventoryMode === POLYWOOD_INVENTORY_MODE;

  if (isPolywood) {
    return getPolywoodWarehouseProductStock(admin, input.warehouseId, input.productId);
  }

  const movementBalances = await warehouseStockBalancesFromMovements(admin, input.warehouseId);
  return resolveRealWarehouseStock(movementBalances, input.productId, input.globalStock, {
    productWarehouseId: input.productWarehouseId,
    selectedWarehouseId: input.warehouseId,
  });
}

export function hasWarehouseStockShortage(requestedQty: number, availableStock: number): boolean {
  return requestedQty > availableStock;
}

export function warehouseStockShortageDelta(requestedQty: number, availableStock: number): number {
  return hasWarehouseStockShortage(requestedQty, availableStock)
    ? Math.max(0, requestedQty - availableStock)
    : 0;
}
