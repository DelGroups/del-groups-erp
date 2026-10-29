import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Recomputes `products.stock` from the available polywood pieces of every warehouse
 * (the product total); the database trigger then sets each warehouse row to its own pieces.
 * `warehouseId` is the warehouse whose pieces just changed; it no longer narrows the total,
 * which used to drop the other warehouses' metres.
 * Single canonical implementation — do not duplicate elsewhere.
 */
export async function syncPolywoodProductStockFromPieces(
  client: SupabaseClient,
  productId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  warehouseId?: string
): Promise<number> {
  const { data: pieces, error } = await client
    .from("polywood_pieces")
    .select("length_m")
    .eq("product_id", productId)
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
