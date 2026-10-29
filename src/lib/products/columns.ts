import type { ProductColumnKey } from "@/types/database.types";
import { PRODUCT_SLUG } from "@/lib/brand";
import { defaultColumnPrefs, mergeColumnPrefs, type ListColumnDef } from "@/lib/lists/columns";

export type { ProductColumnKey };

/** The shared column model (prompt 24c) with the products page's own literal labels. */
export interface ProductColumnDef extends Omit<ListColumnDef, "key" | "labelKey"> {
  key: ProductColumnKey;
  label: string;
}

export const PRODUCT_COLUMNS: ProductColumnDef[] = [
  { key: "name", label: "Məhsul adı", defaultVisible: true },
  { key: "code", label: "Məhsul kodu", defaultVisible: true },
  { key: "category", label: "Kateqoriya", defaultVisible: true },
  { key: "subcategory", label: "Alt kateqoriya", defaultVisible: true },
  { key: "buy_price", label: "Alış qiyməti", defaultVisible: true },
  { key: "sell_price", label: "Satış qiyməti", defaultVisible: true },
  { key: "barcode", label: "Barkod", defaultVisible: true },
  { key: "brand", label: "Brend", defaultVisible: true },
  { key: "country", label: "Ölkə", defaultVisible: true },
  { key: "unit", label: "Ölçü vahidi", defaultVisible: true },
  { key: "extra_info", label: "Əlavə məlumat", defaultVisible: false },
];

export const COLUMN_VISIBILITY_STORAGE_KEY = `${PRODUCT_SLUG}-products-columns`;

function toVisibility(visible: readonly string[]): Record<ProductColumnKey, boolean> {
  const shown = new Set(visible);
  return PRODUCT_COLUMNS.reduce(
    (acc, col) => {
      acc[col.key] = shown.has(col.key);
      return acc;
    },
    {} as Record<ProductColumnKey, boolean>
  );
}

export function getDefaultColumnVisibility(): Record<ProductColumnKey, boolean> {
  return toVisibility(defaultColumnPrefs(PRODUCT_COLUMNS).visible);
}

export function loadColumnVisibility(): Record<ProductColumnKey, boolean> {
  if (typeof window === "undefined") return getDefaultColumnVisibility();

  try {
    const raw = localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
    if (!raw) return getDefaultColumnVisibility();
    // The page stores { key: shown }; keys it does not mention keep their default.
    const parsed = JSON.parse(raw) as Partial<Record<ProductColumnKey, boolean>>;
    const visible = PRODUCT_COLUMNS.filter((c) => parsed?.[c.key] ?? c.defaultVisible).map((c) => c.key);
    return toVisibility(mergeColumnPrefs(PRODUCT_COLUMNS, { visible, order: PRODUCT_COLUMNS.map((c) => c.key) }).visible);
  } catch {
    return getDefaultColumnVisibility();
  }
}

export function saveColumnVisibility(visibility: Record<ProductColumnKey, boolean>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(visibility));
  } catch {
    // Private mode: the choice lasts until the page is left.
  }
}

export function getColumnLabel(key: ProductColumnKey): string {
  return PRODUCT_COLUMNS.find((c) => c.key === key)?.label ?? key;
}
