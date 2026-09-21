"use server";

import { requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

export type WarehouseStockLookupResult =
  | { success: true; data: Record<string, number> }
  | { success: false; error: string };

/** Current physical stock for each product, scoped to a single warehouse. */
export async function fetchWarehouseStockForProductsAction(
  productIds: string[],
  warehouseId: string
): Promise<WarehouseStockLookupResult> {
  try {
    await requirePermissionAction("can_view_products");
    const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
    if (uniqueIds.length === 0 || !warehouseId) {
      return { success: true, data: {} };
    }

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("warehouse_stocks")
      .select("product_id, current_stock")
      .eq("warehouse_id", warehouseId)
      .in("product_id", uniqueIds);

    if (error) return { success: false, error: error.message };

    const result: Record<string, number> = {};
    for (const row of data || []) {
      result[row.product_id as string] = Number(row.current_stock) || 0;
    }
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
