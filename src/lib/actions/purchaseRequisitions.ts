"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { ActionAuthError, requirePermissionAction } from "@/lib/auth/serverActionAuth";
import type { PurchaseRequest } from "@/lib/production/types";

export type PurchaseRequisitionRow = PurchaseRequest & {
  production_order_no?: string | null;
  warehouse_name?: string | null;
};

export type PurchaseRequisitionsResult =
  | { success: true; data: PurchaseRequisitionRow[] }
  | { success: false; error: string };

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function listProductionPurchaseRequisitionsAction(): Promise<PurchaseRequisitionsResult> {
  try {
    await requirePermissionAction("can_view_purchases");
    const admin = createSupabaseAdminClient();

    const { data, error } = await admin
      .from("purchase_requests")
      .select(
        "*, production_orders(order_no), warehouses(name)"
      )
      .in("status", ["pending", "ordered", "auto_triggered"])
      .order("created_at", { ascending: false });

    if (error) {
      return { success: false, error: error.message };
    }

    const rows = (data || []).map((row) => {
      const productionOrder = row.production_orders as { order_no?: string } | null;
      const warehouse = row.warehouses as { name?: string } | null;
      return {
        id: String(row.id),
        request_no: String(row.request_no || ""),
        production_order_id: (row.production_order_id as string) || null,
        product_id: (row.product_id as string) || null,
        product_code: (row.product_code as string) || null,
        product_name: String(row.product_name || ""),
        warehouse_id: (row.warehouse_id as string) || null,
        quantity: num(row.quantity),
        unit: (row.unit as string) || null,
        status: String(row.status || "pending") as PurchaseRequest["status"],
        purchase_id: (row.purchase_id as string) || null,
        notes: (row.notes as string) || null,
        created_at: (row.created_at as string) || null,
        source: (row.source as PurchaseRequest["source"]) || "production",
        production_order_no: productionOrder?.order_no || null,
        warehouse_name: warehouse?.name || null,
      };
    });

    return { success: true, data: rows };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
