"use server";

import { getProductStockAtWarehouse } from "@/lib/inventory/warehouseProductStock";
import { requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { isValidUuid } from "@/lib/auth/validate";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

/**
 * Stock of a product in the transfer's source warehouse. Reads with the service role, so
 * it runs on the server (until now the screen called it in the browser, where it always
 * failed and the stock was not refreshed).
 */
export async function fetchTransferSourceStock(productId: string, warehouseId: string): Promise<number> {
  await requirePermissionAction("can_manage_warehouses", { module: "inventory" });
  if (!isValidUuid(productId) || !isValidUuid(warehouseId)) return 0;
  const admin = await createSupabaseAdminClient();
  return getProductStockAtWarehouse(admin, productId, warehouseId);
}
