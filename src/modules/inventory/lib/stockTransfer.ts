import { recordStockMovement } from "@/lib/inventory/stockMovements";
import {
  adjustProductStockAtWarehouse,
  getProductStockAtWarehouse,
} from "@/lib/inventory/warehouseProductStock";
import { supabase } from "@/lib/supabase";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import type { Product, Warehouse } from "@/types/database.types";
import { generateStockTransferDocumentNumber } from "@/types/database.types";

export const STOCK_TRANSFER_OUT_REF = "TRANSFER_OUT";
export const STOCK_TRANSFER_IN_REF = "TRANSFER_IN";

export interface StockTransferLineInput {
  id: string;
  product_id: string;
  product_code: string;
  product_name: string;
  unit: string;
  barcode?: string | null;
  offcut_id?: string | null;
  quantity: number;
  available_stock: number;
}

export interface SubmitStockTransferPayload {
  reference_number?: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  transfer_date: string;
  notes?: string;
  items: StockTransferLineInput[];
  created_by?: string | null;
}

export interface StockTransferPrintLine {
  product_code: string;
  product_name: string;
  barcode?: string | null;
  unit: string;
  quantity: number;
}

export interface StockTransferPrintData {
  reference_number: string;
  transfer_date: string;
  from_warehouse_name: string;
  to_warehouse_name: string;
  notes?: string | null;
  items: StockTransferPrintLine[];
}

export interface SubmitStockTransferResult {
  success: boolean;
  error?: string;
  transferId?: string;
  print?: StockTransferPrintData;
}

export async function fetchTransferSourceStock(
  productId: string,
  warehouseId: string
): Promise<number> {
  const admin = createSupabaseAdminClient();
  return getProductStockAtWarehouse(admin, productId, warehouseId);
}

export async function resolveTransferBarcode(
  barcode: string,
  sourceWarehouseId: string
): Promise<{
  ok: boolean;
  error?: string;
  line?: Omit<StockTransferLineInput, "id" | "quantity"> & { quantity?: number };
}> {
  const trimmed = barcode.trim();
  if (!trimmed) return { ok: false, error: "Barkod boşdur" };

  const { data: piece } = await supabase
    .from("polywood_pieces")
    .select("id, product_id, warehouse_id, length_m, barcode, status")
    .eq("barcode", trimmed)
    .eq("status", "available")
    .maybeSingle();

  if (piece?.product_id) {
    if (piece.warehouse_id && piece.warehouse_id !== sourceWarehouseId) {
      return { ok: false, error: "Hissə seçilmiş çıxış anbarında deyil" };
    }
    const { data: product } = await supabase
      .from("products")
      .select("id, code, name, unit, barcode")
      .eq("id", piece.product_id)
      .maybeSingle();
    if (!product) return { ok: false, error: "Məhsul tapılmadı" };

    return {
      ok: true,
      line: {
        product_id: product.id,
        product_code: product.code || "",
        product_name: product.name,
        unit: product.unit || "Metr",
        barcode: piece.barcode || product.barcode,
        offcut_id: piece.id,
        available_stock: Number(piece.length_m) || 1,
        quantity: Number(piece.length_m) || 1,
      },
    };
  }

  const { data: product } = await supabase
    .from("products")
    .select("id, code, name, unit, barcode, is_service")
    .eq("barcode", trimmed)
    .maybeSingle();

  if (!product || product.is_service) {
    return { ok: false, error: "Məhsul tapılmadı" };
  }

  const available = await fetchTransferSourceStock(product.id, sourceWarehouseId);

  return {
    ok: true,
    line: {
      product_id: product.id,
      product_code: product.code || "",
      product_name: product.name,
      unit: product.unit || "Ədəd",
      barcode: product.barcode,
      offcut_id: null,
      available_stock: available,
      quantity: 1,
    },
  };
}

