/**
 * Stock transfers: types and the browser-side helpers of the new-transfer screen.
 * Server code (writing the transfer) is in ./stockTransferServer.ts; the source-stock
 * lookup needs the service role and runs as a server action (../actions/stockTransfer.ts).
 */
import { supabase } from "@/lib/supabase";
import type { Product, Warehouse } from "@/types/database.types";
import { fetchTransferSourceStock } from "../actions/stockTransfer";

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
