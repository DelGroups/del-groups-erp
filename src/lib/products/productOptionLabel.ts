import type { PolywoodInventorySummary } from "@/lib/polywood/types";
import type { Product } from "@/types/database.types";

export type ProductStockHint = {
  sheetCount?: number;
  totalMeters?: number;
};

export function productCode(product: Product): string {
  return (product.code || product.sku || "").trim();
}

export function formatProductDropdownLabel(
  product: Product,
  t: (key: string, params?: Record<string, string | number>) => string,
  stockHint?: ProductStockHint,
  stockOverride?: number
): string {
  const code = productCode(product) || "-";
  const name = product.name || "-";

  if (
    product.is_dimensional &&
    stockHint?.sheetCount != null &&
    stockHint?.totalMeters != null
  ) {
    return `${code} - ${name} (${t("products.stockDropdownDimensional", {
      sheets: stockHint.sheetCount,
      meters: stockHint.totalMeters.toFixed(1),
      unit: product.unit || t("polywood.unit.qty"),
    })})`;
  }

  const stock =
    stockOverride != null && Number.isFinite(stockOverride)
      ? stockOverride
      : Number(product.stock) || 0;
  const unit = product.unit || "Ədəd";
  return `${code} - ${name} (${t("products.stockDropdown", { stock, unit })})`;
}

export function stockHintFromPolywoodSummary(
  summary: PolywoodInventorySummary
): ProductStockHint {
  return {
    sheetCount: summary.full_sheet_count,
    totalMeters: summary.total_length_m,
  };
}
