import { supabase } from "@/lib/supabase";
import type { DamagedGoodsItem, Product, WarehouseSlipItem } from "@/types/database.types";
import { toDamagedGoodsItemsJson } from "@/types/database.types";
import { createWarehouseSlip } from "@/lib/warehouse/warehouseSlips";
import { warehouseStockMap, writeoffCandidates, type WarehouseStockRow } from "./warehouseStockMap";

export interface SubmitWriteoffPayload {
  document_number: string;
  writeoff_date: string;
  warehouse_id: string;
  checker_name: string;
  items: DamagedGoodsItem[];
  notes?: string;
}

export interface SubmitWriteoffResult {
  success: boolean;
  error?: string;
  writeoffId?: string;
}

/** post_inventory_writeoff / update_inventory_writeoff are newer than the generated Database types. */
async function callWriteoffRpc(fn: string, args: Record<string, unknown>): Promise<{ id?: string; error?: string }> {
  const rpc = supabase.rpc as unknown as (
    name: string,
    params: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc.call(supabase, fn, args);
  if (error) return { error: error.message };
  return { id: (data as { id?: string } | null)?.id };
}

function writeoffRpcPayload(payload: SubmitWriteoffPayload, items: DamagedGoodsItem[]) {
  return {
    document_number: payload.document_number,
    writeoff_date: payload.writeoff_date,
    warehouse_id: payload.warehouse_id || null,
    checker_name: payload.checker_name.trim(),
    notes: payload.notes?.trim() || null,
    items: toDamagedGoodsItemsJson(items),
  };
}

export async function submitDamagedGoodsWriteoff(
  payload: SubmitWriteoffPayload
): Promise<SubmitWriteoffResult> {
  const validItems = payload.items.filter(
    (item) => item.product_id && item.quantity > 0
  );

  if (validItems.length === 0) {
    return { success: false, error: "Ən azı bir məhsul əlavə edin" };
  }

  for (const item of validItems) {
    if (!item.issue_description.trim()) {
      return {
        success: false,
        error: `"${item.product_name}" üçün problem təsviri daxil edin`,
      };
    }
  }

  // One database transaction: the document, the stock of the document warehouse and one stock
  // movement per line (post_inventory_writeoff, fix F3). Refused when that warehouse lacks stock.
  const saved = await callWriteoffRpc("post_inventory_writeoff", {
    p_payload: writeoffRpcPayload(payload, validItems),
  });
  if (saved.error || !saved.id) {
    return { success: false, error: saved.error || "Silinmə sənədi yaradılmadı" };
  }

  const writeoffId = saved.id;
  const slipItems: WarehouseSlipItem[] = validItems.map((item) => ({
    product_id: item.product_id,
    product_code: item.product_code,
    product_name: item.product_name,
    quantity: item.quantity,
    unit: item.unit,
    issue_description: item.issue_description,
  }));

  await createWarehouseSlip({
    type: "waste",
    sourceDocumentId: writeoffId,
    sourceDocumentNo: payload.document_number,
    sourceType: "writeoff",
    warehouseId: payload.warehouse_id,
    items: slipItems,
    notes: payload.notes,
  });

  return { success: true, writeoffId };
}

export interface WriteoffRecord {
  id: string;
  document_number: string;
  writeoff_date: string | null;
  warehouse_id: string | null;
  checker_name: string;
  notes: string | null;
  items: DamagedGoodsItem[];
  created_at: string | null;
}

export function parseWriteoffItems(raw: unknown): DamagedGoodsItem[] {
  if (!Array.isArray(raw)) return [];
  return raw as DamagedGoodsItem[];
}

export async function fetchInventoryWriteoffs(): Promise<WriteoffRecord[]> {
  const { data, error } = await supabase
    .from("inventory_writeoffs")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Writeoffs fetch error:", error.message);
    return [];
  }

  return (data || []).map((row) => ({
    id: row.id,
    document_number: row.document_number,
    writeoff_date: row.writeoff_date,
    warehouse_id: row.warehouse_id,
    checker_name: row.checker_name,
    notes: row.notes,
    items: parseWriteoffItems(row.items),
    created_at: row.created_at,
  }));
}

/** The database reads the old lines and warehouse itself, so only the new version is sent. */
export async function updateInventoryWriteoff(
  writeoffId: string,
  payload: SubmitWriteoffPayload
): Promise<SubmitWriteoffResult> {
  const validItems = payload.items.filter(
    (item) => item.product_id && item.quantity > 0
  );

  if (validItems.length === 0) {
    return { success: false, error: "Ən azı bir məhsul tələb olunur" };
  }

  for (const item of validItems) {
    if (!item.issue_description.trim()) {
      return {
        success: false,
        error: `"${item.product_name}" üçün problem təsviri daxil edin`,
      };
    }
  }

  // The old lines go back to the old warehouse and the new ones come out of the new warehouse,
  // in one database transaction (update_inventory_writeoff, fix F3).
  const saved = await callWriteoffRpc("update_inventory_writeoff", {
    p_id: writeoffId,
    p_payload: writeoffRpcPayload(payload, validItems),
  });
  if (saved.error) return { success: false, error: saved.error };

  return { success: true, writeoffId };
}

/**
 * Products that can be written off from a warehouse, with `stock` set to that warehouse's stock
 * (fix F3; it was the product total). Polywood, services and kits are not offered here.
 */
export async function fetchProductsByWarehouse(warehouseId: string): Promise<Product[]> {
  if (!warehouseId) return [];
  const [warehouse, stockRows, products] = await Promise.all([
    supabase.from("warehouses").select("is_default").eq("id", warehouseId).maybeSingle(),
    supabase
      .from("warehouse_stocks" as never)
      .select("product_id, warehouse_id, current_stock")
      .or(`warehouse_id.eq.${warehouseId},warehouse_id.is.null`),
    supabase.from("products").select("*").order("name", { ascending: true }),
  ]);

  if (products.error || stockRows.error) {
    console.error("Products fetch error:", products.error?.message || stockRows.error?.message);
    return [];
  }

  const stock = warehouseStockMap(
    (stockRows.data as unknown as WarehouseStockRow[]) || [],
    warehouseId,
    Boolean((warehouse.data as { is_default?: boolean | null } | null)?.is_default)
  );
  return writeoffCandidates((products.data as Product[]) || [], stock);
}
