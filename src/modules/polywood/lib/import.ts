import { rowsToCsv } from "@/lib/csv/csvUtils";
import { DEFAULT_FULL_SHEET_LENGTH_M, isFullSheetLength } from "@/lib/polywood/constants";

export type PolywoodImportUnit = "sheet" | "pcs" | "m";

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
  unit: PolywoodImportUnit;
  quantity: number;
  buyPrice: number;
  sellPrice: number;
  barcode: string;
  fullSheetLengthM: number;
  /** Semicolon-separated lengths e.g. "4;4;2.5;1.2" (used when unit is m) */
  pieceLengths: string;
  parsedLengths: number[];
  groupedStock: PolywoodGroupedStock[];
  stockSummary: string;
  errors: string[];
}

export const POLYWOOD_IMPORT_COLUMNS = [
  "code",
  "name",
  "category",
  "sub_category",
  "unit",
  "quantity",
  "buy_price",
  "sell_price",
  "barcode",
  "full_sheet_length_m",
  "piece_lengths",
] as const;

const HEADER_ALIASES: Record<
  string,
  keyof Omit<
    PolywoodImportRow,
    "rowNumber" | "parsedLengths" | "groupedStock" | "stockSummary" | "errors" | "unit"
  >
> = {
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

  quantity: "quantity",
  miqdar: "quantity",
  qty: "quantity",
  say: "quantity",
  count: "quantity",

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
};

const UNIT_ALIASES: Record<string, PolywoodImportUnit> = {
  sheet: "sheet",
  sheets: "sheet",
  vərəq: "sheet",
  vereq: "sheet",
  "tam vərəq": "sheet",

  pcs: "pcs",
  pc: "pcs",
  piece: "m",
  pieces: "m",
  ədəd: "pcs",
  eded: "pcs",
  qty: "pcs",

  m: "m",
  metr: "m",
  meter: "m",
  metre: "m",
  meters: "m",
};

function parseNumber(value: string, fallback = 0): number {
  const normalized = value.replace(",", ".").trim();
  if (!normalized) return fallback;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : fallback;
}

function parseInteger(value: string, fallback = 0): number {
  const num = parseNumber(value, fallback);
  return Number.isFinite(num) ? Math.floor(num) : fallback;
}

export function normalizeImportUnit(raw: string): PolywoodImportUnit {
  const key = raw.trim().toLowerCase();
  if (!key) return "sheet";
  return UNIT_ALIASES[key] || "sheet";
}

export function isMeterUnit(unit: PolywoodImportUnit): boolean {
  return unit === "m";
}

