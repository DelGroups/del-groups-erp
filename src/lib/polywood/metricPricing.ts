import { LENGTH_EPSILON } from "@/lib/polywood/constants";

export interface MetricProductPricing {
  sell_price?: number | null;
  sell_price_cut?: number | null;
  buy_price?: number | null;
  buy_price_cut?: number | null;
  base_length?: number | null;
  full_sheet_length_m?: number | null;
}

function resolveDualMetricPricePerMeter(
  wholePrice: number,
  cutPrice: number | null | undefined,
  requestedM: number,
  product: MetricProductPricing | null | undefined
): number {
  const whole = wholePrice || 0;
  const cut = Number(cutPrice) > 0 ? Number(cutPrice) : whole;
  const barLengthM = resolveBarLengthM(product);
  if (isWholeBarMeterQuantity(requestedM, barLengthM)) {
    return whole;
  }
  return cut;
}

export function resolveBarLengthM(product: MetricProductPricing | null | undefined): number {
  const fromBase = Number(product?.base_length);
  if (fromBase > 0) return fromBase;
  const fromSheet = Number(product?.full_sheet_length_m);
  if (fromSheet > 0) return fromSheet;
  return 4;
}

/** True when requested length is an exact multiple of the standard bar (e.g. 4m, 8m, 12m). */
export function isWholeBarMeterQuantity(
  requestedM: number,
  barLengthM: number,
  epsilon = LENGTH_EPSILON
): boolean {
  if (requestedM <= 0 || barLengthM <= 0) return false;
  const bars = requestedM / barLengthM;
  const rounded = Math.round(bars);
  return rounded > 0 && Math.abs(bars - rounded) <= epsilon;
}

export function resolveMetricSellPricePerMeter(
  product: MetricProductPricing | null | undefined,
  requestedM: number
): number {
  return resolveDualMetricPricePerMeter(
    Number(product?.sell_price) || 0,
    product?.sell_price_cut,
    requestedM,
    product
  );
}

export function resolveMetricBuyPricePerMeter(
  product: MetricProductPricing | null | undefined,
  requestedM: number
): number {
  return resolveDualMetricPricePerMeter(
    Number(product?.buy_price) || 0,
    product?.buy_price_cut,
    requestedM,
    product
  );
}

/** Weighted average buy price per meter across multiple piece lengths. */
export function resolveMetricPurchaseUnitPrice(
  product: MetricProductPricing | null | undefined,
  lengths: number[]
): number {
  if (lengths.length === 0) {
    return Math.round((Number(product?.buy_price) || 0) * 100) / 100;
  }
  const totalM = lengths.reduce((sum, length) => sum + length, 0);
  if (totalM <= 0) return 0;
  const totalCost = lengths.reduce(
    (sum, length) => sum + length * resolveMetricBuyPricePerMeter(product, length),
    0
  );
  return Math.round((totalCost / totalM) * 100) / 100;
}

export function resolvePolywoodLineUnitPrice(
  product: MetricProductPricing | null | undefined,
  requestedM: number,
  mode: "linear_m" | "full_sheet" | null | undefined
): number {
  const barLengthM = resolveBarLengthM(product);
  if (mode === "full_sheet") {
    const perMeter = resolveMetricSellPricePerMeter(product, barLengthM);
    return Math.round(perMeter * barLengthM * 100) / 100;
  }
  const perMeter = resolveMetricSellPricePerMeter(product, requestedM);
  return Math.round(perMeter * 100) / 100;
}
