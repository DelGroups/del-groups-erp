import { supabase } from "@/lib/supabase";
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

async function fetchProductStock(productId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from("products")
    .select("stock")
    .eq("id", productId)
    .single();

  if (error || !data) return null;
  return Number(data.stock) || 0;
}

export async function decrementProductStock(
  productId: string,
  quantity: number
): Promise<{ ok: boolean; error?: string; previousStock?: number }> {
  const currentStock = await fetchProductStock(productId);
  if (currentStock === null) {
    return { ok: false, error: "Məhsul tapılmadı" };
  }
  if (currentStock < quantity) {
    return {
      ok: false,
      error: `Kifayət qədər stok yoxdur (mövcud: ${currentStock})`,
    };
  }

  const newStock = currentStock - quantity;
  const { error } = await supabase
    .from("products")
    .update({ stock: newStock })
    .eq("id", productId);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, previousStock: currentStock };
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
    const stockResult = await decrementProductStock(item.product_id, item.quantity);
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

async function incrementProductStock(
  productId: string,
  quantity: number
): Promise<{ ok: boolean; error?: string }> {
  const currentStock = await fetchProductStock(productId);
  if (currentStock === null) return { ok: false, error: "Məhsul tapılmadı" };
  const { error } = await supabase
    .from("products")
    .update({ stock: currentStock + quantity })
    .eq("id", productId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
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

  const restored: { productId: string; quantity: number }[] = [];

  for (const item of previousItems) {
    if (!item.product_id || item.quantity <= 0) continue;
    const result = await incrementProductStock(item.product_id, item.quantity);
    if (!result.ok) {
      for (const rb of restored.reverse()) {
        await decrementProductStock(rb.productId, rb.quantity);
      }
      return { success: false, error: `${item.product_name}: ${result.error}` };
    }
    restored.push({ productId: item.product_id, quantity: item.quantity });
  }

  const applied: { productId: string; previousStock: number }[] = [];

  for (const item of validItems) {
    const stockResult = await decrementProductStock(item.product_id, item.quantity);
    if (!stockResult.ok) {
      for (const rb of applied.reverse()) {
        await restoreProductStock(rb.productId, rb.previousStock);
      }
      for (const prev of previousItems) {
        if (!prev.product_id || prev.quantity <= 0) continue;
        await decrementProductStock(prev.product_id, prev.quantity);
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
    for (const rb of applied.reverse()) {
      await restoreProductStock(rb.productId, rb.previousStock);
    }
    for (const prev of previousItems) {
      if (!prev.product_id || prev.quantity <= 0) continue;
      await decrementProductStock(prev.product_id, prev.quantity);
    }
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
