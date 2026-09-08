import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Recomputes `products.stock` from available polywood pieces in a warehouse.
 * Single canonical implementation — do not duplicate elsewhere.
 */
export async function syncPolywoodProductStockFromPieces(
  client: SupabaseClient,
  productId: string,
  warehouseId: string
): Promise<number> {
  const { data: pieces, error } = await client
    .from("polywood_pieces")
    .select("length_m")
    .eq("product_id", productId)
    .eq("warehouse_id", warehouseId)
    .eq("status", "available");

  if (error) throw new Error(error.message);

  const totalLength = (pieces || []).reduce(
    (sum, piece) => sum + (Number(piece.length_m) || 0),
    0
  );
  const rounded = Math.round(totalLength * 1000) / 1000;

  const { error: updateError } = await client
    .from("products")
    .update({ stock: rounded })
    .eq("id", productId);

  if (updateError) throw new Error(updateError.message);
  return rounded;
}
