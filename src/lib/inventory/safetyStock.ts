export function productMinStock(product: {
  min_stock_level?: number | null;
  min_stock?: number | null;
}): number {
  const level = Number(product.min_stock_level);
  if (Number.isFinite(level) && level > 0) return level;
  return Math.max(0, Number(product.min_stock) || 0);
}

export function isCriticalStock(product: {
  stock?: number | null;
  min_stock_level?: number | null;
  min_stock?: number | null;
  is_service?: boolean | null;
}): boolean {
  if (product.is_service) return false;
  const min = productMinStock(product);
  if (min <= 0) return false;
  return (Number(product.stock) || 0) <= min;
}
