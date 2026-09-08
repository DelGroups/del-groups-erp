import { DEFAULT_FULL_SHEET_LENGTH_M } from "@/lib/polywood/constants";
import { syncPolywoodProductStockFromPieces } from "@/lib/inventory/polywoodStock";
import type { Database, SaleItemRow } from "@/types/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type StockClient = SupabaseClient<Database>;

export type ProductQuantityLine = {
  product_id: string;
  quantity: number;
  unit_price?: number;
};

export type SaleItemStockRow = Pick<
  SaleItemRow,
  | "id"
  | "product_id"
  | "warehouse_id"
  | "quantity"
  | "polywood_sale_mode"
  | "polywood_length_m"
  | "polywood_cut_details"
  | "sale_item_type"
  | "piece_count"
>;

export function isSaleServiceItem(item: SaleItemStockRow): boolean {
  return item.sale_item_type === "service";
}

export function isSaleDimensionalItem(item: SaleItemStockRow): boolean {
  return (
    item.sale_item_type === "dimensional" ||
    item.polywood_sale_mode === "linear_m" ||
    item.polywood_sale_mode === "full_sheet"
  );
}

export function hasDimensionalCutDetails(item: SaleItemStockRow): boolean {
  const details = item.polywood_cut_details;
  return details != null && typeof details === "object";
}

export function computeSaleItemStockUnits(
  item: SaleItemStockRow,
  fullSheetLengthM = DEFAULT_FULL_SHEET_LENGTH_M
): number {
  const quantity = Number(item.quantity) || 0;
  if (quantity <= 0) return 0;

  if (item.sale_item_type === "service") return 0;

  if (isSaleDimensionalItem(item)) {
    if (item.polywood_sale_mode === "full_sheet") {
      return quantity * fullSheetLengthM;
    }
    if (
      item.sale_item_type === "dimensional" ||
      item.polywood_sale_mode === "linear_m"
    ) {
      const perPieceLength = Number(item.polywood_length_m) || quantity;
      const pieceCount = Number(item.piece_count) || Math.round(quantity) || 1;
      return perPieceLength * pieceCount;
    }
  }

  return quantity;
}

export function buildProductQuantityMap(
  items: ProductQuantityLine[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    if (!item.product_id || item.quantity <= 0) continue;
    map.set(item.product_id, (map.get(item.product_id) || 0) + item.quantity);
  }
  return map;
}

export function computeProductQuantityDeltas(
  previousItems: ProductQuantityLine[],
  nextItems: ProductQuantityLine[]
): Map<string, number> {
  const previous = buildProductQuantityMap(previousItems);
  const next = buildProductQuantityMap(nextItems);
  const deltas = new Map<string, number>();

  for (const productId of new Set([...previous.keys(), ...next.keys()])) {
    const delta = (next.get(productId) || 0) - (previous.get(productId) || 0);
    if (Math.abs(delta) > 0.0001) {
      deltas.set(productId, delta);
    }
  }

  return deltas;
}

async function fetchProductStock(client: StockClient, productId: string): Promise<number | null> {
  const { data, error } = await client
    .from("products")
    .select("stock")
    .eq("id", productId)
    .single();

  if (error || !data) return null;
  return Number(data.stock) || 0;
}

async function fetchProductSheetLength(
  client: StockClient,
  productId: string
): Promise<number> {
  const { data } = await client
    .from("products")
    .select("full_sheet_length_m")
    .eq("id", productId)
    .single();

  return Number(data?.full_sheet_length_m) || DEFAULT_FULL_SHEET_LENGTH_M;
}

export async function incrementProductStock(
  client: StockClient,
  productId: string,
  quantity: number,
  buyPrice?: number
): Promise<{ ok: boolean; error?: string; previousStock?: number }> {
  if (quantity <= 0) return { ok: true, previousStock: 0 };

  const current = await fetchProductStock(client, productId);
  if (current === null) return { ok: false, error: "Məhsul tapılmadı" };

  const updatePayload: { stock: number; buy_price?: number } = {
    stock: current + quantity,
  };
  if (buyPrice != null && Number.isFinite(buyPrice)) {
    updatePayload.buy_price = buyPrice;
  }

  const { error } = await client.from("products").update(updatePayload).eq("id", productId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, previousStock: current };
}

