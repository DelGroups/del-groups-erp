import { syncPolywoodProductStockFromPieces } from "@/lib/inventory/polywoodStock";
import { recordStockMovement } from "@/lib/inventory/stockMovements";
import { isFullSheetLength } from "@/lib/polywood/constants";
import { isMetricProduct, resolveStandardBarLengthM } from "@/lib/polywood/metricReceive";
import type { BulkImportStockMode } from "@/lib/products/bulkImportUnits";
import { generatePieceBarcode } from "@/lib/products/generateBarcode";
import type { Product } from "@/types/database.types";

export const BULK_IMPORT_OPENING_REFERENCE_TYPE = "opening_balance";

type AdminClient = ReturnType<
  typeof import("@/lib/supabaseAdmin").createSupabaseAdminClient
>;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

async function insertMetricPieces(
  admin: AdminClient,
  productId: string,
  warehouseId: string,
  pieceLengths: number[],
  fullSheetLengthM: number
): Promise<number> {
  const now = new Date().toISOString();
  const rows = pieceLengths.map((length) => {
    const barcode = generatePieceBarcode();
    return {
      product_id: productId,
      warehouse_id: warehouseId,
      length_m: Math.round(length * 1000) / 1000,
      piece_type: isFullSheetLength(length, fullSheetLengthM) ? "full" : "cut",
      status: "available",
      notes: null,
      sale_item_id: null,
      barcode,
      qr_code: barcode,
      updated_at: now,
    };
  });

  if (rows.length === 0) return 0;
  const { error } = await admin.from("polywood_pieces").insert(rows);
  if (error) throw new Error(error.message);
  return pieceLengths.reduce((sum, length) => sum + length, 0);
}

export async function resolveBulkImportWarehouseId(admin: AdminClient): Promise<string | null> {
  return resolveBulkImportWarehouseByLabel(admin, null);
}

function normalizeWarehouseLabel(value: string): string {
  return value.trim().toLowerCase();
}

/** Match warehouse by name or code; empty label → default / polywood / first warehouse. */
export async function resolveBulkImportWarehouseByLabel(
  admin: AdminClient,
  warehouseLabel: string | null | undefined
): Promise<string | null> {
  const { data, error } = await admin
    .from("warehouses")
    .select("id, name, code, is_default, warehouse_type")
    .order("is_default", { ascending: false })
    .limit(100);

  if (error || !data?.length) return null;

  const label = warehouseLabel?.trim();
  if (label) {
    const normalized = normalizeWarehouseLabel(label);
    const match = data.find(
      (row) =>
        normalizeWarehouseLabel(row.name || "") === normalized ||
        normalizeWarehouseLabel(row.code || "") === normalized
    );
    if (match?.id) return match.id;
  }

  const polywood = data.find((row) => row.warehouse_type === "polywood");
  if (polywood?.id) return polywood.id;
  const defaultWarehouse = data.find((row) => row.is_default);
  return defaultWarehouse?.id ?? data[0]?.id ?? null;
}

export async function applyBulkImportOpeningStock(params: {
  admin: AdminClient;
  productId: string;
  product: Product;
  warehouseId: string;
  mode: BulkImportStockMode;
  initialCount: number;
  meterPieces: number[];
  userId?: string | null;
}): Promise<boolean> {
  const { admin, productId, product, warehouseId, mode, initialCount, meterPieces, userId } =
    params;

  const unitCost = Number(product.buy_price) || 0;
  const referenceId = productId;

  if (mode === "meter" || isMetricProduct(product)) {
    if (meterPieces.length === 0) return false;

    const barLengthM = resolveStandardBarLengthM(product);
    const addedQty = await insertMetricPieces(
      admin,
      productId,
      warehouseId,
      meterPieces,
      barLengthM
    );
    const newStock = await syncPolywoodProductStockFromPieces(admin, productId, warehouseId);

    await admin.from("products").update({ stock: newStock }).eq("id", productId);

    await upsertWarehouseStockRow(admin, {
      productId,
      warehouseId,
      currentStock: newStock,
      pieceLengths: meterPieces,
    });

    await recordStockMovement(admin, {
      productId,
      warehouseId,
      movementType: "in",
      quantity: addedQty,
      unit: "Metr",
      referenceType: BULK_IMPORT_OPENING_REFERENCE_TYPE,
      referenceId,
      description: "İlkin Qalıq — toplu məhsul idxalı",
      createdBy: userId ?? null,
    });

    await admin.rpc("create_inventory_batch", {
      p_product_id: productId,
      p_document_id: productId,
      p_document_type: BULK_IMPORT_OPENING_REFERENCE_TYPE,
      p_unit_cost: unitCost,
      p_quantity: addedQty,
    });

    return true;
  }

  const qty = Math.max(0, Math.floor(initialCount));
  if (qty <= 0) return false;

  const oldStock = Number(product.stock) || 0;
  const newStock = oldStock + qty;

  await admin.from("products").update({ stock: newStock }).eq("id", productId);

  await upsertWarehouseStockRow(admin, {
    productId,
    warehouseId,
    currentStock: newStock,
  });

  await recordStockMovement(admin, {
    productId,
    warehouseId,
    movementType: "in",
    quantity: qty,
    unit: product.unit || "Ədəd",
    referenceType: BULK_IMPORT_OPENING_REFERENCE_TYPE,
    referenceId,
    description: "İlkin Qalıq — toplu məhsul idxalı",
    createdBy: userId ?? null,
  });

  await admin.rpc("create_inventory_batch", {
    p_product_id: productId,
    p_document_id: productId,
    p_document_type: BULK_IMPORT_OPENING_REFERENCE_TYPE,
    p_unit_cost: unitCost,
    p_quantity: qty,
  });

  return true;
}

export function totalMeterStock(pieces: number[]): number {
  return roundMoney(pieces.reduce((sum, length) => sum + length, 0));
}

async function upsertWarehouseStockRow(
  admin: AdminClient,
  params: {
    productId: string;
    warehouseId: string;
    currentStock: number;
    pieceLengths?: number[];
  }
): Promise<void> {
  const { productId, warehouseId, currentStock, pieceLengths } = params;
  const { data: existing } = await admin
    .from("warehouse_stocks")
    .select("id")
    .eq("product_id", productId)
    .eq("warehouse_id", warehouseId)
    .maybeSingle();

  const payload = {
    product_id: productId,
    warehouse_id: warehouseId,
    current_stock: currentStock,
    piece_lengths: pieceLengths ?? null,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { error } = await admin.from("warehouse_stocks").update(payload).eq("id", existing.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await admin.from("warehouse_stocks").insert([payload]);
  if (error) throw new Error(error.message);
}
