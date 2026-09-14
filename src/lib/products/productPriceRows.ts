import type { Product } from "@/types/database.types";
import type { PriceEntryUnit } from "@/lib/products/productPriceUnits";

export interface ProductPriceRow {
  id: string;
  price: string;
  unit: PriceEntryUnit;
}

export interface ProductPriceRowsState {
  buy: ProductPriceRow[];
  sell: ProductPriceRow[];
}

export interface ProductPriceRowsMeta {
  buy: Array<{ price: number; unit: PriceEntryUnit }>;
  sell: Array<{ price: number; unit: PriceEntryUnit }>;
}

export const PRICE_META_PREFIX = "@@PRICE_ROWS@@";

const PRICE_UNITS: PriceEntryUnit[] = ["piece", "meter", "square_meter"];

export function createPriceRow(
  price = "",
  unit: PriceEntryUnit = "piece"
): ProductPriceRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    price,
    unit,
  };
}

export function defaultUnitForProduct(product?: Product | null): PriceEntryUnit {
  if (product?.unit === "Metr") return "meter";
  if (product?.unit === "Kvadrat Metr") return "square_meter";
  return "piece";
}

function parseMetaJson(raw: string): ProductPriceRowsMeta | null {
  try {
    const parsed = JSON.parse(raw) as ProductPriceRowsMeta;
    if (!parsed || typeof parsed !== "object") return null;
    const normalize = (rows: unknown) =>
      Array.isArray(rows)
        ? rows
            .map((row) => {
              if (!row || typeof row !== "object") return null;
              const price = Number((row as { price?: unknown }).price);
              const unit = (row as { unit?: unknown }).unit;
              if (!Number.isFinite(price) || price < 0) return null;
              if (!PRICE_UNITS.includes(unit as PriceEntryUnit)) return null;
              return { price, unit: unit as PriceEntryUnit };
            })
            .filter(Boolean) as Array<{ price: number; unit: PriceEntryUnit }>
        : [];
    return {
      buy: normalize(parsed.buy),
      sell: normalize(parsed.sell),
    };
  } catch {
    return null;
  }
}

export function extractUserNotesFromExtraInfo(extraInfo: string | null | undefined): string {
  const text = (extraInfo || "").trim();
  if (!text.startsWith(PRICE_META_PREFIX)) return text;
  const withoutPrefix = text.slice(PRICE_META_PREFIX.length);
  const newlineIndex = withoutPrefix.indexOf("\n");
  if (newlineIndex === -1) return "";
  return withoutPrefix.slice(newlineIndex + 1).trim();
}

export function parsePriceMetaFromExtraInfo(
  extraInfo: string | null | undefined
): ProductPriceRowsMeta | null {
  const text = (extraInfo || "").trim();
  if (!text.startsWith(PRICE_META_PREFIX)) return null;
  const withoutPrefix = text.slice(PRICE_META_PREFIX.length);
  const jsonPart = withoutPrefix.split("\n")[0]?.trim() || "";
  if (!jsonPart) return null;
  return parseMetaJson(jsonPart);
}

export function buildExtraInfoWithPriceMeta(
  userNotes: string,
  meta: ProductPriceRowsMeta
): string | null {
  const notes = userNotes.trim();
  const hasBuy = meta.buy.length > 0;
  const hasSell = meta.sell.length > 0;
  if (!hasBuy && !hasSell && !notes) return null;
  if (!hasBuy && !hasSell) return notes || null;
  const payload = `${PRICE_META_PREFIX}${JSON.stringify(meta)}`;
  return notes ? `${payload}\n${notes}` : payload;
}

function rowsFromMetaSide(
  side: Array<{ price: number; unit: PriceEntryUnit }> | undefined,
  fallback: ProductPriceRow[]
): ProductPriceRow[] {
  if (!side || side.length === 0) return fallback;
  return side.map((row) =>
    createPriceRow(
      Number.isInteger(row.price) ? String(row.price) : row.price.toFixed(2),
      row.unit
    )
  );
}

export function parsePriceRowsFromProduct(product?: Product | null): ProductPriceRowsState {
  const defaultUnit = defaultUnitForProduct(product);
  const meta = parsePriceMetaFromExtraInfo(product?.extra_info);

  if (meta) {
    return {
      buy: rowsFromMetaSide(meta.buy, [createPriceRow("", defaultUnit)]),
      sell: rowsFromMetaSide(meta.sell, [createPriceRow("", defaultUnit)]),
    };
  }

  const buyRows: ProductPriceRow[] = [
    createPriceRow(String(product?.buy_price ?? 0), defaultUnit),
  ];
  if (Number(product?.buy_price_cut) > 0) {
    buyRows.push(createPriceRow(String(product?.buy_price_cut ?? 0), "meter"));
  }

  const sellRows: ProductPriceRow[] = [
    createPriceRow(String(product?.sell_price ?? 0), defaultUnit),
  ];
  if (Number(product?.sell_price_cut) > 0) {
    sellRows.push(createPriceRow(String(product?.sell_price_cut ?? 0), "meter"));
  }

  return { buy: buyRows, sell: sellRows };
}

export function rowsToDbColumns(rows: ProductPriceRowsState): {
  buy_price: number;
  buy_price_cut: number;
  sell_price: number;
  sell_price_cut: number;
} {
  const toNumber = (value: string) => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };

  return {
    buy_price: toNumber(rows.buy[0]?.price ?? "0"),
    buy_price_cut: toNumber(rows.buy[1]?.price ?? "0"),
    sell_price: toNumber(rows.sell[0]?.price ?? "0"),
    sell_price_cut: toNumber(rows.sell[1]?.price ?? "0"),
  };
}

export function rowsToMeta(rows: ProductPriceRowsState): ProductPriceRowsMeta {
  const toEntry = (row: ProductPriceRow) => ({
    price: parseFloat(row.price) || 0,
    unit: row.unit,
  });

  return {
    buy: rows.buy.filter((row) => row.price.trim() !== "").map(toEntry),
    sell: rows.sell.filter((row) => row.price.trim() !== "").map(toEntry),
  };
}
