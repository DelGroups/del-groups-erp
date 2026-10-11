import { isValidUuid } from "@/lib/auth/validate";

export type MaterialLineSelection = {
  productId: string;
  warehouseId: string;
  unitPrice: number;
  realStock: number;
  unitCost: number;
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
  realStock?: number;
  unitCost?: number;
  stock_quantity?: number;
  stock: number;
  unit: string;
};

export function resolveProductUnitCost(
  product: Pick<WarehouseProductCatalogRow, "buy_price" | "cost_price" | "unitCost">
): number {
  const explicit = Number(product.unitCost);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const cost = product.cost_price ?? product.buy_price;
  return Number(cost) || 0;
}

export function resolveProductRealStock(
  product: Pick<WarehouseProductCatalogRow, "realStock" | "stock"> & {
    stock_quantity?: number;
  }
): number {
  const fromQuantity = Number(product.stock_quantity);
  if (Number.isFinite(fromQuantity)) return Math.max(0, fromQuantity);
  const explicit = Number(product.realStock);
  if (Number.isFinite(explicit)) return Math.max(0, explicit);
  return Math.max(0, Number(product.stock) || 0);
}

export function encodeMaterialLineSelection(selection: MaterialLineSelection): string {
  return JSON.stringify(selection);
}

export function buildMaterialLineSelection(
  product: WarehouseProductCatalogRow,
  warehouseId: string
): MaterialLineSelection {
  const productId = product.product_id || product.id || "";
  const unitCost = resolveProductUnitCost(product);
  const realStock = resolveProductRealStock(product);
  return {
    productId,
    warehouseId,
    unitPrice: unitCost,
    unitCost,
    realStock,
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
      const unitCost = Number(parsed.unitCost ?? parsed.unitPrice) || 0;
      const realStock = Number(parsed.realStock);
      const catalogRow = catalog.find((item) => item.product_id === productId || item.id === productId);
      return {
        productId,
        warehouseId: resolvedWarehouseId,
        unitPrice: unitCost,
        unitCost: unitCost > 0 ? unitCost : resolveProductUnitCost(catalogRow || { buy_price: 0, stock: 0, unit: "" }),
        realStock: Number.isFinite(realStock)
          ? Math.max(0, realStock)
          : catalogRow
            ? resolveProductRealStock(catalogRow)
            : 0,
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
