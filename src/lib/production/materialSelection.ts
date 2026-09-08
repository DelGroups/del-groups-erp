import { isValidUuid } from "@/lib/auth/validate";

export type MaterialLineSelection = {
  productId: string;
  warehouseId: string;
  unitPrice: number;
  productName?: string;
  productCode?: string | null;
  unit?: string;
};

export type WarehouseProductCatalogRow = {
  product_id: string;
  id?: string;
  name: string;
  code?: string | null;
  buy_price: number;
  cost_price?: number | null;
  unit: string;
};

export function resolveProductUnitCost(
  product: Pick<WarehouseProductCatalogRow, "buy_price" | "cost_price">
): number {
  const cost = product.cost_price ?? product.buy_price;
  return Number(cost) || 0;
}

export function encodeMaterialLineSelection(selection: MaterialLineSelection): string {
  return JSON.stringify(selection);
}

export function buildMaterialLineSelection(
  product: WarehouseProductCatalogRow,
  warehouseId: string
): MaterialLineSelection {
  const productId = product.product_id || product.id || "";
  return {
    productId,
    warehouseId,
    unitPrice: resolveProductUnitCost(product),
    productName: product.name,
    productCode: product.code ?? null,
    unit: product.unit,
  };
}

export function decodeMaterialLineSelection(
  value: string,
  warehouseId: string,
  catalog: WarehouseProductCatalogRow[] = []
): MaterialLineSelection | null {
  if (!value.trim()) return null;

  try {
    const parsed = JSON.parse(value) as Partial<MaterialLineSelection>;
    const productId = String(parsed.productId || "").trim();
    const resolvedWarehouseId = String(parsed.warehouseId || warehouseId || "").trim();
    if (isValidUuid(productId) && isValidUuid(resolvedWarehouseId)) {
      return {
        productId,
        warehouseId: resolvedWarehouseId,
        unitPrice: Number(parsed.unitPrice) || 0,
        productName: parsed.productName,
        productCode: parsed.productCode ?? null,
        unit: parsed.unit,
      };
    }
  } catch {
    // Fall through to legacy UUID-only option values.
  }

  if (isValidUuid(value)) {
    const row = catalog.find((item) => item.product_id === value || item.id === value);
    if (row && isValidUuid(warehouseId)) {
      return buildMaterialLineSelection(row, warehouseId);
    }
  }

  return null;
}

export function formatMaterialPayloadDebug(
  selection: Partial<MaterialLineSelection> | null | undefined
): string {
  const productId = selection?.productId?.trim() || "null";
  const warehouseId = selection?.warehouseId?.trim() || "null";
  return [
    `Product ID: ${productId}`,
    isValidUuid(productId) ? "valid UUID" : "invalid UUID",
    `Warehouse: ${warehouseId}`,
    isValidUuid(warehouseId) ? "valid UUID" : "invalid UUID",
  ].join(" | ");
}
