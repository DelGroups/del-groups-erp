import type { Product } from "@/types/database.types";

export type CompositeBomIndexEntry = {
  productId: string;
  componentIds: string[];
};

const SEAT_HINTS = ["oturacaq", "üz", "seat", "otur"];
const BASE_HINTS = ["ayaq", "base", "leg", "təkər", "tekər"];

function productHaystack(product: Product): string {
  return `${product.category || ""} ${product.subcategory || ""} ${product.name || ""}`.toLowerCase();
}

export function isModularSeatProduct(product: Product): boolean {
  const text = productHaystack(product);
  return SEAT_HINTS.some((hint) => text.includes(hint));
}

export function isModularBaseProduct(product: Product): boolean {
  const text = productHaystack(product);
  return BASE_HINTS.some((hint) => text.includes(hint));
}

export function findCompositeByComponents(
  index: CompositeBomIndexEntry[],
  products: Product[],
  seatId: string,
  baseId: string
): Product | null {
  const wanted = new Set([seatId, baseId]);
  const match = index.find((entry) => {
    if (entry.componentIds.length !== wanted.size) return false;
    return entry.componentIds.every((id) => wanted.has(id));
  });
  if (!match) return null;
  return products.find((p) => p.id === match.productId) || null;
}

export function computeConfiguratorStock(seatStock: number, baseStock: number): number {
  return Math.max(0, Math.min(Math.floor(seatStock), Math.floor(baseStock)));
}
