import Papa from "papaparse";
import {
  buildExtraInfoWithPriceMeta,
  rowsToDbColumns,
  type ProductPriceRowsState,
} from "@/lib/products/productPriceRows";
import type { PriceEntryUnit } from "@/lib/products/productPriceUnits";
import {
  formatMetrajPiecesPreview,
  normalizeBulkImportMeasureUnit,
  parseMetrajPieces,
  resolveBulkImportStockMode,
  type BulkImportStockMode,
} from "@/lib/products/bulkImportUnits";
import type { ProductInsert } from "@/types/database.types";

/** Canonical column order — `Məhsul kodu` must remain index 0 for template + validation. */
export const BULK_IMPORT_SKU_HEADER = "Məhsul kodu";
export const BULK_IMPORT_NAME_HEADER = "Məhsul adı";
export const BULK_IMPORT_REQUIRED_HEADERS = [BULK_IMPORT_SKU_HEADER, BULK_IMPORT_NAME_HEADER] as const;

/** Canonical CSV column order for template download + parsing (SKU must stay index 0). */
export const BULK_IMPORT_CSV_HEADERS = [
  "Məhsul kodu",
  "Məhsul adı",
  "Kateqoriya",
  "Alt kateqoriya",
  "Brend",
  "Barkod",
  "Uzunluq (m)",
  "En (m)",
  "Alış qiyməti (Şət/Ədəd)",
  "Alış qiyməti (Metr/m²)",
  "Satış qiyməti (Şət/Ədəd)",
  "Satış qiyməti (Metr/m²)",
  "Ölçü vahidi",
  "Anbar",
  "İlkin Say",
  "Metraj hissələri",
] as const;

export const BULK_IMPORT_TEMPLATE_HEADERS = BULK_IMPORT_CSV_HEADERS;

export const BULK_IMPORT_WAREHOUSE_HEADER = "Anbar";

export type BulkImportTemplateHeader = (typeof BULK_IMPORT_TEMPLATE_HEADERS)[number];

export interface BulkImportRow {
  rowNumber: number;
  code: string;
  name: string;
  category: string;
  subcategory: string;
  brand: string;
  barcode: string;
  base_length: string;
  base_width: string;
  buy_price_piece: string;
  buy_price_meter: string;
  sell_price_piece: string;
  sell_price_meter: string;
  measure_unit: string;
  warehouse: string;
  initial_count: string;
  metraj_pieces_raw: string;
  metraj_pieces: number[];
  stock_mode: BulkImportStockMode;
  is_dimensional: boolean;
  unit: string;
  errors: string[];
  isValid: boolean;
}

export interface BulkImportParseResult {
  rows: BulkImportRow[];
  validCount: number;
  invalidCount: number;
  parseError?: string;
}

