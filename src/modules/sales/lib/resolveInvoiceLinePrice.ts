import { resolvePolywoodLineUnitPrice } from "@/lib/polywood/metricPricing";
import {
  parsePriceMetaFromExtraInfo,
  type ProductPriceRowsMeta,
} from "@/lib/products/productPriceRows";
import type { PriceEntryUnit } from "@/lib/products/productPriceUnits";

export type InvoiceLineUnit = "Şət" | "Metr" | "m²" | "Ədəd" | "Vərəq";

export interface InvoiceProductLike {
  id?: string;
  name?: string;
  unit?: string | null;
  sell_price?: number | null;
  sell_price_cut?: number | null;
  sale_price?: number | null;
  price?: number | null;
  price_wholesale?: number | null;
  price_distributor?: number | null;
  extra_info?: string | null;
  inventory_mode?: string | null;
  is_dimensional?: boolean | null;
  base_length?: number | null;
  full_sheet_length_m?: number | null;
  base_width?: number | null;
}

export interface InvoiceLinePricingContext {
  unit: string;
  quantity?: number;
  polywood_sale_mode?: "linear_m" | "full_sheet" | null;
  polywood_length_m?: number | null;
  polywood_full_sheet_length_m?: number;
  /** Wholesale/distributor override the flat (piece) price only; retail = product.sell_price. */
  priceTier?: "retail" | "wholesale" | "distributor" | null;
}

/** Flat/piece price resolved for the given tier; retail (or no override set) falls back to sell_price. */
function resolveTieredFlatPrice(
  product: InvoiceProductLike,
  tier: InvoiceLinePricingContext["priceTier"]
): number {
  if (tier === "wholesale" && product.price_wholesale != null) {
    return Number(product.price_wholesale) || 0;
  }
  if (tier === "distributor" && product.price_distributor != null) {
    return Number(product.price_distributor) || 0;
  }
  return Number(product.sell_price ?? product.sale_price ?? product.price) || 0;
}

export function isDimensionalInvoiceProduct(product: InvoiceProductLike | null | undefined): boolean {
  return product?.inventory_mode === "polywood" || Boolean(product?.is_dimensional);
}

export function invoiceUnitToPriceEntryUnit(unit: string): PriceEntryUnit | null {
  const normalized = unit.trim();
  if (normalized === "Metr") return "meter";
  if (normalized === "m²" || normalized === "Kvadrat Metr") return "square_meter";
  if (normalized === "Şət" || normalized === "Vərəq" || normalized === "Ədəd") return "piece";
  return null;
}

export function priceEntryUnitToInvoiceUnit(unit: PriceEntryUnit): InvoiceLineUnit {
  if (unit === "meter") return "Metr";
  if (unit === "square_meter") return "m²";
  return "Şət";
}

function uniqueUnits(units: string[]): InvoiceLineUnit[] {
  const order: InvoiceLineUnit[] = ["Şət", "Vərəq", "Metr", "m²", "Ədəd"];
  const set = new Set(units);
  const result = order.filter((unit) => set.has(unit));
  for (const unit of units) {
    if (!result.includes(unit as InvoiceLineUnit)) {
      result.push(unit as InvoiceLineUnit);
    }
  }
  return result;
}

export function getProductSaleUnitOptions(
  product: InvoiceProductLike | null | undefined
): InvoiceLineUnit[] {
  if (!product) return ["Ədəd"];

  const meta = parsePriceMetaFromExtraInfo(product.extra_info);
  const fromMeta =
    meta?.sell?.map((row) => priceEntryUnitToInvoiceUnit(row.unit)) ?? [];

  if (fromMeta.length > 0) {
    if (isDimensionalInvoiceProduct(product)) {
      fromMeta.push("Metr", "Vərəq");
    }
    return uniqueUnits(fromMeta);
  }

  if (isDimensionalInvoiceProduct(product)) {
    const units: InvoiceLineUnit[] = ["Metr", "Şət"];
    if (Number(product.sell_price_cut) > 0 || product.unit === "Kvadrat Metr") {
      units.push("m²");
    }
    return uniqueUnits(units);
  }

  if (product.unit === "Metr") return ["Metr", "Şət"];
  if (product.unit === "Kvadrat Metr") return ["m²", "Şət"];
  return ["Ədəd"];
}

function resolveFromMeta(
  meta: ProductPriceRowsMeta | null,
  entryUnit: PriceEntryUnit
): number | null {
  if (!meta?.sell?.length) return null;
  const match = meta.sell.find((row) => row.unit === entryUnit);
  return match && match.price >= 0 ? match.price : null;
}

export function resolveInvoiceLineUnitPrice(
  product: InvoiceProductLike | null | undefined,
  context: InvoiceLinePricingContext
): number {
  if (!product) return 0;

  const unit = context.unit;
  const quantity = Number(context.quantity) || 0;
  const barLengthM =
    context.polywood_full_sheet_length_m ||
    Number(product.base_length ?? product.full_sheet_length_m) ||
    4;

  const entryUnit = invoiceUnitToPriceEntryUnit(unit);
  const metaPrice =
    entryUnit !== null
      ? resolveFromMeta(parsePriceMetaFromExtraInfo(product.extra_info), entryUnit)
      : null;
  if (metaPrice !== null) return metaPrice;

  if (isDimensionalInvoiceProduct(product) && (unit === "Metr" || unit === "Vərəq")) {
    const mode = unit === "Vərəq" ? "full_sheet" : context.polywood_sale_mode || "linear_m";
    const requestedM = mode === "full_sheet" ? barLengthM : context.polywood_length_m ?? quantity;
    return resolvePolywoodLineUnitPrice(product, requestedM || barLengthM, mode);
  }

  if (!entryUnit) {
    return resolveTieredFlatPrice(product, context.priceTier);
  }

  if (entryUnit === "meter") {
    return Number(product.sell_price_cut) > 0
      ? Number(product.sell_price_cut)
      : resolveTieredFlatPrice(product, context.priceTier);
  }
  if (entryUnit === "square_meter") {
    return Number(product.sell_price_cut) > 0
      ? Number(product.sell_price_cut)
      : resolveTieredFlatPrice(product, context.priceTier);
  }
  return resolveTieredFlatPrice(product, context.priceTier);
}

export function defaultInvoiceUnitForProduct(
  product: InvoiceProductLike | null | undefined
): InvoiceLineUnit {
  const options = getProductSaleUnitOptions(product);
  if (!product) return "Ədəd";
  if (product.unit === "Metr" && options.includes("Metr")) return "Metr";
  if (product.unit === "Kvadrat Metr" && options.includes("m²")) return "m²";
  return options[0] || "Ədəd";
}
