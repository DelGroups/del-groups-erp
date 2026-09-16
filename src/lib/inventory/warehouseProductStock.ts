import type { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

type StockClient = ReturnType<typeof createSupabaseAdminClient> | { from: (table: string) => unknown };

const NULL_WAREHOUSE_SENTINEL = "00000000-0000-0000-0000-000000000000";

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getProductStockAtWarehouse(
  client: StockClient,
  productId: string,
  warehouseId: string
): Promise<number> {
  const { data: exact, error: exactError } = await (client as ReturnType<typeof createSupabaseAdminClient>)
    .from("warehouse_stocks")
    .select("current_stock")
    .eq("product_id", productId)
    .eq("warehouse_id", warehouseId)
    .maybeSingle();

  if (!exactError && exact) return num(exact.current_stock);

  const { data: legacy } = await (client as ReturnType<typeof createSupabaseAdminClient>)
    .from("warehouse_stocks")
    .select("current_stock, warehouse_id")
    .eq("product_id", productId);

  const rows = legacy ?? [];
  if (rows.length === 1) {
    const row = rows[0];
    if (!row.warehouse_id || row.warehouse_id === warehouseId) {
      return num(row.current_stock);
    }
  }

  const { data: product } = await (client as ReturnType<typeof createSupabaseAdminClient>)
    .from("products")
    .select("stock, warehouse_id")
    .eq("id", productId)
    .maybeSingle();

  if (product && (!product.warehouse_id || product.warehouse_id === warehouseId)) {
    return num(product.stock);
  }

  return 0;
}

export async function adjustProductStockAtWarehouse(
  client: ReturnType<typeof createSupabaseAdminClient>,
  productId: string,
  warehouseId: string,
  delta: number
): Promise<number> {
  const current = await getProductStockAtWarehouse(client, productId, warehouseId);
  const next = Math.max(0, current + delta);

  const { data: existing } = await client
    .from("warehouse_stocks")
    .select("id")
    .eq("product_id", productId)
    .eq("warehouse_id", warehouseId)
    .maybeSingle();

  const payload = {
    product_id: productId,
    warehouse_id: warehouseId,
    current_stock: next,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { error } = await client.from("warehouse_stocks").update(payload).eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await client.from("warehouse_stocks").insert([payload]);
    if (error) throw new Error(error.message);
  }

  if (delta !== 0) {
    const { data: product } = await client.from("products").select("stock").eq("id", productId).maybeSingle();
    const productStock = num(product?.stock);
    const productNext = Math.max(0, productStock + delta);
    await client.from("products").update({ stock: productNext }).eq("id", productId);
  }

  return next;
}

export { NULL_WAREHOUSE_SENTINEL };
