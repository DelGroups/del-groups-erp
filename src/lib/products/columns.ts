import type { ProductColumnKey } from "@/types/database.types";

export type { ProductColumnKey };

export interface ProductColumnDef {
  key: ProductColumnKey;
  label: string;
  defaultVisible: boolean;
}

export const PRODUCT_COLUMNS: ProductColumnDef[] = [
  { key: "name", label: "Məhsul adı", defaultVisible: true },
  { key: "code", label: "Məhsul kodu", defaultVisible: true },
  { key: "category", label: "Kateqoriya", defaultVisible: true },
  { key: "subcategory", label: "Alt kateqoriya", defaultVisible: true },
  { key: "buy_price", label: "Alış qiyməti", defaultVisible: true },
  { key: "sell_price", label: "Satış qiyməti", defaultVisible: true },
  { key: "barcode", label: "Barkod", defaultVisible: true },
  { key: "unit", label: "Ölçü vahidi", defaultVisible: true },
  { key: "color", label: "Rəng", defaultVisible: false },
  { key: "weight", label: "Çəki", defaultVisible: false },
  { key: "extra_info", label: "Əlavə məlumat", defaultVisible: false },
];

export const COLUMN_VISIBILITY_STORAGE_KEY = "del-groups-products-columns";

export function getDefaultColumnVisibility(): Record<ProductColumnKey, boolean> {
  return PRODUCT_COLUMNS.reduce(
    (acc, col) => {
      acc[col.key] = col.defaultVisible;
      return acc;
    },
    {} as Record<ProductColumnKey, boolean>
  );
}

export function loadColumnVisibility(): Record<ProductColumnKey, boolean> {
  if (typeof window === "undefined") return getDefaultColumnVisibility();

  try {
    const raw = localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
    if (!raw) return getDefaultColumnVisibility();
    const parsed = JSON.parse(raw) as Partial<Record<ProductColumnKey, boolean>>;
    return { ...getDefaultColumnVisibility(), ...parsed };
  } catch {
    return getDefaultColumnVisibility();
  }
}

export function saveColumnVisibility(visibility: Record<ProductColumnKey, boolean>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(visibility));
}

export function getColumnLabel(key: ProductColumnKey): string {
  return PRODUCT_COLUMNS.find((c) => c.key === key)?.label ?? key;
}
