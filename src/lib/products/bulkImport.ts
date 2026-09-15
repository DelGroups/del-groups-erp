import Papa from "papaparse";
import type { ProductInsert } from "@/types/database.types";

export const BULK_IMPORT_TEMPLATE_HEADERS = [
  "Məhsul kodu",
  "Məhsul adı",
  "Kateqoriya",
  "Alış qiyməti",
  "Satış qiyməti",
  "Ölçü vahidi",
  "Brend",
  "Barkod",
] as const;

export type BulkImportTemplateHeader = (typeof BULK_IMPORT_TEMPLATE_HEADERS)[number];

export interface BulkImportRow {
  rowNumber: number;
  code: string;
  name: string;
  category: string;
  buy_price: string;
  sell_price: string;
  unit: string;
  brand: string;
  barcode: string;
  errors: string[];
  isValid: boolean;
}

export interface BulkImportParseResult {
  rows: BulkImportRow[];
  validCount: number;
  invalidCount: number;
  parseError?: string;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

function cell(row: Record<string, string>, header: BulkImportTemplateHeader): string {
  const direct = row[header];
  if (direct !== undefined) return String(direct ?? "").trim();

  const matchKey = Object.keys(row).find(
    (key) => normalizeHeader(key) === normalizeHeader(header)
  );
  return matchKey ? String(row[matchKey] ?? "").trim() : "";
}

function parsePrice(value: string, label: string, errors: string[]): number | null {
  if (!value.trim()) return 0;
  const normalized = value.replace(",", ".").trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    errors.push(`${label} düzgün rəqəm deyil`);
    return null;
  }
  return parsed;
}

export function validateBulkImportRow(
  row: Omit<BulkImportRow, "errors" | "isValid" | "rowNumber">,
  seenCodes: Set<string>
): BulkImportRow {
  const errors: string[] = [];
  const code = row.code.trim();
  const name = row.name.trim();

  if (!code) errors.push("Məhsul kodu tələb olunur");
  if (!name) errors.push("Məhsul adı tələb olunur");
  if (code && seenCodes.has(code.toLowerCase())) {
    errors.push("CSV-də təkrarlanan məhsul kodu");
  }
  if (code) seenCodes.add(code.toLowerCase());

  const buyPrice = parsePrice(row.buy_price, "Alış qiyməti", errors);
  const sellPrice = parsePrice(row.sell_price, "Satış qiyməti", errors);

  return {
    ...row,
    code,
    name,
    category: row.category.trim() || "Ümumi",
    unit: row.unit.trim() || "Ədəd",
    brand: row.brand.trim(),
    barcode: row.barcode.trim(),
    buy_price: buyPrice === null ? row.buy_price : String(buyPrice),
    sell_price: sellPrice === null ? row.sell_price : String(sellPrice),
    errors,
    isValid: errors.length === 0,
  };
}

export function parseBulkImportCsv(text: string): BulkImportParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });

  if (parsed.errors.length > 0) {
    return {
      rows: [],
      validCount: 0,
      invalidCount: 0,
      parseError: parsed.errors[0]?.message || "CSV oxunmadı",
    };
  }

  const seenCodes = new Set<string>();
  const rows: BulkImportRow[] = parsed.data.map((record, index) => {
    const base = {
      rowNumber: index + 2,
      code: cell(record, "Məhsul kodu"),
      name: cell(record, "Məhsul adı"),
      category: cell(record, "Kateqoriya"),
      buy_price: cell(record, "Alış qiyməti"),
      sell_price: cell(record, "Satış qiyməti"),
      unit: cell(record, "Ölçü vahidi"),
      brand: cell(record, "Brend"),
      barcode: cell(record, "Barkod"),
    };

    const isEmpty = Object.values(base).every((value) => !String(value).trim());
    if (isEmpty) {
      return {
        ...base,
        errors: [] as string[],
        isValid: false,
      };
    }

    return validateBulkImportRow(base, seenCodes);
  }).filter((row) => row.code || row.name || row.category || row.barcode);

  const validCount = rows.filter((row) => row.isValid).length;

  return {
    rows,
    validCount,
    invalidCount: rows.length - validCount,
  };
}

export function bulkImportRowToProductInsert(row: BulkImportRow): ProductInsert {
  return {
    code: row.code,
    name: row.name,
    category: row.category || "Ümumi",
    unit: row.unit || "Ədəd",
    buy_price: Number(row.buy_price) || 0,
    sell_price: Number(row.sell_price) || 0,
    stock: 0,
    min_stock: 0,
    brand: row.brand || null,
    barcode: row.barcode || null,
  };
}

export function downloadBulkImportTemplate(): void {
  const csv = Papa.unparse({
    fields: [...BULK_IMPORT_TEMPLATE_HEADERS],
    data: [],
  });
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "mehsul-import-sablonu.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
