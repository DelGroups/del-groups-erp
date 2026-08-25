import type { Product, ProductFilters, Warehouse } from "@/types/database.types";

function includes(value: string | null | undefined, query: string): boolean {
  if (!query.trim()) return true;
  return (value || "").toLowerCase().includes(query.trim().toLowerCase());
}

export function filterProducts(
  products: Product[],
  filters: ProductFilters,
  warehouses: Warehouse[]
): Product[] {
  return products.filter((product) => {
    if (!includes(product.name, filters.name)) return false;
    if (!includes(product.code, filters.code)) return false;
    if (!includes(product.category, filters.category)) return false;
    if (!includes(product.subcategory, filters.subcategory)) return false;
    if (!includes(product.barcode, filters.barcode)) return false;

    // Products are global; warehouse filter applies to document lines, not product rows.

    return true;
  });
}

export function getUniqueCategories(products: Product[]): string[] {
  return [...new Set(products.map((p) => p.category).filter(Boolean))].sort();
}

export function getUniqueSubcategories(products: Product[]): string[] {
  return [...new Set(products.map((p) => p.subcategory || "").filter(Boolean))].sort();
}

export function getWarehouseName(
  warehouses: Warehouse[],
  warehouseId?: string | null
): string {
  if (!warehouseId) return "-";
  return warehouses.find((w) => w.id === warehouseId)?.name || "-";
}