export async function submitStockTransfer(
  payload: SubmitStockTransferPayload
): Promise<SubmitStockTransferResult> {
  if (!payload.from_warehouse_id || !payload.to_warehouse_id) {
    return { success: false, error: "Anbarları seçin" };
  }
  if (payload.from_warehouse_id === payload.to_warehouse_id) {
    return { success: false, error: "Çıxış və giriş anbarı eyni ola bilməz" };
  }

  const lines = payload.items.filter((row) => row.product_id && row.quantity > 0);
  if (lines.length === 0) {
    return { success: false, error: "Ən azı bir sətir əlavə edin" };
  }

  for (const line of lines) {
    if (line.quantity > line.available_stock) {
      return {
        success: false,
        error: `${line.product_name}: transfer miqdarı mövcud qalıqdan çoxdur`,
      };
    }
  }

  const admin = createSupabaseAdminClient();
  const referenceNumber = payload.reference_number?.trim() || generateStockTransferDocumentNumber();

  const { data: header, error: headerError } = await admin
    .from("stock_transfers")
    .insert([
      {
        reference_number: referenceNumber,
        from_warehouse_id: payload.from_warehouse_id,
        to_warehouse_id: payload.to_warehouse_id,
        transfer_date: payload.transfer_date,
        status: "completed",
        notes: payload.notes?.trim() || null,
        created_by: payload.created_by ?? null,
      },
    ])
    .select("id")
    .single();

  if (headerError || !header?.id) {
    return { success: false, error: headerError?.message || "Transfer sənədi yaradılmadı" };
  }

  const transferId = header.id as string;

  try {
    for (const line of lines) {
      const { error: itemError } = await admin.from("stock_transfer_items").insert([
        {
          transfer_id: transferId,
          product_id: line.product_id,
          offcut_id: line.offcut_id || null,
          quantity: line.quantity,
          product_code: line.product_code,
          product_name: line.product_name,
          unit: line.unit,
          barcode: line.barcode || null,
        },
      ]);
      if (itemError) throw new Error(itemError.message);

      if (line.offcut_id) {
        const { error: pieceError } = await admin
          .from("polywood_pieces")
          .update({ warehouse_id: payload.to_warehouse_id })
          .eq("id", line.offcut_id);
        if (pieceError) throw new Error(pieceError.message);
      } else {
        await adjustProductStockAtWarehouse(
          admin,
          line.product_id,
          payload.from_warehouse_id,
          -line.quantity
        );
        await adjustProductStockAtWarehouse(
          admin,
          line.product_id,
          payload.to_warehouse_id,
          line.quantity
        );
      }

      const { data: productRow } = await admin
        .from("products")
        .select("unit")
        .eq("id", line.product_id)
        .maybeSingle();

      await recordStockMovement(admin, {
        productId: line.product_id,
        warehouseId: payload.from_warehouse_id,
        movementType: "out",
        quantity: line.quantity,
        unit: productRow?.unit || line.unit,
        referenceType: STOCK_TRANSFER_OUT_REF,
        referenceId: transferId,
        description: `Anbarlar arası transfer — ${referenceNumber}`,
        createdBy: payload.created_by ?? null,
      });

      await recordStockMovement(admin, {
        productId: line.product_id,
        warehouseId: payload.to_warehouse_id,
        movementType: "in",
        quantity: line.quantity,
        unit: productRow?.unit || line.unit,
        referenceType: STOCK_TRANSFER_IN_REF,
        referenceId: transferId,
        description: `Anbarlar arası transfer — ${referenceNumber}`,
        createdBy: payload.created_by ?? null,
      });
    }
  } catch (error) {
    await admin.from("stock_transfers").delete().eq("id", transferId);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Transfer tamamlanmadı",
    };
  }

  const [{ data: fromWh }, { data: toWh }] = await Promise.all([
    admin.from("warehouses").select("name").eq("id", payload.from_warehouse_id).maybeSingle(),
    admin.from("warehouses").select("name").eq("id", payload.to_warehouse_id).maybeSingle(),
  ]);

  return {
    success: true,
    transferId,
    print: {
      reference_number: referenceNumber,
      transfer_date: payload.transfer_date,
      from_warehouse_name: fromWh?.name || "—",
      to_warehouse_name: toWh?.name || "—",
      notes: payload.notes,
      items: lines.map((line) => ({
        product_code: line.product_code,
        product_name: line.product_name,
        barcode: line.barcode,
        unit: line.unit,
        quantity: line.quantity,
      })),
    },
  };
}

export async function loadWarehousesForTransfer(): Promise<Warehouse[]> {
  const { data, error } = await supabase.from("warehouses").select("*").order("name");
  if (error) {
    console.error(error.message);
    return [];
  }
  return (data as Warehouse[]) || [];
}

export async function searchProductsInWarehouse(
  warehouseId: string,
  query: string
): Promise<Product[]> {
  if (!warehouseId) return [];

  const { data: stockRows, error: stockError } = await supabase
    .from("warehouse_stocks")
    .select("product_id, current_stock")
    .eq("warehouse_id", warehouseId)
    .gt("current_stock", 0);

  if (stockError || !stockRows?.length) return [];

  const stockMap = new Map(
    stockRows.map((row) => [row.product_id as string, Number(row.current_stock) || 0])
  );
  const productIds = [...stockMap.keys()];
  if (productIds.length === 0) return [];

  const { data: products, error } = await supabase
    .from("products")
    .select("*")
    .in("id", productIds);

  if (error || !products) return [];

  const q = query.trim().toLowerCase();
  return (products as Product[])
    .filter((p) => !p.is_service)
    .filter((p) =>
      !q
        ? true
        : p.name.toLowerCase().includes(q) ||
          (p.code || "").toLowerCase().includes(q) ||
          (p.barcode || "").toLowerCase().includes(q)
    )
    .map((p) => ({ ...p, stock: stockMap.get(p.id) ?? 0 }))
    .slice(0, 40);
}
