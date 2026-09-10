import { rowsToCsv } from "@/lib/csv/csvUtils";
import { DEFAULT_FULL_SHEET_LENGTH_M, isFullSheetLength } from "@/lib/polywood/constants";

export type PolywoodGroupedStock = {
  lengthM: number;
  quantity: number;
  isFullSheet: boolean;
};

export interface PolywoodImportRow {
  rowNumber: number;
  code: string;
  name: string;
  category: string;
  subCategory: string;
  buyPrice: number;
  sellPrice: number;
  barcode: string;
  fullSheetLengthM: number;
  /** Semicolon-separated lengths e.g. "4;4;2.5;1.2" */
  pieceLengths: string;
  parsedLengths: number[];
  groupedStock: PolywoodGroupedStock[];
  errors: string[];
}

export const POLYWOOD_IMPORT_COLUMNS = [
  "code",
  "name",
  "category",
  "sub_category",
  "buy_price",
  "sell_price",
  "barcode",
  "full_sheet_length_m",
  "piece_lengths",
] as const;

const HEADER_ALIASES: Record<string, keyof Omit<PolywoodImportRow, "rowNumber" | "parsedLengths" | "groupedStock" | "errors">> = {
  code: "code",
  kod: "code",
  sku: "code",
  "məhsul kodu": "code",
  "product code": "code",

  name: "name",
  ad: "name",
  "məhsul adı": "name",
  "product name": "name",

  category: "category",
  kateqoriya: "category",
  "kateqoriya adı": "category",

  sub_category: "subCategory",
  subcategory: "subCategory",
  "alt kateqoriya": "subCategory",
  "sub category": "subCategory",
  "alt kateqoriya adı": "subCategory",

  buy_price: "buyPrice",
  "alış qiyməti": "buyPrice",
  "buy price": "buyPrice",

  sell_price: "sellPrice",
  "satış qiyməti": "sellPrice",
  "sell price": "sellPrice",

  barcode: "barcode",
  barkod: "barcode",

  full_sheet_length_m: "fullSheetLengthM",
  "tam vərəq uzunluğu (m)": "fullSheetLengthM",
  "full sheet length (m)": "fullSheetLengthM",
  "vərəq uzunluğu": "fullSheetLengthM",

  piece_lengths: "pieceLengths",
  "hissə uzunluqları": "pieceLengths",
  "piece lengths": "pieceLengths",
  uzunluqlar: "pieceLengths",
  lengths: "pieceLengths",
  stok: "pieceLengths",
  stock: "pieceLengths",
};

function parseNumber(value: string, fallback = 0): number {
  const normalized = value.replace(",", ".").trim();
  if (!normalized) return fallback;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : fallback;
}

function parseLengths(raw: string): number[] {
  if (!raw.trim()) return [];
  return raw
    .split(/[;,\n|]+/)
    .map((part) => parseNumber(part.trim()))
    .filter((value) => value > 0);
}

export function groupPieceLengths(
  lengths: number[],
  fullSheetLengthM: number
): PolywoodGroupedStock[] {
  const counts = new Map<number, number>();
  for (const length of lengths) {
    const key = Math.round(length * 1000) / 1000;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([lengthM, quantity]) => ({
      lengthM,
      quantity,
      isFullSheet: isFullSheetLength(lengthM, fullSheetLengthM),
    }));
}

export function formatGroupedStock(groups: PolywoodGroupedStock[]): string {
  if (groups.length === 0) return "";
  return groups.map((group) => `${group.quantity}×${group.lengthM}m`).join(", ");
}

function createEmptyRow(rowNumber: number): PolywoodImportRow {
  return {
    rowNumber,
    code: "",
    name: "",
    category: "Polywood",
    subCategory: "",
    buyPrice: 0,
    sellPrice: 0,
    barcode: "",
    fullSheetLengthM: DEFAULT_FULL_SHEET_LENGTH_M,
    pieceLengths: "",
    parsedLengths: [],
    groupedStock: [],
    errors: [],
  };
}

const TEMPLATE_SAMPLE_ROW = [
  "PW-001",
  "Polywood White 18mm",
  "Polywood",
  "18mm",
  "45",
  "65",
  "869000000001",
  "4",
  "4;4;4;2.5;1.2",
];

export function buildPolywoodImportTemplateCsv(): string {
  return rowsToCsv([...POLYWOOD_IMPORT_COLUMNS], [TEMPLATE_SAMPLE_ROW]);
}

export async function downloadPolywoodImportTemplateXlsx(): Promise<void> {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet([[...POLYWOOD_IMPORT_COLUMNS], TEMPLATE_SAMPLE_ROW]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Import");
  XLSX.writeFile(workbook, "Polywood_Import_Sablonu.xlsx");
}

export function parsePolywoodImportRows(rows: string[][]): PolywoodImportRow[] {
  if (rows.length === 0) return [];

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const fieldIndexes = new Map<string, number>();

  header.forEach((cell, index) => {
    const field = HEADER_ALIASES[cell];
    if (field) fieldIndexes.set(field, index);
  });

  const hasHeader = fieldIndexes.size >= 2;
  const dataRows = hasHeader ? rows.slice(1) : rows;

  return dataRows.map((cells, index) => {
    const row = createEmptyRow(hasHeader ? index + 2 : index + 1);

    const readCell = (field: string): string => {
      const idx = fieldIndexes.get(field);
      if (idx === undefined) return "";
      return (cells[idx] ?? "").trim();
    };

    if (hasHeader) {
      row.code = readCell("code");
      row.name = readCell("name");
      row.category = readCell("category") || "Polywood";
      row.subCategory = readCell("subCategory");
      row.buyPrice = parseNumber(readCell("buyPrice"));
      row.sellPrice = parseNumber(readCell("sellPrice"));
      row.barcode = readCell("barcode");
      row.fullSheetLengthM = parseNumber(readCell("fullSheetLengthM"), DEFAULT_FULL_SHEET_LENGTH_M);
      row.pieceLengths = readCell("pieceLengths");
    } else {
      row.code = (cells[0] ?? "").trim();
      row.name = (cells[1] ?? "").trim();
      row.category = (cells[2] ?? "").trim() || "Polywood";
      row.subCategory = (cells[3] ?? "").trim();
      row.buyPrice = parseNumber(cells[4] ?? "");
      row.sellPrice = parseNumber(cells[5] ?? "");
      row.barcode = (cells[6] ?? "").trim();
      row.fullSheetLengthM = parseNumber(cells[7] ?? "", DEFAULT_FULL_SHEET_LENGTH_M);
      row.pieceLengths = (cells[8] ?? "").trim();
    }

    row.parsedLengths = parseLengths(row.pieceLengths);
    row.groupedStock = groupPieceLengths(row.parsedLengths, row.fullSheetLengthM);

    if (!row.name.trim()) row.errors.push("Product name is required");
    if (!row.category.trim()) row.errors.push("Category is required");
    if (row.parsedLengths.length === 0) row.errors.push("At least one piece length is required");
    if (row.fullSheetLengthM <= 0) row.errors.push("Full sheet length must be positive");

    return row;
  });
}

export function validPolywoodImportRows(rows: PolywoodImportRow[]): PolywoodImportRow[] {
  return rows.filter((row) => row.errors.length === 0);
}