export async function decrementProductStock(
  client: StockClient,
  productId: string,
  quantity: number
): Promise<{ ok: boolean; error?: string; previousStock?: number }> {
  if (quantity <= 0) return { ok: true, previousStock: 0 };

  const current = await fetchProductStock(client, productId);
  if (current === null) return { ok: false, error: "Məhsul tapılmadı" };
  if (current < quantity) {
    return { ok: false, error: `Kifayət qədər stok yoxdur (mövcud: ${current})` };
  }

  const { error } = await client
    .from("products")
    .update({ stock: current - quantity })
    .eq("id", productId);

  if (error) return { ok: false, error: error.message };
  return { ok: true, previousStock: current };
}

async function rollbackDimensionalSaleItem(
  client: StockClient,
  item: SaleItemStockRow
): Promise<void> {
  if (!item.id) return;

  const { error } = await client.rpc("rollback_mixed_dimensional_sale", {
    p_sale_item_id: item.id,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (item.product_id && item.warehouse_id) {
    await syncPolywoodProductStockFromPieces(client, item.product_id, item.warehouse_id);
  }
}

export async function restoreSaleItemStock(
  client: StockClient,
  item: SaleItemStockRow
): Promise<void> {
  if (!item.product_id || isSaleServiceItem(item)) return;

  if (isSaleDimensionalItem(item)) {
    if (hasDimensionalCutDetails(item) && item.id) {
      await rollbackDimensionalSaleItem(client, item);
      return;
    }

    const sheetLength = await fetchProductSheetLength(client, item.product_id);
    const units = computeSaleItemStockUnits(item, sheetLength);
    if (units > 0) {
      const result = await incrementProductStock(client, item.product_id, units);
      if (!result.ok) throw new Error(result.error || "Stok bərpa olunmadı");
    }
    return;
  }

  const quantity = Number(item.quantity) || 0;
  if (quantity <= 0) return;

  const result = await incrementProductStock(client, item.product_id, quantity);
  if (!result.ok) throw new Error(result.error || "Stok bərpa olunmadı");
}

export async function restoreSaleStock(
  client: StockClient,
  items: SaleItemStockRow[]
): Promise<void> {
  for (const item of items) {
    await restoreSaleItemStock(client, item);
  }
}

export async function revertPurchaseItemStock(
  client: StockClient,
  item: ProductQuantityLine
): Promise<void> {
  if (!item.product_id || item.quantity <= 0) return;

  const result = await decrementProductStock(client, item.product_id, item.quantity);
  if (!result.ok) throw new Error(result.error || "Alış stoku geri qaytarılmadı");
}

export async function revertPurchaseStock(
  client: StockClient,
  items: ProductQuantityLine[]
): Promise<void> {
  for (const item of items) {
    await revertPurchaseItemStock(client, item);
  }
}

export async function applyPurchaseStockDeltas(
  client: StockClient,
  previousItems: ProductQuantityLine[],
  nextItems: ProductQuantityLine[],
  unitPriceByProduct: Map<string, number>
): Promise<{ ok: boolean; error?: string }> {
  const deltas = computeProductQuantityDeltas(previousItems, nextItems);

  for (const [productId, delta] of deltas) {
    if (delta > 0) {
      const result = await incrementProductStock(
        client,
        productId,
        delta,
        unitPriceByProduct.get(productId)
      );
      if (!result.ok) return { ok: false, error: result.error };
      continue;
    }

    const result = await decrementProductStock(client, productId, -delta);
    if (!result.ok) return { ok: false, error: result.error };
  }

  return { ok: true };
}

export async function applyWriteoffStockDeltas(
  client: StockClient,
  previousItems: ProductQuantityLine[],
  nextItems: ProductQuantityLine[]
): Promise<{ ok: boolean; error?: string }> {
  const deltas = computeProductQuantityDeltas(previousItems, nextItems);

  for (const [productId, delta] of deltas) {
    if (delta > 0) {
      const result = await decrementProductStock(client, productId, delta);
      if (!result.ok) return { ok: false, error: result.error };
      continue;
    }

    const result = await incrementProductStock(client, productId, -delta);
    if (!result.ok) return { ok: false, error: result.error };
  }

  return { ok: true };
}
