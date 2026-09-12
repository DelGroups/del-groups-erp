import { DEFAULT_FULL_SHEET_LENGTH_M, POLYWOOD_INVENTORY_MODE } from "@/lib/polywood/constants";
import { addPolywoodStockFromLengths } from "@/lib/polywood/inventory";
import type { Product, PurchaseLineItem } from "@/types/database.types";
import { supabase } from "@/lib/supabase";

export type MetricReceiveMode = "full_bars" | "custom_pieces";

export function isMetricProduct(
  product: Pick<Product, "unit" | "is_dimensional" | "inventory_mode"> | null | undefined
): boolean {
  if (!product) return false;
  const unit = (product.unit || "").trim().toLowerCase();
  return (
    product.is_dimensional === true ||
    product.inventory_mode === POLYWOOD_INVENTORY_MODE ||
    unit === "metr" ||
    unit === "m"
  );
}

export function resolveStandardBarLengthM(
  product: Pick<Product, "full_sheet_length_m" | "base_length"> | null | undefined
): number {
  const fromProduct = Number(product?.full_sheet_length_m ?? product?.base_length);
  return fromProduct > 0 ? fromProduct : DEFAULT_FULL_SHEET_LENGTH_M;
}

export function parseCustomPieceLengths(input: string): number[] {
  return input
    .split(/[,;]+/)
    .map((part) => Math.round((parseFloat(part.trim()) || 0) * 1000) / 1000)
    .filter((length) => length > 0);
}

export function buildMetricLengths(
  mode: MetricReceiveMode,
  fullBarCount: number,
  customInput: string,
  standardLengthM: number
): number[] {
  if (mode === "full_bars") {
    const count = Math.max(0, Math.floor(fullBarCount));
    return Array.from({ length: count }, () => standardLengthM);
  }
  return parseCustomPieceLengths(customInput);
}

export function totalMetricMeters(lengths: number[]): number {
  return Math.round(lengths.reduce((sum, length) => sum + length, 0) * 1000) / 1000;
}

export async function applyMetricStockReceipt(
  productId: string,
  warehouseId: string,
  lengths: number[],
  fullSheetLengthM: number
): Promise<number> {
  if (lengths.length === 0) return 0;
  return addPolywoodStockFromLengths(productId, warehouseId, lengths, fullSheetLengthM);
}

export async function applyMetricPurchaseReceipts(
  items: PurchaseLineItem[],
  warehouseId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const item of items) {
    if (!item.product_id || !item.metric_receive_mode) continue;

    const { data: product, error } = await supabase
      .from("products")
      .select("id, name, unit, is_dimensional, inventory_mode, full_sheet_length_m, base_length")
      .eq("id", item.product_id)
      .maybeSingle();

    if (error) {
      return { ok: false, error: error.message };
    }
    if (!product || !isMetricProduct(product as Product)) continue;

    const standardLengthM = resolveStandardBarLengthM(product as Product);
    const lengths = buildMetricLengths(
      item.metric_receive_mode,
      item.metric_full_bar_count || 0,
      item.metric_custom_lengths || "",
      standardLengthM
    );

    if (lengths.length === 0) {
      return {
        ok: false,
        error: `${item.product_name}: parça uzunluqları təyin olunmayıb`,
      };
    }

    try {
      await applyMetricStockReceipt(item.product_id, warehouseId, lengths, standardLengthM);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Metrik stok qəbulu alınmadı",
      };
    }
  }

  return { ok: true };
}
