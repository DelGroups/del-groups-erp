import { supabase } from "@/lib/supabase";
import {
  applyWriteoffStockDeltas,
  decrementProductStock,
} from "@/lib/inventory/stockAdjustment";
import type {
  DamagedGoodsItem,
  InventoryWriteoffInsert,
  Product,
  WarehouseSlipItem,
} from "@/types/database.types";
import { toDamagedGoodsItemsJson } from "@/types/database.types";
import { createWarehouseSlip } from "@/lib/warehouse/warehouseSlips";

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

async function restoreProductStock(productId: string, previousStock: number): Promise<void> {
  await supabase.from("products").update({ stock: previousStock }).eq("id", productId);
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

  const applied: { productId: string; previousStock: number }[] = [];

  for (const item of validItems) {
    const stockResult = await decrementProductStock(supabase, item.product_id, item.quantity);
    if (!stockResult.ok) {
      for (const rollback of applied.reverse()) {
        await restoreProductStock(rollback.productId, rollback.previousStock);
      }
      return {
        success: false,
        error: `${item.product_name}: ${stockResult.error}`,
      };
    }
    applied.push({
      productId: item.product_id,
      previousStock: stockResult.previousStock!,
    });
  }

  const insertPayload: InventoryWriteoffInsert = {
    document_number: payload.document_number,
    writeoff_date: payload.writeoff_date,
    warehouse_id: payload.warehouse_id || null,
    checker_name: payload.checker_name.trim(),
    items: toDamagedGoodsItemsJson(validItems),
    notes: payload.notes?.trim() || null,
  };

  const { data, error } = await supabase
    .from("inventory_writeoffs")
    .insert([insertPayload])
    .select("id")
    .single();

  if (error) {
    for (const rollback of applied.reverse()) {
      await restoreProductStock(rollback.productId, rollback.previousStock);
    }
    return { success: false, error: error.message };
  }

  const writeoffId = data?.id as string;
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

export async function updateInventoryWriteoff(
  writeoffId: string,
  payload: SubmitWriteoffPayload,
  previousItems: DamagedGoodsItem[]
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

  const toStockLines = (items: DamagedGoodsItem[]) =>
    items
      .filter((item) => item.product_id && item.quantity > 0)
      .map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
      }));

  const stockResult = await applyWriteoffStockDeltas(
    supabase,
    toStockLines(previousItems),
    toStockLines(validItems)
  );

  if (!stockResult.ok) {
    return { success: false, error: stockResult.error };
  }

  const { error } = await supabase
    .from("inventory_writeoffs")
    .update({
      writeoff_date: payload.writeoff_date,
      warehouse_id: payload.warehouse_id || null,
      checker_name: payload.checker_name.trim(),
      items: toDamagedGoodsItemsJson(validItems),
      notes: payload.notes?.trim() || null,
    })
    .eq("id", writeoffId);

  if (error) {
    await applyWriteoffStockDeltas(supabase, toStockLines(validItems), toStockLines(previousItems));
    return { success: false, error: error.message };
  }

  return { success: true, writeoffId };
}

export async function fetchProductsByWarehouse(warehouseId: string): Promise<Product[]> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    console.error("Products fetch error:", error.message);
    return [];
  }

  const products = (data as Product[]) || [];
  if (!warehouseId) return products;

  return products.filter(
    (p) => !p.warehouse_id || p.warehouse_id === warehouseId
  );
}
