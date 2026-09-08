import type { ProductionMaterial } from "@/lib/production/types";

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function sumOrderAllocatedQuantity(
  materials: ProductionMaterial[],
  productId: string,
  warehouseId: string | null,
  excludeMaterialId?: string
): number {
  return materials.reduce((sum, material) => {
    if (material.id === excludeMaterialId) return sum;
    if (material.product_id !== productId) return sum;
    if ((material.warehouse_id || null) !== (warehouseId || null)) return sum;
    return sum + num(material.quantity);
  }, 0);
}

export function netAvailableWarehouseStock(
  warehouseStock: number,
  orderAllocated: number
): number {
  return Math.max(0, num(warehouseStock) - num(orderAllocated));
}

export function computeMaterialAllocation(
  requestedQty: number,
  warehouseStock: number,
  orderAllocated: number
): {
  available: number;
  issueQty: number;
  deficit: number;
} {
  const available = netAvailableWarehouseStock(warehouseStock, orderAllocated);
  const issueQty = Math.min(num(requestedQty), available);
  const deficit = Math.max(0, num(requestedQty) - available);
  return { available, issueQty, deficit };
}

export function adjustWarehouseProductsForOrderAllocations<
  T extends { product_id: string; stock: number }
>(products: T[], materials: ProductionMaterial[], warehouseId: string): T[] {
  const allocatedByProduct = new Map<string, number>();
  for (const material of materials) {
    if (!material.product_id) continue;
    if ((material.warehouse_id || null) !== warehouseId) continue;
    allocatedByProduct.set(
      material.product_id,
      (allocatedByProduct.get(material.product_id) || 0) + num(material.quantity)
    );
  }

  return products.map((product) => ({
    ...product,
    stock: Math.max(
      0,
      Math.round((num(product.stock) - (allocatedByProduct.get(product.product_id) || 0)) * 100) / 100
    ),
  }));
}