export interface BulkImportApiPayload {
  product: ProductInsert;
  stock: {
    mode: BulkImportStockMode;
    initialCount: number;
    meterPieces: number[];
    warehouseLabel?: string | null;
  };
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

function validateCsvHeaderRow(fields: string[] | undefined): string | null {
  if (!fields?.length) {
    return "CSV başlıqları tapılmadı";
  }

  const normalized = fields.map((field) => normalizeHeader(field));
  const skuIndex = normalized.indexOf(normalizeHeader(BULK_IMPORT_SKU_HEADER));
  const nameIndex = normalized.indexOf(normalizeHeader(BULK_IMPORT_NAME_HEADER));

  if (skuIndex === -1) {
    return `CSV şablonunda «${BULK_IMPORT_SKU_HEADER}» sütunu tapılmadı`;
  }
  if (skuIndex !== 0) {
    return `«${BULK_IMPORT_SKU_HEADER}» ilk sütun olmalıdır`;
  }
  if (nameIndex === -1) {
    return `CSV şablonunda «${BULK_IMPORT_NAME_HEADER}» sütunu tapılmadı`;
  }

  return null;
}

function cell(row: Record<string, string>, header: BulkImportTemplateHeader): string {
  const direct = row[header];
  if (direct !== undefined) return String(direct ?? "").trim();

  const matchKey = Object.keys(row).find(
    (key) => normalizeHeader(key) === normalizeHeader(header)
  );
  return matchKey ? String(row[matchKey] ?? "").trim() : "";
}

function parseDecimal(value: string): number {
  const normalized = value.replace(",", ".").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function parsePrice(value: string, label: string, errors: string[]): number | null {
  if (!value.trim()) return 0;
  const parsed = parseDecimal(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    errors.push(`${label} düzgün rəqəm deyil`);
    return null;
  }
  return parsed;
}

function parseOptionalDimension(
  value: string,
  label: string,
  errors: string[]
): number | null {
  if (!value.trim()) return null;
  const parsed = parseDecimal(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    errors.push(`${label} düzgün rəqəm deyil`);
    return null;
  }
  return parsed;
}

function parseInitialCount(value: string, errors: string[]): number | null {
  if (!value.trim()) return 0;
  const parsed = parseDecimal(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed % 1 !== 0) {
    errors.push("İlkin Say tam ədəd olmalıdır");
    return null;
  }
  return parsed;
}

function hasDimensionInput(lengthRaw: string, widthRaw: string): boolean {
  return Boolean(lengthRaw.trim() || widthRaw.trim());
}

function cutPriceUnit(width: number | null): PriceEntryUnit {
  return width && width > 0 ? "square_meter" : "meter";
}

function buildPriceRowsState(
  buyPiece: number,
  buyMeter: number,
  sellPiece: number,
  sellMeter: number,
  cutUnit: PriceEntryUnit
): ProductPriceRowsState {
  const buy = [{ id: "buy-0", price: String(buyPiece), unit: "piece" as PriceEntryUnit }];
  const sell = [{ id: "sell-0", price: String(sellPiece), unit: "piece" as PriceEntryUnit }];

  if (buyMeter > 0) {
    buy.push({ id: "buy-1", price: String(buyMeter), unit: cutUnit });
  }
  if (sellMeter > 0) {
    sell.push({ id: "sell-1", price: String(sellMeter), unit: cutUnit });
  }

  return { buy, sell };
}

export function formatBulkImportDimensions(row: BulkImportRow): string {
  const length = row.base_length.trim();
  const width = row.base_width.trim();
  if (length && width) return `${length} × ${width} m`;
  if (length) return `${length} m`;
  if (width) return `${width} m (en)`;
  return "—";
}

export function formatBulkImportPricePair(piece: string, meter: string): string {
  const pieceValue = piece.trim() || "0";
  const meterValue = meter.trim() || "0";
  return `${pieceValue} / ${meterValue}`;
}

export function formatBulkImportMetraj(row: BulkImportRow): string {
  return formatMetrajPiecesPreview(row.metraj_pieces, row.metraj_pieces_raw);
}

export function validateBulkImportRow(
  row: Omit<
    BulkImportRow,
    | "errors"
    | "isValid"
    | "rowNumber"
    | "is_dimensional"
    | "unit"
    | "stock_mode"
    | "metraj_pieces"
  >,
  seenCodes: Set<string>
): BulkImportRow {
  const errors: string[] = [];
  const code = row.code.trim();
  const name = row.name.trim();

  if (!code) errors.push(`${BULK_IMPORT_SKU_HEADER} tələb olunur`);
  if (!name) errors.push(`${BULK_IMPORT_NAME_HEADER} tələb olunur`);
  if (code && seenCodes.has(code.toLowerCase())) {
    errors.push("CSV-də təkrarlanan məhsul kodu");
  }
  if (code) seenCodes.add(code.toLowerCase());

  const baseLength = parseOptionalDimension(row.base_length, "Uzunluq (m)", errors);
  const baseWidth = parseOptionalDimension(row.base_width, "En (m)", errors);
  const sheetDimensional = hasDimensionInput(row.base_length, row.base_width);
  const stockMode = resolveBulkImportStockMode(row.measure_unit, sheetDimensional);
  const normalizedUnit = normalizeBulkImportMeasureUnit(row.measure_unit, stockMode);
  const isDimensional = sheetDimensional || stockMode === "meter";

  const buyPiece = parsePrice(row.buy_price_piece, "Alış qiyməti (Şət/Ədəd)", errors);
  const buyMeter = parsePrice(row.buy_price_meter, "Alış qiyməti (Metr/m²)", errors);
  const sellPiece = parsePrice(row.sell_price_piece, "Satış qiyməti (Şət/Ədəd)", errors);
  const sellMeter = parsePrice(row.sell_price_meter, "Satış qiyməti (Metr/m²)", errors);

  let initialCount = 0;
  let metrajPieces: number[] = [];

  if (stockMode === "piece") {
    const parsedCount = parseInitialCount(row.initial_count, errors);
    if (parsedCount !== null) initialCount = parsedCount;
  } else {
    if (row.metraj_pieces_raw.trim()) {
      metrajPieces = parseMetrajPieces(row.metraj_pieces_raw);
      if (metrajPieces.length === 0) {
        errors.push("Metraj hissələri düzgün formatda deyil");
      }
    }
  }

  return {
    ...row,
    code,
    name,
    category: row.category.trim() || "Ümumi",
    subcategory: row.subcategory.trim(),
    brand: row.brand.trim(),
    barcode: row.barcode.trim(),
    base_length: baseLength === null ? row.base_length.trim() : String(baseLength),
    base_width: baseWidth === null ? row.base_width.trim() : String(baseWidth),
    buy_price_piece: buyPiece === null ? row.buy_price_piece : String(buyPiece),
    buy_price_meter: buyMeter === null ? row.buy_price_meter : String(buyMeter),
    sell_price_piece: sellPiece === null ? row.sell_price_piece : String(sellPiece),
    sell_price_meter: sellMeter === null ? row.sell_price_meter : String(sellMeter),
    measure_unit: normalizedUnit,
    initial_count: String(initialCount),
    metraj_pieces_raw: row.metraj_pieces_raw.trim(),
    metraj_pieces: metrajPieces,
    stock_mode: stockMode,
    is_dimensional: isDimensional,
    unit: normalizedUnit,
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

  const headerError = validateCsvHeaderRow(parsed.meta.fields);
  if (headerError) {
    return {
      rows: [],
      validCount: 0,
      invalidCount: 0,
      parseError: headerError,
    };
  }

  const seenCodes = new Set<string>();
  const rows: BulkImportRow[] = parsed.data
    .map((record, index) => {
      const base = {
        rowNumber: index + 2,
        code: cell(record, BULK_IMPORT_SKU_HEADER),
        name: cell(record, BULK_IMPORT_NAME_HEADER),
        category: cell(record, "Kateqoriya"),
        subcategory: cell(record, "Alt kateqoriya"),
        brand: cell(record, "Brend"),
        barcode: cell(record, "Barkod"),
        base_length: cell(record, "Uzunluq (m)"),
        base_width: cell(record, "En (m)"),
        buy_price_piece: cell(record, "Alış qiyməti (Şət/Ədəd)"),
        buy_price_meter: cell(record, "Alış qiyməti (Metr/m²)"),
        sell_price_piece: cell(record, "Satış qiyməti (Şət/Ədəd)"),
        sell_price_meter: cell(record, "Satış qiyməti (Metr/m²)"),
        measure_unit: cell(record, "Ölçü vahidi"),
        warehouse: cell(record, BULK_IMPORT_WAREHOUSE_HEADER),
        initial_count: cell(record, "İlkin Say"),
        metraj_pieces_raw: cell(record, "Metraj hissələri"),
      };

      const isEmpty = Object.values(base).every((value) => !String(value).trim());
      if (isEmpty) {
        return {
          ...base,
          metraj_pieces: [] as number[],
          stock_mode: "piece" as BulkImportStockMode,
          is_dimensional: false,
          unit: "Ədəd",
          errors: [] as string[],
          isValid: false,
        };
      }

      return validateBulkImportRow(base, seenCodes);
    })
    .filter(
      (row) =>
        row.code ||
        row.name ||
        row.category ||
        row.subcategory ||
        row.barcode ||
        row.base_length ||
        row.base_width ||
        row.measure_unit ||
        row.warehouse ||
        row.initial_count ||
        row.metraj_pieces_raw
    );

  const validCount = rows.filter((row) => row.isValid).length;

  return {
    rows,
    validCount,
    invalidCount: rows.length - validCount,
  };
}

function buildProductFromRow(row: BulkImportRow): ProductInsert {
  const baseLength = row.base_length.trim() ? Number(row.base_length) || null : null;
  const baseWidth = row.base_width.trim() ? Number(row.base_width) || null : null;
  const cutUnit = cutPriceUnit(baseWidth);

  const priceRows = buildPriceRowsState(
    Number(row.buy_price_piece) || 0,
    Number(row.buy_price_meter) || 0,
    Number(row.sell_price_piece) || 0,
    Number(row.sell_price_meter) || 0,
    cutUnit
  );
  const priceColumns = rowsToDbColumns(priceRows);

  const priceMeta = {
    buy: priceRows.buy
      .filter((entry) => entry.price.trim() !== "")
      .map((entry) => ({ price: Number(entry.price) || 0, unit: entry.unit })),
    sell: priceRows.sell
      .filter((entry) => entry.price.trim() !== "")
      .map((entry) => ({ price: Number(entry.price) || 0, unit: entry.unit })),
  };

  return {
    code: row.code,
    name: row.name,
    category: row.category || "Ümumi",
    subcategory: row.subcategory || null,
    unit: row.unit || "Ədəd",
    buy_price: priceColumns.buy_price,
    buy_price_cut: priceColumns.buy_price_cut,
    sell_price: priceColumns.sell_price,
    sell_price_cut: priceColumns.sell_price_cut,
    stock: 0,
    min_stock: 0,
    brand: row.brand || null,
    barcode: row.barcode.trim() || null,
    is_dimensional: row.is_dimensional,
    base_length: row.is_dimensional ? baseLength : null,
    base_width: row.is_dimensional ? baseWidth : null,
    extra_info: buildExtraInfoWithPriceMeta("", priceMeta),
  };
}

export function bulkImportRowToProductInsert(row: BulkImportRow): ProductInsert {
  return buildProductFromRow(row);
}

export function bulkImportRowToApiPayload(row: BulkImportRow): BulkImportApiPayload {
  return {
    product: buildProductFromRow(row),
    stock: {
      mode: row.stock_mode,
      initialCount: Number(row.initial_count) || 0,
      meterPieces: row.metraj_pieces,
      warehouseLabel: row.warehouse.trim() || null,
    },
  };
}

export function downloadBulkImportTemplate(): void {
  const csvHeaders = [...BULK_IMPORT_CSV_HEADERS];
  const templateRow = Object.fromEntries(csvHeaders.map((header) => [header, ""]));
  const csv = Papa.unparse([templateRow], { columns: csvHeaders });
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
