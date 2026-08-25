import { rowsToCsv } from "@/lib/csv/csvUtils";
import {
  createEmptyProductImportRow,
  PRODUCT_IMPORT_COLUMN_KEYS,
  type ProductImportFieldKey,
  type ProductImportRow,
  type ProductImportValidationError,
} from "@/lib/initial-setup/types";

const HEADER_ALIASES: Record<string, ProductImportFieldKey> = {
  "barkod (ean/upc)": "barcode",
  "barcode (ean/upc)": "barcode",
  barkod: "barcode",
  barcode: "barcode",
  ean: "barcode",
  upc: "barcode",

  "məhsul kodu (sku)": "sku",
  "product code (sku)": "sku",
  sku: "sku",
  kod: "sku",
  code: "sku",

  "məhsul adı": "name",
  "product name": "name",
  ad: "name",
  name: "name",

  brend: "brand",
  brand: "brand",

  "ana kateqoriya": "category",
  category: "category",
  kateqoriya: "category",
  "main category": "category",

  "alt kateqoriya": "subcategory",
  subcategory: "subcategory",
  "sub category": "subcategory",

  "ölçü vahidi": "unit",
  unit: "unit",
  vahid: "unit",
  "unit of measure": "unit",

  "alış qiyməti (azn)": "buyPrice",
  "buy price (azn)": "buyPrice",
  "alış qiyməti": "buyPrice",
  "buy price": "buyPrice",

  "topdansatış qiyməti (azn)": "wholesalePrice",
  "wholesale price (azn)": "wholesalePrice",
  "topdansatış qiyməti": "wholesalePrice",
  "wholesale price": "wholesalePrice",

  "pərakəndə satış qiyməti (azn)": "retailPrice",
  "retail price (azn)": "retailPrice",
  "pərakəndə satış qiyməti": "retailPrice",
  "retail price": "retailPrice",
  "satış qiyməti (azn)": "retailPrice",
  "sell price (azn)": "retailPrice",

  "ədv dərəcəsi (%)": "vatRate",
  "vat rate (%)": "vatRate",
  "ədv dərəcəsi": "vatRate",
  "vat rate": "vatRate",
  vat: "vatRate",

  "ilkin stok sayı": "initialStock",
  "initial stock qty": "initialStock",
  stok: "initialStock",
  stock: "initialStock",

  "minimum stok səviyyəsi": "minStock",
  "minimum stock level": "minStock",
  "min stok": "minStock",
  "min stock": "minStock",

  "anbar mövqeyi": "warehouseLocation",
  "warehouse location": "warehouseLocation",
  "warehouse position": "warehouseLocation",
  mövqe: "warehouseLocation",

  "təchizatçı adı": "supplierName",
  "supplier name": "supplierName",
  təchizatçı: "supplierName",
  supplier: "supplierName",
};

function parseNumber(value: string, fallback = 0): number {
  const normalized = value.replace(",", ".").trim();
  if (!normalized) return fallback;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

function setField(row: ProductImportRow, field: ProductImportFieldKey, raw: string): void {
  const cell = raw.trim();
  switch (field) {
    case "barcode":
      row.barcode = cell;
      break;
    case "sku":
      row.sku = cell;
      break;
    case "name":
      row.name = cell;
      break;
    case "brand":
      row.brand = cell;
      break;
    case "category":
      row.category = cell || "Ümumi";
      break;
    case "subcategory":
      row.subcategory = cell;
      break;
    case "unit":
      row.unit = cell || "Ədəd";
      break;
    case "buyPrice":
      row.buyPrice = parseNumber(cell);
      break;
    case "wholesalePrice":
      row.wholesalePrice = parseNumber(cell);
      break;
    case "retailPrice":
      row.retailPrice = parseNumber(cell);
      break;
    case "vatRate":
      row.vatRate = parseNumber(cell);
      break;
    case "initialStock":
      row.initialStock = parseNumber(cell);
      break;
    case "minStock":
      row.minStock = parseNumber(cell);
      break;
    case "warehouseLocation":
      row.warehouseLocation = cell;
      break;
    case "supplierName":
      row.supplierName = cell;
      break;
  }
}

export function getProductImportHeaderLabels(
  t: (key: string) => string
): string[] {
  return PRODUCT_IMPORT_COLUMN_KEYS.map((key) =>
    t(`initialSetup.importHeaders.${key}`)
  );
}

export function getProductImportSampleRow(t: (key: string) => string): string[] {
  return PRODUCT_IMPORT_COLUMN_KEYS.map((key) =>
    t(`initialSetup.importSample.${key}`)
  );
}

export function buildProductImportTemplateCsv(
  headers: string[],
  sampleRow: string[]
): string {
  return rowsToCsv(headers, [sampleRow]);
}

export function parseProductImportRows(rows: string[][]): {
  items: ProductImportRow[];
  errors: ProductImportValidationError[];
} {
  const errors: ProductImportValidationError[] = [];
  if (rows.length === 0) {
    return { items: [], errors: [{ row: 0, message: "empty_file" }] };
  }

  const [headerRow, ...dataRows] = rows;
  const columnMap: Partial<Record<number, ProductImportFieldKey>> = {};

  headerRow.forEach((header, index) => {
    const key = HEADER_ALIASES[normalizeHeader(header)];
    if (key) columnMap[index] = key;
  });

  const mappedFieldCount = new Set(Object.values(columnMap)).size;
  const hasHeaderMapping = mappedFieldCount >= 3 && Boolean(columnMap);

  const items: ProductImportRow[] = [];

  dataRows.forEach((row, index) => {
    const rowNumber = index + 2;
    if (!row.some((cell) => cell.trim())) return;

    const item = createEmptyProductImportRow();

    if (hasHeaderMapping) {
      row.forEach((cell, colIndex) => {
        const field = columnMap[colIndex];
        if (field) setField(item, field, cell);
      });
    } else {
      PRODUCT_IMPORT_COLUMN_KEYS.forEach((field, colIndex) => {
        setField(item, field, row[colIndex] ?? "");
      });
    }

    if (!item.name) {
      errors.push({ row: rowNumber, message: "missing_name" });
      return;
    }

    if (
      item.buyPrice < 0 ||
      item.wholesalePrice < 0 ||
      item.retailPrice < 0 ||
      item.initialStock < 0 ||
      item.minStock < 0
    ) {
      errors.push({ row: rowNumber, message: "negative_values" });
      return;
    }

    if (item.vatRate < 0 || item.vatRate > 100) {
      errors.push({ row: rowNumber, message: "invalid_vat" });
      return;
    }

    items.push(item);
  });

  if (items.length === 0 && errors.length === 0) {
    errors.push({ row: 0, message: "no_valid_rows" });
  }

  return { items, errors };
}
