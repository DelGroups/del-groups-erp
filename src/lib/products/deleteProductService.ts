import type { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export type DeleteProductServiceResult = { success: boolean; error?: string };

async function deleteByProductId(
  admin: AdminClient,
  table: string,
  productId: string
): Promise<DeleteProductServiceResult> {
  const { error } = await admin.from(table).delete().eq("product_id", productId);
  if (!error) return { success: true };

  const message = error.message ?? "";
  if (message.includes("does not exist") || message.includes("Could not find")) {
    return { success: true };
  }
  return { success: false, error: message };
}

/** Removes inventory links so products without sales/purchase lines can be deleted. */
export async function purgeProductDependencies(
  admin: AdminClient,
  productId: string
): Promise<DeleteProductServiceResult> {
  const { count: componentBomCount, error: bomError } = await admin
    .from("product_bom")
    .select("id", { count: "exact", head: true })
    .eq("component_product_id", productId);

  if (bomError) return { success: false, error: bomError.message };
  if ((componentBomCount ?? 0) > 0) {
    return {
      success: false,
      error: "Komplektin tərkib hissəsi olan məhsul silinə bilməz",
    };
  }

  const { count: materialCount, error: materialError } = await admin
    .from("production_materials")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);

  if (materialError && !materialError.message.includes("does not exist")) {
    return { success: false, error: materialError.message };
  }
  if ((materialCount ?? 0) > 0) {
    return {
      success: false,
      error: "İstehsal sifarişində material olan məhsul silinə bilməz",
    };
  }

  const { count: productionOrderCount, error: orderError } = await admin
    .from("production_orders")
    .select("id", { count: "exact", head: true })
    .eq("finished_product_id", productId);

  if (orderError && !orderError.message.includes("does not exist")) {
    return { success: false, error: orderError.message };
  }
  if ((productionOrderCount ?? 0) > 0) {
    return {
      success: false,
      error: "İstehsal sifarişi bağlı məhsul silinə bilməz",
    };
  }

  const purgeTables = [
    "stock_transfer_items",
    "stock_movements",
    "warehouse_stocks",
    "inventory_audit_items",
    "inventory_initial_balance_items",
    "purchase_requests",
    "consignment_inventory",
    "warehouse_slip_items",
  ];

  for (const table of purgeTables) {
    const result = await deleteByProductId(admin, table, productId);
    if (!result.success) return result;
  }

  const { error: parentBomError } = await admin
    .from("product_bom")
    .delete()
    .eq("parent_product_id", productId);

  if (parentBomError && !parentBomError.message.includes("does not exist")) {
    return { success: false, error: parentBomError.message };
  }

  return { success: true };
}

export function friendlyProductDeleteError(raw: string): string {
  if (raw.includes("stock_movements_product_id_fkey")) {
    return "Bu məhsulun anbar hərəkəti qeydi var; silinə bilməz";
  }
  if (raw.includes("sale_items") || raw.includes("Satış sətri")) {
    return "Satış sətri olan məhsul silinə bilməz";
  }
  if (raw.includes("purchase_items") || raw.includes("Alış sətri")) {
    return "Alış sətri olan məhsul silinə bilməz";
  }
  if (raw.includes("stock_transfer_items")) {
    return "Anbarlar arası transferdə olan məhsul silinə bilməz";
  }
  return raw;
}
