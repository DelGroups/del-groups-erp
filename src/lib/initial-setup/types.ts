export type ProductImportFieldKey =
  | "barcode"
  | "sku"
  | "name"
  | "brand"
  | "category"
  | "subcategory"
  | "unit"
  | "buyPrice"
  | "wholesalePrice"
  | "retailPrice"
  | "vatRate"
  | "initialStock"
  | "minStock"
  | "warehouseLocation"
  | "supplierName";

/** Fixed column order for positional CSV fallback (15 columns) */
export const PRODUCT_IMPORT_COLUMN_KEYS: ProductImportFieldKey[] = [
  "barcode",
  "sku",
  "name",
  "brand",
  "category",
  "subcategory",
  "unit",
  "buyPrice",
  "wholesalePrice",
  "retailPrice",
  "vatRate",
  "initialStock",
  "minStock",
  "warehouseLocation",
  "supplierName",
];

export interface ProductImportRow {
  barcode: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  subcategory: string;
  unit: string;
  buyPrice: number;
  wholesalePrice: number;
  retailPrice: number;
  vatRate: number;
  initialStock: number;
  minStock: number;
  warehouseLocation: string;
  supplierName: string;
}

export interface ProductImportValidationError {
  row: number;
  message: string;
}

export interface InitialAccountBalance {
  accountId: string;
  name: string;
  type: "Kassa" | "Bank";
  balance: number;
}

export interface InitialSetupAccountInput {
  name: string;
  type: "Kassa" | "Bank";
  balance: number;
  code?: string;
}

export function createEmptyProductImportRow(): ProductImportRow {
  return {
    barcode: "",
    sku: "",
    name: "",
    brand: "",
    category: "Ümumi",
    subcategory: "",
    unit: "Ədəd",
    buyPrice: 0,
    wholesalePrice: 0,
    retailPrice: 0,
    vatRate: 0,
    initialStock: 0,
    minStock: 0,
    warehouseLocation: "",
    supplierName: "",
  };
}

export function buildProductImportExtraInfo(row: ProductImportRow): string | null {
  const meta: Record<string, string | number> = {};
  if (row.brand) meta.brand = row.brand;
  if (row.wholesalePrice > 0) meta.wholesale_price = row.wholesalePrice;
  if (row.vatRate > 0) meta.vat_rate = row.vatRate;
  if (row.warehouseLocation) meta.warehouse_location = row.warehouseLocation;
  if (row.supplierName) meta.supplier_name = row.supplierName;
  return Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;
}
