import { supabase } from "@/lib/supabase";
import {
  DEFAULT_FULL_SHEET_LENGTH_M,
  isFullSheetLength,
  POLYWOOD_INVENTORY_MODE,
  POLYWOOD_WAREHOUSE_TYPE,
} from "@/lib/polywood/constants";
import type {
  PolywoodCutPieceSummary,
  PolywoodInventorySummary,
  PolywoodPiece,
  PolywoodPieceInsert,
} from "@/lib/polywood/types";
import type { Product, Warehouse } from "@/types/database.types";

export function isPolywoodWarehouse(warehouse: Pick<Warehouse, "warehouse_type"> | null | undefined): boolean {
  return warehouse?.warehouse_type === POLYWOOD_WAREHOUSE_TYPE;
}

export function isPolywoodProduct(product: Pick<Product, "inventory_mode"> | null | undefined): boolean {
  return product?.inventory_mode === POLYWOOD_INVENTORY_MODE;
}

export async function fetchPolywoodWarehouse(): Promise<Warehouse | null> {
  const { data, error } = await supabase
    .from("warehouses")
    .select("*")
    .eq("warehouse_type", POLYWOOD_WAREHOUSE_TYPE)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as Warehouse) || null;
}

export async function fetchAvailablePolywoodPieces(
  productId: string,
  warehouseId: string
): Promise<PolywoodPiece[]> {
  const { data, error } = await supabase
    .from("polywood_pieces")
    .select("*")
    .eq("product_id", productId)
    .eq("warehouse_id", warehouseId)
    .eq("status", "available")
    .order("piece_type", { ascending: true })
    .order("length_m", { ascending: true });

  if (error) throw new Error(error.message);
  return (data as PolywoodPiece[]) || [];
}

function summarizeCutPieces(pieces: PolywoodPiece[]): PolywoodCutPieceSummary[] {
  const map = new Map<number, number>();
  for (const piece of pieces) {
    if (piece.piece_type !== "cut") continue;
    const key = Math.round(piece.length_m * 1000) / 1000;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .map(([length_m, count]) => ({ length_m, count }))
    .sort((a, b) => a.length_m - b.length_m);
}

export function buildInventorySummary(
  productId: string,
  warehouseId: string,
  pieces: PolywoodPiece[],
  fullSheetLengthM: number
): PolywoodInventorySummary {
  const fullSheets = pieces.filter(
    (piece) => piece.piece_type === "full" && isFullSheetLength(piece.length_m, fullSheetLengthM)
  );
  const cutPieces = pieces.filter((piece) => piece.piece_type === "cut");
  const totalLength = pieces.reduce((sum, piece) => sum + piece.length_m, 0);

  return {
    product_id: productId,
    warehouse_id: warehouseId,
    total_length_m: Math.round(totalLength * 1000) / 1000,
    full_sheet_count: fullSheets.length,
    full_sheet_length_m: fullSheetLengthM,
    cut_pieces: summarizeCutPieces(cutPieces),
    available_piece_count: pieces.length,
  };
}

export async function fetchPolywoodInventorySummary(
  productId: string,
  warehouseId: string,
  fullSheetLengthM = DEFAULT_FULL_SHEET_LENGTH_M
): Promise<PolywoodInventorySummary> {
  const pieces = await fetchAvailablePolywoodPieces(productId, warehouseId);
  return buildInventorySummary(productId, warehouseId, pieces, fullSheetLengthM);
}

export async function syncPolywoodProductStock(productId: string, warehouseId: string): Promise<void> {
  const summary = await fetchPolywoodInventorySummary(productId, warehouseId);
  await supabase
    .from("products")
    .update({ stock: summary.total_length_m })
    .eq("id", productId);
}

export async function insertPolywoodPieces(rows: PolywoodPieceInsert[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from("polywood_pieces").insert(rows);
  if (error) throw new Error(error.message);
}

export async function addPolywoodStockFromLengths(
  productId: string,
  warehouseId: string,
  lengthsM: number[],
  fullSheetLengthM: number
): Promise<number> {
  const now = new Date().toISOString();
  const rows: PolywoodPieceInsert[] = lengthsM
    .filter((length) => length > 0)
    .map((length) => ({
      product_id: productId,
      warehouse_id: warehouseId,
      length_m: Math.round(length * 1000) / 1000,
      piece_type: isFullSheetLength(length, fullSheetLengthM) ? "full" : "cut",
      status: "available",
      notes: null,
      sale_item_id: null,
      updated_at: now,
    }));

  await insertPolywoodPieces(rows);
  await syncPolywoodProductStock(productId, warehouseId);
  return rows.length;
}

export async function fetchPolywoodProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("inventory_mode", POLYWOOD_INVENTORY_MODE)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data as Product[]) || [];
}

export interface PolywoodProductInventoryRow {
  product: Product;
  summary: PolywoodInventorySummary;
}

export async function fetchAllPolywoodInventory(
  warehouseId: string
): Promise<PolywoodProductInventoryRow[]> {
  const products = await fetchPolywoodProducts();
  const rows: PolywoodProductInventoryRow[] = [];

  for (const product of products) {
    const fullSheetLengthM = Number(product.full_sheet_length_m) || DEFAULT_FULL_SHEET_LENGTH_M;
    const summary = await fetchPolywoodInventorySummary(product.id, warehouseId, fullSheetLengthM);
    rows.push({ product, summary });
  }

  return rows;
}
