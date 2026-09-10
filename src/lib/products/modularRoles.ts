import { productCode } from "@/lib/products/productOptionLabel";
import type { Product } from "@/types/database.types";

export type CompositeBomIndexEntry = {
  productId: string;
  componentIds: string[];
};

const SEAT_HINTS = [
  "oturacaq",
  "üz",
  "uz",
  "seat",
  "otur",
  "stul",
  "chair",
  "arne",
  "aren",
];
const BASE_HINTS = [
  "ayaq",
  "base",
  "leg",
  "təkər",
  "tekər",
  "teker",
  "eiffel",
  "spider",
  "chrome",
];

function productHaystack(product: Product): string {
  return `${product.category || ""} ${product.subcategory || ""} ${product.name || ""}`.toLowerCase();
}

export function isConfiguratorComponent(product: Product): boolean {
  return !product.is_composite && !product.is_service;
}

export function isModularSeatProduct(product: Product): boolean {
  const text = productHaystack(product);
  return SEAT_HINTS.some((hint) => text.includes(hint));
}

export function isModularBaseProduct(product: Product): boolean {
  const text = productHaystack(product);
  return BASE_HINTS.some((hint) => text.includes(hint));
}

/** Non-composite, non-service products eligible for kit configurator. */
export function listConfiguratorComponents(products: Product[]): Product[] {
  return products
    .filter(isConfiguratorComponent)
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "az"));
}

/** Seat/top options — category hints first, all components as fallback. */
export function listSeatConfiguratorOptions(products: Product[]): Product[] {
  const all = listConfiguratorComponents(products);
  const matched = all.filter(isModularSeatProduct);
  return matched.length > 0 ? matched : all;
}

/** Base/leg options — category hints first, all components as fallback. */
export function listBaseConfiguratorOptions(products: Product[]): Product[] {
  const all = listConfiguratorComponents(products);
  const matched = all.filter(isModularBaseProduct);
  return matched.length > 0 ? matched : all;
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

function componentSellPrice(product: Product): number {
  return Number(product.sell_price ?? product.sale_price ?? product.price) || 0;
}

/** Preview kit when no persisted composite exists yet. */
export function buildConfiguratorKitPreview(
  seat: Product,
  base: Product,
  seatStock: number,
  baseStock: number
): Product {
  const stock = computeConfiguratorStock(seatStock, baseStock);
  const seatCode = productCode(seat);
  const baseCode = productCode(base);

  return {
    ...seat,
    id: `virtual:${seat.id}:${base.id}`,
    name: `${seat.name || seatCode} ${base.name || baseCode}`.trim(),
    code: seatCode && baseCode ? `${seatCode}-${baseCode}` : seatCode || baseCode || undefined,
    sell_price: componentSellPrice(seat) + componentSellPrice(base),
    buy_price: (Number(seat.buy_price) || 0) + (Number(base.buy_price) || 0),
    stock,
    is_composite: true,
    unit: seat.unit || base.unit || "Ədəd",
  };
}