export function isDiscreteUnit(unit: PolywoodImportUnit): boolean {
  return unit === "sheet" || unit === "pcs";
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

export function buildStockFromUnit(row: PolywoodImportRow): void {
  if (isMeterUnit(row.unit)) {
    row.parsedLengths = parseLengths(row.pieceLengths);
    row.groupedStock = groupPieceLengths(row.parsedLengths, row.fullSheetLengthM);
    return;
  }

  const qty = Math.max(0, Math.floor(row.quantity));
  if (row.unit === "sheet") {
    row.parsedLengths = Array.from({ length: qty }, () => row.fullSheetLengthM);
    row.groupedStock =
      qty > 0
        ? [{ lengthM: row.fullSheetLengthM, quantity: qty, isFullSheet: true }]
        : [];
    return;
  }

  row.parsedLengths = Array.from({ length: qty }, () => 1);
  row.groupedStock =
    qty > 0 ? [{ lengthM: 1, quantity: qty, isFullSheet: false }] : [];
}

export function formatStockSummary(row: PolywoodImportRow): string {
  if (row.unit === "sheet") {
    return `${row.quantity} sheet${row.quantity === 1 ? "" : "s"}`;
  }
  if (row.unit === "pcs") {
    return `${row.quantity} pcs`;
  }
  const totalM = row.parsedLengths.reduce((sum, length) => sum + length, 0);
  const pieceCount = row.parsedLengths.length;
  if (pieceCount === 0) return "";
  return `${pieceCount} piece${pieceCount === 1 ? "" : "s"} total ${totalM.toFixed(1)}m`;
}

export function productUnitLabel(unit: PolywoodImportUnit): string {
  if (unit === "sheet") return "Vərəq";
  if (unit === "pcs") return "Ədəd";
  return "Metr";
}

function createEmptyRow(rowNumber: number): PolywoodImportRow {
  return {
    rowNumber,
    code: "",
    name: "",
    category: "Polywood",
    subCategory: "",
    unit: "sheet",
    quantity: 0,
    buyPrice: 0,
    sellPrice: 0,
    barcode: "",
    fullSheetLengthM: DEFAULT_FULL_SHEET_LENGTH_M,
    pieceLengths: "",
    parsedLengths: [],
    groupedStock: [],
    stockSummary: "",
    errors: [],
  };
}

const TEMPLATE_SAMPLE_ROWS = [
  [
    "PW-SHEET-001",
    "Polywood White 18mm",
    "Polywood",
    "18mm",
    "sheet",
    "50",
    "45",
    "65",
    "869000000001",
    "4",
    "",
  ],
  [
    "PW-METER-001",
    "Polywood Cut Stock",
    "Polywood",
    "18mm",
    "m",
    "",
    "40",
    "58",
    "869000000002",
    "4",
    "4;4;4;2.5;1.2",
  ],
];

export function buildPolywoodImportTemplateCsv(): string {
  return rowsToCsv([...POLYWOOD_IMPORT_COLUMNS], TEMPLATE_SAMPLE_ROWS);
}

export async function downloadPolywoodImportTemplateXlsx(): Promise<void> {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet([[...POLYWOOD_IMPORT_COLUMNS], ...TEMPLATE_SAMPLE_ROWS]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Import");
  XLSX.writeFile(workbook, "Polywood_Import_Sablonu.xlsx");
}

function validateImportRow(row: PolywoodImportRow): void {
  if (!row.name.trim()) row.errors.push("Product name is required");
  if (!row.category.trim()) row.errors.push("Category is required");
  if (row.fullSheetLengthM <= 0) row.errors.push("Full sheet length must be positive");

  if (isMeterUnit(row.unit)) {
    if (row.parsedLengths.length === 0) {
      row.errors.push("At least one piece length is required for meter unit");
    }
    return;
  }

  if (row.quantity <= 0) {
    row.errors.push("Quantity must be a positive integer for sheet/pcs unit");
  }
}

export function parsePolywoodImportRows(rows: string[][]): PolywoodImportRow[] {
  if (rows.length === 0) return [];

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const fieldIndexes = new Map<string, number>();

  header.forEach((cell, index) => {
    const field = HEADER_ALIASES[cell];
    if (field) fieldIndexes.set(field, index);
    if (UNIT_ALIASES[cell]) fieldIndexes.set("unit", index);
    if (cell === "unit" || cell === "ölçü vahidi" || cell === "unit of measure") {
      fieldIndexes.set("unit", index);
    }
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
      row.unit = normalizeImportUnit(readCell("unit"));
      row.quantity = parseInteger(readCell("quantity"));
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
      row.unit = normalizeImportUnit((cells[4] ?? "").trim());
      row.quantity = parseInteger(cells[5] ?? "");
      row.buyPrice = parseNumber(cells[6] ?? "");
      row.sellPrice = parseNumber(cells[7] ?? "");
      row.barcode = (cells[8] ?? "").trim();
      row.fullSheetLengthM = parseNumber(cells[9] ?? "", DEFAULT_FULL_SHEET_LENGTH_M);
      row.pieceLengths = (cells[10] ?? "").trim();
    }

    buildStockFromUnit(row);
    row.stockSummary = formatStockSummary(row);
    validateImportRow(row);

    return row;
  });
}

export function validPolywoodImportRows(rows: PolywoodImportRow[]): PolywoodImportRow[] {
  return rows.filter((row) => row.errors.length === 0);
}

export function rowHasImportableStock(row: PolywoodImportRow): boolean {
  if (row.errors.length > 0) return false;
  if (isMeterUnit(row.unit)) return row.parsedLengths.length > 0;
  return row.quantity > 0;
}
