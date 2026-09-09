export const BARCODE_LABEL_CONFIG_KEY = "barcode_label_config";

export const BARCODE_PAPER_SIZES = ["58x40mm", "80x50mm", "A4_STICKERS", "CUSTOM"] as const;
export type BarcodePaperSize = (typeof BARCODE_PAPER_SIZES)[number];

export const BARCODE_SYMBOL_TYPES = ["CODE128", "EAN13", "QR_CODE"] as const;
export type BarcodeSymbolType = (typeof BARCODE_SYMBOL_TYPES)[number];

export interface BarcodeLabelConfig {
  paper_size: BarcodePaperSize;
  barcode_type: BarcodeSymbolType;
  show_company_logo: boolean;
  show_item_code: boolean;
  show_price: boolean;
  show_dimensions: boolean;
  show_warehouse_location: boolean;
  header_title: string;
  margin_padding_mm: number;
  custom_width_mm: number;
  custom_height_mm: number;
}

export const DEFAULT_BARCODE_LABEL_CONFIG: BarcodeLabelConfig = {
  paper_size: "80x50mm",
  barcode_type: "CODE128",
  show_company_logo: true,
  show_item_code: true,
  show_price: false,
  show_dimensions: true,
  show_warehouse_location: true,
  header_title: "DEL GROUPS MMC",
  margin_padding_mm: 2,
  custom_width_mm: 80,
  custom_height_mm: 50,
};

const PAPER_DIMENSIONS: Record<Exclude<BarcodePaperSize, "CUSTOM">, { widthMm: number; heightMm: number }> = {
  "58x40mm": { widthMm: 58, heightMm: 40 },
  "80x50mm": { widthMm: 80, heightMm: 50 },
  A4_STICKERS: { widthMm: 50, heightMm: 30 },
};

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function isPaperSize(value: unknown): value is BarcodePaperSize {
  return (BARCODE_PAPER_SIZES as readonly string[]).includes(String(value));
}

function isSymbolType(value: unknown): value is BarcodeSymbolType {
  return (BARCODE_SYMBOL_TYPES as readonly string[]).includes(String(value));
}

export function parseBarcodeLabelConfig(raw: unknown): BarcodeLabelConfig {
  const source = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const paper_size = isPaperSize(source.paper_size)
    ? source.paper_size
    : DEFAULT_BARCODE_LABEL_CONFIG.paper_size;
  const barcode_type = isSymbolType(source.barcode_type)
    ? source.barcode_type
    : DEFAULT_BARCODE_LABEL_CONFIG.barcode_type;
  const header = typeof source.header_title === "string" ? source.header_title.trim() : "";

  return {
    paper_size,
    barcode_type,
    show_company_logo: asBoolean(source.show_company_logo, DEFAULT_BARCODE_LABEL_CONFIG.show_company_logo),
    show_item_code: asBoolean(source.show_item_code, DEFAULT_BARCODE_LABEL_CONFIG.show_item_code),
    show_price: asBoolean(source.show_price, DEFAULT_BARCODE_LABEL_CONFIG.show_price),
    show_dimensions: asBoolean(source.show_dimensions, DEFAULT_BARCODE_LABEL_CONFIG.show_dimensions),
    show_warehouse_location: asBoolean(
      source.show_warehouse_location,
      DEFAULT_BARCODE_LABEL_CONFIG.show_warehouse_location
    ),
    header_title: header || DEFAULT_BARCODE_LABEL_CONFIG.header_title,
    margin_padding_mm: asNumber(source.margin_padding_mm, DEFAULT_BARCODE_LABEL_CONFIG.margin_padding_mm, 0, 12),
    custom_width_mm: asNumber(source.custom_width_mm, DEFAULT_BARCODE_LABEL_CONFIG.custom_width_mm, 20, 210),
    custom_height_mm: asNumber(source.custom_height_mm, DEFAULT_BARCODE_LABEL_CONFIG.custom_height_mm, 15, 297),
  };
}

export function resolveLabelDimensions(config: BarcodeLabelConfig): { widthMm: number; heightMm: number } {
  if (config.paper_size === "CUSTOM") {
    return { widthMm: config.custom_width_mm, heightMm: config.custom_height_mm };
  }
  return PAPER_DIMENSIONS[config.paper_size];
}

export function overridePaperSize(
  config: BarcodeLabelConfig,
  paperSize: BarcodePaperSize
): BarcodeLabelConfig {
  return { ...config, paper_size: paperSize };
}

export const SAMPLE_THERMAL_LABEL = {
  id: "preview-sample",
  name: "Polywood 18mm",
  code: "PW-001",
  barcode: generateStableEan13(),
  qrCode: "PW-001",
  dimensions: "2.44 m × 1.22 m",
  warehouseName: "Əsas anbar",
  price: 45.5,
};

function generateStableEan13(): string {
  const body = "200123456789";
  const sum = body.split("").reduce((acc, digit, index) => {
    const n = Number(digit);
    return acc + (index % 2 === 0 ? n : n * 3);
  }, 0);
  return body + String((10 - (sum % 10)) % 10);
}

export function isEan13Payload(value: string): boolean {
  return /^\d{12,13}$/.test(value.trim());
}
