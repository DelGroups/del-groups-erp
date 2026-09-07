import type { Category, Product } from "@/types/database.types";

export const SERVICE_CATEGORY_KEYS = new Set([
  "services",
  "service",
  "xidmət",
  "xidmet",
]);

export function normalizeCategoryName(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

export function matchesServiceCategoryName(value: string | null | undefined): boolean {
  return SERVICE_CATEGORY_KEYS.has(normalizeCategoryName(value));
}

export function isServiceProduct(
  product: Pick<Product, "category" | "subcategory" | "category_id" | "is_service">,
  categoryById: Map<string, Category> = new Map()
): boolean {
  if (product.is_service) return true;

  if (
    matchesServiceCategoryName(product.category) ||
    matchesServiceCategoryName(product.subcategory)
  ) {
    return true;
  }

  if (!product.category_id) return false;

  const category = categoryById.get(product.category_id);
  if (!category) return false;
  if (matchesServiceCategoryName(category.name)) return true;

  if (category.parent_id) {
    const parent = categoryById.get(category.parent_id);
    return parent ? matchesServiceCategoryName(parent.name) : false;
  }

  return false;
}

export function resolveServicesCategoryId(categories: Category[]): string | null {
  const match = categories.find(
    (category) => !category.parent_id && matchesServiceCategoryName(category.name)
  );
  return match?.id || null;
}
